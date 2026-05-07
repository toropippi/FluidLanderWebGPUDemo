import { loadUnityBmp } from "../../src/bmp.js";
import { CO } from "../../src/constants.js";
import { UNITY_FLUID_QUALITY } from "../../src/fluidQuality.js";
import { FluidGpuSimulation } from "../../src/fluidGpu.js";
import { GameState, loadUfoCollisionPoints, updateMoveObject } from "../../src/game.js";
import { GameRenderer } from "../../src/render.js";
import { loadStageData } from "../../src/stageData.js";

const canvas = document.getElementById("gameCanvas");
const statusEl = document.getElementById("status");
const simValue = document.getElementById("simValue");
const elapsedValue = document.getElementById("elapsedValue");
const frameValue = document.getElementById("frameValue");
const speedValue = document.getElementById("speedValue");
const objectValue = document.getElementById("objectValue");
const stopValue = document.getElementById("stopValue");
const triggerValue = document.getElementById("triggerValue");
const topSlitValue = document.getElementById("topSlitValue");
const maxSpeedValue = document.getElementById("maxSpeedValue");
const energyValue = document.getElementById("energyValue");
const sampleBody = document.getElementById("sampleBody");
const restartBtn = document.getElementById("restartBtn");
const csvBtn = document.getElementById("csvBtn");

const START_SCALE = 0.5;
const STOP_AFTER_MS = 3000;
const SAMPLE_INTERVAL_MS = 500;
const AUTO_RESTART_AFTER_MS = 12000;
const SIDE_EXPLOSION_THRESHOLD = 0.15;
const FIXED_STOP_FRAME = null;
const urlParams = new URLSearchParams(window.location.search);
const TIME_SCALE = Math.max(1, Math.min(50, Number.parseFloat(urlParams.get("timescale") ?? "10") || 10));

const renderer = new GameRenderer(canvas);
let fluid = null;
let game = null;
let replayStart = 0;
let simElapsed = 0;
let lastRealNow = 0;
let lastSample = 0;
let samplePending = false;
let samples = [];
let latestTop = null;
let latestSide = null;
let peakSide = null;
let sideExplosionDetected = false;
let restarting = false;
let replayCount = 0;
let loadingReplay = false;
let simFrame = 0;
let speedStopRecord = null;
let triggerRecord = null;
let currentReplayRecord = null;
let replayHistory = [];

function setStatus(text, kind = "") {
  statusEl.className = kind;
  statusEl.textContent = text;
}

function scenarioScale(elapsedMs) {
  if (Number.isFinite(FIXED_STOP_FRAME)) {
    return simFrame < FIXED_STOP_FRAME ? START_SCALE : 0;
  }
  return elapsedMs < STOP_AFTER_MS ? START_SCALE : 0;
}

function simElapsedMs() {
  return simElapsed;
}

function format(value, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function objectRegions() {
  const obj = game?.stage?.moveObjects?.[0];
  if (!obj) {
    return [];
  }
  const width = obj.visualShape?.width ?? obj.width ?? 30;
  const height = obj.visualShape?.height ?? obj.height ?? 2;
  const x0 = Math.max(0, Math.floor(obj.x - width * 0.5));
  const x1 = Math.min(CO.WX - 1, Math.ceil(obj.x + width * 0.5));
  const y0 = Math.max(0, Math.floor(obj.y - height * 0.5));
  const y1 = Math.min(CO.WY - 1, Math.ceil(obj.y + height * 0.5));
  const mx = 8;
  const my = 8;
  return [
    { name: "localBand", x0: Math.max(0, x0 - mx), y0: Math.max(0, y0 - my), x1: Math.min(CO.WX - 1, x1 + mx), y1: Math.min(CO.WY - 1, y1 + my) },
    { name: "above", x0: Math.max(0, x0 - mx), y0: Math.max(0, y0 - my), x1: Math.min(CO.WX - 1, x1 + mx), y1: Math.max(0, y0 - 1) },
    { name: "below", x0: Math.max(0, x0 - mx), y0: Math.min(CO.WY - 1, y1 + 1), x1: Math.min(CO.WX - 1, x1 + mx), y1: Math.min(CO.WY - 1, y1 + my) },
    { name: "leftTip", x0: Math.max(0, x0 - mx), y0: Math.max(0, y0 - my), x1: Math.max(0, x0 - 1), y1: Math.min(CO.WY - 1, y1 + my) },
    { name: "rightTip", x0: Math.min(CO.WX - 1, x1 + 1), y0: Math.max(0, y0 - my), x1: Math.min(CO.WX - 1, x1 + mx), y1: Math.min(CO.WY - 1, y1 + my) },
  ];
}

function pickTopRegion(stats) {
  const regionStats = stats.filter((item) => item.name !== "all");
  return regionStats.reduce((best, item) => (
    item.maxSpeed.value > (best?.maxSpeed.value ?? -Infinity) ? item : best
  ), null);
}

function pickTopSide(stats) {
  const sideStats = stats.filter((item) => item.name === "leftTip" || item.name === "rightTip");
  return sideStats.reduce((best, item) => (
    item.maxSpeed.value > (best?.maxSpeed.value ?? -Infinity) ? item : best
  ), null);
}

function pickNamedRegion(stats, name) {
  return stats.find((item) => item.name === name) ?? null;
}

function appendSampleRow(sample) {
  const row = document.createElement("tr");
  if (sample.top.maxSpeed.value > 0.18) {
    row.className = "bad";
  } else if (sample.top.maxSpeed.value > 0.11) {
    row.className = "warn";
  }
  row.innerHTML = `
    <td>${format(sample.elapsed, 1)}</td>
    <td>${sample.simFrame}</td>
    <td>${format(sample.scale, 2)}</td>
    <td>${sample.top.name}</td>
    <td>${format(sample.top.maxSpeed.value)}</td>
    <td>${format(sample.top.maxAbsU.value)}</td>
    <td>${format(sample.top.maxAbsV.value)}</td>
    <td>${format(sample.top.meanEnergy, 6)}</td>
  `;
  sampleBody.prepend(row);
  while (sampleBody.children.length > 20) {
    sampleBody.lastElementChild.remove();
  }
}

function makeSpeedStopRecord(elapsedMs) {
  const obj = game?.stage?.moveObjects?.[0];
  return {
    replay: replayCount,
    simFrame,
    elapsed: elapsedMs / 1000,
    elapsedMs,
    objectX: obj?.x ?? 0,
    objectY: obj?.y ?? 0,
    objectCnt: obj?.cnt ?? 0,
    runtimeSpdY: obj?.runtimeSpdY ?? obj?.spdY ?? 0,
    mode: Number.isFinite(FIXED_STOP_FRAME) ? "fixed-replay" : "wall-clock",
  };
}

function cloneSideRecord(record) {
  return record ? structuredClone(record) : null;
}

function updateReplayRecord(sample) {
  if (!currentReplayRecord) {
    return;
  }
  currentReplayRecord.sampleCount = samples.length;
  currentReplayRecord.latestElapsed = sample.elapsed;
  currentReplayRecord.stop = speedStopRecord;
  currentReplayRecord.maxTop = Math.max(currentReplayRecord.maxTop, sample.top.maxSpeed.value);
  currentReplayRecord.maxLeftTip = Math.max(currentReplayRecord.maxLeftTip, sample.leftSide?.maxSpeed.value ?? 0);
  currentReplayRecord.maxRightTip = Math.max(currentReplayRecord.maxRightTip, sample.rightSide?.maxSpeed.value ?? 0);
  currentReplayRecord.peakSide = cloneSideRecord(peakSide);
  currentReplayRecord.trigger = triggerRecord;
}

function makeTriggerRecord(elapsedMs, side) {
  return {
    replay: replayCount,
    simFrame,
    elapsed: elapsedMs / 1000,
    elapsedMs,
    stop: speedStopRecord,
    peakSide: cloneSideRecord(side),
    peakSpeed: side?.maxSpeed.value ?? 0,
  };
}

async function sampleFluid(elapsedMs, scale) {
  if (samplePending || !fluid?.readVelocityStats) {
    return;
  }
  samplePending = true;
  try {
    const stats = await fluid.readVelocityStats(objectRegions());
    const top = pickTopRegion(stats);
    if (!top) {
      return;
    }
    latestTop = top;
    latestSide = pickTopSide(stats);
    const leftSide = pickNamedRegion(stats, "leftTip");
    const rightSide = pickNamedRegion(stats, "rightTip");
    if ((latestSide?.maxSpeed.value ?? 0) > (peakSide?.maxSpeed.value ?? -Infinity)) {
      peakSide = structuredClone(latestSide);
    }
    if ((peakSide?.maxSpeed.value ?? 0) >= SIDE_EXPLOSION_THRESHOLD) {
      sideExplosionDetected = true;
      if (!triggerRecord) {
        triggerRecord = makeTriggerRecord(elapsedMs, peakSide);
      }
    }
    const sample = {
      replay: replayCount,
      simFrame,
      elapsed: elapsedMs / 1000,
      scale,
      objectY: game.stage.moveObjects[0]?.y ?? 0,
      top,
      side: latestSide,
      leftSide,
      rightSide,
      stop: speedStopRecord,
      trigger: triggerRecord,
    };
    samples.push(sample);
    updateReplayRecord(sample);
    appendSampleRow(sample);
  } finally {
    samplePending = false;
  }
}

function updatePanel(elapsedMs, scale) {
  const obj = game?.stage?.moveObjects?.[0];
  simValue.textContent = `time x${TIME_SCALE}`;
  elapsedValue.textContent = `${(elapsedMs / 1000).toFixed(2)}s`;
  frameValue.textContent = `${simFrame}`;
  speedValue.textContent = `${scale.toFixed(2)}x`;
  objectValue.textContent = obj ? `${obj.x.toFixed(1)}, ${obj.y.toFixed(1)}` : "--";
  stopValue.textContent = speedStopRecord
    ? `f${speedStopRecord.simFrame} y${format(speedStopRecord.objectY, 2)} cnt${speedStopRecord.objectCnt}`
    : "--";
  triggerValue.textContent = triggerRecord
    ? `f${triggerRecord.simFrame} ${triggerRecord.peakSide?.name ?? "--"}:${format(triggerRecord.peakSpeed)}`
    : "--";
  if (latestTop) {
    const sideText = latestSide ? ` side ${latestSide.name}:${format(latestSide.maxSpeed.value)}` : "";
    topSlitValue.textContent = `${latestTop.name} @ ${latestTop.maxSpeed.x},${latestTop.maxSpeed.y}${sideText}`;
    maxSpeedValue.textContent = format(latestTop.maxSpeed.value);
    energyValue.textContent = format(latestTop.meanEnergy, 6);
  }
}

function drawAnalysisOverlay() {
  if (!game || !latestTop) {
    return;
  }
  const ctx = renderer.ctx;
  const obj = game.stage.moveObjects?.[0];
  if (!obj) {
    return;
  }
  const width = obj.visualShape?.width ?? obj.width ?? 30;
  const height = obj.visualShape?.height ?? obj.height ?? 2;
  const x0 = Math.max(0, Math.floor(obj.x - width * 0.5));
  const x1 = Math.min(CO.WX - 1, Math.ceil(obj.x + width * 0.5));
  const y0 = Math.max(0, Math.floor(obj.y - height * 0.5));
  const y1 = Math.min(CO.WY - 1, Math.ceil(obj.y + height * 0.5));
  ctx.save();
  ctx.lineWidth = Math.max(1, 2 * renderer.viewport.scale);
  ctx.strokeStyle = "rgba(210, 230, 255, 0.72)";
  ctx.strokeRect(
    renderer.toScreenX(0),
    renderer.toScreenY(0),
    CO.WX * CO.TEXSCALE * renderer.viewport.scale,
    CO.WY * CO.TEXSCALE * renderer.viewport.scale,
  );
  ctx.strokeStyle = "rgba(255, 210, 115, 0.92)";
  ctx.strokeRect(
    renderer.toScreenX(x0),
    renderer.toScreenY(y0),
    (x1 - x0 + 1) * CO.TEXSCALE * renderer.viewport.scale,
    (y1 - y0 + 1) * CO.TEXSCALE * renderer.viewport.scale,
  );
  ctx.fillStyle = latestTop.maxSpeed.value > 0.18 ? "rgba(255, 70, 60, 0.95)" : "rgba(111, 231, 255, 0.95)";
  ctx.beginPath();
  ctx.arc(renderer.toScreenX(latestTop.maxSpeed.x), renderer.toScreenY(latestTop.maxSpeed.y), 7 * renderer.viewport.scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function csvText() {
  const header = [
    "replay",
    "simFrame",
    "elapsed",
    "scale",
    "objectY",
    "speedStopFrame",
    "speedStopElapsedMs",
    "stopObjectY",
    "stopObjectCnt",
    "stopRuntimeSpdY",
    "triggerFrame",
    "triggerSide",
    "triggerSpeed",
    "slit",
    "maxSpeed",
    "maxSpeedX",
    "maxSpeedY",
    "maxU",
    "maxUX",
    "maxUY",
    "maxV",
    "maxVX",
    "maxVY",
    "meanEnergy",
  ];
  const lines = samples.map((sample) => [
    sample.replay,
    sample.simFrame,
    sample.elapsed,
    sample.scale,
    sample.objectY,
    sample.stop?.simFrame ?? "",
    sample.stop?.elapsedMs ?? "",
    sample.stop?.objectY ?? "",
    sample.stop?.objectCnt ?? "",
    sample.stop?.runtimeSpdY ?? "",
    sample.trigger?.simFrame ?? "",
    sample.trigger?.peakSide?.name ?? "",
    sample.trigger?.peakSpeed ?? "",
    sample.top.name,
    sample.top.maxSpeed.value,
    sample.top.maxSpeed.x,
    sample.top.maxSpeed.y,
    sample.top.maxAbsU.value,
    sample.top.maxAbsU.x,
    sample.top.maxAbsU.y,
    sample.top.maxAbsV.value,
    sample.top.maxAbsV.x,
    sample.top.maxAbsV.y,
    sample.top.meanEnergy,
  ].join(","));
  return [header.join(","), ...lines].join("\n");
}

function downloadCsv() {
  const blob = new Blob([csvText()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stage53-cip-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
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

async function restartReplay() {
  setStatus("Loading 5-3modify analysis replay...");
  samples = [];
  latestTop = null;
  latestSide = null;
  peakSide = null;
  sideExplosionDetected = false;
  speedStopRecord = null;
  triggerRecord = null;
  sampleBody.textContent = "";
  loadingReplay = true;
  try {
    const [stage, ufocoli] = await Promise.all([
      loadStageData("5-3modify"),
      loadUnityBmp("./assets/textures/ufo/ufocoli.bmp"),
    ]);
    const collisionPoints = loadUfoCollisionPoints(ufocoli);
    const nextFluid = new FluidGpuSimulation(UNITY_FLUID_QUALITY);
    await nextFluid.loadAssets(stage);
    await renderer.load(stage);
    fluid = nextFluid;
    game = new GameState(stage, collisionPoints);
    removeUfoFromAnalysis();
    game.stage.moveObjectSpeedScale = START_SCALE;
    replayStart = performance.now();
    lastRealNow = replayStart;
    simElapsed = 0;
    lastSample = 0;
    replayCount += 1;
    simFrame = 0;
    currentReplayRecord = {
      replay: replayCount,
      mode: Number.isFinite(FIXED_STOP_FRAME) ? "fixed-replay" : "wall-clock",
      maxTop: 0,
      maxLeftTip: 0,
      maxRightTip: 0,
      sampleCount: 0,
      stop: null,
      trigger: null,
      peakSide: null,
    };
    replayHistory.push(currentReplayRecord);
    setStatus(`Replay running.\nMoveobject speed: 0.5x for the first 3 simulated seconds, then fixed at 0.0x.\nSimulation time scale is x${TIME_SCALE}.\nIf left/right side speed stays below 0.15 for 12 simulated seconds, replay restarts automatically.`);
    restarting = false;
  } finally {
    loadingReplay = false;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (loadingReplay || !game || !fluid) {
    return;
  }
  const realDelta = Math.max(0, now - lastRealNow);
  lastRealNow = now;
  simElapsed += realDelta * TIME_SCALE;
  const elapsedMs = simElapsedMs();
  if (!restarting && elapsedMs >= AUTO_RESTART_AFTER_MS && !sideExplosionDetected) {
    restarting = true;
    setStatus("No side explosion by 12 simulated seconds. Restarting replay...");
    restartReplay().catch((error) => {
      console.error(error);
      setStatus(error.message, "bad");
    });
    return;
  }
  const scale = scenarioScale(elapsedMs);
  if (scale === 0 && !speedStopRecord) {
    speedStopRecord = makeSpeedStopRecord(elapsedMs);
    if (currentReplayRecord) {
      currentReplayRecord.stop = speedStopRecord;
    }
  }
  game.stage.moveObjectSpeedScale = scale;
  for (const obj of game.stage.moveObjects ?? []) {
    updateMoveObject(obj, scale);
  }
  removeUfoFromAnalysis();
  fluid.step(game.ufo, game.stage.moveObjects ?? []);
  renderer.draw(game, fluid);
  drawAnalysisOverlay();
  updatePanel(elapsedMs, scale);
  if (elapsedMs - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = elapsedMs;
    sampleFluid(elapsedMs, scale);
  }
  simFrame += 1;
}

restartBtn.addEventListener("click", () => {
  restartReplay().catch((error) => {
    console.error(error);
    setStatus(error.message, "bad");
  });
});
csvBtn.addEventListener("click", downloadCsv);

window.__stage53AnalysisDebug = {
  getState() {
    return {
      replayCount,
      sideExplosionDetected,
      latestTop,
      latestSide,
      peakSide,
      speedStopRecord,
      triggerRecord,
      replayHistory,
      simFrame,
      mode: Number.isFinite(FIXED_STOP_FRAME) ? "fixed-replay" : "wall-clock",
      fixedStopFrame: FIXED_STOP_FRAME,
      timeScale: TIME_SCALE,
      sampleCount: samples.length,
      samples,
      elapsed: simElapsedMs() / 1000,
      realElapsed: replayStart ? (performance.now() - replayStart) / 1000 : 0,
    };
  },
};

if (!(await FluidGpuSimulation.isSupported())) {
  setStatus("WebGPU is required for this analysis replay.", "bad");
} else {
  await restartReplay();
  requestAnimationFrame(frame);
}
