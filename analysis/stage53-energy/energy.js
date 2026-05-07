import { loadUnityBmp } from "../../src/bmp.js";
import { FluidGpuSimulation } from "../../src/fluidGpu.js";
import { UNITY_FLUID_QUALITY } from "../../src/fluidQuality.js";
import { GameState, loadUfoCollisionPoints, updateMoveObject } from "../../src/game.js";
import { loadStageData } from "../../src/stageData.js";

const chart = document.getElementById("chart");
const ctx = chart.getContext("2d");
const statusEl = document.getElementById("status");
const frameValue = document.getElementById("frameValue");
const peakValue = document.getElementById("peakValue");
const speedValue = document.getElementById("speedValue");
const firstValue = document.getElementById("firstValue");
const snapshotValue = document.getElementById("snapshotValue");
const pngBtn = document.getElementById("pngBtn");
const csvBtn = document.getElementById("csvBtn");

const query = new URLSearchParams(window.location.search);
const START_SCALE = 0.5;

function intParam(name, fallback, min, max) {
  const rawValue = query.get(name);
  if (rawValue === null || rawValue === "") {
    return fallback;
  }
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

const endFrame = intParam("endFrame", 720, 1, 100000);
const stopFrame = intParam("stopFrame", 174, 0, endFrame - 1);
const stepsPerTick = intParam("steps", 100, 1, 1000);
const sampleEveryFrames = intParam("sampleEvery", 1, 1, 10000);
const renderEveryFrames = intParam("renderEvery", 8, 1, 10000);

let fluid = null;
let game = null;
let simFrame = 0;
let lastSnapshotFrame = 0;
let lastRenderedFrame = 0;
let snapshotRecords = [];
let energyTrace = [];
let crossings = {};
let running = false;
let finished = false;
let startTime = 0;

function setStatus(text) {
  statusEl.textContent = text;
}

function scenarioScale(frameNumber = simFrame) {
  return frameNumber < stopFrame ? START_SCALE : 0;
}

function format(value, digits = 6) {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function absPoint(point) {
  return {
    value: Math.abs(point?.value ?? 0),
    signed: point?.value ?? 0,
    x: point?.x ?? 0,
    y: point?.y ?? 0,
  };
}

function strongestGradient(stats) {
  const candidates = [
    ["GXU", stats?.maxAbsGXU],
    ["GYU", stats?.maxAbsGYU],
    ["GXV", stats?.maxAbsGXV],
    ["GYV", stats?.maxAbsGYV],
  ].map(([name, point]) => ({ name, ...absPoint(point) }));
  return candidates.reduce((best, item) => (
    item.value > best.value ? item : best
  ), candidates[0]);
}

function statsRow(stats = {}) {
  const maxSpeed = stats.maxSpeed ?? {};
  const maxAbsU = absPoint(stats.maxAbsU);
  const maxAbsV = absPoint(stats.maxAbsV);
  const maxGrad = strongestGradient(stats);
  return {
    energy: stats.energy ?? 0,
    meanEnergy: stats.meanEnergy ?? 0,
    fluidU: stats.fluidU ?? 0,
    fluidV: stats.fluidV ?? 0,
    maxSpeed: maxSpeed.value ?? 0,
    maxSpeedX: maxSpeed.x ?? 0,
    maxSpeedY: maxSpeed.y ?? 0,
    maxAbsU: maxAbsU.value,
    maxAbsUSigned: maxAbsU.signed,
    maxAbsUX: maxAbsU.x,
    maxAbsUY: maxAbsU.y,
    maxAbsV: maxAbsV.value,
    maxAbsVSigned: maxAbsV.signed,
    maxAbsVX: maxAbsV.x,
    maxAbsVY: maxAbsV.y,
    maxGrad: maxGrad.value,
    maxGradSigned: maxGrad.signed,
    maxGradName: maxGrad.name,
    maxGradX: maxGrad.x,
    maxGradY: maxGrad.y,
  };
}

function firstCrossing(field, threshold) {
  return energyTrace.find((item) => item[field] >= threshold) ?? null;
}

function updateCrossings() {
  crossings = {
    speed010: firstCrossing("maxSpeed", 0.1),
    speed015: firstCrossing("maxSpeed", 0.15),
    speed020: firstCrossing("maxSpeed", 0.2),
    energy1: firstCrossing("energy", 1),
    energy5: firstCrossing("energy", 5),
    grad050: firstCrossing("maxGrad", 0.5),
    grad085: firstCrossing("maxGrad", 0.85),
  };
}

function resizeChart() {
  const rect = chart.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  chart.width = Math.max(1, Math.round(rect.width * dpr));
  chart.height = Math.max(1, Math.round(rect.height * dpr));
}

function drawPanel({ y0, height, label, series, maxValue }) {
  const w = chart.width;
  const padL = 72;
  const padR = 24;
  const plotW = Math.max(1, w - padL - padR);
  const maxY = Math.max(1e-9, maxValue ?? Math.max(1e-9, ...series.flatMap((s) => s.values.map((item) => item.value))));
  const minY = 0;
  const range = Math.max(1e-9, maxY - minY);

  ctx.strokeStyle = "rgba(132, 207, 255, 0.22)";
  ctx.lineWidth = 1;
  ctx.strokeRect(padL, y0, plotW, height);
  for (let i = 1; i < 4; i += 1) {
    const y = y0 + (height * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#9db5c3";
  ctx.font = `${Math.max(11, Math.round(w / 150))}px "Trebuchet MS", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(label, 8, y0 + 12);
  ctx.fillText(format(maxY, 4), 8, y0 + 30);

  const stopX = padL + (Math.min(stopFrame, endFrame) / endFrame) * plotW;
  ctx.strokeStyle = "rgba(255, 210, 125, 0.7)";
  ctx.beginPath();
  ctx.moveTo(stopX, y0);
  ctx.lineTo(stopX, y0 + height);
  ctx.stroke();

  let legendX = padL + 8;
  for (const serie of series) {
    ctx.fillStyle = serie.color;
    ctx.fillText(serie.name, legendX, y0 + 14);
    legendX += ctx.measureText(serie.name).width + 18;
  }

  for (const serie of series) {
    if (serie.values.length <= 1) {
      continue;
    }
    ctx.strokeStyle = serie.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < serie.values.length; i += 1) {
      const item = serie.values[i];
      const x = padL + (item.frame / endFrame) * plotW;
      const y = y0 + height - ((item.value - minY) / range) * height;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
}

function drawChart() {
  resizeChart();
  const w = chart.width;
  const h = chart.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  const padL = 72;
  const padT = 28;
  const padB = 54;
  const gap = 16;
  const panelH = Math.max(1, (h - padT - padB - gap * 2) / 3);
  const values = energyTrace.length ? energyTrace : [{ frame: simFrame, energy: 0, maxSpeed: 0, maxAbsU: 0, maxAbsV: 0, maxGrad: 0 }];

  const plotW = Math.max(1, w - padL - 24);
  const plotH = panelH * 3 + gap * 2;
  ctx.fillStyle = "#9db5c3";
  ctx.fillText("frame 0", padL, padT + plotH + 12);
  ctx.textAlign = "right";
  ctx.fillText(`frame ${endFrame}`, padL + plotW, padT + plotH + 12);
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255, 210, 125, 0.9)";
  ctx.fillText(`stop ${stopFrame}`, padL + (Math.min(stopFrame, endFrame) / endFrame) * plotW + 6, padT + 8);

  drawPanel({
    y0: padT,
    height: panelH,
    label: "total energy",
    series: [{ name: "energy", color: "#73e0ff", values: values.map((item) => ({ frame: item.frame, value: item.energy })) }],
  });
  drawPanel({
    y0: padT + panelH + gap,
    height: panelH,
    label: "velocity",
    series: [
      { name: "speed", color: "#ff7ab6", values: values.map((item) => ({ frame: item.frame, value: item.maxSpeed })) },
      { name: "|u|", color: "#8dff9b", values: values.map((item) => ({ frame: item.frame, value: item.maxAbsU })) },
      { name: "|v|", color: "#ffc85a", values: values.map((item) => ({ frame: item.frame, value: item.maxAbsV })) },
    ],
  });
  drawPanel({
    y0: padT + (panelH + gap) * 2,
    height: panelH,
    label: "max gradient",
    series: [{ name: "grad", color: "#d69cff", values: values.map((item) => ({ frame: item.frame, value: item.maxGrad })) }],
  });
}

function updateStats() {
  frameValue.textContent = `${simFrame}`;
  snapshotValue.textContent = `${snapshotRecords.length}`;
  if (energyTrace.length === 0) {
    peakValue.textContent = "--";
    speedValue.textContent = "--";
    firstValue.textContent = "--";
    return;
  }
  const peak = energyTrace.reduce((best, item) => (
    item.energy > best.energy ? item : best
  ), energyTrace[0]);
  const speedPeak = energyTrace.reduce((best, item) => (
    item.maxSpeed > best.maxSpeed ? item : best
  ), energyTrace[0]);
  peakValue.textContent = `${format(peak.energy, 5)} @ ${peak.frame}`;
  speedValue.textContent = `${format(speedPeak.maxSpeed, 5)} @ ${speedPeak.frame}`;
  firstValue.textContent = crossings.speed015 ? `${crossings.speed015.frame}` : "--";
}

function removeUfoFromAnalysis() {
  if (!game?.ufo) {
    return;
  }
  game.ufo.pos.x = -999;
  game.ufo.pos.y = -999;
  game.ufo.spd.x = 0;
  game.ufo.spd.y = 0;
  game.ufo.nozzleRysPos.x = 900;
  game.ufo.nozzleRysPos.y = 900;
  game.ufo.thrusting = false;
  game.ufo.fastkey = 0;
}

function advanceFrame() {
  const scale = scenarioScale();
  game.stage.moveObjectSpeedScale = scale;
  for (const obj of game.stage.moveObjects ?? []) {
    updateMoveObject(obj, scale);
  }
  removeUfoFromAnalysis();
  fluid.step(game.ufo, game.stage.moveObjects ?? []);
  simFrame += 1;
}

function captureSnapshotIfDue() {
  if (simFrame - lastSnapshotFrame < sampleEveryFrames) {
    return;
  }
  const index = snapshotRecords.length;
  if (!fluid.captureVelocitySnapshot(index)) {
    setStatus(`Snapshot buffer is full at frame ${simFrame}.`);
    running = false;
    return;
  }
  snapshotRecords.push({ frame: simFrame });
  lastSnapshotFrame = simFrame;
}

async function finalizeTrace() {
  running = false;
  setStatus(`Reading ${snapshotRecords.length} full-cell snapshots...`);
  const frames = snapshotRecords.map((item) => item.frame);
  const results = await fluid.readVelocitySnapshotStats(frames, []);
  energyTrace = results.map((item) => ({
    frame: item.frame,
    ...statsRow(item.stats[0]),
  }));
  updateCrossings();
  finished = true;
  const elapsed = (performance.now() - startTime) / 1000;
  updateStats();
  drawChart();
  setStatus(`Done. ${energyTrace.length} samples, ${elapsed.toFixed(2)}s real.`);
}

function tick() {
  if (!running || finished) {
    return;
  }
  for (let i = 0; i < stepsPerTick && simFrame < endFrame; i += 1) {
    advanceFrame();
    captureSnapshotIfDue();
    if (simFrame - lastRenderedFrame >= renderEveryFrames) {
      lastRenderedFrame = simFrame;
      updateStats();
      drawChart();
      requestAnimationFrame(tick);
      return;
    }
  }
  updateStats();
  if (simFrame >= endFrame) {
    finalizeTrace().catch((error) => {
      console.error(error);
      setStatus(error.message);
    });
  } else {
    requestAnimationFrame(tick);
  }
}

function csvText() {
  const header = [
    "frame",
    "totalEnergy",
    "meanEnergy",
    "fluidU",
    "fluidV",
    "maxSpeed",
    "maxSpeedX",
    "maxSpeedY",
    "maxAbsU",
    "maxAbsUX",
    "maxAbsUY",
    "maxAbsV",
    "maxAbsVX",
    "maxAbsVY",
    "maxGrad",
    "maxGradName",
    "maxGradX",
    "maxGradY",
  ].join(",");
  const rows = energyTrace.map((item) => [
    item.frame,
    item.energy,
    item.meanEnergy,
    item.fluidU,
    item.fluidV,
    item.maxSpeed,
    item.maxSpeedX,
    item.maxSpeedY,
    item.maxAbsU,
    item.maxAbsUX,
    item.maxAbsUY,
    item.maxAbsV,
    item.maxAbsVX,
    item.maxAbsVY,
    item.maxGrad,
    item.maxGradName,
    item.maxGradX,
    item.maxGradY,
  ].join(","));
  return [header, ...rows].join("\n");
}

function downloadCsv() {
  const blob = new Blob([csvText()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stage53-energy-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadPng() {
  drawChart();
  const link = document.createElement("a");
  link.href = chart.toDataURL("image/png");
  link.download = `stage53-energy-${Date.now()}.png`;
  link.click();
}

async function start() {
  if (!(await FluidGpuSimulation.isSupported())) {
    setStatus("WebGPU is required for this analysis.");
    return;
  }
  setStatus("Loading Stage 5-3 modify...");
  const [stage, ufocoli] = await Promise.all([
    loadStageData("5-3modify"),
    loadUnityBmp("./assets/textures/ufo/ufocoli.bmp"),
  ]);
  const collisionPoints = loadUfoCollisionPoints(ufocoli);
  fluid = new FluidGpuSimulation(UNITY_FLUID_QUALITY);
  await fluid.loadAssets(stage);
  fluid.prepareVelocitySnapshots(Math.ceil(endFrame / sampleEveryFrames));
  game = new GameState(stage, collisionPoints);
  removeUfoFromAnalysis();
  running = true;
  startTime = performance.now();
  setStatus(`Running ${endFrame} CFD frames. Snapshot every ${sampleEveryFrames} frame(s).`);
  drawChart();
  requestAnimationFrame(tick);
}

pngBtn.addEventListener("click", downloadPng);
csvBtn.addEventListener("click", downloadCsv);
window.addEventListener("resize", drawChart);

window.__stage53EnergyDebug = {
  getState() {
    return {
      endFrame,
      stopFrame,
      stepsPerTick,
      sampleEveryFrames,
      renderEveryFrames,
      simFrame,
      snapshotCount: snapshotRecords.length,
      energyTrace,
      crossings,
      running,
      finished,
    };
  },
};

start().catch((error) => {
  console.error(error);
  setStatus(error.message);
});
