const WX = 32;
const WY = 32;
const WZ = 32;
const CELL_COUNT = WX * WY * WZ;
const FIELD_COUNT = 36;
const WALL_COUNT = 4;
const CELL_BYTES = CELL_COUNT * 4;

const STEPS_PER_ANIMATION = 8;
const PRESSURE_ITERATIONS = 32;
const PRESSURE_WARMUP_FRAMES = 20;
const PRESSURE_WARMUP_EXTRA = 2048;
const VISUAL_PARTICLE_COUNT = 65536 * 4;
const STATS_BYTES = 64;

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

const W = { X: 0, Y: 1, Z: 2, P: 3 };

const canvas = document.querySelector("#view");
const statusEl = document.querySelector("#status");
const frameEl = document.querySelector("#frameValue");
const fpsEl = document.querySelector("#fpsValue");
const energyEl = document.querySelector("#energyValue");
const maxSpeedEl = document.querySelector("#maxSpeedValue");
const divEl = document.querySelector("#divValue");
const warmupEl = document.querySelector("#warmupValue");
const toggleButton = document.querySelector("#toggleButton");
const resetButton = document.querySelector("#resetButton");
const pointSize = document.querySelector("#pointSize");
const pointSizeValue = document.querySelector("#pointSizeValue");
const zoom = document.querySelector("#zoom");
const zoomValue = document.querySelector("#zoomValue");
const yaw = document.querySelector("#yaw");
const yawValue = document.querySelector("#yawValue");
const energyChart = document.querySelector("#energyChart");
const energyChartCtx = energyChart.getContext("2d");

function setStatus(text, show = true) {
  statusEl.textContent = text;
  statusEl.classList.toggle("hidden", !show);
}

function idx3(i, j, k) {
  return i + (j + k * WY) * WX;
}

function fieldOffset(field) {
  return field * CELL_BYTES;
}

function makeBuffer(device, label, size, usage) {
  return device.createBuffer({ label, size, usage });
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

function random(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
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
        if (i === 0 || j === 0 || k === 0) {
          wallP[idx3(i, j, k)] = 0;
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

function makeVisualParticles() {
  const rand = random(0x53c1a35);
  const particles = new Float32Array(VISUAL_PARTICLE_COUNT * 4);
  for (let i = 0; i < VISUAL_PARTICLE_COUNT; i += 1) {
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
    context.configure({ device, format, alphaMode: "opaque" });
  }
}

async function createComputePipeline(device, module, layout, entryPoint) {
  return device.createComputePipelineAsync({
    label: `stable3d-${entryPoint}`,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
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
  pass.dispatchWorkgroups(Math.ceil(VISUAL_PARTICLE_COUNT / 64), 1, 1);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "NaN";
  const abs = Math.abs(value);
  if (abs >= 100000 || (abs > 0 && abs < 0.001)) return value.toExponential(3);
  return value.toFixed(4);
}

function drawEnergyChart(history) {
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
  if (history.length < 2) return;

  const values = history.map((p) => Math.log10(Math.max(p.energy, 1e-8)));
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 0.25) {
    const center = (min + max) * 0.5;
    min = center - 0.125;
    max = center + 0.125;
  }
  const xOf = (i) => (i / Math.max(1, history.length - 1)) * (w - 12) + 6;
  const yOf = (v) => h - 10 - ((v - min) / (max - min)) * (h - 24);
  ctx.strokeStyle = "#a6d2ff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < values.length; i += 1) {
    const x = xOf(i);
    const y = yOf(values[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const last = history[history.length - 1];
  ctx.fillStyle = "rgba(238,248,255,0.78)";
  ctx.fillText(`f ${last.frame}  E ${formatNumber(last.energy)}`, 8, h - 8);
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
    loadText("./stable3d.wgsl"),
    loadText("./render_tracers.wgsl"),
  ]);
  const computeModule = device.createShaderModule({ label: "stable 3d cip compute", code: computeSource });
  const renderModule = device.createShaderModule({ label: "stable 3d cip render", code: renderSource });

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
  const fieldCopyBuffer = makeBuffer(
    device,
    "field copy temp",
    CELL_BYTES,
    GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  );
  const particleBuffer = makeBuffer(
    device,
    "visual tracers",
    VISUAL_PARTICLE_COUNT * 16,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX
  );
  const simBuffer = makeBuffer(device, "sim params", 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const renderBuffer = makeBuffer(device, "render params", 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const statsBuffer = makeBuffer(device, "energy stats", STATS_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
  const statsReadBuffer = makeBuffer(device, "energy stats readback", STATS_BYTES, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const apiStatsReadBuffer = makeBuffer(device, "api energy stats readback", STATS_BYTES, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

  const computeLayout = device.createBindGroupLayout({
    label: "stable 3d cip compute layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
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
      { binding: 2, resource: { buffer: simBuffer } },
      { binding: 3, resource: { buffer: paramBuffer } },
      { binding: 4, resource: { buffer: statsBuffer } },
      { binding: 5, resource: { buffer: particleBuffer } },
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
    energyStats: await createComputePipeline(device, computeModule, computeLayout, "energy_stats"),
  };

  const renderLayout = device.createBindGroupLayout({
    label: "stable 3d cip render layout",
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
    label: "stable field render pipeline",
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
  let statsReadPending = false;
  let statsSampleCounter = 0;
  const energyHistory = [];
  let lastTime = performance.now();
  let fpsTime = lastTime;
  let fpsFrames = 0;

  function writeSimUniform(now) {
    const simUniform = new ArrayBuffer(32);
    const simF = new Float32Array(simUniform);
    const simU = new Uint32Array(simUniform);
    simF[0] = VISUAL_PARTICLE_COUNT;
    simF[1] = now * 0.001;
    simU[4] = cfdFrame;
    device.queue.writeBuffer(simBuffer, 0, simUniform);
  }

  function resetSimulation() {
    device.queue.writeBuffer(fieldsBuffer, 0, new Float32Array(FIELD_COUNT * CELL_COUNT));
    device.queue.writeBuffer(wallsBuffer, 0, makeWalls());
    device.queue.writeBuffer(particleBuffer, 0, makeVisualParticles());
    device.queue.writeBuffer(statsBuffer, 0, new Float32Array(STATS_BYTES / 4));
    cfdFrame = 0;
    energyHistory.length = 0;
    drawEnergyChart(energyHistory);
  }

  function copyField(encoder, src, dst) {
    encoder.copyBufferToBuffer(fieldsBuffer, fieldOffset(src), fieldCopyBuffer, 0, CELL_BYTES);
    encoder.copyBufferToBuffer(fieldCopyBuffer, 0, fieldsBuffer, fieldOffset(dst), CELL_BYTES);
  }

  function encodeGridPass(encoder, label, callback) {
    const pass = encoder.beginComputePass({ label });
    callback(pass);
    pass.end();
  }

  function encodeStep(encoder) {
    copyField(encoder, F.YUN, F.YU);
    copyField(encoder, F.YVN, F.YV);
    copyField(encoder, F.YWN, F.YW);

    encodeGridPass(encoder, "velocities", (pass) => {
      dispatchGrid(pass, pipelines.veloc0, bgDefault);
      dispatchGrid(pass, pipelines.veloc1, bgDefault);
    });

    copyField(encoder, F.GXU, F.GXU0);
    copyField(encoder, F.GYU, F.GYU0);
    copyField(encoder, F.GZU, F.GZU0);
    copyField(encoder, F.GXV, F.GXV0);
    copyField(encoder, F.GYV, F.GYV0);
    copyField(encoder, F.GZV, F.GZV0);
    copyField(encoder, F.GXW, F.GXW0);
    copyField(encoder, F.GYW, F.GYW0);
    copyField(encoder, F.GZW, F.GZW0);

    encodeGridPass(encoder, "cip advection", (pass) => {
      dispatchGrid(pass, pipelines.advection, bgU);
      dispatchGrid(pass, pipelines.advection, bgV);
      dispatchGrid(pass, pipelines.advection, bgW);
    });

    copyField(encoder, F.YUN, F.YU);
    copyField(encoder, F.YVN, F.YV);
    copyField(encoder, F.YWN, F.YW);

    if (cfdFrame < 9992) {
      encodeGridPass(encoder, "external force", (pass) => dispatchOne(pass, pipelines.exforce, bgDefault));
    }
    encodeGridPass(encoder, "divergence", (pass) => dispatchGrid(pass, pipelines.div, bgDefault));

    const pressureCount = PRESSURE_ITERATIONS + (cfdFrame < PRESSURE_WARMUP_FRAMES ? PRESSURE_WARMUP_EXTRA : 0);
    encodeGridPass(encoder, "pressure", (pass) => {
      for (let i = 0; i < pressureCount; i += 1) {
        dispatchGrid(pass, pipelines.pressure0, bgDefault);
        dispatchGrid(pass, pipelines.pressure1, bgDefault);
      }
    });

    encodeGridPass(encoder, "pressure rhs", (pass) => dispatchGrid(pass, pipelines.rhs, bgDefault));

    copyField(encoder, F.GXU, F.GXU0);
    copyField(encoder, F.GYU, F.GYU0);
    copyField(encoder, F.GZU, F.GZU0);
    copyField(encoder, F.GXV, F.GXV0);
    copyField(encoder, F.GYV, F.GYV0);
    copyField(encoder, F.GZV, F.GZV0);
    copyField(encoder, F.GXW, F.GXW0);
    copyField(encoder, F.GYW, F.GYW0);
    copyField(encoder, F.GZW, F.GZW0);

    encodeGridPass(encoder, "new gradients", (pass) => {
      dispatchGrid(pass, pipelines.newgradX, bgDefault);
      dispatchGrid(pass, pipelines.newgradY, bgDefault);
      dispatchGrid(pass, pipelines.newgradZ, bgDefault);
      dispatchParticles(pass, pipelines.particle, bgDefault);
    });
    cfdFrame += 1;
  }

  function encodeEnergyStats(encoder) {
    encodeGridPass(encoder, "energy stats", (pass) => dispatchOne(pass, pipelines.energyStats, bgDefault));
    encoder.copyBufferToBuffer(statsBuffer, 0, statsReadBuffer, 0, STATS_BYTES);
  }

  function encodeRender(encoder) {
    const textureView = context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.47, g: 0.66, b: 0.93, a: 1.0 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, renderBindGroup);
    pass.draw(6, VISUAL_PARTICLE_COUNT, 0, 0);
    pass.end();
  }

  async function readStats() {
    const encoder = device.createCommandEncoder({ label: "api stats" });
    encodeGridPass(encoder, "api energy stats", (pass) => dispatchOne(pass, pipelines.energyStats, bgDefault));
    encoder.copyBufferToBuffer(statsBuffer, 0, apiStatsReadBuffer, 0, STATS_BYTES);
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
      const unstable = !Number.isFinite(values[0]) || values[0] > 100000 || values[2] > 5;
      energyEl.style.color = unstable ? "#ff806d" : "";
      maxSpeedEl.style.color = unstable ? "#ff806d" : "";
      divEl.style.color = unstable ? "#ff806d" : "";
      energyHistory.push({ frame: cfdFrame, energy: values[0] });
      if (energyHistory.length > 240) energyHistory.splice(0, energyHistory.length - 240);
      drawEnergyChart(energyHistory);
    } catch (error) {
      try {
        statsReadBuffer.unmap();
      } catch {}
      console.error(error);
    } finally {
      statsReadPending = false;
    }
  }

  function setRunning(nextRunning) {
    running = Boolean(nextRunning);
    toggleButton.textContent = running ? "Pause" : "Resume";
  }

  async function stepFrames(count = 1) {
    const frameCount = Math.max(0, Math.floor(Number(count) || 0));
    const wasRunning = running;
    setRunning(false);
    for (let done = 0; done < frameCount; done += STEPS_PER_ANIMATION) {
      writeSimUniform(performance.now());
      const encoder = device.createCommandEncoder({ label: "api stable step" });
      const chunk = Math.min(STEPS_PER_ANIMATION, frameCount - done);
      for (let i = 0; i < chunk; i += 1) encodeStep(encoder);
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
    }
    setRunning(wasRunning);
    return { frame: cfdFrame, stats: await readStats() };
  }

  function frame(now) {
    resizeCanvas(device, context, format);
    writeSimUniform(now);

    const renderUniform = new Float32Array(12);
    renderUniform[0] = canvas.width;
    renderUniform[1] = canvas.height;
    renderUniform[4] = Number(yaw.value) * Math.PI / 180;
    renderUniform[5] = -0.05;
    renderUniform[6] = Number(zoom.value);
    renderUniform[7] = Number(pointSize.value);
    renderUniform[8] = 0.82;
    device.queue.writeBuffer(renderBuffer, 0, renderUniform);

    const encoder = device.createCommandEncoder({ label: "stable 3d cip frame" });
    if (running) {
      for (let i = 0; i < STEPS_PER_ANIMATION; i += 1) {
        encodeStep(encoder);
      }
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
    if (shouldReadStats) readEnergyStats();

    fpsFrames += 1;
    if (now - fpsTime > 500) {
      fpsEl.textContent = (fpsFrames * 1000 / (now - fpsTime)).toFixed(1);
      fpsTime = now;
      fpsFrames = 0;
    }

    frameEl.textContent = String(cfdFrame);
    warmupEl.textContent = cfdFrame < PRESSURE_WARMUP_FRAMES ? "on" : "off";
    pointSizeValue.value = pointSize.value;
    zoomValue.value = zoom.value;
    yawValue.value = yaw.value;

    if (now - lastTime > 1200) {
      setStatus("Stable 3D CIP reference is running.", false);
      lastTime = now;
    }
    requestAnimationFrame(frame);
  }

  toggleButton.addEventListener("click", () => setRunning(!running));
  resetButton.addEventListener("click", resetSimulation);
  for (const [slider, output] of [[pointSize, pointSizeValue], [zoom, zoomValue], [yaw, yawValue]]) {
    slider.addEventListener("input", () => {
      output.value = slider.value;
    });
  }

  window.__stableCip3d = {
    reset() {
      resetSimulation();
      return this.getState();
    },
    setRunning,
    getState() {
      return {
        frame: cfdFrame,
        running,
        stepsPerAnimation: STEPS_PER_ANIMATION,
        pressureIterations: PRESSURE_ITERATIONS,
        pressureWarmupFrames: PRESSURE_WARMUP_FRAMES,
        pressureWarmupExtra: PRESSURE_WARMUP_EXTRA,
        cipLimit: 1.0,
        rhsClamp: false,
        gasRelease: false,
        transverseRepair: true,
        visualParticles: VISUAL_PARTICLE_COUNT,
      };
    },
    step: stepFrames,
    stats: readStats,
  };

  resetSimulation();
  setStatus("Stable 3D CIP reference is running.", false);
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
