const WX = 32;
const WY = 32;
const WZ = 32;
const CELL_COUNT = WX * WY * WZ;
const FIELD_COUNT = 36;
const WALL_COUNT = 4;
const CELL_BYTES = CELL_COUNT * 4;
const VELOCITY_BYTES = CELL_BYTES * 3;

const PRESSURE_ITERATIONS = 32;
const PRESSURE_WARMUP_FRAMES = 20;
const PRESSURE_WARMUP_EXTRA = 2048;

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

const CASES = [
  {
    name: "closed_zero",
    walls: "closed",
    init: "zero",
    force: false,
    checkpoints: [0, 32, 128],
    quickCheckpoints: [0, 16],
  },
  {
    name: "closed_center_u_pulse",
    walls: "closed",
    init: "centerPulseU",
    force: false,
    checkpoints: [0, 16, 64, 256, 512],
    quickCheckpoints: [0, 32],
  },
  {
    name: "current_forced_stable",
    walls: "current",
    init: "zero",
    force: true,
    checkpoints: [128, 512, 1024],
    quickCheckpoints: [128],
  },
];

const summaryEl = document.querySelector("#summary");
const outputEl = document.querySelector("#output");
const runDefaultButton = document.querySelector("#runDefault");
const runQuickButton = document.querySelector("#runQuick");

function setSummary(text, state = "") {
  summaryEl.textContent = text;
  summaryEl.className = state;
}

function setOutput(value) {
  outputEl.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function idx3(i, j, k) {
  return ((i + WX) % WX) + (((j + WY) % WY) + ((k + WZ) % WZ) * WY) * WX;
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

function makeWalls(kind) {
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
        const boundary = kind === "closed"
          ? i === 0 || j === 0 || k === 0 || i === WX - 1 || j === WY - 1 || k === WZ - 1
          : i === 0 || j === 0 || k === 0;
        if (boundary) wallP[idx3(i, j, k)] = 0;
      }
    }
  }

  for (let k = 0; k < WZ; k += 1) {
    for (let j = 0; j < WY; j += 1) {
      for (let i = 0; i < WX; i += 1) {
        const p = idx3(i, j, k);
        const tx = wallP[idx3(i - 1, j, k)];
        const ty = wallP[idx3(i, j - 1, k)];
        const tz = wallP[idx3(i, j, k - 1)];
        if (tx === 0 || wallP[p] === 0) wallX[p] = 0;
        if (ty === 0 || wallP[p] === 0) wallY[p] = 0;
        if (tz === 0 || wallP[p] === 0) wallZ[p] = 0;
      }
    }
  }
  return walls;
}

function makeInitialFields(kind) {
  const fields = new Float32Array(FIELD_COUNT * CELL_COUNT);
  if (kind !== "centerPulseU") return fields;

  for (let k = 14; k < 18; k += 1) {
    for (let j = 14; j < 18; j += 1) {
      for (let i = 14; i < 18; i += 1) {
        const c = idx3(i, j, k);
        fields[fieldOffset(F.YU) / 4 + c] = 0.8;
        fields[fieldOffset(F.YUN) / 4 + c] = 0.8;
      }
    }
  }
  return fields;
}

async function loadText(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.text();
}

async function createComputePipeline(device, module, layout, entryPoint) {
  return device.createComputePipelineAsync({
    label: `validate3d-${entryPoint}`,
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

function finite(value) {
  return Number.isFinite(value);
}

function speedAt(u, v, w, i, j, k) {
  const c = idx3(i, j, k);
  return Math.hypot(u[c], v[c], w[c]);
}

function evaluateCase(name, samples) {
  const failures = [];
  const all = samples.every((sample) => finite(sample.energy) && finite(sample.maxSpeed) && finite(sample.divRms));
  if (!all) failures.push("non-finite metric");

  const last = samples[samples.length - 1];
  if (name === "closed_zero") {
    if (last.energy > 1e-8) failures.push(`zero energy drift ${last.energy}`);
    if (last.maxSpeed > 1e-6) failures.push(`zero max speed drift ${last.maxSpeed}`);
    if (last.divRms > 1e-6) failures.push(`zero div drift ${last.divRms}`);
  } else if (name === "closed_center_u_pulse") {
    const first = samples[0];
    if (!(first.energy > 30 && first.energy < 50)) failures.push(`unexpected initial pulse energy ${first.energy}`);
    if (samples.some((sample) => sample.maxSpeed > 1.05)) failures.push("pulse max speed exceeded 1.05");
    if (samples.some((sample) => sample.divRms > 0.12)) failures.push("pulse divergence exceeded 0.12 RMS");
    if (!(last.energy > 0.05 && last.energy < first.energy * 1.2)) failures.push(`pulse energy did not settle ${last.energy}`);
    if (!(last.active1e3 > first.active1e3)) failures.push("pulse did not spread to more active cells");
  } else if (name === "current_forced_stable") {
    if (!(last.energy > 100 && last.energy < 2000)) failures.push(`forced energy outside stable range ${last.energy}`);
    if (samples.some((sample) => sample.maxSpeed > 1.05)) failures.push("forced max speed exceeded 1.05");
    if (samples.some((sample) => sample.divRms > 0.08)) failures.push("forced divergence exceeded 0.08 RMS");
    if (!(last.active1e3 > 1000)) failures.push("forced flow did not activate enough cells");
  }
  return { pass: failures.length === 0, failures };
}

async function createHarness() {
  if (!navigator.gpu) throw new Error("WebGPU is not available in this browser.");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("WebGPU adapter was not found.");
  const device = await adapter.requestDevice();
  const source = await loadText("./stable3d.wgsl");
  const module = device.createShaderModule({ label: "stable 3d cip validation shader", code: source });

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
  const velocityReadBuffer = makeBuffer(
    device,
    "velocity readback",
    VELOCITY_BYTES,
    GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  );
  const simBuffer = makeBuffer(device, "sim params", 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const paramDefault = createParam(device, makeParamArray([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]), "param default");
  const paramsU = createParam(
    device,
    makeParamArray([F.YU, F.YVU, F.YWU, F.YUN], [F.GXU, F.GYU, F.GZU, F.GXU0], [F.GYU0, F.GZU0, F.YU, W.X]),
    "param U"
  );
  const paramsV = createParam(
    device,
    makeParamArray([F.YUV, F.YV, F.YWV, F.YVN], [F.GXV, F.GYV, F.GZV, F.GXV0], [F.GYV0, F.GZV0, F.YV, W.Y]),
    "param V"
  );
  const paramsW = createParam(
    device,
    makeParamArray([F.YUW, F.YVW, F.YW, F.YWN], [F.GXW, F.GYW, F.GZW, F.GXW0], [F.GYW0, F.GZW0, F.YW, W.Z]),
    "param W"
  );
  const statsBuffer = makeBuffer(device, "unused stats", 64, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  const particleBuffer = makeBuffer(device, "unused particles", 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);

  const layout = device.createBindGroupLayout({
    label: "validation compute layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });

  const makeBindGroup = (param, label) => device.createBindGroup({
    label,
    layout,
    entries: [
      { binding: 0, resource: { buffer: fieldsBuffer } },
      { binding: 1, resource: { buffer: wallsBuffer } },
      { binding: 2, resource: { buffer: simBuffer } },
      { binding: 3, resource: { buffer: param } },
      { binding: 4, resource: { buffer: statsBuffer } },
      { binding: 5, resource: { buffer: particleBuffer } },
    ],
  });

  const bgDefault = makeBindGroup(paramDefault, "default");
  const bgU = makeBindGroup(paramsU, "u");
  const bgV = makeBindGroup(paramsV, "v");
  const bgW = makeBindGroup(paramsW, "w");
  const pipelines = {
    veloc0: await createComputePipeline(device, module, layout, "veloc0"),
    veloc1: await createComputePipeline(device, module, layout, "veloc1"),
    advection: await createComputePipeline(device, module, layout, "advection_cip"),
    div: await createComputePipeline(device, module, layout, "div"),
    pressure0: await createComputePipeline(device, module, layout, "pressure0"),
    pressure1: await createComputePipeline(device, module, layout, "pressure1"),
    rhs: await createComputePipeline(device, module, layout, "rhs"),
    newgradX: await createComputePipeline(device, module, layout, "newgrad_x"),
    newgradY: await createComputePipeline(device, module, layout, "newgrad_y"),
    newgradZ: await createComputePipeline(device, module, layout, "newgrad_z"),
    exforce: await createComputePipeline(device, module, layout, "exforce0"),
  };

  let frame = 0;

  function writeSimUniform() {
    const simUniform = new ArrayBuffer(32);
    const simU = new Uint32Array(simUniform);
    simU[4] = frame;
    device.queue.writeBuffer(simBuffer, 0, simUniform);
  }

  function reset(config) {
    frame = 0;
    device.queue.writeBuffer(fieldsBuffer, 0, makeInitialFields(config.init));
    device.queue.writeBuffer(wallsBuffer, 0, makeWalls(config.walls));
  }

  function copyField(encoder, src, dst) {
    encoder.copyBufferToBuffer(fieldsBuffer, fieldOffset(src), fieldCopyBuffer, 0, CELL_BYTES);
    encoder.copyBufferToBuffer(fieldCopyBuffer, 0, fieldsBuffer, fieldOffset(dst), CELL_BYTES);
  }

  function encodePass(encoder, label, callback) {
    const pass = encoder.beginComputePass({ label });
    callback(pass);
    pass.end();
  }

  function encodeStep(encoder, config) {
    copyField(encoder, F.YUN, F.YU);
    copyField(encoder, F.YVN, F.YV);
    copyField(encoder, F.YWN, F.YW);
    encodePass(encoder, "velocities", (pass) => {
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

    encodePass(encoder, "cip advection", (pass) => {
      dispatchGrid(pass, pipelines.advection, bgU);
      dispatchGrid(pass, pipelines.advection, bgV);
      dispatchGrid(pass, pipelines.advection, bgW);
    });

    copyField(encoder, F.YUN, F.YU);
    copyField(encoder, F.YVN, F.YV);
    copyField(encoder, F.YWN, F.YW);

    if (config.force && frame < 9992) {
      encodePass(encoder, "external force", (pass) => dispatchOne(pass, pipelines.exforce, bgDefault));
    }
    encodePass(encoder, "divergence", (pass) => dispatchGrid(pass, pipelines.div, bgDefault));
    const pressureCount = PRESSURE_ITERATIONS + (frame < PRESSURE_WARMUP_FRAMES ? PRESSURE_WARMUP_EXTRA : 0);
    encodePass(encoder, "pressure", (pass) => {
      for (let i = 0; i < pressureCount; i += 1) {
        dispatchGrid(pass, pipelines.pressure0, bgDefault);
        dispatchGrid(pass, pipelines.pressure1, bgDefault);
      }
    });
    encodePass(encoder, "rhs", (pass) => dispatchGrid(pass, pipelines.rhs, bgDefault));

    copyField(encoder, F.GXU, F.GXU0);
    copyField(encoder, F.GYU, F.GYU0);
    copyField(encoder, F.GZU, F.GZU0);
    copyField(encoder, F.GXV, F.GXV0);
    copyField(encoder, F.GYV, F.GYV0);
    copyField(encoder, F.GZV, F.GZV0);
    copyField(encoder, F.GXW, F.GXW0);
    copyField(encoder, F.GYW, F.GYW0);
    copyField(encoder, F.GZW, F.GZW0);

    encodePass(encoder, "new gradients", (pass) => {
      dispatchGrid(pass, pipelines.newgradX, bgDefault);
      dispatchGrid(pass, pipelines.newgradY, bgDefault);
      dispatchGrid(pass, pipelines.newgradZ, bgDefault);
    });
    frame += 1;
  }

  async function readMetrics(label) {
    const encoder = device.createCommandEncoder({ label: "read velocity metrics" });
    encoder.copyBufferToBuffer(fieldsBuffer, fieldOffset(F.YUN), velocityReadBuffer, 0, CELL_BYTES);
    encoder.copyBufferToBuffer(fieldsBuffer, fieldOffset(F.YVN), velocityReadBuffer, CELL_BYTES, CELL_BYTES);
    encoder.copyBufferToBuffer(fieldsBuffer, fieldOffset(F.YWN), velocityReadBuffer, CELL_BYTES * 2, CELL_BYTES);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await velocityReadBuffer.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(velocityReadBuffer.getMappedRange()).slice();
    velocityReadBuffer.unmap();

    const u = values.subarray(0, CELL_COUNT);
    const v = values.subarray(CELL_COUNT, CELL_COUNT * 2);
    const w = values.subarray(CELL_COUNT * 2, CELL_COUNT * 3);
    let energy = 0;
    let maxSpeed2 = 0;
    let div2 = 0;
    let maxDiv = 0;
    let sumU = 0;
    let sumV = 0;
    let sumW = 0;
    let active1e3 = 0;
    let active1e2 = 0;

    for (let k = 0; k < WZ; k += 1) {
      for (let j = 0; j < WY; j += 1) {
        for (let i = 0; i < WX; i += 1) {
          const c = idx3(i, j, k);
          const speed2 = u[c] * u[c] + v[c] * v[c] + w[c] * w[c];
          energy += speed2;
          if (speed2 > maxSpeed2) maxSpeed2 = speed2;
          const speed = Math.sqrt(speed2);
          if (speed > 1e-3) active1e3 += 1;
          if (speed > 1e-2) active1e2 += 1;
          sumU += u[c];
          sumV += v[c];
          sumW += w[c];
          const div = u[idx3(i + 1, j, k)] - u[c] + v[idx3(i, j + 1, k)] - v[c] + w[idx3(i, j, k + 1)] - w[c];
          div2 += div * div;
          const absDiv = Math.abs(div);
          if (absDiv > maxDiv) maxDiv = absDiv;
        }
      }
    }

    return {
      label,
      frame,
      energy,
      energyPerCell: energy / CELL_COUNT,
      maxSpeed: Math.sqrt(maxSpeed2),
      divRms: Math.sqrt(div2 / CELL_COUNT),
      maxDiv,
      active1e3,
      active1e2,
      momentum: [sumU, sumV, sumW],
      probes: {
        center: speedAt(u, v, w, 16, 16, 16),
        source: speedAt(u, v, w, 15, 16, 16),
        plusX: speedAt(u, v, w, 22, 16, 16),
        minusX: speedAt(u, v, w, 10, 16, 16),
        plusY: speedAt(u, v, w, 16, 22, 16),
        plusZ: speedAt(u, v, w, 16, 16, 22),
        nearWall: speedAt(u, v, w, 2, 16, 16),
      },
    };
  }

  async function runCase(config, quick = false) {
    reset(config);
    writeSimUniform();
    const checkpoints = quick ? config.quickCheckpoints : config.checkpoints;
    const samples = [];
    const maxFrame = checkpoints[checkpoints.length - 1];
    let nextCheckpoint = 0;

    if (checkpoints[0] === 0) {
      samples.push(await readMetrics(`${config.name}@0`));
      nextCheckpoint = 1;
    }

    while (frame < maxFrame) {
      writeSimUniform();
      const encoder = device.createCommandEncoder({ label: `${config.name} frame ${frame}` });
      encodeStep(encoder, config);
      device.queue.submit([encoder.finish()]);
      if (checkpoints[nextCheckpoint] === frame) {
        await device.queue.onSubmittedWorkDone();
      }
      if (frame === checkpoints[nextCheckpoint]) {
        samples.push(await readMetrics(`${config.name}@${frame}`));
        nextCheckpoint += 1;
      }
    }

    const verdict = evaluateCase(config.name, samples);
    return { name: config.name, pass: verdict.pass, failures: verdict.failures, samples };
  }

  async function runAll(options = {}) {
    const quick = options.quick === true;
    const startedAt = performance.now();
    const cases = [];
    for (const config of CASES) {
      setSummary(`Running ${config.name}...`);
      const result = await runCase(config, quick);
      cases.push(result);
      setOutput({ quick, cases });
    }
    const pass = cases.every((row) => row.pass);
    const out = {
      pass,
      quick,
      elapsedMs: performance.now() - startedAt,
      constants: {
        grid: [WX, WY, WZ],
        pressureIterations: PRESSURE_ITERATIONS,
        pressureWarmupFrames: PRESSURE_WARMUP_FRAMES,
        pressureWarmupExtra: PRESSURE_WARMUP_EXTRA,
        cipLimit: 1.0,
        rhsClamp: false,
        gasRelease: false,
        transverseRepair: true,
      },
      cases,
    };
    setSummary(pass ? `PASS in ${out.elapsedMs.toFixed(1)} ms` : `FAIL in ${out.elapsedMs.toFixed(1)} ms`, pass ? "pass" : "fail");
    setOutput(out);
    return out;
  }

  return { runAll };
}

let harnessPromise;

async function getHarness() {
  if (!harnessPromise) harnessPromise = createHarness();
  return harnessPromise;
}

async function runValidation(options = {}) {
  const harness = await getHarness();
  return harness.runAll(options);
}

window.__stableCip3dValidation = {
  run: runValidation,
};

runDefaultButton.addEventListener("click", () => {
  runValidation({ quick: false }).catch((error) => {
    console.error(error);
    setSummary(error?.stack || String(error), "fail");
  });
});

runQuickButton.addEventListener("click", () => {
  runValidation({ quick: true }).catch((error) => {
    console.error(error);
    setSummary(error?.stack || String(error), "fail");
  });
});

setSummary("Ready. Run default for regression validation, or quick for a smoke test.");
setOutput({
  cases: CASES.map((row) => ({
    name: row.name,
    walls: row.walls,
    init: row.init,
    force: row.force,
    checkpoints: row.checkpoints,
  })),
});
