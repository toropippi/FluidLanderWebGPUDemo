import { CO } from "./constants.js";

const MAX_CANVAS_WIDTH = CO.WX * CO.TEXSCALE;
const MAX_CANVAS_HEIGHT = CO.WY * CO.TEXSCALE;
const FLUID_CELLS_PER_WORLD_UNIT = CO.WY / 10;
const UFO_WORLD_SIZE = 0.8;
const GOAL_WORLD_SIZE = 1.48 * 0.8680555;
const RARE_EARTH_WORLD_WIDTH = 2.0 * 0.5;
const RARE_EARTH_WORLD_HEIGHT = 1.28 * 0.5;
const HEART_WORLD_SCALE = 0.5;
const ONE_UP_WORLD_SCALE = 0.5;
const MOVE_OBJECT_WORLD_SCALE = 1.736111;

function loadImage(path) {
  return new Promise((resolve, reject) => {
    if (!path) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${path}`));
    image.src = path;
  });
}

function colorIntToCss(color, alpha = 0.75) {
  const r = color & 255;
  const g = (color >>> 8) & 255;
  const b = (color >>> 16) & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.viewport = { x: 0, y: 0, w: canvas.width, h: canvas.height, scale: 1 };
    this.backingSize = { width: canvas.width, height: canvas.height };
    this.images = {};
  }

  async load(stage) {
    const [stageImage, backgroundImage, ufo, goalWhite, goalBack, rareEarth, heart, oneUp] = await Promise.all([
      loadImage(stage.stageImage),
      loadImage(stage.backgroundImage),
      loadImage("./assets/textures/ufo/ufo.png"),
      loadImage("./assets/textures/goalwhite.png"),
      loadImage("./assets/textures/goalback.png"),
      loadImage("./assets/textures/rareearth.png"),
      loadImage("./assets/textures/hart.png"),
      loadImage("./assets/textures/1up.png"),
    ]);
    const moveObjects = {};
    await Promise.all((stage.moveObjects ?? []).map(async (obj) => {
      if (!moveObjects[obj.bmpId]) {
        moveObjects[obj.bmpId] = await loadImage(obj.imagePath);
      }
    }));
    this.images = { stageImage, backgroundImage, ufo, goalWhite, goalBack, rareEarth, heart, oneUp, moveObjects };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetWidth = Math.max(320, Math.floor(this.canvas.clientWidth * dpr));
    const targetHeight = Math.max(240, Math.floor(this.canvas.clientHeight * dpr));
    const fit = Math.min(1, MAX_CANVAS_WIDTH / targetWidth, MAX_CANVAS_HEIGHT / targetHeight);
    const width = Math.max(320, Math.floor(targetWidth * fit));
    const height = Math.max(240, Math.floor(targetHeight * fit));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.backingSize = { width, height };
    const scale = Math.min(width / (CO.WX * CO.TEXSCALE), height / (CO.WY * CO.TEXSCALE));
    const w = CO.WX * CO.TEXSCALE * scale;
    const h = CO.WY * CO.TEXSCALE * scale;
    this.viewport = {
      x: (width - w) * 0.5,
      y: (height - h) * 0.5,
      w,
      h,
      scale,
    };
  }

  toScreenX(x) {
    return this.viewport.x + x * CO.TEXSCALE * this.viewport.scale;
  }

  toScreenY(y) {
    return this.viewport.y + y * CO.TEXSCALE * this.viewport.scale;
  }

  unityWorldToPixels(worldUnits) {
    return worldUnits * FLUID_CELLS_PER_WORLD_UNIT * CO.TEXSCALE * this.viewport.scale;
  }

  draw(game, fluid) {
    this.resize();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#020407";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.viewport.x, this.viewport.y, this.viewport.w, this.viewport.h);
    ctx.clip();

    if (this.images.backgroundImage) {
      ctx.drawImage(this.images.backgroundImage, this.viewport.x, this.viewport.y, this.viewport.w, this.viewport.h);
    }
    if (this.images.stageImage) {
      ctx.drawImage(this.images.stageImage, this.viewport.x, this.viewport.y, this.viewport.w, this.viewport.h);
    }

    this.drawParticles(fluid);
    this.drawMoveObjects(game);
    this.drawGoals(game);
    this.drawHearts(game);
    this.drawOneUps(game);
    this.drawRareEarths(game);
    this.drawUfo(game.ufo);
    ctx.restore();
    this.drawFrame();
  }

  drawParticles(fluid) {
    const ctx = this.ctx;
    const particleScale = Math.max(1.5, 2.2 * this.viewport.scale);
    for (let i = 0; i < fluid.particles.length / 2; i += 1) {
      const x = fluid.particles[i * 2 + 0];
      const y = fluid.particles[i * 2 + 1];
      if (x <= 0 || y <= 0 || x >= CO.WX || y >= CO.WY) {
        continue;
      }
      const color = fluid.particleColors[i];
      const nozzle = color === CO.PARTICLECOLOR_NOZ1;
      const size = nozzle ? particleScale * 1.6 : particleScale;
      ctx.fillStyle = colorIntToCss(color, nozzle ? 0.95 : 0.82);
      ctx.fillRect(this.toScreenX(x), this.toScreenY(y), size, size);
    }
  }

  drawMoveObjects(game) {
    const ctx = this.ctx;
    const images = this.images.moveObjects ?? {};
    for (const obj of game.stage.moveObjects ?? []) {
      const image = images[obj.bmpId];
      if (!image && !obj.visualShape) {
        continue;
      }
      const x = this.toScreenX(obj.x);
      const y = this.toScreenY(obj.y);
      const width = obj.visualShape
        ? obj.visualShape.width * CO.TEXSCALE * this.viewport.scale
        : this.unityWorldToPixels((image.naturalWidth / 100) * MOVE_OBJECT_WORLD_SCALE);
      const height = obj.visualShape
        ? obj.visualShape.height * CO.TEXSCALE * this.viewport.scale
        : this.unityWorldToPixels((image.naturalHeight / 100) * MOVE_OBJECT_WORLD_SCALE);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(obj.rad);
      if (image) {
        ctx.drawImage(image, -width * 0.5, -height * 0.5, width, height);
      } else {
        ctx.fillStyle = "rgba(230, 240, 255, 0.92)";
        ctx.strokeStyle = "rgba(40, 70, 90, 0.95)";
        ctx.lineWidth = Math.max(1, this.viewport.scale);
        ctx.fillRect(-width * 0.5, -height * 0.5, width, height);
        ctx.strokeRect(-width * 0.5, -height * 0.5, width, height);
      }
      ctx.restore();
    }
  }

  drawGoals(game) {
    const ctx = this.ctx;
    for (const goal of game.stage.goals) {
      const x = this.toScreenX(goal.x);
      const y = this.toScreenY(goal.y);
      const size = this.unityWorldToPixels(GOAL_WORLD_SIZE);
      if (this.images.goalBack) {
        ctx.globalAlpha = 0.78;
        ctx.drawImage(this.images.goalBack, x - size * 0.5, y - size * 0.5, size, size);
      }
      if (goal.active && this.images.goalWhite) {
        ctx.globalAlpha = goal.wait < CO.GOALWAIT ? Math.max(0.15, goal.wait / CO.GOALWAIT) : 1;
        ctx.drawImage(this.images.goalWhite, x - size * 0.5, y - size * 0.5, size, size);
      }
      ctx.globalAlpha = 1;
    }
  }

  drawRareEarths(game) {
    const ctx = this.ctx;
    for (const rare of game.stage.rareEarths) {
      if (rare.collected) {
        continue;
      }
      const x = this.toScreenX(rare.x);
      const y = this.toScreenY(rare.y);
      const width = this.unityWorldToPixels(RARE_EARTH_WORLD_WIDTH);
      const height = this.unityWorldToPixels(RARE_EARTH_WORLD_HEIGHT);
      if (this.images.rareEarth) {
        ctx.drawImage(this.images.rareEarth, x - width * 0.5, y - height * 0.5, width, height);
      } else {
        ctx.fillStyle = rare.superRare ? "#ffcf5a" : "#d8f5ff";
        ctx.beginPath();
        ctx.arc(x, y, Math.min(width, height) * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawHearts(game) {
    const ctx = this.ctx;
    const image = this.images.heart;
    if (!image) {
      return;
    }
    const width = this.unityWorldToPixels((image.naturalWidth / 100) * HEART_WORLD_SCALE);
    const height = this.unityWorldToPixels((image.naturalHeight / 100) * HEART_WORLD_SCALE);
    for (const heart of game.stage.hearts ?? []) {
      if (heart.collected) {
        continue;
      }
      const x = this.toScreenX(heart.x);
      const y = this.toScreenY(heart.y);
      ctx.drawImage(image, x - width * 0.5, y - height * 0.5, width, height);
    }
  }

  drawOneUps(game) {
    const ctx = this.ctx;
    const image = this.images.oneUp;
    if (!image) {
      return;
    }
    const width = this.unityWorldToPixels((image.naturalWidth / 100) * ONE_UP_WORLD_SCALE);
    const height = this.unityWorldToPixels((image.naturalHeight / 100) * ONE_UP_WORLD_SCALE);
    for (const oneUp of game.stage.oneUps ?? []) {
      if (oneUp.collected) {
        continue;
      }
      const x = this.toScreenX(oneUp.x);
      const y = this.toScreenY(oneUp.y);
      ctx.drawImage(image, x - width * 0.5, y - height * 0.5, width, height);
    }
  }

  drawUfo(ufo) {
    const ctx = this.ctx;
    const x = this.toScreenX(ufo.pos.x);
    const y = this.toScreenY(ufo.pos.y);
    const size = this.unityWorldToPixels(UFO_WORLD_SIZE);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ufo.rad);
    if (ufo.restartInvincible > 0 && Math.floor(ufo.restartInvincible / 6) % 2 === 0) {
      ctx.globalAlpha = 0.45;
    }
    if (this.images.ufo) {
      ctx.drawImage(this.images.ufo, -size * 0.5, -size * 0.5, size, size);
    } else {
      ctx.fillStyle = "#e8f8ff";
      ctx.fillRect(-size * 0.4, -size * 0.2, size * 0.8, size * 0.4);
    }
    if (ufo.thrusting) {
      ctx.fillStyle = "rgba(255, 85, 24, 0.78)";
      ctx.beginPath();
      ctx.moveTo(0, size * 0.55);
      ctx.lineTo(-size * 0.16, size * 0.16);
      ctx.lineTo(size * 0.16, size * 0.16);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawFrame() {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(180, 220, 255, 0.32)";
    ctx.lineWidth = Math.max(1, this.viewport.scale);
    ctx.strokeRect(this.viewport.x, this.viewport.y, this.viewport.w, this.viewport.h);
  }
}
