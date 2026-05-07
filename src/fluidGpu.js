import { CO } from "./constants.js";
import { blueOfUnityColor, greenOfUnityColor, loadUnityBmp, redOfUnityColor } from "./bmp.js";
import { UNITY_FLUID_QUALITY } from "./fluidQuality.js";

const CELL_COUNT = CO.WX * CO.WY;
const GPU_VISUAL_PARTICLE_LIMIT = 24576;
const UNITY_DEFAULT_PARTICLE_COUNT = 262144;
const UNITY_STAGE_PARTICLES_PER_GAME_FRAME = 192;
const UNITY_NOZZLE_PARTICLES_PER_GAME_FRAME = 768;
const STRIDE = 34;
const CELL_BYTE_LENGTH = CELL_COUNT * STRIDE * 4;
const OFF = {
  YU: 0,
  YUN: 1,
  YV: 2,
  YVN: 3,
  YPN: 4,
  DIV: 5,
  DIVEX: 6,
  YE: 7,
  YEN: 8,
  KP: 9,
  KPORI: 10,
  KX: 11,
  KY: 12,
  BASEU: 13,
  BASEV: 14,
  BASEP: 15,
  BASEX: 16,
  BASEY: 17,
  GXU: 18,
  GYU: 19,
  GXV: 20,
  GYV: 21,
  GXE: 22,
  GYE: 23,
  GXU0: 24,
  GYU0: 25,
  GXV0: 26,
  GYV0: 27,
  GXE0: 28,
  GYE0: 29,
  YVU: 30,
  YUV: 31,
  YTTX: 32,
  YTTY: 33,
};

function createBuffer(device, size, usage, label) {
  return device.createBuffer({ size, usage, label });
}

function pipeline(device, module, layout, entryPoint) {
  return device.createComputePipeline({
    label: `unity-fluid-${entryPoint}`,
    layout,
    compute: { module, entryPoint },
  });
}

function colorForStage(stage, x, y, fallback) {
  let color = fallback;
  for (let c = 0; c < stage.ranges.length; c += 1) {
    const r = stage.ranges[c];
    if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) {
      color = stage.colors[c] ?? color;
    }
  }
  return color;
}

function makeVelocityStats(name = "all") {
  return {
    name,
    samples: 0,
    fluidU: 0,
    fluidV: 0,
    energy: 0,
    maxAbsU: { value: 0, x: 0, y: 0 },
    maxAbsV: { value: 0, x: 0, y: 0 },
    maxAbsGXU: { value: 0, x: 0, y: 0 },
    maxAbsGYU: { value: 0, x: 0, y: 0 },
    maxAbsGXV: { value: 0, x: 0, y: 0 },
    maxAbsGYV: { value: 0, x: 0, y: 0 },
    maxSpeed: { value: 0, x: 0, y: 0 },
  };
}

function velocityStatsFromCells(cells, regions = []) {
  const statsFor = [makeVelocityStats("all"), ...regions.map((r) => makeVelocityStats(r.name))];
  const inRegion = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  const add = (stats, x, y, base) => {
    const u = cells[base + OFF.YUN];
    const v = cells[base + OFF.YVN];
    const kx = cells[base + OFF.KX];
    const ky = cells[base + OFF.KY];
    const gxu = cells[base + OFF.GXU];
    const gyu = cells[base + OFF.GYU];
    const gxv = cells[base + OFF.GXV];
    const gyv = cells[base + OFF.GYV];
    stats.samples += 1;
    if (kx > 128) {
      stats.fluidU += 1;
      stats.energy += u * u;
      if (Math.abs(u) > Math.abs(stats.maxAbsU.value)) {
        stats.maxAbsU = { value: u, x, y };
      }
      if (Math.abs(gxu) > Math.abs(stats.maxAbsGXU.value)) {
        stats.maxAbsGXU = { value: gxu, x, y };
      }
      if (Math.abs(gyu) > Math.abs(stats.maxAbsGYU.value)) {
        stats.maxAbsGYU = { value: gyu, x, y };
      }
    }
    if (ky > 128) {
      stats.fluidV += 1;
      stats.energy += v * v;
      if (Math.abs(v) > Math.abs(stats.maxAbsV.value)) {
        stats.maxAbsV = { value: v, x, y };
      }
      if (Math.abs(gxv) > Math.abs(stats.maxAbsGXV.value)) {
        stats.maxAbsGXV = { value: gxv, x, y };
      }
      if (Math.abs(gyv) > Math.abs(stats.maxAbsGYV.value)) {
        stats.maxAbsGYV = { value: gyv, x, y };
      }
    }
    const speed = Math.hypot(kx > 128 ? u : 0, ky > 128 ? v : 0);
    if (speed > stats.maxSpeed.value) {
      stats.maxSpeed = { value: speed, x, y };
    }
  };

  for (let y = 0; y < CO.WY; y += 1) {
    for (let x = 0; x < CO.WX; x += 1) {
      const base = (y * CO.WX + x) * STRIDE;
      add(statsFor[0], x, y, base);
      for (let i = 0; i < regions.length; i += 1) {
        if (inRegion(regions[i], x, y)) {
          add(statsFor[i + 1], x, y, base);
        }
      }
    }
  }

  for (const stats of statsFor) {
    stats.meanEnergy = stats.energy / Math.max(1, stats.fluidU + stats.fluidV);
  }
  return statsFor;
}

function velocityCellSamplesFromCells(cells, points = []) {
  return points.map((point) => {
    const x = ((point.x % CO.WX) + CO.WX) % CO.WX;
    const y = ((point.y % CO.WY) + CO.WY) % CO.WY;
    const base = (y * CO.WX + x) * STRIDE;
    return {
      name: point.name ?? `${x},${y}`,
      x,
      y,
      yu: cells[base + OFF.YU],
      yun: cells[base + OFF.YUN],
      yv: cells[base + OFF.YV],
      yvn: cells[base + OFF.YVN],
      yuv: cells[base + OFF.YUV],
      yvu: cells[base + OFF.YVU],
      gxu: cells[base + OFF.GXU],
      gyu: cells[base + OFF.GYU],
      gxv: cells[base + OFF.GXV],
      gyv: cells[base + OFF.GYV],
      gxu0: cells[base + OFF.GXU0],
      gyu0: cells[base + OFF.GYU0],
      gxv0: cells[base + OFF.GXV0],
      gyv0: cells[base + OFF.GYV0],
      kx: cells[base + OFF.KX],
      ky: cells[base + OFF.KY],
    };
  });
}

export class FluidGpuSimulation {
  constructor(quality = UNITY_FLUID_QUALITY) {
    this.quality = quality;
    this.kabePori = new Uint16Array(CELL_COUNT);
    this.baseU = new Float32Array(CELL_COUNT);
    this.baseV = new Float32Array(CELL_COUNT);
    this.emitters = [];
    this.particleCount = Math.min(quality.gpuParticleCount ?? quality.particleCount ?? 3000, GPU_VISUAL_PARTICLE_LIMIT);
    this.particles = new Float32Array(this.particleCount * 2);
    this.particleColors = new Uint32Array(this.particleCount);
    this.particleData = new Float32Array(this.particleCount * 4);
    this.particleWrite = 0;
    this.lastForce = { x: 0, y: 0, coolDamage: 0 };
    this.readPending = false;
    this.particleReadPending = false;
    this.shapeData = [];
    this.emitterData = new Float32Array(4);
    this.ufoShapeOffset = 0;
    this.ufoShapeCount = 0;
    this.nozzleShapeOffset = 0;
    this.nozzleShapeCount = 4;
    this.moveObjectBuffers = [];
    this.moveObjectBindGroups = [];
  }

  static async isSupported() {
    if (!("gpu" in navigator)) {
      return false;
    }
    const adapter = await navigator.gpu.requestAdapter();
    return Boolean(adapter);
  }

  async ensureDevice() {
    if (this.device) {
      return;
    }
    this.adapter = await navigator.gpu.requestAdapter();
    if (!this.adapter) {
      throw new Error("WebGPU adapter is unavailable");
    }
    this.device = await this.adapter.requestDevice();
    const shader = await fetch("./shaders/fluid_unity_compute.wgsl");
    if (!shader.ok) {
      throw new Error("Failed to load WebGPU fluid shader");
    }
    const module = this.device.createShaderModule({ code: await shader.text() });
    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
    this.pipelines = {
      resetDynamic: pipeline(this.device, module, layout, "reset_dynamic"),
      objectMapping: pipeline(this.device, module, layout, "object_mapping"),
      kabeMapping: pipeline(this.device, module, layout, "kabe_mapping"),
      copyVelocity: pipeline(this.device, module, layout, "copy_velocity"),
      velocityAverage: pipeline(this.device, module, layout, "velocity_average"),
      copyGradients: pipeline(this.device, module, layout, "copy_gradients"),
      cipVelocity: pipeline(this.device, module, layout, "cip_velocity"),
      cipHeat: pipeline(this.device, module, layout, "cip_heat"),
      copyHeat: pipeline(this.device, module, layout, "copy_heat"),
      divergence: pipeline(this.device, module, layout, "divergence"),
      pressure0: pipeline(this.device, module, layout, "pressure0"),
      pressure1: pipeline(this.device, module, layout, "pressure1"),
      rhs: pipeline(this.device, module, layout, "rhs"),
      newGradU: pipeline(this.device, module, layout, "newgrad_u"),
      newGradV: pipeline(this.device, module, layout, "newgrad_v"),
      ufoPressure: pipeline(this.device, module, layout, "ufopressure"),
      particleUpdate: pipeline(this.device, module, layout, "particle_update"),
    };
  }

  async loadAssets(stage) {
    await this.ensureDevice();
    this.stage = stage;
    const [ufoCfd, wallBmps, moveCfds] = await Promise.all([
      loadUnityBmp("./assets/textures/ufo/cfdcoli.bmp"),
      stage.syntheticFluidStage ? null : Promise.all([
        loadUnityBmp(`${stage.assetRoot}/kabex.bmp`),
        loadUnityBmp(`${stage.assetRoot}/kabey.bmp`),
        loadUnityBmp(`${stage.assetRoot}/kabep.bmp`),
        loadUnityBmp(`${stage.assetRoot}/kabew.bmp`),
      ]),
      Promise.all((stage.moveObjects ?? []).map((obj) => (obj.syntheticShape ? null : loadUnityBmp(obj.cfdPath)))),
    ]);

    const cellData = stage.syntheticFluidStage ? this.buildSyntheticCellData(stage) : this.buildCellData(stage, ...wallBmps);
    this.buildShapeData(ufoCfd, moveCfds);
    this.resetParticles(stage);
    this.createGpuBuffers(cellData);
  }

  buildShapeData(ufoCfd, moveCfds = []) {
    const shape = [];
    this.ufoShapeOffset = 0;
    for (let y = 0; y < ufoCfd.height; y += 1) {
      for (let x = 0; x < ufoCfd.width; x += 1) {
        if (redOfUnityColor(ufoCfd.data[x + y * ufoCfd.width]) === 0) {
          shape.push(x - 5, y - 5);
        }
      }
    }
    this.ufoShapeCount = shape.length / 2;
    this.nozzleShapeOffset = this.ufoShapeCount;
    for (const p of [
      [-1, 3],
      [0, 3],
      [-1, 2],
      [0, 2],
    ]) {
      shape.push(p[0], p[1]);
    }
    for (let m = 0; m < moveCfds.length; m += 1) {
      const bmp = moveCfds[m];
      const obj = this.stage.moveObjects[m];
      obj.shapeOffset = shape.length / 2;
      obj.shape = [];
      let radiusSq = 0;
      if (obj.syntheticShape) {
        const width = Math.max(1, Math.trunc(obj.syntheticShape.width));
        const height = Math.max(1, Math.trunc(obj.syntheticShape.height));
        const startX = -Math.floor(width / 2);
        const startY = -Math.floor(height / 2);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const px = startX + x;
            const py = startY + y;
            shape.push(px, py);
            obj.shape.push({ x: px, y: py });
            radiusSq = Math.max(radiusSq, px * px + py * py);
          }
        }
        obj.shapeCount = (shape.length / 2) - obj.shapeOffset;
        obj.radius = Math.sqrt(radiusSq);
        obj.width = width;
        obj.height = height;
        continue;
      }
      for (let y = 0; y < bmp.height; y += 1) {
        for (let x = 0; x < bmp.width; x += 1) {
          if (redOfUnityColor(bmp.data[x + y * bmp.width]) === 0) {
            const px = x - Math.trunc(bmp.width / 2);
            const py = y - Math.trunc(bmp.height / 2);
            shape.push(px, py);
            obj.shape.push({ x: px, y: py });
            radiusSq = Math.max(radiusSq, px * px + py * py);
          }
        }
      }
      obj.shapeCount = (shape.length / 2) - obj.shapeOffset;
      obj.radius = Math.sqrt(radiusSq);
      obj.width = bmp.width;
      obj.height = bmp.height;
    }
    this.shapeData = new Float32Array(shape);
  }

  buildSyntheticCellData(stage) {
    const data = new Float32Array(CELL_COUNT * STRIDE);
    this.kabePori.fill(255);
    this.baseU.fill(0);
    this.baseV.fill(0);
    this.emitters = [];
    const set = (cell, off, value) => {
      data[cell * STRIDE + off] = value;
    };

    for (let y = 0; y < CO.WY; y += 1) {
      for (let x = 0; x < CO.WX; x += 1) {
        const cell = x + y * CO.WX;
        const fixedEdge = x === 0 || y === 0 || x === CO.WX - 1 || y === CO.WY - 1;
        const kp = fixedEdge ? 1 : 255;
        const kxy = fixedEdge ? 0 : 255;
        this.kabePori[cell] = kp;
        set(cell, OFF.KPORI, kp);
        set(cell, OFF.KP, kp);
        set(cell, OFF.BASEX, kxy);
        set(cell, OFF.BASEY, kxy);
        set(cell, OFF.KX, kxy);
        set(cell, OFF.KY, kxy);
      }
    }

    if (stage.syntheticTracerGrid) {
      for (let y = 8; y < CO.WY; y += 8) {
        for (let x = 8; x < CO.WX; x += 8) {
          this.emitters.push({ x, y });
        }
      }
    }

    return data;
  }

  buildCellData(stage, kabex, kabey, kabep, kabew) {
    const data = new Float32Array(CELL_COUNT * STRIDE);
    this.kabePori.fill(255);
    this.baseU.fill(0);
    this.baseV.fill(0);
    this.emitters = [];
    const set = (cell, off, value) => {
      data[cell * STRIDE + off] = value;
    };
    const get = (cell, off) => data[cell * STRIDE + off];

    for (let y = 0; y < CO.WY; y += 1) {
      for (let x = 0; x < CO.WX; x += 1) {
        const cell = x + y * CO.WX;
        const rx = redOfUnityColor(kabex.data[cell]);
        const ry = redOfUnityColor(kabey.data[cell]);
        const rp = redOfUnityColor(kabep.data[cell]);
        const kx = rx > 128 ? 255 : 0;
        const ky = ry > 128 ? 255 : 0;
        const kp = rp === 0 ? 1 : rp;
        const baseU = rx > 128 ? 0 : ((rx - 64) / 64) * CO.SPEED * stage.stageSpeed;
        const baseV = ry > 128 ? 0 : ((ry - 64) / 64) * CO.SPEED * stage.stageSpeed;
        const baseP = kp !== 255 ? CO.PRESSURER * (kp - 96) : 0;

        this.kabePori[cell] = kp;
        this.baseU[cell] = baseU;
        this.baseV[cell] = baseV;
        set(cell, OFF.KPORI, kp);
        set(cell, OFF.KP, kp);
        set(cell, OFF.BASEX, kx);
        set(cell, OFF.BASEY, ky);
        set(cell, OFF.KX, kx);
        set(cell, OFF.KY, ky);
        set(cell, OFF.BASEU, baseU);
        set(cell, OFF.BASEV, baseV);
        set(cell, OFF.BASEP, baseP);
        set(cell, OFF.YUN, baseU);
        set(cell, OFF.YVN, baseV);
        set(cell, OFF.YPN, baseP);
      }
    }

    for (let y = 0; y < CO.WY; y += 1) {
      for (let x = 0; x < CO.WX; x += 1) {
        const cell = x + y * CO.WX;
        const color = kabew.data[cell];
        const r = redOfUnityColor(color);
        const g = greenOfUnityColor(color);
        const b = blueOfUnityColor(color);
        if (r === 0) {
          if (get(cell, OFF.KPORI) === 255) {
            this.kabePori[cell] = 0;
            set(cell, OFF.KPORI, 0);
            set(cell, OFF.KP, 0);
          }
          const right = ((x + 1) % CO.WX) + y * CO.WX;
          const down = x + ((y + 1) % CO.WY) * CO.WX;
          for (const c of [cell, right]) {
            this.baseU[c] = 0;
            set(c, OFF.BASEX, 0);
            set(c, OFF.KX, 0);
            set(c, OFF.BASEU, 0);
            set(c, OFF.YUN, 0);
          }
          for (const c of [cell, down]) {
            this.baseV[c] = 0;
            set(c, OFF.BASEY, 0);
            set(c, OFF.KY, 0);
            set(c, OFF.BASEV, 0);
            set(c, OFF.YVN, 0);
          }
        }
        if (b === 0) {
          this.kabePori[cell] = 1;
          set(cell, OFF.KPORI, 1);
          set(cell, OFF.KP, 1);
        }
        if (g < 128) {
          for (let n = 0; n < 128 - g; n += 1) {
            this.emitters.push({ x, y });
          }
        }
      }
    }

    return data;
  }

  resetParticles(stage) {
    const fallback = stage.colors[0] ?? 0xffffff;
    this.emitterData = new Float32Array(Math.max(1, this.emitters.length) * 4);
    if (this.emitters.length === 0 || this.particleCount === 0) {
      return;
    }
    for (let i = 0; i < this.emitters.length; i += 1) {
      const emitter = this.emitters[i];
      this.emitterData[i * 4 + 0] = emitter.x;
      this.emitterData[i * 4 + 1] = emitter.y;
      this.emitterData[i * 4 + 2] = colorForStage(stage, emitter.x, emitter.y, fallback);
      this.emitterData[i * 4 + 3] = 1;
    }
    for (let i = 0; i < this.particleCount; i += 1) {
      const emitter = this.emitters[(i * 37) % this.emitters.length];
      const x = emitter.x + ((i * 13) % 1000) * 0.001;
      const y = emitter.y + ((i * 29) % 1000) * 0.001;
      const color = colorForStage(stage, emitter.x, emitter.y, fallback);
      this.particles[i * 2 + 0] = x;
      this.particles[i * 2 + 1] = y;
      this.particleColors[i] = color;
      this.particleData[i * 4 + 0] = x;
      this.particleData[i * 4 + 1] = y;
      this.particleData[i * 4 + 2] = color;
      this.particleData[i * 4 + 3] = 0;
    }
  }

  createGpuBuffers(cellData) {
    const device = this.device;
    this.cellBuffer?.destroy?.();
    this.shapeBuffer?.destroy?.();
    this.ufoeBuffer?.destroy?.();
    this.objectInfoBuffer?.destroy?.();
    this.readbackBuffer?.destroy?.();
    this.cellReadbackBuffer?.destroy?.();
    for (const buffer of this.velocitySnapshotBuffers ?? []) {
      buffer?.destroy?.();
    }
    for (const buffer of this.velocitySnapshotReadbackBuffers ?? []) {
      buffer?.destroy?.();
    }
    this.particleBuffer?.destroy?.();
    this.particleReadbackBuffer?.destroy?.();
    this.emitterBuffer?.destroy?.();
    for (const buffer of this.moveObjectBuffers) {
      buffer?.destroy?.();
    }
    this.moveObjectBuffers = [];
    this.moveObjectBindGroups = [];
    this.velocitySnapshotBuffers = [];
    this.velocitySnapshotReadbackBuffers = [];
    this.velocitySnapshotCount = 0;
    this.velocitySnapshotsPerBuffer = 0;

    this.cellBuffer = createBuffer(
      device,
      cellData.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      "unity-fluid-cells",
    );
    device.queue.writeBuffer(this.cellBuffer, 0, cellData);
    this.cellReadbackBuffer = createBuffer(
      device,
      cellData.byteLength,
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      "unity-fluid-cells-readback",
    );
    this.shapeBuffer = createBuffer(
      device,
      this.shapeData.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      "unity-fluid-shape",
    );
    device.queue.writeBuffer(this.shapeBuffer, 0, this.shapeData);
    this.ufoeBuffer = createBuffer(
      device,
      16,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      "unity-fluid-ufoe",
    );
    this.objectInfoBuffer = createBuffer(
      device,
      64 * 8 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      "unity-fluid-object-info",
    );
    this.readbackBuffer = createBuffer(
      device,
      16,
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      "unity-fluid-ufoe-readback",
    );
    this.particleBuffer = createBuffer(
      device,
      this.particleData.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      "unity-fluid-particles",
    );
    device.queue.writeBuffer(this.particleBuffer, 0, this.particleData);
    this.particleReadbackBuffer = createBuffer(
      device,
      this.particleData.byteLength,
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      "unity-fluid-particles-readback",
    );
    this.emitterBuffer = createBuffer(
      device,
      this.emitterData.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      "unity-fluid-emitters",
    );
    device.queue.writeBuffer(this.emitterBuffer, 0, this.emitterData);
    this.simBuffer = this.simBuffer ?? createBuffer(device, 80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "unity-fluid-sim");
    this.ufoObjectBuffer = this.ufoObjectBuffer ?? createBuffer(device, 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "unity-fluid-ufo-object");
    this.nozzleObjectBuffer = this.nozzleObjectBuffer ?? createBuffer(device, 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "unity-fluid-nozzle-object");
    this.particleParamBuffer = this.particleParamBuffer ?? createBuffer(device, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "unity-fluid-particle-params");

    this.ufoBindGroup = this.makeBindGroup(this.ufoObjectBuffer);
    this.nozzleBindGroup = this.makeBindGroup(this.nozzleObjectBuffer);
    for (let i = 0; i < (this.stage.moveObjects ?? []).length; i += 1) {
      const buffer = createBuffer(device, 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, `unity-fluid-move-object-${i}`);
      this.moveObjectBuffers.push(buffer);
      this.moveObjectBindGroups.push(this.makeBindGroup(buffer));
    }
  }

  destroy() {
    this.cellBuffer?.destroy?.();
    this.shapeBuffer?.destroy?.();
    this.ufoeBuffer?.destroy?.();
    this.objectInfoBuffer?.destroy?.();
    this.readbackBuffer?.destroy?.();
    this.cellReadbackBuffer?.destroy?.();
    this.particleBuffer?.destroy?.();
    this.particleReadbackBuffer?.destroy?.();
    this.emitterBuffer?.destroy?.();
    this.simBuffer?.destroy?.();
    this.ufoObjectBuffer?.destroy?.();
    this.nozzleObjectBuffer?.destroy?.();
    this.particleParamBuffer?.destroy?.();
    for (const buffer of this.velocitySnapshotBuffers ?? []) {
      buffer?.destroy?.();
    }
    for (const buffer of this.velocitySnapshotReadbackBuffers ?? []) {
      buffer?.destroy?.();
    }
    for (const buffer of this.moveObjectBuffers ?? []) {
      buffer?.destroy?.();
    }
    this.velocitySnapshotBuffers = [];
    this.velocitySnapshotReadbackBuffers = [];
    this.moveObjectBuffers = [];
    this.moveObjectBindGroups = [];
    this.velocitySnapshotCount = 0;
    this.velocitySnapshotsPerBuffer = 0;
  }

  makeBindGroup(objectBuffer) {
    return this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.simBuffer } },
        { binding: 1, resource: { buffer: this.cellBuffer } },
        { binding: 2, resource: { buffer: this.shapeBuffer } },
        { binding: 3, resource: { buffer: this.ufoeBuffer } },
        { binding: 4, resource: { buffer: objectBuffer } },
        { binding: 5, resource: { buffer: this.particleBuffer } },
        { binding: 6, resource: { buffer: this.emitterBuffer } },
        { binding: 7, resource: { buffer: this.particleParamBuffer } },
        { binding: 8, resource: { buffer: this.objectInfoBuffer } },
      ],
    });
  }

  writeSim(ufo) {
    const sim = new Float32Array(20);
    sim[0] = CO.WX;
    sim[1] = CO.WY;
    sim[4] = CO.ALPHA;
    sim[5] = CO.DT;
    sim[6] = this.quality.substeps;
    sim[8] = ufo.pos.x;
    sim[9] = ufo.pos.y;
    sim[10] = ufo.spd.x;
    sim[11] = ufo.spd.y;
    sim[12] = ufo.rad;
    sim[13] = ufo.radspd;
    sim[16] = ufo.thrusting ? ufo.nozzleRysPos.x : 900;
    sim[17] = ufo.thrusting ? ufo.nozzleRysPos.y : 900;
    sim[18] = ufo.nozzleSpd.x;
    sim[19] = ufo.nozzleSpd.y;
    this.device.queue.writeBuffer(this.simBuffer, 0, sim);
  }

  writeParticleParams() {
    const data = new Float32Array(4);
    data[0] = this.particleCount;
    data[1] = this.emitters.length;
    data[2] = this.particleWrite;
    data[3] = this.stageParticleSpawnCount();
    this.device.queue.writeBuffer(this.particleParamBuffer, 0, data);
  }

  scaleUnityParticleCount(unityCount) {
    return Math.max(1, Math.round((unityCount * this.particleCount) / UNITY_DEFAULT_PARTICLE_COUNT));
  }

  stageParticleSpawnCount() {
    return this.scaleUnityParticleCount(UNITY_STAGE_PARTICLES_PER_GAME_FRAME * this.stage.particleLoopMultiplier);
  }

  nozzleParticleSpawnCount() {
    return this.scaleUnityParticleCount(UNITY_NOZZLE_PARTICLES_PER_GAME_FRAME);
  }

  writeObject(buffer, ufo, setVal, shapeOffset, shapeCount, spd) {
    const data = new Float32Array(12);
    data[0] = ufo.pos.x;
    data[1] = ufo.pos.y;
    data[2] = spd.x;
    data[3] = spd.y;
    data[4] = ufo.rad;
    data[5] = setVal;
    data[6] = shapeOffset;
    data[7] = shapeCount;
    data[8] = ufo.radspd;
    this.device.queue.writeBuffer(buffer, 0, data);
  }

  writeMoveObject(buffer, obj) {
    const data = new Float32Array(12);
    data[0] = obj.x;
    data[1] = obj.y;
    data[2] = obj.runtimeSpdX ?? obj.spdX;
    data[3] = obj.runtimeSpdY ?? obj.spdY;
    data[4] = obj.rad;
    data[5] = obj.id;
    data[6] = obj.shapeOffset;
    data[7] = obj.shapeCount;
    data[8] = obj.runtimeRadspd ?? obj.radspd;
    this.device.queue.writeBuffer(buffer, 0, data);
  }

  async readVelocityStats(regions = []) {
    if (!this.cellBuffer || !this.cellReadbackBuffer) {
      return null;
    }
    const encoder = this.device.createCommandEncoder({ label: "unity-fluid-stats-readback" });
    encoder.copyBufferToBuffer(this.cellBuffer, 0, this.cellReadbackBuffer, 0, CELL_BYTE_LENGTH);
    this.device.queue.submit([encoder.finish()]);
    await this.cellReadbackBuffer.mapAsync(GPUMapMode.READ);
    const cells = new Float32Array(this.cellReadbackBuffer.getMappedRange().slice(0));
    this.cellReadbackBuffer.unmap();
    return velocityStatsFromCells(cells, regions);
  }

  prepareVelocitySnapshots(snapshotCount) {
    for (const buffer of this.velocitySnapshotBuffers ?? []) {
      buffer?.destroy?.();
    }
    for (const buffer of this.velocitySnapshotReadbackBuffers ?? []) {
      buffer?.destroy?.();
    }
    this.velocitySnapshotCount = Math.max(0, snapshotCount | 0);
    if (!this.cellBuffer || this.velocitySnapshotCount <= 0) {
      this.velocitySnapshotBuffers = [];
      this.velocitySnapshotReadbackBuffers = [];
      this.velocitySnapshotsPerBuffer = 0;
      return;
    }
    const maxBufferSize = this.device.limits?.maxBufferSize ?? (256 * 1024 * 1024);
    this.velocitySnapshotsPerBuffer = Math.max(1, Math.floor(maxBufferSize / CELL_BYTE_LENGTH));
    this.velocitySnapshotBuffers = [];
    this.velocitySnapshotReadbackBuffers = [];
    for (let offset = 0; offset < this.velocitySnapshotCount; offset += this.velocitySnapshotsPerBuffer) {
      const count = Math.min(this.velocitySnapshotsPerBuffer, this.velocitySnapshotCount - offset);
      const byteLength = CELL_BYTE_LENGTH * count;
      this.velocitySnapshotBuffers.push(createBuffer(
        this.device,
        byteLength,
        GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        `unity-fluid-velocity-snapshots-${this.velocitySnapshotBuffers.length}`,
      ));
      this.velocitySnapshotReadbackBuffers.push(createBuffer(
        this.device,
        byteLength,
        GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        `unity-fluid-velocity-snapshots-readback-${this.velocitySnapshotReadbackBuffers.length}`,
      ));
    }
  }

  encodeVelocitySnapshot(encoder, index) {
    if (!this.cellBuffer || !this.velocitySnapshotBuffers?.length || index < 0 || index >= this.velocitySnapshotCount) {
      return false;
    }
    const chunk = Math.floor(index / this.velocitySnapshotsPerBuffer);
    const localIndex = index - chunk * this.velocitySnapshotsPerBuffer;
    const snapshotBuffer = this.velocitySnapshotBuffers[chunk];
    if (!snapshotBuffer) {
      return false;
    }
    encoder.copyBufferToBuffer(this.cellBuffer, 0, snapshotBuffer, localIndex * CELL_BYTE_LENGTH, CELL_BYTE_LENGTH);
    return true;
  }

  captureVelocitySnapshot(index) {
    const encoder = this.device.createCommandEncoder({ label: "unity-fluid-velocity-snapshot" });
    const captured = this.encodeVelocitySnapshot(encoder, index);
    if (!captured) {
      return false;
    }
    this.device.queue.submit([encoder.finish()]);
    return true;
  }

  async readVelocitySnapshotStats(frames = [], regionsOrList = []) {
    if (!this.velocitySnapshotBuffers?.length || !this.velocitySnapshotReadbackBuffers?.length || frames.length === 0) {
      return [];
    }
    const snapshotCount = Math.min(frames.length, this.velocitySnapshotCount);
    const results = [];
    const regionsBySnapshot = Array.isArray(regionsOrList[0]) ? regionsOrList : null;
    for (let chunk = 0; chunk < this.velocitySnapshotBuffers.length; chunk += 1) {
      const start = chunk * this.velocitySnapshotsPerBuffer;
      if (start >= snapshotCount) {
        break;
      }
      const count = Math.min(this.velocitySnapshotsPerBuffer, snapshotCount - start);
      const byteLength = CELL_BYTE_LENGTH * count;
      const encoder = this.device.createCommandEncoder({ label: "unity-fluid-velocity-snapshots-readback" });
      encoder.copyBufferToBuffer(this.velocitySnapshotBuffers[chunk], 0, this.velocitySnapshotReadbackBuffers[chunk], 0, byteLength);
      this.device.queue.submit([encoder.finish()]);
      await this.velocitySnapshotReadbackBuffers[chunk].mapAsync(GPUMapMode.READ, 0, byteLength);
      const mapped = this.velocitySnapshotReadbackBuffers[chunk].getMappedRange(0, byteLength);
      for (let i = 0; i < count; i += 1) {
        const snapshotIndex = start + i;
        const cells = new Float32Array(mapped, i * CELL_BYTE_LENGTH, CELL_COUNT * STRIDE);
        const regions = regionsBySnapshot ? (regionsOrList[snapshotIndex] ?? []) : regionsOrList;
        results.push({
          frame: frames[snapshotIndex],
          stats: velocityStatsFromCells(cells, regions),
        });
      }
      this.velocitySnapshotReadbackBuffers[chunk].unmap();
    }
    return results;
  }

  async readVelocitySnapshotCells(frames = [], points = []) {
    if (!this.velocitySnapshotBuffers?.length || !this.velocitySnapshotReadbackBuffers?.length || frames.length === 0) {
      return [];
    }
    const snapshotCount = Math.min(frames.length, this.velocitySnapshotCount);
    const results = [];
    for (let chunk = 0; chunk < this.velocitySnapshotBuffers.length; chunk += 1) {
      const start = chunk * this.velocitySnapshotsPerBuffer;
      if (start >= snapshotCount) {
        break;
      }
      const count = Math.min(this.velocitySnapshotsPerBuffer, snapshotCount - start);
      const byteLength = CELL_BYTE_LENGTH * count;
      const encoder = this.device.createCommandEncoder({ label: "unity-fluid-velocity-snapshot-cells-readback" });
      encoder.copyBufferToBuffer(this.velocitySnapshotBuffers[chunk], 0, this.velocitySnapshotReadbackBuffers[chunk], 0, byteLength);
      this.device.queue.submit([encoder.finish()]);
      await this.velocitySnapshotReadbackBuffers[chunk].mapAsync(GPUMapMode.READ, 0, byteLength);
      const mapped = this.velocitySnapshotReadbackBuffers[chunk].getMappedRange(0, byteLength);
      for (let i = 0; i < count; i += 1) {
        const snapshotIndex = start + i;
        const cells = new Float32Array(mapped, i * CELL_BYTE_LENGTH, CELL_COUNT * STRIDE);
        results.push({
          frame: frames[snapshotIndex],
          cells: velocityCellSamplesFromCells(cells, points),
        });
      }
      this.velocitySnapshotReadbackBuffers[chunk].unmap();
    }
    return results;
  }

  step(ufo, moveObjects = [], snapshotCapture = null) {
    this.writeSim(ufo);
    this.writeParticleParams();
    this.writeObject(this.ufoObjectBuffer, ufo, 2, this.ufoShapeOffset, this.ufoShapeCount, ufo.spd);
    this.writeObject(this.nozzleObjectBuffer, ufo, 3, this.nozzleShapeOffset, this.nozzleShapeCount, ufo.nozzleSpd);
    for (let i = 0; i < moveObjects.length && i < this.moveObjectBuffers.length; i += 1) {
      this.writeMoveObject(this.moveObjectBuffers[i], moveObjects[i]);
    }
    this.device.queue.writeBuffer(this.ufoeBuffer, 0, new Float32Array(4));

    const encoder = this.device.createCommandEncoder({ label: "unity-fluid-frame" });
    let fluidPass = encoder.beginComputePass();
    const dispatchGrid = (pass, pipe, bindGroup = this.ufoBindGroup) => {
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(12, 9, 1);
    };
    const dispatchOne = (pass, pipe, x, bindGroup = this.ufoBindGroup) => {
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(x, 1, 1);
    };
    const dispatchPressure = (pass, pipe) => {
      pass.setPipeline(pipe);
      pass.setBindGroup(0, this.ufoBindGroup);
      pass.dispatchWorkgroups((CO.WX * CO.WY) / 128 / 2, 1, 1);
    };

    dispatchGrid(fluidPass, this.pipelines.resetDynamic);
    dispatchOne(fluidPass, this.pipelines.objectMapping, Math.ceil(this.ufoShapeCount / 64), this.ufoBindGroup);
    if (ufo.thrusting) {
      dispatchOne(fluidPass, this.pipelines.objectMapping, 1, this.nozzleBindGroup);
    }
    for (let i = 0; i < moveObjects.length && i < this.moveObjectBindGroups.length; i += 1) {
      const obj = moveObjects[i];
      dispatchOne(fluidPass, this.pipelines.objectMapping, Math.ceil((obj.shapeCount ?? 0) / 64), this.moveObjectBindGroups[i]);
    }
    dispatchGrid(fluidPass, this.pipelines.kabeMapping);

    const captureStage = (stageName, sub) => {
      const index = snapshotCapture?.(stageName, sub);
      if (!Number.isInteger(index)) {
        return;
      }
      fluidPass.end();
      this.encodeVelocitySnapshot(encoder, index);
      fluidPass = encoder.beginComputePass();
    };

    for (let sub = 0; sub < this.quality.substeps; sub += 1) {
      dispatchGrid(fluidPass, this.pipelines.copyVelocity);
      dispatchGrid(fluidPass, this.pipelines.velocityAverage);
      dispatchGrid(fluidPass, this.pipelines.copyGradients);
      captureStage("beforeCip", sub);
      dispatchGrid(fluidPass, this.pipelines.cipVelocity);
      captureStage("afterCipVelocity", sub);
      dispatchGrid(fluidPass, this.pipelines.cipHeat);
      dispatchGrid(fluidPass, this.pipelines.copyVelocity);
      dispatchGrid(fluidPass, this.pipelines.copyHeat);
      dispatchGrid(fluidPass, this.pipelines.divergence);
      for (let i = 0; i < this.quality.pressureLoops; i += 1) {
        dispatchPressure(fluidPass, this.pipelines.pressure0);
        dispatchPressure(fluidPass, this.pipelines.pressure1);
      }
      dispatchOne(fluidPass, this.pipelines.ufoPressure, 1);
      dispatchGrid(fluidPass, this.pipelines.rhs);
      captureStage("afterRhs", sub);
      dispatchGrid(fluidPass, this.pipelines.newGradV);
      captureStage("afterNewGradV", sub);
      dispatchGrid(fluidPass, this.pipelines.newGradU);
      captureStage("afterNewGradU", sub);
    }
    fluidPass.end();

    if (this.particleCount > 0 && this.emitters.length > 0) {
      const particlePass = encoder.beginComputePass();
      particlePass.setPipeline(this.pipelines.particleUpdate);
      particlePass.setBindGroup(0, this.ufoBindGroup);
      particlePass.dispatchWorkgroups(Math.ceil(this.particleCount / 128), 1, 1);
      particlePass.end();
      this.particleWrite = (
        this.particleWrite + this.stageParticleSpawnCount() + (ufo.thrusting ? this.nozzleParticleSpawnCount() : 0)
      ) % this.particleCount;
    }

    let copyForce = false;
    let copyParticles = false;
    if (!this.readPending) {
      encoder.copyBufferToBuffer(this.ufoeBuffer, 0, this.readbackBuffer, 0, 16);
      this.readPending = true;
      copyForce = true;
    }
    if (!this.particleReadPending && this.particleCount > 0 && this.emitters.length > 0) {
      encoder.copyBufferToBuffer(this.particleBuffer, 0, this.particleReadbackBuffer, 0, this.particleData.byteLength);
      this.particleReadPending = true;
      copyParticles = true;
    }

    this.device.queue.submit([encoder.finish()]);

    if (copyForce) {
      this.readbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
        const values = new Float32Array(this.readbackBuffer.getMappedRange().slice(0));
        this.lastForce = { x: values[0] || 0, y: values[1] || 0, coolDamage: values[2] || 0 };
        this.readbackBuffer.unmap();
        this.readPending = false;
      }).catch(() => {
        this.readPending = false;
      });
    }

    if (copyParticles) {
      this.particleReadbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
        const values = new Float32Array(this.particleReadbackBuffer.getMappedRange().slice(0));
        this.particleData.set(values);
        for (let i = 0; i < this.particleCount; i += 1) {
          this.particles[i * 2 + 0] = values[i * 4 + 0];
          this.particles[i * 2 + 1] = values[i * 4 + 1];
          this.particleColors[i] = values[i * 4 + 2] >>> 0;
        }
        this.particleReadbackBuffer.unmap();
        this.particleReadPending = false;
      }).catch(() => {
        this.particleReadPending = false;
      });
    }
    return this.lastForce;
  }
}
