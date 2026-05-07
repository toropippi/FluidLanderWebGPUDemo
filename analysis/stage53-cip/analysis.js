import { loadUnityBmp } from "../../src/bmp.js";
import { CO } from "../../src/constants.js";
import { UNITY_FLUID_QUALITY } from "../../src/fluidQuality.js";
import { FluidGpuSimulation } from "../../src/fluidGpu.js";
import { GameState, loadUfoCollisionPoints, updateMoveObject } from "../../src/game.js";
import { GameRenderer } from "../../src/render.js";
import { loadStageData } from "../../src/stageData.js";

const canvas = document.getElementById("gameCanvas");
const statusEl = document.getElementById("status");
const elapsedValue = document.getElementById("elapsedValue");
const speedValue = document.getElementById("speedValue");
const objectValue = document.getElementById("objectValue");
const topSlitValue = document.getElementById("topSlitValue");
const maxSpeedValue = document.getElementById("maxSpeedValue");
const energyValue = document.getElementById("energyValue");
const sampleBody = document.getElementById("sampleBody");
const restartBtn = document.getElementById("restartBtn");
const csvBtn = document.getElementById("csvBtn");

const START_SCALE = 0.5;
const SIDE_EXPLOSION_THRESHOLD = 0.15;
const query = new URLSearchParams(window.location.search);

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

const stepsPerTick = intParam("steps", 100, 1, 1000);
const renderEveryFrames = intParam("renderEvery", 8, 1, 10000);
const sampleEveryFrames = intParam("sampleEvery", 1, 1, 10000);
const stopFrame = intParam("stopFrame", 174, 0, 2000);
const endFrame = intParam("endFrame", 720, stopFrame + 1, 100000);

const renderer = new GameRenderer(canvas);
let fluid = null;
let game = null;
let replayStart = 0;
let lastRenderedFrame = 0;
let lastSampleFrame = 0;
let samplePending = false;
let samples = [];
let latestTop = null;
let latestSide = null;
let peakSide = null;
let peakLeftTip = null;
let peakRightTip = null;
let sideExplosionDetected = false;
let restarting = false;
let replayCount = 0;
let loadingReplay = false;
let simFrame = 0;
let replayToken = 0;
let replayHistory = [];
let renderHistory = [];
let snapshotRecords = [];
let currentReplayFinished = false;
let sampleAttempts = 0;
let sampleCompletions = 0;
let sampleSkips = 0;
let lastSampleError = "";
let lastSampleStatus = "idle";

function setStatus(text, kind = "") {
  statusEl.className = kind;
  statusEl.textContent = text;
}

function scenarioScale(frameNumber = simFrame) {
  return frameNumber < stopFrame ? START_SCALE : 0;
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

function updatePeak(current, next) {
  if (!next) {
    return current;
  }
  return next.maxSpeed.value > (current?.maxSpeed.value ?? -Infinity) ? structuredClone(next) : current;
}

function finishReplay(reason) {
  if (currentReplayFinished || replayCount <= 0) {
    return;
  }
  currentReplayFinished = true;
  replayHistory.push({
    replay: replayCount,
    reason,
    detected: sideExplosionDetected,
    simFrame,
    frame: simFrame,
    realElapsed: replayStart ? (performance.now() - replayStart) / 1000 : 0,
    sampleCount: samples.length,
    sampleAttempts,
    sampleCompletions,
    sampleSkips,
    snapshotCount: snapshotRecords.length,
    snapshotFrames: snapshotRecords.map((item) => item.frame),
    stopFrame,
    endFrame,
    stepsPerTick,
    renderEveryFrames,
    renderHistory: [...renderHistory],
    sampleEveryFrames,
    peakSide: structuredClone(peakSide),
    peakLeftTip: structuredClone(peakLeftTip),
    peakRightTip: structuredClone(peakRightTip),
    lastSampleError,
  });
  while (replayHistory.length > 50) {
    replayHistory.shift();
  }
}

function appendSampleRow(sample) {
  const row = document.createElement("tr");
  if (sample.top.maxSpeed.value > 0.18) {
    row.className = "bad";
  } else if (sample.top.maxSpeed.value > 0.11) {
    row.className = "warn";
  }
  row.innerHTML = `
    <td>${sample.frame}</td>
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

async function sampleFluid(frameNumber, scale, token = replayToken) {
  if (samplePending || !fluid?.readVelocityStats) {
    sampleSkips += 1;
    return;
  }
  samplePending = true;
  sampleAttempts += 1;
  lastSampleStatus = "pending";
  try {
    const stats = await fluid.readVelocityStats(objectRegions());
    sampleCompletions += 1;
    lastSampleStatus = `stats:${stats?.length ?? 0}`;
    if (token !== replayToken) {
      return;
    }
    applyVelocityStats(frameNumber, scale, game.stage.moveObjects[0]?.y ?? 0, stats);
  } catch (error) {
    lastSampleError = error?.message ?? String(error);
    lastSampleStatus = "error";
    console.error(error);
  } finally {
    samplePending = false;
  }
}

function applyVelocityStats(frameNumber, scale, objectY, stats) {
  const top = pickTopRegion(stats);
  if (!top) {
    return;
  }
  latestTop = top;
  latestSide = pickTopSide(stats);
  peakSide = updatePeak(peakSide, latestSide);
  peakLeftTip = updatePeak(peakLeftTip, stats.find((item) => item.name === "leftTip"));
  peakRightTip = updatePeak(peakRightTip, stats.find((item) => item.name === "rightTip"));
  const sample = {
    frame: frameNumber,
    scale,
    objectY,
    top,
    side: latestSide,
  };
  samples.push(sample);
  appendSampleRow(sample);
  if ((peakSide?.maxSpeed.value ?? 0) >= SIDE_EXPLOSION_THRESHOLD) {
    sideExplosionDetected = true;
  }
}

function updatePanel(frameNumber, scale) {
  const obj = game?.stage?.moveObjects?.[0];
  const realElapsed = replayStart ? (performance.now() - replayStart) / 1000 : 0;
  elapsedValue.textContent = `${frameNumber} / ${realElapsed.toFixed(2)}s real`;
  speedValue.textContent = `${scale.toFixed(2)}x`;
  objectValue.textContent = obj ? `${obj.x.toFixed(1)}, ${obj.y.toFixed(1)}` : "--";
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
    "frame",
    "scale",
    "objectY",
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
    sample.frame,
    sample.scale,
    sample.objectY,
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
  finishReplay("restart");
  replayToken += 1;
  samples = [];
  sampleAttempts = 0;
  sampleCompletions = 0;
  sampleSkips = 0;
  lastSampleError = "";
  lastSampleStatus = "idle";
  latestTop = null;
  latestSide = null;
  peakSide = null;
  peakLeftTip = null;
  peakRightTip = null;
  renderHistory = [];
  snapshotRecords = [];
  sideExplosionDetected = false;
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
    nextFluid.prepareVelocitySnapshots(Math.ceil(endFrame / sampleEveryFrames) + 1);
    await renderer.load(stage);
    fluid = nextFluid;
    game = new GameState(stage, collisionPoints);
    removeUfoFromAnalysis();
    game.stage.moveObjectSpeedScale = START_SCALE;
    replayStart = performance.now();
    lastRenderedFrame = 0;
    lastSampleFrame = 0;
    simFrame = 0;
    replayCount += 1;
    currentReplayFinished = false;
    setStatus(`Replay running.\nUp to ${stepsPerTick} CFD frames per browser tick. Yield for display every ${renderEveryFrames} CFD frames. Snapshot on GPU every ${sampleEveryFrames} CFD frames.\nMoveobject speed: 0.5x until CFD frame ${stopFrame}, then fixed at 0.0x.\nAt CFD frame ${endFrame}, snapshots are read back once and judged on CPU.`);
    restarting = false;
    renderFrame();
  } finally {
    loadingReplay = false;
  }
}

function renderFrame() {
  const scale = scenarioScale();
  renderer.draw(game, fluid);
  drawAnalysisOverlay();
  updatePanel(simFrame, scale);
  lastRenderedFrame = simFrame;
  renderHistory.push(simFrame);
  while (renderHistory.length > 50) {
    renderHistory.shift();
  }
}

function renderIfDue(force = false) {
  if (force || simFrame - lastRenderedFrame >= renderEveryFrames) {
    renderFrame();
    return true;
  }
  return false;
}

function advanceCfdFrame() {
  const scale = scenarioScale();
  game.stage.moveObjectSpeedScale = scale;
  for (const obj of game.stage.moveObjects ?? []) {
    updateMoveObject(obj, scale);
  }
  removeUfoFromAnalysis();
  fluid.step(game.ufo, game.stage.moveObjects ?? []);
  simFrame += 1;
  return scale;
}

function sampleIfDue(scale) {
  if (simFrame - lastSampleFrame < sampleEveryFrames) {
    return false;
  }
  lastSampleFrame = simFrame;
  const snapshotIndex = snapshotRecords.length;
  sampleAttempts += 1;
  const captured = fluid.captureVelocitySnapshot(snapshotIndex);
  if (!captured) {
    sampleSkips += 1;
    lastSampleStatus = "snapshot-skip";
    return false;
  }
  snapshotRecords.push({
    frame: simFrame,
    scale,
    objectY: game.stage.moveObjects[0]?.y ?? 0,
    regions: objectRegions(),
  });
  lastSampleStatus = `snapshot:${simFrame}`;
  return true;
}

async function finalizeSnapshots(reason) {
  samplePending = true;
  lastSampleStatus = "readback-pending";
  try {
    const token = replayToken;
    const frames = snapshotRecords.map((item) => item.frame);
    const regions = snapshotRecords.map((item) => item.regions);
    const results = await fluid.readVelocitySnapshotStats(frames, regions);
    if (token !== replayToken) {
      return;
    }
    samples = [];
    sampleBody.textContent = "";
    latestTop = null;
    latestSide = null;
    peakSide = null;
    peakLeftTip = null;
    peakRightTip = null;
    sideExplosionDetected = false;
    for (let i = 0; i < results.length; i += 1) {
      const record = snapshotRecords[i];
      applyVelocityStats(results[i].frame, record?.scale ?? 0, record?.objectY ?? 0, results[i].stats);
    }
    sampleCompletions = results.length;
    lastSampleStatus = `readback:${results.length}`;
    finishReplay(sideExplosionDetected ? "trigger" : reason);
    renderFrame();
  } catch (error) {
    lastSampleError = error?.message ?? String(error);
    lastSampleStatus = "error";
    console.error(error);
  } finally {
    samplePending = false;
  }
}

function restartAfterTimeout() {
  restarting = true;
  setStatus(`Reading ${snapshotRecords.length} GPU snapshots for CPU analysis...`);
  finalizeSnapshots("timeout").then(() => {
    if (sideExplosionDetected) {
      setStatus(`Side explosion detected from ${snapshotRecords.length} GPU snapshots.`);
    } else {
      setStatus(`No side explosion by CFD frame ${endFrame}. Restarting replay...`);
      restartReplay().catch((error) => {
        console.error(error);
        setStatus(error.message, "bad");
      });
    }
  });
}

function frame() {
  requestAnimationFrame(frame);
  if (loadingReplay || !game || !fluid) {
    return;
  }
  if (samplePending) {
    return;
  }
  if (currentReplayFinished) {
    return;
  }
  for (let step = 0; step < stepsPerTick; step += 1) {
    if (!restarting && simFrame >= endFrame && !sideExplosionDetected) {
      restartAfterTimeout();
      return;
    }
    const scale = advanceCfdFrame();
    sampleIfDue(scale);
    if (renderIfDue()) {
      return;
    }
  }
  renderIfDue(sideExplosionDetected);
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
      stepsPerTick,
      renderEveryFrames,
      sampleEveryFrames,
      stopFrame,
      endFrame,
      simFrame,
      lastRenderedFrame,
      renderHistory,
      samplePending,
      sampleAttempts,
      sampleCompletions,
      sampleSkips,
      lastSampleStatus,
      lastSampleError,
      snapshotCount: snapshotRecords.length,
      snapshotFrames: snapshotRecords.map((item) => item.frame),
      sideExplosionDetected,
      latestTop,
      latestSide,
      peakSide,
      peakLeftTip,
      peakRightTip,
      replayHistory,
      sampleCount: samples.length,
      samples,
      frame: simFrame,
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
