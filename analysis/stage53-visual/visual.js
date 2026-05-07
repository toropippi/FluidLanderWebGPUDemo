import { loadUnityBmp } from "../../src/bmp.js";
import { CO } from "../../src/constants.js";
import { FluidGpuSimulation } from "../../src/fluidGpu.js";
import { UNITY_FLUID_QUALITY } from "../../src/fluidQuality.js";
import { GameState, loadUfoCollisionPoints } from "../../src/game.js";
import { GameRenderer } from "../../src/render.js";
import { loadStageData } from "../../src/stageData.js";

const canvas = document.getElementById("gameCanvas");
const frameValue = document.getElementById("frameValue");
const moveSpeedValue = document.getElementById("moveSpeedValue");
const objectValue = document.getElementById("objectValue");
const renderValue = document.getElementById("renderValue");
const stateValue = document.getElementById("stateValue");
const statusEl = document.getElementById("status");

const endFrameInput = document.getElementById("endFrameInput");
const stopFrameInput = document.getElementById("stopFrameInput");
const beforeSpeedSlider = document.getElementById("beforeSpeedSlider");
const afterSpeedSlider = document.getElementById("afterSpeedSlider");
const stepsSlider = document.getElementById("stepsSlider");
const renderSlider = document.getElementById("renderSlider");
const endFrameLabel = document.getElementById("endFrameLabel");
const stopFrameLabel = document.getElementById("stopFrameLabel");
const beforeSpeedLabel = document.getElementById("beforeSpeedLabel");
const afterSpeedLabel = document.getElementById("afterSpeedLabel");
const stepsLabel = document.getElementById("stepsLabel");
const renderLabel = document.getElementById("renderLabel");
const playBtn = document.getElementById("playBtn");
const resetBtn = document.getElementById("resetBtn");
const applyBtn = document.getElementById("applyBtn");

const query = new URLSearchParams(window.location.search);
const renderer = new GameRenderer(canvas);

let fluid = null;
let game = null;
let simFrame = 0;
let lastRenderedFrame = 0;
let running = true;
let loading = false;
let endFrame = intParam("endFrame", 1280, 1, 100000);
let stopFrame = intParam("stopFrame", 174, 0, 100000);
let beforeStopSpeed = numberParam("beforeSpeed", 0.5, -2, 2);
let afterStopSpeed = numberParam("afterSpeed", 0, -2, 2);
let stepsPerTick = intParam("steps", 8, 1, 120);
let renderEveryFrames = intParam("renderEvery", 8, 1, 120);

function intParam(name, fallback, min, max) {
  const rawValue = query.get(name);
  if (rawValue === null || rawValue === "") {
    return fallback;
  }
  const value = Number(rawValue);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

function numberParam(name, fallback, min, max) {
  const rawValue = query.get(name);
  if (rawValue === null || rawValue === "") {
    return fallback;
  }
  const value = Number(rawValue);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function configureRotatedStage(stage) {
  const obj = stage.moveObjects?.[0];
  if (!obj) {
    return;
  }
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

function setControlValues() {
  endFrameInput.value = String(endFrame);
  stopFrameInput.value = String(stopFrame);
  beforeSpeedSlider.value = String(beforeStopSpeed);
  afterSpeedSlider.value = String(afterStopSpeed);
  stepsSlider.value = String(stepsPerTick);
  renderSlider.value = String(renderEveryFrames);
  updateLabels();
}

function readControlValues() {
  endFrame = clampInt(Number(endFrameInput.value), 1, 100000, 1280);
  stopFrame = clampInt(Number(stopFrameInput.value), 0, 100000, 174);
  beforeStopSpeed = clampNumber(Number(beforeSpeedSlider.value), -2, 2, 0.5);
  afterStopSpeed = clampNumber(Number(afterSpeedSlider.value), -2, 2, 0);
  stepsPerTick = clampInt(Number(stepsSlider.value), 1, 120, 8);
  renderEveryFrames = clampInt(Number(renderSlider.value), 1, 120, 8);
  if (stopFrame > endFrame) {
    stopFrame = endFrame;
    stopFrameInput.value = String(stopFrame);
  }
  updateLabels();
}

function clampInt(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

function clampNumber(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function updateLabels() {
  endFrameLabel.textContent = String(endFrame);
  stopFrameLabel.textContent = String(stopFrame);
  beforeSpeedLabel.textContent = `${beforeStopSpeed.toFixed(2)}x`;
  afterSpeedLabel.textContent = `${afterStopSpeed.toFixed(2)}x`;
  stepsLabel.textContent = `${stepsPerTick} frames/tick`;
  renderLabel.textContent = `${renderEveryFrames} frames`;
  renderValue.textContent = `${renderEveryFrames} frames`;
  playBtn.textContent = running ? "Pause" : "Play";
}

function scenarioScale(frameNumber = simFrame) {
  return frameNumber < stopFrame ? beforeStopSpeed : afterStopSpeed;
}

function removeUfoFromView() {
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

function updatePanel() {
  const obj = game?.stage?.moveObjects?.[0] ?? null;
  const scale = scenarioScale();
  frameValue.textContent = `${simFrame} / ${endFrame}`;
  moveSpeedValue.textContent = `${scale.toFixed(2)}x horizontal`;
  objectValue.textContent = obj ? `${obj.x.toFixed(1)}, ${obj.y.toFixed(1)}` : "--";
  stateValue.textContent = loading ? "Loading" : simFrame >= endFrame ? "Done" : running ? "Running" : "Paused";
  stateValue.className = simFrame >= endFrame ? "done" : "";
}

function drawOverlay() {
  const obj = game?.stage?.moveObjects?.[0];
  if (!obj) {
    return;
  }
  const ctx = renderer.ctx;
  const width = obj.visualShape?.width ?? obj.width ?? 30;
  const height = obj.visualShape?.height ?? obj.height ?? 2;
  const x0 = renderer.toScreenX(obj.x - width * 0.5);
  const y0 = renderer.toScreenY(obj.y - height * 0.5);
  const x1 = renderer.toScreenX(obj.x + width * 0.5);
  const y1 = renderer.toScreenY(obj.y + height * 0.5);
  ctx.save();
  ctx.strokeStyle = "rgba(255, 210, 125, 0.95)";
  ctx.lineWidth = Math.max(1, 2 * renderer.viewport.scale);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

function renderFrame() {
  if (!game || !fluid) {
    return;
  }
  renderer.draw(game, fluid);
  drawOverlay();
  updatePanel();
  lastRenderedFrame = simFrame;
}

function advanceFrame() {
  const scale = scenarioScale();
  game.stage.moveObjectSpeedScale = scale;
  for (const obj of game.stage.moveObjects ?? []) {
    updateRotatedMoveObject(obj, scale);
  }
  removeUfoFromView();
  fluid.step(game.ufo, game.stage.moveObjects ?? []);
  simFrame += 1;
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

function tick() {
  requestAnimationFrame(tick);
  if (loading || !game || !fluid) {
    return;
  }
  readControlValues();
  if (running && simFrame < endFrame) {
    for (let i = 0; i < stepsPerTick && simFrame < endFrame; i += 1) {
      advanceFrame();
      if (simFrame - lastRenderedFrame >= renderEveryFrames) {
        break;
      }
    }
  }
  renderFrame();
}

async function loadReplay() {
  loading = true;
  readControlValues();
  updatePanel();
  setStatus("Loading Stage 5-3 visual replay...");
  const [stage, ufocoli] = await Promise.all([
    loadStageData("5-3modify"),
    loadUnityBmp("./assets/textures/ufo/ufocoli.bmp"),
  ]);
  configureRotatedStage(stage);
  const collisionPoints = loadUfoCollisionPoints(ufocoli);
  const nextFluid = new FluidGpuSimulation(UNITY_FLUID_QUALITY);
  await nextFluid.loadAssets(stage);
  await renderer.load(stage);
  fluid?.destroy?.();
  fluid = nextFluid;
  game = new GameState(stage, collisionPoints);
  removeUfoFromView();
  simFrame = 0;
  lastRenderedFrame = 0;
  loading = false;
  running = true;
  setStatus(`Visual replay. End ${endFrame}, stop ${stopFrame}.`);
  renderFrame();
}

for (const input of [endFrameInput, stopFrameInput, beforeSpeedSlider, afterSpeedSlider, stepsSlider, renderSlider]) {
  input.addEventListener("input", () => {
    readControlValues();
    updatePanel();
  });
}

playBtn.addEventListener("click", () => {
  if (simFrame >= endFrame) {
    simFrame = 0;
    loadReplay().catch((error) => {
      console.error(error);
      setStatus(error.message);
    });
    return;
  }
  running = !running;
  updateLabels();
  updatePanel();
});

resetBtn.addEventListener("click", () => {
  loadReplay().catch((error) => {
    console.error(error);
    setStatus(error.message);
  });
});

applyBtn.addEventListener("click", () => {
  loadReplay().catch((error) => {
    console.error(error);
    setStatus(error.message);
  });
});

window.__stage53VisualDebug = {
  getState() {
    const obj = game?.stage?.moveObjects?.[0] ?? null;
    return {
      simFrame,
      endFrame,
      stopFrame,
      beforeStopSpeed,
      afterStopSpeed,
      stepsPerTick,
      renderEveryFrames,
      running,
      loading,
      object: obj ? {
        x: obj.x,
        y: obj.y,
        cnt: obj.cnt,
        runtimeSpdX: obj.runtimeSpdX,
        runtimeSpdY: obj.runtimeSpdY,
      } : null,
    };
  },
};

setControlValues();
if (!(await FluidGpuSimulation.isSupported())) {
  setStatus("WebGPU is required for this visual replay.");
} else {
  loadReplay().then(() => {
    requestAnimationFrame(tick);
  }).catch((error) => {
    console.error(error);
    setStatus(error.message);
  });
}
