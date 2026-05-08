const WX = 32;
const WY = 32;
const WZ = 32;
const CELL_COUNT = WX * WY * WZ;
const FIELD_COUNT = 36;
const WALL_COUNT = 4;
const CELL_BYTES = CELL_COUNT * 4;
const DIAG_HEADER_FLOATS = 32;
const DIAG_MAX_FRAMES = 8192;
const DIAG_STAGE_COUNT = 5;
const DIAG_STRIDE = 16;
const STATS_FLOATS = DIAG_HEADER_FLOATS + DIAG_MAX_FRAMES * DIAG_STAGE_COUNT * DIAG_STRIDE;
const STATS_BYTES = STATS_FLOATS * 4;
const MAX_ANALYSIS_FRAMES_PER_SUBMIT = 64;

const pageParams = new URLSearchParams(window.location.search);
const DEFAULT_PARTICLE_COUNT = 65536 * 4;
const MAX_PARTICLE_COUNT = 65536 * 16;
const rhsClampEnabled = pageParams.get("rhsClamp") !== "0";
const gasReleaseEnabled = pageParams.get("gas") !== "0";
const diagEnabled = pageParams.get("diag") === "1";
const requestedLimit = Number(pageParams.get("limit") ?? "1.0");
const fallbackLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 1.0;
const requestedValueLimit = Number(pageParams.get("valueLimit") ?? fallbackLimit);
const requestedGradLimit = Number(pageParams.get("gradLimit") ?? fallbackLimit);
const valueLimit = Number.isFinite(requestedValueLimit) && requestedValueLimit > 0 ? requestedValueLimit : 1.0;
const gradLimit = Number.isFinite(requestedGradLimit) && requestedGradLimit > 0 ? requestedGradLimit : 1.0;
const rhsClampLimit = Number.isFinite(valueLimit) && valueLimit > 0 ? valueLimit : 1.0;
const requestedParticleCount = Math.floor(Number(pageParams.get("particles") ?? DEFAULT_PARTICLE_COUNT));
const PARTICLE_COUNT = Math.min(MAX_PARTICLE_COUNT, Math.max(1024, Number.isFinite(requestedParticleCount) ? requestedParticleCount : DEFAULT_PARTICLE_COUNT));
const requestedPressureWarmupFrames = Math.floor(Number(pageParams.get("pressureWarmup") ?? pageParams.get("warmup") ?? 150));
const pressureWarmupFrames = Math.max(0, Number.isFinite(requestedPressureWarmupFrames) ? requestedPressureWarmupFrames : 150);
const degenerateMode = pageParams.get("degenerate") === "old" ? "old" : "repair";
const transverseRepairEnabled = degenerateMode !== "old";
const shaderConfig = {
  valueLimit,
  gradLimit,
  degenerateMode,
  transverseRepairEnabled,
  rhsClampEnabled,
  gasReleaseEnabled,
  pressureWarmupFrames,
  particleCount: PARTICLE_COUNT,
};

const F = {
  YU: 0, YUN: 1, YV: 2, YVN: 3, YW: 4, YWN: 5,
  YUT: 6, YVT: 7, YWT: 8,
  YUV: 9, YUW: 10, YWU: 11, YWV: 12, YVU: 13, YVW: 14,
  GXU: 15, GYU: 16, GZU: 17,
  GXV: 18, GYV: 19, GZV: 20,
  GXW: 21, GYW: 22, GZW: 23,
  GXU0: 24, GYU0: 25, GZU0: 26,
  GXV0: 27, GYV0: 28, GZV0: 29,
  GXW0: 30, GYW0: 31, GZW0: 32,
  VOR: 33, YPN: 34, DIV: 35,
};
const FIELD_NAMES = Object.fromEntries(Object.entries(F).map(([name, id]) => [id, name]));

const W = { X: 0, Y: 1, Z: 2, P: 3 };

const canvas = document.querySelector("#view");
const statusEl = document.querySelector("#status");
const frameEl = document.querySelector("#frameValue");
const fpsEl = document.querySelector("#fpsValue");
const particleEl = document.querySelector("#particleValue");
const pressureEl = document.querySelector("#pressureValue");
const configEl = document.querySelector("#configValue");
const energyEl = document.querySelector("#energyValue");
const maxSpeedEl = document.querySelector("#maxSpeedValue");
const divEl = document.querySelector("#divValue");
const warmupEl = document.querySelector("#warmupValue");
const energyChart = document.querySelector("#energyChart");
const energyChartCtx = energyChart.getContext("2d");
const toggleButton = document.querySelector("#toggleButton");
const resetButton = document.querySelector("#resetButton");
const stepsSlider = document.querySelector("#stepsSlider");
const stepsValue = document.querySelector("#stepsValue");
const pressureSlider = document.querySelector("#pressureSlider");
const pressureOut = document.querySelector("#pressureOut");
const sizeSlider = document.querySelector("#sizeSlider");
const sizeValue = document.querySelector("#sizeValue");
const zoomSlider = document.querySelector("#zoomSlider");
const zoomValue = document.querySelector("#zoomValue");
const yawSlider = document.querySelector("#yawSlider");
const yawValue = document.querySelector("#yawValue");

function setStatus(text, show = true) {
  statusEl.textContent = text;
  statusEl.classList.toggle("hidden", !show);
}

function fieldOffset(field) {
  return field * CELL_BYTES;
}

function normalizeFieldId(field) {
  if (typeof field === "number" && Number.isInteger(field) && field >= 0 && field < FIELD_COUNT) {
    return field;
  }
  if (typeof field === "string" && Object.hasOwn(F, field)) {
    return F[field];
  }
  throw new Error(`Unknown field: ${field}`);
}

function summarizeValues(values) {
  let min = Infinity;
  let max = -Infinity;
  let maxAbs = -Infinity;
  let maxCell = -1;
  let sum = 0;
  let sum2 = 0;
  let finiteCount = 0;
  let nanCount = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) {
      nanCount += 1;
      continue;
    }
    finiteCount += 1;
    sum += value;
    sum2 += value * value;
    if (value < min) min = value;
    if (value > max) max = value;
    const abs = Math.abs(value);
    if (abs > maxAbs) {
      maxAbs = abs;
      maxCell = i;
    }
  }
  return {
    min: finiteCount ? min : null,
    max: finiteCount ? max : null,
    mean: finiteCount ? sum / finiteCount : null,
    rms: finiteCount ? Math.sqrt(sum2 / finiteCount) : null,
    maxAbs: finiteCount ? maxAbs : null,
    maxCell,
    finiteCount,
    nanCount,
  };
}

function makeBuffer(device, label, size, usage) {
  return device.createBuffer({ label, size, usage });
}

function formatShaderFloat(value) {
  return Number(value).toFixed(8).replace(/0+$/, "").replace(/\.$/, ".0");
}

function configureComputeSource(source) {
  const velocityLimit = formatShaderFloat(valueLimit);
  const gradientLimit = formatShaderFloat(gradLimit);
  const rhsLimit = formatShaderFloat(rhsClampLimit);
  return source
    .replace(/const CIP_VALUE_LIMIT : f32 = [^;]+;/, `const CIP_VALUE_LIMIT : f32 = ${velocityLimit};`)
    .replace(/const SPEEDLIMIT : f32 = [^;]+;/, `const SPEEDLIMIT : f32 = ${gradientLimit};`)
    .replace(/const RHS_SPEED_CLAMP : f32 = [^;]+;/, `const RHS_SPEED_CLAMP : f32 = ${rhsLimit};`)
    .replace(/const USE_TRANSVERSE_REPAIR : bool = [^;]+;/, `const USE_TRANSVERSE_REPAIR : bool = ${transverseRepairEnabled ? "true" : "false"};`);
}

function makeParamArray(a, b, c) {
  const out = new Uint32Array(12);
  out.set(a, 0);
  out.set(b, 4);
  out.set(c, 8);
  return out;
}

function createParam(device, data, label) {
  const buffer = makeBuffer(device, label, 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

function idx3(i, j, k) {
  return i + (j + k * WY) * WX;
}

function random(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967296);
  };
}

function makeWalls() {
  const walls = new Uint32Array(WALL_COUNT * CELL_COUNT);
  const wallP = walls.subarray(W.P * CELL_COUNT, (W.P + 1) * CELL_COUNT);
  const wallX = walls.subarray(W.X * CELL_COUNT, (W.X + 1) * CELL_COUNT);
  const wallY = walls.subarray(W.Y * CELL_COUNT, (W.Y + 1) * CELL_COUNT);
  const wallZ = walls.subarray(W.Z * CELL_COUNT, (W.Z + 1) * CELL_COUNT);
  wallP.fill(255);
  wallX.fill(255);
  wallY.fill(255);
  wallZ.fill(255);

  for (let k = 0; k < WZ; k += 1) {
    for (let j = 0; j < WY; j += 1) {
      for (let i = 0; i < WX; i += 1) {
        const p = idx3(i, j, k);
        if (i === 0 || j === 0 || k === 0) {
          wallP[p] = 0;
        }
      }
    }
  }

  for (let k = 0; k < WZ; k += 1) {
    for (let j = 0; j < WY; j += 1) {
      for (let i = 0; i < WX; i += 1) {
        const p = idx3(i, j, k);
        const tx = wallP[idx3((i - 1 + WX) % WX, j, k)];
        const ty = wallP[idx3(i, (j - 1 + WY) % WY, k)];
        const tz = wallP[idx3(i, j, (k - 1 + WZ) % WZ)];
        if (tx === 0 || wallP[p] === 0) wallX[p] = 0;
        if (ty === 0 || wallP[p] === 0) wallY[p] = 0;
        if (tz === 0 || wallP[p] === 0) wallZ[p] = 0;
      }
    }
  }
  return walls;
}

function makeParticles() {
  const rand = random(0x53c1a35);
  const particles = new Float32Array(PARTICLE_COUNT * 4);
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const base = i * 4;
    if (i % 256 < 32) {
      particles[base + 0] = 9.0 + rand() * 2.0;
      particles[base + 1] = 14.0 + rand() * 3.0;
      particles[base + 2] = 14.0 + rand() * 3.0;
    } else {
      particles[base + 0] = 21.0 + rand() * 0.7;
      particles[base + 1] = 14.0 + rand() * 3.0;
      particles[base + 2] = 14.0 + rand() * 3.0;
    }
    particles[base + 3] = 1.0;
  }
  return particles;
}

async function loadText(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.text();
}

function resizeCanvas(device, context, format) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    context.configure({
      device,
      format,
      alphaMode: "opaque",
    });
  }
}

async function createComputePipeline(device, module, bindGroupLayout, entryPoint) {
  return device.createComputePipelineAsync({
    label: `cip3d-${entryPoint}`,
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: { module, entryPoint },
  });
}

function dispatchGrid(pass, pipeline, bindGroup) {
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(1, WY, WZ);
}

function dispatchOne(pass, pipeline, bindGroup) {
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(1, 1, 1);
}

function dispatchParticles(pass, pipeline, bindGroup) {
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / 64), 1, 1);
}

function encodeGridPass(encoder, label, pipeline, bindGroup) {
  const pass = encoder.beginComputePass({ label });
  dispatchGrid(pass, pipeline, bindGroup);
  pass.end();
}

function encodeOnePass(encoder, label, pipeline, bindGroup) {
  const pass = encoder.beginComputePass({ label });
  dispatchOne(pass, pipeline, bindGroup);
  pass.end();
}

async function main() {
  if (!navigator.gpu) {
    setStatus("WebGPU is not available in this browser.");
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    setStatus("WebGPU adapter was not found.");
    return;
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  resizeCanvas(device, context, format);

  const [computeSource, renderSource] = await Promise.all([
    loadText("./cip3d.wgsl"),
    loadText("./render.wgsl"),
  ]);
  const configuredComputeSource = configureComputeSource(computeSource);
  const computeModule = device.createShaderModule({ label: "cip3d compute", code: configuredComputeSource });
  const renderModule = device.createShaderModule({ label: "cip3d render", code: renderSource });

  const fieldsBuffer = makeBuffer(
    device,
    "fields",
    FIELD_COUNT * CELL_BYTES,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  );
  const wallsBuffer = makeBuffer(
    device,
    "walls",
    WALL_COUNT * CELL_BYTES,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const particleBuffer = makeBuffer(
    device,
    "particles",
    PARTICLE_COUNT * 16,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX
  );
  const fieldCopyBuffer = makeBuffer(
    device,
    "field copy temp",
    CELL_BYTES,
    GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  );
  const simBuffer = makeBuffer(device, "sim params", 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const renderBuffer = makeBuffer(device, "render params", 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const statsBuffer = makeBuffer(device, "energy stats", STATS_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
  const statsReadBuffer = makeBuffer(device, "energy stats readback", 64, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const apiStatsReadBuffer = makeBuffer(device, "api energy stats readback", 64, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const diagReadBuffer = makeBuffer(device, "diagnostic stats readback", STATS_BYTES, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const apiFieldReadBuffer = makeBuffer(device, "api field readback", CELL_BYTES, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

  function resetSimulation() {
    device.queue.writeBuffer(fieldsBuffer, 0, new Float32Array(FIELD_COUNT * CELL_COUNT));
    device.queue.writeBuffer(wallsBuffer, 0, makeWalls());
    device.queue.writeBuffer(particleBuffer, 0, makeParticles());
    device.queue.writeBuffer(statsBuffer, 0, new Float32Array(STATS_FLOATS));
    cfdFrame = 0;
    visualWarmupFrames = 2;
  }

  const computeLayout = device.createBindGroupLayout({
    label: "cip3d compute layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });

  const defaultParam = createParam(device, makeParamArray([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]), "params default");
  const paramsU = createParam(
    device,
    makeParamArray([F.YU, F.YVU, F.YWU, F.YUN], [F.GXU, F.GYU, F.GZU, F.GXU0], [F.GYU0, F.GZU0, F.YU, W.X]),
    "params advection U"
  );
  const paramsV = createParam(
    device,
    makeParamArray([F.YUV, F.YV, F.YWV, F.YVN], [F.GXV, F.GYV, F.GZV, F.GXV0], [F.GYV0, F.GZV0, F.YV, W.Y]),
    "params advection V"
  );
  const paramsW = createParam(
    device,
    makeParamArray([F.YUW, F.YVW, F.YW, F.YWN], [F.GXW, F.GYW, F.GZW, F.GXW0], [F.GYW0, F.GZW0, F.YW, W.Z]),
    "params advection W"
  );

  const makeComputeBindGroup = (paramBuffer, label) => device.createBindGroup({
    label,
    layout: computeLayout,
    entries: [
      { binding: 0, resource: { buffer: fieldsBuffer } },
      { binding: 1, resource: { buffer: wallsBuffer } },
      { binding: 2, resource: { buffer: particleBuffer } },
      { binding: 3, resource: { buffer: simBuffer } },
      { binding: 4, resource: { buffer: paramBuffer } },
      { binding: 5, resource: { buffer: statsBuffer } },
    ],
  });

  const bgDefault = makeComputeBindGroup(defaultParam, "compute default");
  const bgU = makeComputeBindGroup(paramsU, "compute U");
  const bgV = makeComputeBindGroup(paramsV, "compute V");
  const bgW = makeComputeBindGroup(paramsW, "compute W");

  const pipelines = {
    veloc0: await createComputePipeline(device, computeModule, computeLayout, "veloc0"),
    veloc1: await createComputePipeline(device, computeModule, computeLayout, "veloc1"),
    advection: await createComputePipeline(device, computeModule, computeLayout, "advection_cip"),
    div: await createComputePipeline(device, computeModule, computeLayout, "div"),
    pressure0: await createComputePipeline(device, computeModule, computeLayout, "pressure0"),
    pressure1: await createComputePipeline(device, computeModule, computeLayout, "pressure1"),
    rhs: await createComputePipeline(device, computeModule, computeLayout, "rhs"),
    newgradX: await createComputePipeline(device, computeModule, computeLayout, "newgrad_x"),
    newgradY: await createComputePipeline(device, computeModule, computeLayout, "newgrad_y"),
    newgradZ: await createComputePipeline(device, computeModule, computeLayout, "newgrad_z"),
    exforce: await createComputePipeline(device, computeModule, computeLayout, "exforce0"),
    particle: await createComputePipeline(device, computeModule, computeLayout, "particle_move"),
    gasRelease: await createComputePipeline(device, computeModule, computeLayout, "gas_release"),
    energyStats: await createComputePipeline(device, computeModule, computeLayout, "energy_stats"),
    diagAfterCip: await createComputePipeline(device, computeModule, computeLayout, "diag_after_cip"),
    diagAfterDiv: await createComputePipeline(device, computeModule, computeLayout, "diag_after_div"),
    diagAfterPressure: await createComputePipeline(device, computeModule, computeLayout, "diag_after_pressure"),
    diagAfterRhs: await createComputePipeline(device, computeModule, computeLayout, "diag_after_rhs"),
    diagAfterNewgrad: await createComputePipeline(device, computeModule, computeLayout, "diag_after_newgrad"),
  };

  const renderLayout = device.createBindGroupLayout({
    label: "cip3d render layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
    ],
  });
  const renderBindGroup = device.createBindGroup({
    label: "render bind group",
    layout: renderLayout,
    entries: [
      { binding: 0, resource: { buffer: particleBuffer } },
      { binding: 1, resource: { buffer: renderBuffer } },
    ],
  });
  const renderPipeline = await device.createRenderPipelineAsync({
    label: "particle render pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
    vertex: { module: renderModule, entryPoint: "vs_main" },
    fragment: {
      module: renderModule,
      entryPoint: "fs_main",
      targets: [{
        format,
        blend: {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
      }],
    },
    primitive: { topology: "triangle-list" },
  });

  let running = true;
  let cfdFrame = 0;
  let visualWarmupFrames = 2;
  let statsReadPending = false;
  let statsSampleCounter = 0;
  const energyHistory = [];
  let lastTime = performance.now();
  let fpsTime = lastTime;
  let fpsFrames = 0;

  toggleButton.addEventListener("click", () => {
    running = !running;
    toggleButton.textContent = running ? "Pause" : "Resume";
  });
  resetButton.addEventListener("click", () => {
    resetSimulation();
    energyHistory.length = 0;
    drawEnergyChart();
  });
  for (const [slider, out] of [[stepsSlider, stepsValue], [pressureSlider, pressureOut], [sizeSlider, sizeValue], [zoomSlider, zoomValue], [yawSlider, yawValue]]) {
    slider.addEventListener("input", () => {
      out.value = slider.value;
      pressureEl.textContent = pressureSlider.value;
    });
  }

  function setRunning(nextRunning) {
    running = Boolean(nextRunning);
    toggleButton.textContent = running ? "Pause" : "Resume";
  }

  function setSliderValue(slider, value) {
    if (value === undefined || value === null) return;
    let next = Number(value);
    if (Number.isFinite(next) && slider.type === "range") {
      const min = Number(slider.min);
      const max = Number(slider.max);
      if (Number.isFinite(min)) next = Math.max(min, next);
      if (Number.isFinite(max)) next = Math.min(max, next);
      slider.value = String(next);
    } else {
      slider.value = String(value);
    }
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function getParams() {
    return {
      steps: Number(stepsSlider.value),
      pressure: Number(pressureSlider.value),
      size: Number(sizeSlider.value),
      zoom: Number(zoomSlider.value),
      yaw: Number(yawSlider.value),
      rhsClampEnabled,
      gasReleaseEnabled,
      diagEnabled,
      valueLimit,
      gradLimit,
      pressureWarmupFrames,
      particleCount: PARTICLE_COUNT,
      degenerateMode,
    };
  }

  function setParams(params = {}) {
    setSliderValue(stepsSlider, params.steps);
    setSliderValue(pressureSlider, params.pressure);
    setSliderValue(sizeSlider, params.size);
    setSliderValue(zoomSlider, params.zoom);
    setSliderValue(yawSlider, params.yaw);
    if (params.running !== undefined) {
      setRunning(params.running);
    }
    return getParams();
  }

  setParams({
    steps: pageParams.get("steps"),
    pressure: pageParams.get("pressure"),
    size: pageParams.get("size"),
    zoom: pageParams.get("zoom"),
    yaw: pageParams.get("yaw"),
  });

  function copyField(encoder, src, dst) {
    encoder.copyBufferToBuffer(fieldsBuffer, fieldOffset(src), fieldCopyBuffer, 0, CELL_BYTES);
    encoder.copyBufferToBuffer(fieldCopyBuffer, 0, fieldsBuffer, fieldOffset(dst), CELL_BYTES);
  }

  function encodeStep(encoder) {
    copyField(encoder, F.YUN, F.YU);
    copyField(encoder, F.YVN, F.YV);
    copyField(encoder, F.YWN, F.YW);

    {
      const pass = encoder.beginComputePass({ label: "veloc" });
      dispatchGrid(pass, pipelines.veloc0, bgDefault);
      dispatchGrid(pass, pipelines.veloc1, bgDefault);
      pass.end();
    }

    copyField(encoder, F.GXU, F.GXU0);
    copyField(encoder, F.GYU, F.GYU0);
    copyField(encoder, F.GZU, F.GZU0);
    copyField(encoder, F.GXV, F.GXV0);
    copyField(encoder, F.GYV, F.GYV0);
    copyField(encoder, F.GZV, F.GZV0);
    copyField(encoder, F.GXW, F.GXW0);
    copyField(encoder, F.GYW, F.GYW0);
    copyField(encoder, F.GZW, F.GZW0);

    {
      const pass = encoder.beginComputePass({ label: "cip advection" });
      dispatchGrid(pass, pipelines.advection, bgU);
      dispatchGrid(pass, pipelines.advection, bgV);
      dispatchGrid(pass, pipelines.advection, bgW);
      pass.end();
    }

    copyField(encoder, F.YUN, F.YU);
    copyField(encoder, F.YVN, F.YV);
    copyField(encoder, F.YWN, F.YW);
    if (diagEnabled) {
      encodeOnePass(encoder, "diag after cip", pipelines.diagAfterCip, bgDefault);
    }

    if (cfdFrame < 9992) {
      encodeOnePass(encoder, "exforce", pipelines.exforce, bgDefault);
    }
    encodeGridPass(encoder, "div", pipelines.div, bgDefault);
    if (diagEnabled) {
      encodeOnePass(encoder, "diag after div", pipelines.diagAfterDiv, bgDefault);
    }
    const pressureIterations = Number(pressureSlider.value) + (cfdFrame < pressureWarmupFrames ? 2048 : 0);
    for (let i = 0; i < pressureIterations; i += 1) {
      encodeGridPass(encoder, "pressure0", pipelines.pressure0, bgDefault);
      encodeGridPass(encoder, "pressure1", pipelines.pressure1, bgDefault);
    }
    if (diagEnabled) {
      encodeOnePass(encoder, "diag after pressure", pipelines.diagAfterPressure, bgDefault);
    }
    encodeGridPass(encoder, "rhs", pipelines.rhs, bgDefault);
    if (diagEnabled) {
      encodeOnePass(encoder, "diag after rhs", pipelines.diagAfterRhs, bgDefault);
    }

    copyField(encoder, F.GXU, F.GXU0);
    copyField(encoder, F.GYU, F.GYU0);
    copyField(encoder, F.GZU, F.GZU0);
    copyField(encoder, F.GXV, F.GXV0);
    copyField(encoder, F.GYV, F.GYV0);
    copyField(encoder, F.GZV, F.GZV0);
    copyField(encoder, F.GXW, F.GXW0);
    copyField(encoder, F.GYW, F.GYW0);
    copyField(encoder, F.GZW, F.GZW0);

    {
      const pass = encoder.beginComputePass({ label: "newgrad particles" });
      dispatchGrid(pass, pipelines.newgradX, bgDefault);
      dispatchGrid(pass, pipelines.newgradY, bgDefault);
      dispatchGrid(pass, pipelines.newgradZ, bgDefault);
      dispatchParticles(pass, pipelines.particle, bgDefault);
      pass.end();
    }
    if (diagEnabled) {
      encodeOnePass(encoder, "diag after newgrad", pipelines.diagAfterNewgrad, bgDefault);
    }
    cfdFrame += 1;
  }

  function encodeGasRelease(encoder) {
    const pass = encoder.beginComputePass({ label: "gas release" });
    dispatchOne(pass, pipelines.gasRelease, bgDefault);
    pass.end();
  }

  function maybeEncodeGasRelease(encoder) {
    if (gasReleaseEnabled && (cfdFrame % 2) === 0) {
      encodeGasRelease(encoder);
    }
  }

  function encodeEnergyStats(encoder, readBuffer = statsReadBuffer) {
    const pass = encoder.beginComputePass({ label: "energy stats" });
    dispatchOne(pass, pipelines.energyStats, bgDefault);
    pass.end();
    encoder.copyBufferToBuffer(statsBuffer, 0, readBuffer, 0, 64);
  }

  async function readCurrentStats() {
    writeSimUniform(performance.now());
    const encoder = device.createCommandEncoder({ label: "api read energy stats" });
    encodeEnergyStats(encoder, apiStatsReadBuffer);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await apiStatsReadBuffer.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(apiStatsReadBuffer.getMappedRange()).slice();
    apiStatsReadBuffer.unmap();
    return {
      energy: values[0],
      energyPerCell: values[1],
      maxSpeed: values[2],
      pressureRms: values[3],
      maxPressure: values[4],
      divRms: values[5],
      maxDiv: values[6],
      frame: values[7],
    };
  }

  async function readField(field, options = {}) {
    const fieldId = normalizeFieldId(field);
    const encoder = device.createCommandEncoder({ label: `api read field ${FIELD_NAMES[fieldId]}` });
    encoder.copyBufferToBuffer(fieldsBuffer, fieldOffset(fieldId), apiFieldReadBuffer, 0, CELL_BYTES);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await apiFieldReadBuffer.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(apiFieldReadBuffer.getMappedRange()).slice();
    apiFieldReadBuffer.unmap();

    const cells = Array.isArray(options.cells)
      ? options.cells.map((cell) => {
        if (Array.isArray(cell)) {
          return { cell, value: values[idx3(cell[0], cell[1], cell[2])] };
        }
        return { cell, value: values[cell] };
      })
      : undefined;
    const out = {
      field: FIELD_NAMES[fieldId] ?? String(fieldId),
      fieldId,
      frame: cfdFrame,
      summary: summarizeValues(values),
    };
    if (cells) out.cells = cells;
    if (options.values) out.values = Array.from(values);
    return out;
  }

  async function readFields(fields = ["YUN", "YVN", "YWN", "YPN", "DIV"], options = {}) {
    const out = {};
    for (const field of fields) {
      const row = await readField(field, options);
      out[row.field] = row;
    }
    return out;
  }

  function encodeManualFrameCommands(encoder) {
    encodeStep(encoder);
    maybeEncodeGasRelease(encoder);
  }

  function encodeManualFrame(now) {
    writeSimUniform(now);
    const encoder = device.createCommandEncoder({ label: "api cip3d step" });
    encodeManualFrameCommands(encoder);
    device.queue.submit([encoder.finish()]);
  }

  async function stepFrames(count = 1, options = {}) {
    const frameCount = Math.max(0, Math.floor(Number(count) || 0));
    const awaitEvery = Math.min(MAX_ANALYSIS_FRAMES_PER_SUBMIT, Math.max(1, Math.floor(Number(options.awaitEvery) || MAX_ANALYSIS_FRAMES_PER_SUBMIT)));
    const fast = options.fast !== false && !diagEnabled;
    const framesPerSubmit = Math.min(MAX_ANALYSIS_FRAMES_PER_SUBMIT, Math.max(1, Math.floor(Number(options.framesPerSubmit) || awaitEvery)));
    const warmupFramesPerSubmit = Math.min(MAX_ANALYSIS_FRAMES_PER_SUBMIT, Math.max(1, Math.floor(Number(options.warmupFramesPerSubmit) || Math.min(framesPerSubmit, 2))));
    const previousRunning = running;
    if (options.pause !== false) {
      setRunning(false);
    }
    if (fast) {
      let encoded = 0;
      let submittedSinceWait = 0;
      while (encoded < frameCount) {
        const chunkLimit = cfdFrame < pressureWarmupFrames ? warmupFramesPerSubmit : framesPerSubmit;
        const chunk = Math.min(frameCount - encoded, chunkLimit);
        writeSimUniform(performance.now());
        const encoder = device.createCommandEncoder({ label: `api cip3d batch ${chunk}` });
        for (let i = 0; i < chunk; i += 1) {
          encodeManualFrameCommands(encoder);
        }
        device.queue.submit([encoder.finish()]);
        encoded += chunk;
        submittedSinceWait += chunk;
        if (submittedSinceWait >= awaitEvery) {
          await device.queue.onSubmittedWorkDone();
          submittedSinceWait = 0;
        }
      }
    } else {
      for (let i = 0; i < frameCount; i += 1) {
        encodeManualFrame(performance.now());
        if (((i + 1) % awaitEvery) === 0) {
          await device.queue.onSubmittedWorkDone();
        }
      }
    }
    if (frameCount > 0) {
      await device.queue.onSubmittedWorkDone();
    }
    if (options.restoreRunning) {
      setRunning(previousRunning);
    }
    return {
      frame: cfdFrame,
      fast,
      framesPerSubmit: fast ? framesPerSubmit : 1,
      warmupFramesPerSubmit: fast ? warmupFramesPerSubmit : 1,
      stats: await readCurrentStats(),
    };
  }

  function getState() {
    return {
      frame: cfdFrame,
      running,
      warmup: cfdFrame < pressureWarmupFrames,
      params: getParams(),
      constants: {
        WX,
        WY,
        WZ,
        CELL_COUNT,
        FIELD_COUNT,
        PARTICLE_COUNT,
        DIAG_MAX_FRAMES,
        DIAG_STAGE_COUNT,
        DIAG_STRIDE,
        valueLimit,
        gradLimit,
        degenerateMode,
        transverseRepairEnabled,
        rhsClampEnabled,
        gasReleaseEnabled,
        pressureWarmupFrames,
      },
    };
  }

  async function runUntil(options = {}) {
    const startFrame = cfdFrame;
    const targetFrame = options.frame !== undefined
      ? Math.floor(Number(options.frame))
      : startFrame + Math.floor(Number(options.frames ?? 0));
    const sampleEvery = Math.max(1, Math.floor(Number(options.sampleEvery) || 500));
    const batch = Math.min(MAX_ANALYSIS_FRAMES_PER_SUBMIT, Math.max(1, Math.floor(Number(options.batch) || MAX_ANALYSIS_FRAMES_PER_SUBMIT)));
    const fast = options.fast !== false;
    const framesPerSubmit = Math.min(MAX_ANALYSIS_FRAMES_PER_SUBMIT, Math.max(1, Math.floor(Number(options.framesPerSubmit) || batch)));
    const warmupFramesPerSubmit = Math.min(MAX_ANALYSIS_FRAMES_PER_SUBMIT, Math.max(1, Math.floor(Number(options.warmupFramesPerSubmit) || Math.min(framesPerSubmit, 2))));
    const maxEnergy = Number(options.maxEnergy ?? 10000);
    const maxSpeed = Number(options.maxSpeed ?? 5);
    const maxDiv = Number(options.maxDiv ?? 5);
    const timeoutMs = Number(options.timeoutMs ?? 300000);
    const startedAt = performance.now();
    const samples = [];
    let stoppedBy = "target";

    setParams(options.params ?? options);
    setRunning(false);
    while (cfdFrame < targetFrame) {
      const remaining = targetFrame - cfdFrame;
      await stepFrames(Math.min(batch, remaining), {
        pause: false,
        awaitEvery: batch,
        fast,
        framesPerSubmit,
        warmupFramesPerSubmit,
      });
      const dueSample = samples.length === 0 || cfdFrame - samples[samples.length - 1].frame >= sampleEvery || cfdFrame >= targetFrame;
      if (dueSample) {
        const stats = await readCurrentStats();
        samples.push(stats);
        if (!Number.isFinite(stats.energy) || stats.energy > maxEnergy) {
          stoppedBy = "energy";
          break;
        }
        if (!Number.isFinite(stats.maxSpeed) || stats.maxSpeed > maxSpeed) {
          stoppedBy = "maxSpeed";
          break;
        }
        if (!Number.isFinite(stats.divRms) || stats.divRms > maxDiv) {
          stoppedBy = "divRms";
          break;
        }
      }
      if (performance.now() - startedAt > timeoutMs) {
        stoppedBy = "timeout";
        break;
      }
    }
    return {
      startFrame,
      targetFrame,
      stoppedBy,
      elapsedMs: performance.now() - startedAt,
      fast: fast && !diagEnabled,
      framesPerSubmit: fast && !diagEnabled ? framesPerSubmit : 1,
      warmupFramesPerSubmit: fast && !diagEnabled ? warmupFramesPerSubmit : 1,
      state: getState(),
      samples,
      last: samples[samples.length - 1] ?? await readCurrentStats(),
    };
  }

  async function collectDiagnosticStats() {
    const encoder = device.createCommandEncoder({ label: "read diagnostic stats" });
    encoder.copyBufferToBuffer(statsBuffer, 0, diagReadBuffer, 0, STATS_BYTES);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await diagReadBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(diagReadBuffer.getMappedRange()).slice();
    diagReadBuffer.unmap();

    const rows = [];
    const maxima = {
      maxSpeed: { value: -Infinity },
      pressureGrad: { value: -Infinity },
      divRms: { value: -Infinity },
      maxPressure: { value: -Infinity },
    };
    const labels = ["after_cip", "after_div", "after_pressure", "after_rhs", "after_newgrad"];
    const crossings = {
      speed_gt_2_29: null,
      speed_gt_4: null,
      energy_gt_10000: null,
      div_gt_0_1: null,
      pressure_grad_gt_1_17: null,
      pressure_grad_gt_2_29: null,
    };
    for (let frame = 0; frame < DIAG_MAX_FRAMES; frame += 1) {
      for (let stage = 0; stage < DIAG_STAGE_COUNT; stage += 1) {
        const offset = DIAG_HEADER_FLOATS + (frame * DIAG_STAGE_COUNT + stage) * DIAG_STRIDE;
        const storedFrame = data[offset + 0];
        const storedStage = data[offset + 1];
        if (storedFrame === 0 && storedStage === 0 && frame !== 0) continue;
        const row = {
          frame: storedFrame,
          stage: labels[storedStage] ?? `stage_${storedStage}`,
          energy: data[offset + 2],
          maxSpeed: data[offset + 3],
          divRms: data[offset + 4],
          maxDiv: data[offset + 5],
          pressureRms: data[offset + 6],
          maxPressure: data[offset + 7],
          maxPressureGrad: data[offset + 8],
          maxPressureGradCell: data[offset + 9],
        };
        if (!Number.isFinite(row.energy) || (row.energy === 0 && row.maxSpeed === 0 && row.maxPressureGrad === 0 && frame > 10)) continue;
        rows.push(row);
        if (!crossings.speed_gt_2_29 && row.maxSpeed > 2.29) crossings.speed_gt_2_29 = row;
        if (!crossings.speed_gt_4 && row.maxSpeed > 4.0) crossings.speed_gt_4 = row;
        if (!crossings.energy_gt_10000 && row.energy > 10000) crossings.energy_gt_10000 = row;
        if (!crossings.div_gt_0_1 && row.divRms > 0.1) crossings.div_gt_0_1 = row;
        if (!crossings.pressure_grad_gt_1_17 && row.maxPressureGrad > 1.17) crossings.pressure_grad_gt_1_17 = row;
        if (!crossings.pressure_grad_gt_2_29 && row.maxPressureGrad > 2.29) crossings.pressure_grad_gt_2_29 = row;
        if (row.maxSpeed > maxima.maxSpeed.value) maxima.maxSpeed = { value: row.maxSpeed, row };
        if (row.maxPressureGrad > maxima.pressureGrad.value) maxima.pressureGrad = { value: row.maxPressureGrad, row };
        if (row.divRms > maxima.divRms.value) maxima.divRms = { value: row.divRms, row };
        if (row.maxPressure > maxima.maxPressure.value) maxima.maxPressure = { value: row.maxPressure, row };
      }
    }
    const firstFrame = Math.min(
      ...Object.values(crossings)
        .filter(Boolean)
        .map((row) => row.frame)
    );
    const aroundFirst = Number.isFinite(firstFrame)
      ? rows.filter((row) => row.frame >= firstFrame - 3 && row.frame <= firstFrame + 5)
      : [];
    return {
      rhsClampEnabled,
      diagEnabled,
      currentFrame: cfdFrame,
      header: Array.from(data.slice(0, 16)),
      crossings,
      aroundFirst,
      maxima,
      tail: rows.slice(-80),
    };
  }

  window.__cip3dCollectDiag = collectDiagnosticStats;
  window.__cip3d = {
    fields: { ...F },
    fieldNames: { ...FIELD_NAMES },
    getState,
    getParams,
    setParams,
    setRunning,
    reset() {
      resetSimulation();
      energyHistory.length = 0;
      drawEnergyChart();
      return getState();
    },
    step: stepFrames,
    runUntil,
    stats: readCurrentStats,
    diag: collectDiagnosticStats,
    readField,
    readFields,
  };

  function formatNumber(value) {
    if (!Number.isFinite(value)) return "NaN";
    const abs = Math.abs(value);
    if (abs >= 100000 || (abs > 0 && abs < 0.001)) return value.toExponential(3);
    return value.toFixed(4);
  }

  function drawEnergyChart() {
    const ctx = energyChartCtx;
    const w = energyChart.width;
    const h = energyChart.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(2, 6, 10, 0.18)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const y = Math.round((h * i) / 4) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(238,248,255,0.66)";
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.fillText("log energy", 8, 14);
    if (energyHistory.length < 2) return;

    const values = energyHistory.map((p) => Math.log10(Math.max(p.energy, 1e-8)));
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max - min < 0.25) {
      const center = (min + max) * 0.5;
      min = center - 0.125;
      max = center + 0.125;
    }
    const xOf = (i) => (i / Math.max(1, energyHistory.length - 1)) * (w - 12) + 6;
    const yOf = (v) => h - 10 - ((v - min) / (max - min)) * (h - 24);
    ctx.strokeStyle = "#9ecbff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < values.length; i += 1) {
      const x = xOf(i);
      const y = yOf(values[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    const last = energyHistory[energyHistory.length - 1];
    ctx.fillStyle = "rgba(238,248,255,0.78)";
    ctx.fillText(`f ${last.frame}  E ${formatNumber(last.energy)}`, 8, h - 8);
  }

  async function readEnergyStats() {
    if (statsReadPending) return;
    statsReadPending = true;
    try {
      await statsReadBuffer.mapAsync(GPUMapMode.READ);
      const values = new Float32Array(statsReadBuffer.getMappedRange()).slice();
      statsReadBuffer.unmap();
      energyEl.textContent = formatNumber(values[0]);
      maxSpeedEl.textContent = formatNumber(values[2]);
      divEl.textContent = formatNumber(values[5]);
      const unstable = !Number.isFinite(values[0]) || values[0] > 10000 || values[2] > 5;
      energyEl.style.color = unstable ? "#ff806d" : "";
      maxSpeedEl.style.color = unstable ? "#ff806d" : "";
      divEl.style.color = unstable ? "#ff806d" : "";
      energyHistory.push({ frame: cfdFrame, energy: values[0], maxSpeed: values[2], div: values[5] });
      if (energyHistory.length > 240) {
        energyHistory.splice(0, energyHistory.length - 240);
      }
      drawEnergyChart();
    } catch (error) {
      try {
        statsReadBuffer.unmap();
      } catch {}
      console.error(error);
    } finally {
      statsReadPending = false;
    }
  }

  function encodeRender(encoder) {
    const textureView = context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.50, g: 0.69, b: 0.96, a: 1.0 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, renderBindGroup);
    pass.draw(6, PARTICLE_COUNT, 0, 0);
    pass.end();
  }

  function writeSimUniform(now) {
    const simUniform = new ArrayBuffer(32);
    const simF = new Float32Array(simUniform);
    const simU = new Uint32Array(simUniform);
    simF[0] = PARTICLE_COUNT;
    simF[1] = now * 0.001;
    simU[4] = cfdFrame;
    simU[5] = rhsClampEnabled ? 1 : 0;
    device.queue.writeBuffer(simBuffer, 0, simUniform);
  }

  function frame(now) {
    resizeCanvas(device, context, format);

    writeSimUniform(now);

    const renderUniform = new Float32Array(12);
    renderUniform[0] = canvas.width;
    renderUniform[1] = canvas.height;
    renderUniform[4] = Number(yawSlider.value) * Math.PI / 180;
    renderUniform[5] = -0.05;
    renderUniform[6] = Number(zoomSlider.value);
    renderUniform[7] = Number(sizeSlider.value);
    renderUniform[8] = 0.24;
    device.queue.writeBuffer(renderBuffer, 0, renderUniform);

    const encoder = device.createCommandEncoder({ label: "cip3d frame" });
    if (running && visualWarmupFrames <= 0) {
      const steps = Number(stepsSlider.value);
      for (let i = 0; i < steps; i += 1) {
        if (diagEnabled) {
          writeSimUniform(now);
          const stepEncoder = device.createCommandEncoder({ label: "cip3d diagnostic step" });
          encodeStep(stepEncoder);
          maybeEncodeGasRelease(stepEncoder);
          device.queue.submit([stepEncoder.finish()]);
        } else {
          encodeStep(encoder);
          maybeEncodeGasRelease(encoder);
        }
      }
    } else if (visualWarmupFrames > 0) {
      visualWarmupFrames -= 1;
    }
    let shouldReadStats = false;
    if (!statsReadPending && statsSampleCounter <= 0) {
      encodeEnergyStats(encoder);
      shouldReadStats = true;
      statsSampleCounter = 10;
    } else {
      statsSampleCounter -= 1;
    }
    encodeRender(encoder);
    device.queue.submit([encoder.finish()]);
    if (shouldReadStats) {
      readEnergyStats();
    }

    fpsFrames += 1;
    if (now - fpsTime > 500) {
      const fps = fpsFrames * 1000 / (now - fpsTime);
      fpsEl.textContent = fps.toFixed(1);
      fpsTime = now;
      fpsFrames = 0;
    }
    frameEl.textContent = String(cfdFrame);
    particleEl.textContent = PARTICLE_COUNT.toLocaleString();
    stepsValue.value = stepsSlider.value;
    pressureOut.value = pressureSlider.value;
    pressureEl.textContent = pressureSlider.value;
    const clampText = rhsClampEnabled ? "CIP+RHS" : "CIP";
    const gasText = gasReleaseEnabled ? "gas on" : "gas off";
    configEl.textContent = `${degenerateMode} / ${clampText} / v${valueLimit} g${gradLimit} / ${gasText}`;
    warmupEl.textContent = cfdFrame < pressureWarmupFrames ? "on" : "off";
    sizeValue.value = sizeSlider.value;
    zoomValue.value = zoomSlider.value;
    yawValue.value = yawSlider.value;

    if (now - lastTime > 1200) {
      setStatus(`3D CIP ${degenerateMode}, value ${valueLimit}, grad ${gradLimit}, RHS clamp ${rhsClampEnabled ? "on" : "off"}, gas ${gasReleaseEnabled ? "on" : "off"}.`, false);
      lastTime = now;
    }
    requestAnimationFrame(frame);
  }

  setStatus(`Running 3D CIP ${degenerateMode}, value ${valueLimit}, grad ${gradLimit}, RHS clamp ${rhsClampEnabled ? "on" : "off"}, gas ${gasReleaseEnabled ? "on" : "off"}.`, false);
  resetSimulation();
  requestAnimationFrame(frame);
}

main().catch((error) => {
  console.error(error);
  setStatus(error?.stack || String(error));
});

window.addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
  setStatus(event.reason?.stack || String(event.reason));
});

window.addEventListener("error", (event) => {
  console.error(event.error || event.message);
  setStatus(event.error?.stack || event.message);
});
