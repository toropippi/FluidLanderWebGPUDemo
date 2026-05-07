import { CO, DIFFICULTY } from "./constants.js";

export const STAGE_DEFS = {
  "1-2": {
    label: "1-2",
    unityStage: 2,
    dataPath: "./assets/resources/data2.txt",
    assetRoot: "./assets/stage/2",
    stageImage: "./assets/stage/2/stage.png",
  },
  "2-1": {
    label: "2-1",
    unityStage: 7,
    dataPath: "./assets/resources/data7.txt",
    assetRoot: "./assets/stage/7",
    stageImage: "./assets/stage/7/stage.png",
    backgroundImage: "./assets/stage/7/haikei.png",
  },
  "5-2": {
    label: "5-2",
    unityStage: 18,
    dataPath: "./assets/resources/data18.txt",
    assetRoot: "./assets/stage/18",
    stageImage: "./assets/stage/18/stage.png",
  },
  "5-3": {
    label: "5-3",
    unityStage: 19,
    dataPath: "./assets/resources/data19.txt",
    assetRoot: "./assets/stage/19",
    stageImage: "./assets/stage/19/stage.png",
  },
  "5-3modify": {
    label: "5-3modify",
    unityStage: 19,
    dataPath: "./assets/resources/data19.txt",
    syntheticFluidStage: true,
    syntheticTracerGrid: true,
    moveObjectSpeedControl: true,
    moveObjectSpeedScaleDefault: 0.5,
    syntheticMoveObject: {
      bmpId: 8,
      x: 96,
      y: 72,
      width: 30,
      height: 2,
    },
  },
};

export function parseUnityFloat(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") {
    return 0;
  }
  return Number.parseFloat(trimmed);
}

export function parseUnityCsvNumbers(value, parseValue = Number.parseInt) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") {
    return [];
  }
  return trimmed.split(",").map((part) => {
    const clean = part.trim();
    return clean === "" ? 0 : parseValue(clean, 10);
  });
}

function readLine(lines, index) {
  return lines[index] ?? "";
}

function parseStageText(text, def, difficulty) {
  const lines = text.replace(/\r/g, "").split("\n");
  const goalXs = parseUnityCsvNumbers(readLine(lines, 4));
  const goalYs = parseUnityCsvNumbers(readLine(lines, 6));
  const rareFlags = parseUnityCsvNumbers(readLine(lines, 20));
  const rareXs = parseUnityCsvNumbers(readLine(lines, 22));
  const rareYs = parseUnityCsvNumbers(readLine(lines, 24));
  const colorValues = parseUnityCsvNumbers(readLine(lines, 26));
  const oneUpPosition = parseUnityCsvNumbers(readLine(lines, 18));
  const heartPositions = parseUnityCsvNumbers(readLine(lines, 28));
  const rangeLines = [30, 32, 34, 36].map((line) => parseUnityCsvNumbers(readLine(lines, line)));
  const moveFlags = parseUnityCsvNumbers(readLine(lines, 56));
  const moveXs = parseUnityCsvNumbers(readLine(lines, 58));
  const moveYs = parseUnityCsvNumbers(readLine(lines, 60));

  const goals = [];
  for (let i = 0; i < 4; i += 1) {
    const x = goalXs[i] ?? 0;
    const y = goalYs[i] ?? 0;
    if (x + y !== 0) {
      goals.push({ x, y, wait: CO.GOALWAIT, active: false, cleared: false });
    }
  }

  const rareEarths = [];
  for (let i = 0; i < 10; i += 1) {
    const flag = rareFlags[i] ?? 0;
    if (flag === 1 || flag === 2) {
      rareEarths.push({
        x: rareXs[i] ?? 0,
        y: rareYs[i] ?? 0,
        superRare: flag === 2,
        collected: false,
      });
    }
  }

  const hearts = [];
  for (let i = 0; i < 4; i += 1) {
    const x = heartPositions[i * 2 + 0] ?? 0;
    const y = heartPositions[i * 2 + 1] ?? 0;
    if (x + y !== 0) {
      hearts.push({ x, y, collected: false });
    }
  }

  const oneUps = [];
  if ((oneUpPosition[0] ?? 0) + (oneUpPosition[1] ?? 0) !== 0) {
    oneUps.push({ x: oneUpPosition[0] ?? 0, y: oneUpPosition[1] ?? 0, collected: false });
  }

  const colors = [];
  for (let i = 0; i < 4; i += 1) {
    const r = colorValues[i * 3 + 0] ?? 0;
    const g = colorValues[i * 3 + 1] ?? 0;
    const b = colorValues[i * 3 + 2] ?? 0;
    colors.push(r + g * 256 + b * 65536);
  }

  const ranges = rangeLines.map((range) => ({
    x0: range[0] ?? 0,
    y0: range[1] ?? 0,
    x1: range[2] ?? 0,
    y1: range[3] ?? 0,
  }));

  const moveObjects = [];
  for (let i = 0; i < 61; i += 1) {
    const flag = moveFlags[i] ?? 0;
    if (flag === 0) {
      break;
    }
    moveObjects.push({
      id: 4 + i,
      objFlag: flag,
      bmpId: flag - 1,
      x: moveXs[i] ?? 0,
      y: moveYs[i] ?? 0,
      spdX: 0,
      spdY: 0,
      rad: 0,
      radspd: 0,
      cnt: 0,
      cfdPath: `./assets/textures/stageobjs/${flag - 1}cfdcoli.bmp`,
      imagePath: `./assets/textures/stageobjs/${flag - 1}obj.png`,
    });
  }

  const stage = {
    ...def,
    start: {
      x: parseUnityFloat(readLine(lines, 0)),
      y: parseUnityFloat(readLine(lines, 2)),
    },
    goals,
    rareEarths,
    damageRatio: parseUnityFloat(readLine(lines, 14)),
    colors,
    ranges,
    grav: parseUnityFloat(readLine(lines, 74 + difficulty * 2)),
    jumpf: parseUnityFloat(readLine(lines, 80 + difficulty * 2)),
    pullf: parseUnityFloat(readLine(lines, 86 + difficulty * 2)),
    stageSpeed: parseUnityFloat(readLine(lines, 92 + difficulty * 2)),
    particleLoopMultiplier: Number.parseInt(readLine(lines, 98), 10) || 1,
    forceToUfoLimit: parseUnityFloat(readLine(lines, 100)),
    moveObjectSpeedScale: def.moveObjectSpeedScaleDefault ?? 1,
    oneUps,
    hearts,
    moveObjects,
  };

  if (def.syntheticFluidStage) {
    stage.start = { x: 20, y: 120 };
    stage.goals = [];
    stage.rareEarths = [];
    stage.hearts = [];
    stage.oneUps = [];
    stage.colors = [0x8fdcff, 0x8fdcff, 0x8fdcff, 0x8fdcff];
    stage.ranges = [{ x0: 0, y0: 0, x1: CO.WX, y1: CO.WY }];
    const synthetic = def.syntheticMoveObject;
    stage.moveObjects = [{
      id: 4,
      objFlag: synthetic.bmpId + 1,
      bmpId: synthetic.bmpId,
      x: synthetic.x,
      y: synthetic.y,
      spdX: 0,
      spdY: 0,
      rad: 0,
      radspd: 0,
      cnt: 0,
      syntheticShape: {
        width: synthetic.width,
        height: synthetic.height,
      },
      visualShape: {
        width: synthetic.width,
        height: synthetic.height,
      },
    }];
  }

  return stage;
}

export async function loadStageData(stageId, difficulty = DIFFICULTY.easy) {
  const def = STAGE_DEFS[stageId];
  if (!def) {
    throw new Error(`Unknown stage: ${stageId}`);
  }
  const res = await fetch(def.dataPath);
  if (!res.ok) {
    throw new Error(`Failed to load stage data: ${def.dataPath}`);
  }
  return parseStageText(await res.text(), def, difficulty);
}

export function parseStageTextForTest(text, stageId = "1-2", difficulty = DIFFICULTY.easy) {
  return parseStageText(text, STAGE_DEFS[stageId], difficulty);
}
