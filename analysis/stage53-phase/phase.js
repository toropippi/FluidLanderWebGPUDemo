import { loadUnityBmp } from "../../src/bmp.js";
import { FluidGpuSimulation } from "../../src/fluidGpu.js";
import { UNITY_FLUID_QUALITY } from "../../src/fluidQuality.js";
import { GameState, loadUfoCollisionPoints, updateMoveObject } from "../../src/game.js";
import { loadStageData } from "../../src/stageData.js";

const statusEl = document.getElementById("status");
const rowsEl = document.getElementById("rows");
const query = new URLSearchParams(window.location.search);

const START_SCALE = 0.5;
const stages = ["beforeCip", "afterCipVelocity", "afterRhs", "afterNewGradV", "afterNewGradU"];

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

const startFrame = intParam("startFrame", 270, 1, 100000);
const endFrame = intParam("endFrame", 300, startFrame, 100000);
const stopFrame = intParam("stopFrame", 174, 0, endFrame - 1);
const stepsPerTick = intParam("steps", 100, 1, 1000);

let fluid = null;
let game = null;
let simFrame = 0;
let snapshotRecords = [];
let phaseRows = [];
let phaseDeltas = [];
let cellTrace = [];
let summary = null;
let running = false;
let finished = false;
let startTime = 0;

function setStatus(text) {
  statusEl.textContent = text;
}

function scenarioScale(frameNumber = simFrame) {
  return frameNumber < stopFrame ? START_SCALE : 0;
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
  const maxGXV = absPoint(stats.maxAbsGXV);
  const maxGrad = strongestGradient(stats);
  return {
    energy: stats.energy ?? 0,
    maxSpeed: maxSpeed.value ?? 0,
    maxSpeedX: maxSpeed.x ?? 0,
    maxSpeedY: maxSpeed.y ?? 0,
    maxGXV: maxGXV.value,
    maxGXVSigned: maxGXV.signed,
    maxGXVX: maxGXV.x,
    maxGXVY: maxGXV.y,
    maxGrad: maxGrad.value,
    maxGradSigned: maxGrad.signed,
    maxGradName: maxGrad.name,
    maxGradX: maxGrad.x,
    maxGradY: maxGrad.y,
  };
}

function tracePoints() {
  const points = [];
  for (const y of [63, 64, 65, 74]) {
    for (const x of [78, 79, 80]) {
      points.push({ name: `x${x}y${y}`, x, y });
    }
  }
  return points;
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
  const nextFrame = simFrame + 1;
  const scale = scenarioScale();
  game.stage.moveObjectSpeedScale = scale;
  for (const obj of game.stage.moveObjects ?? []) {
    updateMoveObject(obj, scale);
  }
  removeUfoFromAnalysis();
  const shouldCapture = nextFrame >= startFrame && nextFrame <= endFrame;
  fluid.step(game.ufo, game.stage.moveObjects ?? [], (stage, substep) => {
    if (!shouldCapture || !stages.includes(stage)) {
      return null;
    }
    const index = snapshotRecords.length;
    snapshotRecords.push({ frame: nextFrame, stage, substep, scale });
    return index;
  });
  simFrame = nextFrame;
}

function maxBy(rows, field) {
  return rows.reduce((best, row) => row[field] > best[field] ? row : best, rows[0]);
}

function makeSummary() {
  const byStep = new Map();
  for (const row of phaseRows) {
    const key = `${row.frame}:${row.substep}`;
    if (!byStep.has(key)) {
      byStep.set(key, new Map());
    }
    byStep.get(key).set(row.stage, row);
  }

  phaseDeltas = [];
  for (const frameRows of byStep.values()) {
    for (let i = 1; i < stages.length; i += 1) {
      const from = frameRows.get(stages[i - 1]);
      const to = frameRows.get(stages[i]);
      if (!from || !to) {
        continue;
      }
      phaseDeltas.push({
        frame: to.frame,
        substep: to.substep,
        transition: `${from.stage}->${to.stage}`,
        dEnergy: to.energy - from.energy,
        dSpeed: to.maxSpeed - from.maxSpeed,
        dGXV: to.maxGXV - from.maxGXV,
        dGrad: to.maxGrad - from.maxGrad,
        toStage: to.stage,
        toMaxGradName: to.maxGradName,
        toMaxGradX: to.maxGradX,
        toMaxGradY: to.maxGradY,
      });
    }
  }

  return {
    rowCount: phaseRows.length,
    frameStart: startFrame,
    frameEnd: endFrame,
    stages,
    maxRows: {
      energy: maxBy(phaseRows, "energy"),
      speed: maxBy(phaseRows, "maxSpeed"),
      gxv: maxBy(phaseRows, "maxGXV"),
      grad: maxBy(phaseRows, "maxGrad"),
    },
    maxDeltas: {
      energy: maxBy(phaseDeltas, "dEnergy"),
      speed: maxBy(phaseDeltas, "dSpeed"),
      gxv: maxBy(phaseDeltas, "dGXV"),
      grad: maxBy(phaseDeltas, "dGrad"),
    },
  };
}

function renderRows() {
  const focused = phaseRows.filter((row) => row.frame >= 276 && row.frame <= 290);
  rowsEl.textContent = "";
  for (const row of focused) {
    const tr = document.createElement("tr");
    const cells = [
      row.frame,
      row.stage,
      row.energy.toFixed(6),
      row.maxSpeed.toFixed(6),
      row.maxGXV.toFixed(6),
      row.maxGrad.toFixed(6),
      row.maxGradName,
      row.maxGradX,
      row.maxGradY,
    ];
    for (const value of cells) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }
    rowsEl.appendChild(tr);
  }
}

async function finalize() {
  running = false;
  setStatus(`Reading ${snapshotRecords.length} phase snapshots...`);
  const results = await fluid.readVelocitySnapshotStats(snapshotRecords.map((item) => `${item.frame}:${item.stage}`), []);
  const pointResults = await fluid.readVelocitySnapshotCells(
    snapshotRecords.map((item) => `${item.frame}:${item.stage}`),
    tracePoints(),
  );
  phaseRows = results.map((result, index) => ({
    ...snapshotRecords[index],
    ...statsRow(result.stats[0]),
  }));
  cellTrace = pointResults.flatMap((result, index) => (
    result.cells.map((cell) => ({
      ...snapshotRecords[index],
      ...cell,
    }))
  ));
  summary = makeSummary();
  finished = true;
  renderRows();
  const elapsed = (performance.now() - startTime) / 1000;
  setStatus(`Done. ${phaseRows.length} snapshots, ${elapsed.toFixed(2)}s real.\nShowing frames 276-290.`);
}

function tick() {
  if (!running || finished) {
    return;
  }
  for (let i = 0; i < stepsPerTick && simFrame < endFrame; i += 1) {
    advanceFrame();
  }
  setStatus(`Running... frame ${simFrame}, snapshots ${snapshotRecords.length}`);
  if (simFrame >= endFrame) {
    finalize().catch((error) => {
      console.error(error);
      setStatus(error.message);
    });
  } else {
    requestAnimationFrame(tick);
  }
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
  fluid.prepareVelocitySnapshots((endFrame - startFrame + 1) * stages.length * UNITY_FLUID_QUALITY.substeps);
  game = new GameState(stage, collisionPoints);
  removeUfoFromAnalysis();
  running = true;
  startTime = performance.now();
  requestAnimationFrame(tick);
}

window.__stage53PhaseDebug = {
  getState() {
    return {
      startFrame,
      endFrame,
      stopFrame,
      stepsPerTick,
      simFrame,
      snapshotCount: snapshotRecords.length,
      phaseRows,
      phaseDeltas,
      cellTrace,
      summary,
      running,
      finished,
    };
  },
};

start().catch((error) => {
  console.error(error);
  setStatus(error.message);
});
