import { loadUnityBmp } from "../../src/bmp.js";
import { CO } from "../../src/constants.js";
import { FluidGpuSimulation } from "../../src/fluidGpu.js";
import { UNITY_FLUID_QUALITY } from "../../src/fluidQuality.js";
import { GameState, loadUfoCollisionPoints, updateMoveObject } from "../../src/game.js";
import { loadStageData } from "../../src/stageData.js";

const chart = document.getElementById("chart");
const ctx = chart.getContext("2d");
const statusEl = document.getElementById("status");
const frameValue = document.getElementById("frameValue");
const horizontalPeakValue = document.getElementById("horizontalPeakValue");
const verticalPeakValue = document.getElementById("verticalPeakValue");
const sampleValue = document.getElementById("sampleValue");
const pngBtn = document.getElementById("pngBtn");
const csvBtn = document.getElementById("csvBtn");

const query = new URLSearchParams(window.location.search);
const START_SCALE = 0.5;
const endFrame = intParam("endFrame", 3000, 1, 100000);
const stopFrame = intParam("stopFrame", 174, 0, endFrame - 1);
const stepsPerTick = intParam("steps", 120, 1, 1000);
const sampleEveryFrames = intParam("sampleEvery", 1, 1, 10000);
const renderEveryFrames = intParam("renderEvery", 60, 1, 10000);

let traces = { horizontal: [], vertical: [] };
let currentFrame = 0;
let currentCondition = "";
let running = false;
let finished = false;

function intParam(name, fallback, min, max) {
  const rawValue = query.get(name);
  if (rawValue === null || rawValue === "") {
    return Math.max(min, Math.min(max, Math.round(fallback)));
  }
  const value = Number(rawValue);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function scenarioScale(frameNumber) {
  return frameNumber < stopFrame ? START_SCALE : 0;
}

function removeUfo(game) {
  if (!game?.ufo) return;
  game.ufo.pos.x = -999;
  game.ufo.pos.y = -999;
  game.ufo.spd.x = 0;
  game.ufo.spd.y = 0;
  game.ufo.nozzleRysPos.x = 900;
  game.ufo.nozzleRysPos.y = 900;
  game.ufo.thrusting = false;
  game.ufo.fastkey = 0;
}

function configureVerticalStage(stage) {
  const obj = stage.moveObjects?.[0];
  if (!obj) return;
  obj.x = 96;
  obj.y = 72;
  obj.spdX = 0;
  obj.spdY = 0;
  obj.runtimeSpdX = 0;
  obj.runtimeSpdY = 0;
  obj.rad = 0;
  obj.radspd = 0;
  obj.runtimeRadspd = 0;
  obj.cnt = 0;
  obj.syntheticShape = { width: 2, height: 30 };
  obj.visualShape = { width: 2, height: 30 };
}

function updateRotatedMoveObject(obj, speedScale = 1) {
  const moveScale = Number.isFinite(speedScale) ? speedScale : 1;
  obj.runtimeSpdX = obj.spdX * moveScale;
  obj.runtimeSpdY = obj.spdY * moveScale;
  obj.runtimeRadspd = obj.radspd * moveScale;
  obj.x += obj.runtimeSpdX * CO.DT * CO.CFDFRAME_PAR_GAMEFRAME;
  obj.y += obj.runtimeSpdY * CO.DT * CO.CFDFRAME_PAR_GAMEFRAME;
  obj.rad += obj.runtimeRadspd * CO.DT * CO.CFDFRAME_PAR_GAMEFRAME;
  obj.rad = ((obj.rad + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  obj.spdX = -0.03 * Math.cos(0.02 * obj.cnt);
  obj.spdY = 0;
  obj.radspd = 0;
  obj.runtimeSpdX = obj.spdX * moveScale;
  obj.runtimeSpdY = obj.spdY * moveScale;
  obj.runtimeRadspd = obj.radspd * moveScale;
  obj.cnt += 1;
}

function absPoint(point) {
  return { value: Math.abs(point?.value ?? 0), x: point?.x ?? 0, y: point?.y ?? 0 };
}

function statsRow(stats = {}) {
  const maxSpeed = stats.maxSpeed ?? {};
  const maxAbsU = absPoint(stats.maxAbsU);
  const maxAbsV = absPoint(stats.maxAbsV);
  return {
    energy: stats.energy ?? 0,
    meanEnergy: stats.meanEnergy ?? 0,
    maxSpeed: maxSpeed.value ?? 0,
    maxSpeedX: maxSpeed.x ?? 0,
    maxSpeedY: maxSpeed.y ?? 0,
    maxAbsU: maxAbsU.value,
    maxAbsV: maxAbsV.value,
  };
}

function resizeChart() {
  const rect = chart.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  chart.width = Math.max(1, Math.round(rect.width * dpr));
  chart.height = Math.max(1, Math.round(rect.height * dpr));
}

function drawChart() {
  resizeChart();
  const w = chart.width;
  const h = chart.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  const padL = 82;
  const padR = 28;
  const padT = 42;
  const padB = 58;
  const plotW = Math.max(1, w - padL - padR);
  const plotH = Math.max(1, h - padT - padB);
  const all = [...traces.horizontal, ...traces.vertical];
  const maxEnergy = Math.max(1e-9, ...all.map((item) => item.energy));

  ctx.strokeStyle = "rgba(132, 207, 255, 0.24)";
  ctx.lineWidth = 1;
  ctx.strokeRect(padL, padT, plotW, plotH);
  for (let i = 1; i < 5; i += 1) {
    const y = padT + (plotH * i) / 5;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
  }

  const stopX = padL + (Math.min(stopFrame, endFrame) / endFrame) * plotW;
  ctx.strokeStyle = "rgba(255, 210, 125, 0.72)";
  ctx.beginPath();
  ctx.moveTo(stopX, padT);
  ctx.lineTo(stopX, padT + plotH);
  ctx.stroke();

  ctx.font = `${Math.max(11, Math.round(w / 150))}px "Trebuchet MS", sans-serif`;
  ctx.fillStyle = "#9db5c3";
  ctx.textAlign = "left";
  ctx.fillText(`total energy, frame 0-${endFrame}, stop ${stopFrame}`, padL, 22);
  ctx.fillText(`max ${format(maxEnergy, 5)}`, 12, padT + 14);
  ctx.fillText("0", padL, padT + plotH + 22);
  ctx.textAlign = "right";
  ctx.fillText(String(endFrame), padL + plotW, padT + plotH + 22);
  ctx.textAlign = "left";

  drawSeries(traces.horizontal, "#73e0ff", "horizontal bar, vertical move", padL, padT, plotW, plotH, maxEnergy);
  drawSeries(traces.vertical, "#ff9d66", "vertical bar, horizontal move", padL, padT, plotW, plotH, maxEnergy);
}

function drawSeries(values, color, label, padL, padT, plotW, plotH, maxEnergy) {
  ctx.fillStyle = color;
  ctx.fillText(label, padL + 10, label.startsWith("horizontal") ? padT + 16 : padT + 34);
  if (values.length <= 1) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < values.length; i += 1) {
    const item = values[i];
    const x = padL + (item.frame / endFrame) * plotW;
    const y = padT + plotH - (item.energy / maxEnergy) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function format(value, digits = 6) {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function peak(trace) {
  return trace.reduce((best, item) => item.energy > best.energy ? item : best, trace[0] ?? { frame: 0, energy: 0 });
}

function updateStats() {
  frameValue.textContent = `${currentCondition ? `${currentCondition} ` : ""}${currentFrame} / ${endFrame}`;
  const hp = peak(traces.horizontal);
  const vp = peak(traces.vertical);
  horizontalPeakValue.textContent = traces.horizontal.length ? `${format(hp.energy, 5)} @ ${hp.frame}` : "--";
  verticalPeakValue.textContent = traces.vertical.length ? `${format(vp.energy, 5)} @ ${vp.frame}` : "--";
  sampleValue.textContent = `${traces.horizontal.length} / ${traces.vertical.length}`;
}

async function runCondition(kind, collisionPoints) {
  currentCondition = kind;
  currentFrame = 0;
  updateStats();
  drawChart();

  const stage = await loadStageData("5-3modify");
  if (kind === "vertical") configureVerticalStage(stage);
  const fluid = new FluidGpuSimulation(UNITY_FLUID_QUALITY);
  await fluid.loadAssets(stage);
  const game = new GameState(stage, collisionPoints);
  removeUfo(game);

  let simFrame = 0;
  let lastRenderedFrame = 0;
  let lastSampleFrame = 0;
  traces[kind] = [];

  while (simFrame < endFrame) {
    for (let i = 0; i < stepsPerTick && simFrame < endFrame; i += 1) {
      const scale = scenarioScale(simFrame);
      game.stage.moveObjectSpeedScale = scale;
      for (const obj of game.stage.moveObjects ?? []) {
        if (kind === "vertical") updateRotatedMoveObject(obj, scale);
        else updateMoveObject(obj, scale);
      }
      removeUfo(game);
      fluid.step(game.ufo, game.stage.moveObjects ?? []);
      simFrame += 1;
      if (simFrame - lastSampleFrame >= sampleEveryFrames) {
        const stats = await fluid.readVelocityStats([]);
        traces[kind].push({ frame: simFrame, ...statsRow(stats[0]) });
        lastSampleFrame = simFrame;
      }
    }
    currentFrame = simFrame;
    if (simFrame - lastRenderedFrame >= renderEveryFrames || simFrame >= endFrame) {
      lastRenderedFrame = simFrame;
      setStatus(`${kind}: simulated ${simFrame}/${endFrame}. Samples ${traces[kind].length}.`);
      updateStats();
      drawChart();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  fluid.destroy();
  currentFrame = endFrame;
  updateStats();
  drawChart();
}

function csvText() {
  const rowsByFrame = new Map();
  for (const item of traces.horizontal) {
    rowsByFrame.set(item.frame, { frame: item.frame, horizontalEnergy: item.energy, horizontalMaxSpeed: item.maxSpeed });
  }
  for (const item of traces.vertical) {
    const row = rowsByFrame.get(item.frame) ?? { frame: item.frame };
    row.verticalEnergy = item.energy;
    row.verticalMaxSpeed = item.maxSpeed;
    rowsByFrame.set(item.frame, row);
  }
  const rows = [...rowsByFrame.values()].sort((a, b) => a.frame - b.frame);
  const header = "frame,horizontalEnergy,verticalEnergy,horizontalMaxSpeed,verticalMaxSpeed";
  return [header, ...rows.map((row) => [
    row.frame,
    row.horizontalEnergy ?? "",
    row.verticalEnergy ?? "",
    row.horizontalMaxSpeed ?? "",
    row.verticalMaxSpeed ?? "",
  ].join(","))].join("\n");
}

function downloadCsv() {
  const blob = new Blob([csvText()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stage53-energy-compare-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadPng() {
  drawChart();
  const link = document.createElement("a");
  link.href = chart.toDataURL("image/png");
  link.download = `stage53-energy-compare-${Date.now()}.png`;
  link.click();
}

pngBtn.addEventListener("click", downloadPng);
csvBtn.addEventListener("click", downloadCsv);
window.addEventListener("resize", drawChart);

window.__stage53EnergyCompareDebug = {
  getState() {
    return {
      endFrame,
      stopFrame,
      stepsPerTick,
      sampleEveryFrames,
      renderEveryFrames,
      currentCondition,
      currentFrame,
      running,
      finished,
      traces,
    };
  },
};

async function start() {
  if (!(await FluidGpuSimulation.isSupported())) {
    setStatus("WebGPU is required for this comparison.");
    return;
  }
  running = true;
  setStatus("Loading collision data...");
  drawChart();
  const ufocoli = await loadUnityBmp("./assets/textures/ufo/ufocoli.bmp");
  const collisionPoints = loadUfoCollisionPoints(ufocoli);
  await runCondition("horizontal", collisionPoints);
  await runCondition("vertical", collisionPoints);
  currentCondition = "";
  running = false;
  finished = true;
  setStatus(`Done. ${traces.horizontal.length} horizontal samples, ${traces.vertical.length} vertical samples.`);
  updateStats();
  drawChart();
}

start().catch((error) => {
  console.error(error);
  running = false;
  setStatus(error.message);
});
