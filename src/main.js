import { loadUnityBmp } from "./bmp.js";
import { UNITY_FLUID_QUALITY } from "./fluidQuality.js";
import { FluidGpuSimulation } from "./fluidGpu.js";
import { GameRenderer } from "./render.js";
import { InputState, GameState, loadUfoCollisionPoints } from "./game.js";
import { loadStageData } from "./stageData.js";

const canvas = document.getElementById("gameCanvas");
const statusEl = document.getElementById("status");
const stageValue = document.getElementById("stageValue");
const timeValue = document.getElementById("timeValue");
const hpValue = document.getElementById("hpValue");
const rareValue = document.getElementById("rareValue");
const goalValue = document.getElementById("goalValue");
const fpsValue = document.getElementById("fpsValue");
const stageSelect = document.getElementById("stageSelect");
const restartBtn = document.getElementById("restartBtn");
const moveSpeedRow = document.getElementById("moveSpeedRow");
const moveSpeedSlider = document.getElementById("moveSpeedSlider");
const moveSpeedValue = document.getElementById("moveSpeedValue");

const input = new InputState();
input.attach();

const renderer = new GameRenderer(canvas);
let fluid = null;
let game = null;
let collisionPoints = [];
let currentStageId = stageSelect.value;
let loading = false;
let lastFrame = performance.now();
let fpsFrames = 0;
let fpsTime = lastFrame;
let gpuSupported = null;
let fluidStatus = "";
let currentMoveObjectSpeedScale = Number.parseFloat(moveSpeedSlider?.value ?? "0.2");

function setStatus(text, kind = "") {
  statusEl.className = kind;
  statusEl.textContent = text;
}

function statusText(kind = "normal") {
  const prefix = kind === "death" ? "Restarting from checkpoint..." : game?.message ?? "";
  const canvasStatus = renderer.backingSize ? `Canvas: ${renderer.backingSize.width} x ${renderer.backingSize.height}` : "";
  return `${prefix}\n${fluidStatus}${canvasStatus ? `\n${canvasStatus}` : ""}`;
}

function setMoveObjectSpeedScale(value) {
  currentMoveObjectSpeedScale = Number.parseFloat(value);
  if (!Number.isFinite(currentMoveObjectSpeedScale)) {
    currentMoveObjectSpeedScale = 1;
  }
  if (moveSpeedValue) {
    moveSpeedValue.textContent = `${currentMoveObjectSpeedScale.toFixed(2)}x`;
  }
  if (game?.stage?.moveObjectSpeedControl) {
    game.stage.moveObjectSpeedScale = currentMoveObjectSpeedScale;
  }
}

function configureMoveObjectSpeedControl(stage) {
  const visible = Boolean(stage.moveObjectSpeedControl);
  moveSpeedRow?.classList.toggle("visible", visible);
  if (!visible) {
    setMoveObjectSpeedScale(1);
    return;
  }
  const scale = stage.moveObjectSpeedScale ?? stage.moveObjectSpeedScaleDefault ?? 0.2;
  if (moveSpeedSlider) {
    moveSpeedSlider.value = String(scale);
  }
  setMoveObjectSpeedScale(scale);
}

async function loadStage(stageId) {
  loading = true;
  setStatus(`Loading ${stageId}...`);
  currentStageId = stageId;

  const [stage, ufocoli] = await Promise.all([
    loadStageData(stageId),
    collisionPoints.length === 0 ? loadUnityBmp("./assets/textures/ufo/ufocoli.bmp") : null,
  ]);

  if (ufocoli) {
    collisionPoints = loadUfoCollisionPoints(ufocoli);
  }

  if (gpuSupported === null) {
    gpuSupported = await FluidGpuSimulation.isSupported();
  }
  if (!gpuSupported) {
    throw new Error("WebGPU is required for the Unity CIP fluid path. CPU/upwind fallback is disabled.");
  }
  fluid = new FluidGpuSimulation(UNITY_FLUID_QUALITY);
  await fluid.loadAssets(stage);
  await renderer.load(stage);
  game = new GameState(stage, collisionPoints);
  configureMoveObjectSpeedControl(game.stage);
  stageValue.textContent = `${stage.label} (Unity ${stage.unityStage})`;
  fluidStatus = "Fluid: WebGPU Unity CIP";
  setStatus(statusText());
  loading = false;
}

function updateHud(now) {
  if (!game) {
    return;
  }
  const rare = game.rareCount();
  timeValue.textContent = game.time.toFixed(2);
  hpValue.textContent = Math.max(0, game.ufo.hitpoint).toFixed(0);
  rareValue.textContent = `${rare.collected} / ${rare.total}`;
  goalValue.textContent = game.goalStatus();

  fpsFrames += 1;
  if (now - fpsTime >= 250) {
    fpsValue.textContent = ((fpsFrames * 1000) / (now - fpsTime)).toFixed(1);
    fpsFrames = 0;
    fpsTime = now;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (loading || !game || !fluid) {
    return;
  }

  lastFrame = now;
  game.update(input, fluid);
  const force = fluid.step(game.ufo, game.stage.moveObjects ?? []);
  game.applyFluidForce(force);

  renderer.draw(game, fluid);
  updateHud(now);
  if (game.cleared) {
    setStatus(statusText(), "ok");
  } else if (game.ufo.deathcounter !== 0) {
    setStatus(statusText("death"), "danger");
  } else {
    setStatus(statusText());
  }
}

stageSelect.addEventListener("change", () => {
  loadStage(stageSelect.value).catch((error) => {
    console.error(error);
    setStatus(error.message, "danger");
  });
});

restartBtn.addEventListener("click", () => {
  loadStage(currentStageId).catch((error) => {
    console.error(error);
    setStatus(error.message, "danger");
  });
});

moveSpeedSlider?.addEventListener("input", () => {
  setMoveObjectSpeedScale(moveSpeedSlider.value);
});

window.__fluidLanderDebug = {
  loadStage,
  setMoveObjectSpeedScale,
  getState() {
    const obj = game?.stage?.moveObjects?.[0] ?? null;
    return {
      stageId: currentStageId,
      stageLabel: game?.stage?.label ?? null,
      time: game?.time ?? 0,
      moveObjectSpeedScale: game?.stage?.moveObjectSpeedScale ?? null,
      moveObject: obj ? {
        x: obj.x,
        y: obj.y,
        radius: obj.radius,
        spdX: obj.spdX,
        spdY: obj.spdY,
        radspd: obj.radspd,
        runtimeSpdX: obj.runtimeSpdX,
        runtimeSpdY: obj.runtimeSpdY,
        runtimeRadspd: obj.runtimeRadspd,
      } : null,
      fps: fpsValue.textContent,
    };
  },
  async readFluidStats(customRegions = null) {
    const obj = game?.stage?.moveObjects?.[0] ?? null;
    const regions = Array.isArray(customRegions) ? customRegions : [];
    if (!customRegions && obj) {
      const margin = Math.ceil((obj.radius ?? 20) + 16);
      regions.push({
        name: "moveObject",
        x0: Math.max(0, Math.floor(obj.x - margin)),
        y0: Math.max(0, Math.floor(obj.y - margin)),
        x1: Math.min(191, Math.ceil(obj.x + margin)),
        y1: Math.min(143, Math.ceil(obj.y + margin)),
      });
    }
    return fluid?.readVelocityStats ? fluid.readVelocityStats(regions) : null;
  },
};

loadStage(currentStageId)
  .then(() => {
    requestAnimationFrame(frame);
  })
  .catch((error) => {
    console.error(error);
    setStatus(error.message, "danger");
  });
