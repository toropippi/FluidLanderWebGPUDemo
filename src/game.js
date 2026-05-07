import { CO, clamp } from "./constants.js";

function lengthSq(dx, dy) {
  return dx * dx + dy * dy;
}

function normalize(vec) {
  const len = Math.hypot(vec.x, vec.y);
  if (len > 0) {
    vec.x /= len;
    vec.y /= len;
  }
  return vec;
}

export function updateMoveObject(obj, speedScale = 1) {
  const moveScale = Number.isFinite(speedScale) ? speedScale : 1;
  obj.runtimeSpdX = obj.spdX * moveScale;
  obj.runtimeSpdY = obj.spdY * moveScale;
  obj.runtimeRadspd = obj.radspd * moveScale;
  obj.x += obj.runtimeSpdX * CO.DT * CO.CFDFRAME_PAR_GAMEFRAME;
  obj.y += obj.runtimeSpdY * CO.DT * CO.CFDFRAME_PAR_GAMEFRAME;
  obj.rad += obj.runtimeRadspd * CO.DT * CO.CFDFRAME_PAR_GAMEFRAME;
  obj.rad = ((obj.rad + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;

  switch (obj.bmpId) {
    case 5:
      obj.radspd = 0.0036;
      break;
    case 6:
      obj.radspd = -0.0008;
      break;
    case 7:
      obj.radspd = -0.0012;
      break;
    case 8:
      obj.spdY = -0.03 * Math.cos(0.02 * obj.cnt);
      break;
    default:
      break;
  }
  obj.runtimeSpdX = obj.spdX * moveScale;
  obj.runtimeSpdY = obj.spdY * moveScale;
  obj.runtimeRadspd = obj.radspd * moveScale;
  obj.cnt += 1;
}

export class InputState {
  constructor() {
    this.left = false;
    this.right = false;
    this.thrust = false;
    this.pause = false;
  }

  attach(target = window) {
    const setKey = (event, value) => {
      const key = event.key.toLowerCase();
      if (key === "arrowleft" || key === "a") {
        this.left = value;
        event.preventDefault();
      }
      if (key === "arrowright" || key === "d") {
        this.right = value;
        event.preventDefault();
      }
      if (key === " " || key === "z" || key === "x" || key === "enter") {
        this.thrust = value;
        event.preventDefault();
      }
    };
    target.addEventListener("keydown", (event) => setKey(event, true));
    target.addEventListener("keyup", (event) => setKey(event, false));
  }
}

export class UfoBody {
  constructor(collisionPoints) {
    this.collisionPoints = collisionPoints;
    this.left = CO.STARTLEFT;
    this.reset(null);
  }

  reset(stage) {
    this.stage = stage;
    this.pos = { x: stage?.start.x ?? 20, y: stage?.start.y ?? 20, z: -0.02 };
    this.restartPos = { x: this.pos.x, y: this.pos.y };
    this.spd = { x: 0, y: 0 };
    this.nozzleSpd = { x: 0, y: 0 };
    this.nozzleRysPos = { x: 0, y: 0 };
    this.rad = 0;
    this.radspd = 0;
    this.hitpoint = 128;
    this.fastkey = 0;
    this.deathcounter = 0;
    this.restartInvincible = 0;
    this.ingoal = 0;
    this.preIngoal = 0;
    this.thrusting = false;
  }

  update(input, stage, fluid, goalActive) {
    this.stage = stage;
    this.radspd = 0;
    this.thrusting = false;

    if (this.deathcounter !== 0) {
      this.updateDeath();
      this.updateNozzle(false);
      return;
    }

    if (input.left) {
      this.rad -= CO.UFORADSPD;
      this.radspd = -CO.UFORADSPD / (CO.DT * CO.CFDFRAME_PAR_GAMEFRAME);
    }
    if (input.right) {
      this.rad += CO.UFORADSPD;
      this.radspd = CO.UFORADSPD / (CO.DT * CO.CFDFRAME_PAR_GAMEFRAME);
    }
    this.rad = ((this.rad + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;

    if (input.thrust) {
      this.spd.x += stage.jumpf * Math.sin(this.rad);
      this.spd.y -= stage.jumpf * Math.cos(this.rad);
      this.fastkey = 1;
      this.thrusting = true;
    }

    this.spd.y += stage.grav * this.fastkey;
    this.spd.x *= 0.993;
    this.spd.y *= 0.993;

    this.collide(fluid, stage, goalActive);
    this.collideMoveObjects(stage, goalActive);

    this.pos.x += this.spd.x * CO.DT * CO.CFDFRAME_PAR_GAMEFRAME;
    this.pos.y += this.spd.y * CO.DT * CO.CFDFRAME_PAR_GAMEFRAME;
    this.pos.x = clamp(this.pos.x, -40, CO.WX + 40);
    this.pos.y = clamp(this.pos.y, -40, CO.WY + 40);

    if (this.restartInvincible > 0) {
      this.restartInvincible = Math.max(0, this.restartInvincible - 1);
    }
    this.updateNozzle(this.thrusting);
    this.checkDeath();
  }

  updateNozzle() {
    this.nozzleSpd.x = (-0.7 * Math.sin(this.rad)) + this.spd.x;
    this.nozzleSpd.y = (0.7 * Math.cos(this.rad)) + this.spd.y;
    this.nozzleRysPos.x = -3.0 * Math.sin(this.rad) + this.pos.x;
    this.nozzleRysPos.y = 3.5 * Math.cos(this.rad) + this.pos.y;
  }

  applyFluidForce(force, stage) {
    if (this.fastkey === 0 || this.deathcounter !== 0) {
      return;
    }
    const fx = clamp(force.x, -stage.forceToUfoLimit, stage.forceToUfoLimit);
    const fy = clamp(force.y, -stage.forceToUfoLimit, stage.forceToUfoLimit);
    this.spd.x += stage.pullf * (1 - this.preIngoal) * fx;
    this.spd.y += stage.pullf * (1 - this.preIngoal) * fy;
    if (force.coolDamage > 0 && this.restartInvincible === 0) {
      this.hitpoint -= 0.0005 * force.coolDamage * 2;
    }
  }

  collide(fluid, stage, goalActive) {
    let hits = 0;
    const ref = { x: 0, y: 0 };
    const cos = Math.cos(this.rad);
    const sin = Math.sin(this.rad);

    for (const p of this.collisionPoints) {
      const rx = p.x * cos - p.y * sin;
      const ry = p.x * sin + p.y * cos;
      const x = Math.trunc(rx + this.pos.x);
      const y = Math.trunc(ry + this.pos.y);
      if (x > 0 && x < CO.WX - 1 && y > 0 && y < CO.WY - 1) {
        const kb = fluid.kabePori[x + y * CO.WX];
        if (kb < 64) {
          hits += 1;
          ref.x += rx;
          ref.y += ry;
        }
      } else {
        hits += 1;
        ref.x += rx;
        ref.y += ry;
      }
    }

    if (hits === 0) {
      return;
    }
    normalize(ref);
    const dot = ref.x * this.spd.x + ref.y * this.spd.y;
    if (dot <= 0) {
      return;
    }
    this.spd.x += -2 * dot * ref.x;
    this.spd.y += -2 * dot * ref.y;

    if (!goalActive && Math.abs(dot) > 0.01 && this.restartInvincible === 0) {
      const base = Math.abs(dot) > 0.088 ? 70 : 40;
      this.hitpoint -= base * Math.abs(dot) * 2 * stage.damageRatio;
    }

  }

  collideMoveObjects(stage, goalActive) {
    const objects = stage.moveObjects ?? [];
    const ufoCos = Math.cos(this.rad);
    const ufoSin = Math.sin(this.rad);
    for (const obj of objects) {
      const shape = obj.shape ?? [];
      if (shape.length === 0 || Math.abs(this.pos.x - obj.x) > (obj.radius ?? 64) + 9 || Math.abs(this.pos.y - obj.y) > (obj.radius ?? 64) + 9) {
        continue;
      }
      let hits = 0;
      const ref = { x: 0, y: 0 };
      let outSpdX = 0;
      let outSpdY = 0;
      const objCos = Math.cos(obj.rad);
      const objSin = Math.sin(obj.rad);
      for (const p of shape) {
        const objX = Math.trunc(p.x * objCos - p.y * objSin + obj.x);
        const objY = Math.trunc(p.x * objSin + p.y * objCos + obj.y);
        if (Math.abs(Math.trunc(this.pos.x) - objX) >= 9 || Math.abs(Math.trunc(this.pos.y) - objY) >= 9) {
          continue;
        }
        for (const u of this.collisionPoints) {
          const rx = u.x * ufoCos - u.y * ufoSin;
          const ry = u.x * ufoSin + u.y * ufoCos;
          const colX = Math.trunc(rx + this.pos.x);
          const colY = Math.trunc(ry + this.pos.y);
          if (colX === objX && colY === objY) {
            hits += 1;
            ref.x += rx;
            ref.y += ry;
            const px = objX - Math.trunc(obj.x);
            const py = objY - Math.trunc(obj.y);
            const objSpdX = obj.runtimeSpdX ?? obj.spdX;
            const objSpdY = obj.runtimeSpdY ?? obj.spdY;
            const objRadspd = obj.runtimeRadspd ?? obj.radspd;
            outSpdX = objSpdX + (px * Math.cos(objRadspd) - py * Math.sin(objRadspd) - px);
            outSpdY = objSpdY + (px * Math.sin(objRadspd) + py * Math.cos(objRadspd) - py);
          }
        }
      }
      if (hits === 0) {
        continue;
      }
      normalize(ref);
      const dot = ref.x * (this.spd.x - outSpdX) + ref.y * (this.spd.y - outSpdY);
      if (dot <= 0) {
        continue;
      }
      this.spd.x += -2 * dot * ref.x;
      this.spd.y += -2 * dot * ref.y;
      if (!goalActive && Math.abs(dot) > 0.01 && this.restartInvincible === 0 && stage.unityStage !== 18) {
        const base = Math.abs(dot) > 0.088 ? 70 : 40;
        this.hitpoint -= base * Math.abs(dot) * 2 * stage.damageRatio;
      }
    }
  }

  checkDeath() {
    if (this.hitpoint >= 0) {
      return;
    }
    this.deathcounter = 1;
    this.hitpoint = 128;
    this.left -= 1;
    this.pos.x = 280;
    this.pos.y = 50;
    this.spd.x = 0;
    this.spd.y = 0;
    this.rad = 0;
  }

  updateDeath() {
    this.deathcounter += 1;
    if (this.deathcounter === 147) {
      this.deathcounter = 0;
      this.pos.x = this.restartPos.x;
      this.pos.y = this.restartPos.y;
      this.fastkey = 0;
      this.restartInvincible = 240;
    }
  }
}

export class GameState {
  constructor(stage, collisionPoints) {
    this.stage = structuredClone(stage);
    this.ufo = new UfoBody(collisionPoints);
    this.ufo.reset(this.stage);
    this.time = 0;
    this.cleared = false;
    this.message = "Arrow/A,D: rotate   Space/Z/X/Enter: thrust";
    this.activateGoalsIfReady();
  }

  reset(stage = this.stage) {
    this.stage = structuredClone(stage);
    this.ufo.reset(this.stage);
    this.time = 0;
    this.cleared = false;
    this.message = "Arrow/A,D: rotate   Space/Z/X/Enter: thrust";
    this.activateGoalsIfReady();
  }

  update(input, fluid) {
    if (this.cleared) {
      return;
    }

    const inGoalBefore = this.isUfoInAnyActiveGoal();
    for (const obj of this.stage.moveObjects ?? []) {
      updateMoveObject(obj, this.stage.moveObjectSpeedScale ?? 1);
    }
    this.ufo.preIngoal = this.ufo.ingoal;
    this.ufo.ingoal = 0;
    this.ufo.update(input, this.stage, fluid, inGoalBefore);
    this.collectRareEarths();
    this.collectHearts();
    this.collectOneUps();
    this.activateGoalsIfReady();
    this.updateGoals();

    if (this.ufo.fastkey !== 0 && this.ufo.deathcounter === 0 && !this.isUfoInAnyActiveGoal()) {
      this.time += 1 / 60;
    }
  }

  applyFluidForce(force) {
    this.ufo.applyFluidForce(force, this.stage);
  }

  collectRareEarths() {
    for (const rare of this.stage.rareEarths) {
      if (rare.collected) {
        continue;
      }
      if (lengthSq(this.ufo.pos.x - rare.x, this.ufo.pos.y - rare.y) < 72) {
        rare.collected = true;
        if (rare.superRare) {
          this.ufo.hitpoint = 128;
        }
      }
    }
  }

  collectHearts() {
    for (const heart of this.stage.hearts ?? []) {
      if (heart.collected) {
        continue;
      }
      if (lengthSq(this.ufo.pos.x - heart.x, this.ufo.pos.y - heart.y) < 56) {
        heart.collected = true;
        this.ufo.hitpoint = clamp(this.ufo.hitpoint + 64, 0, 128);
      }
    }
  }

  collectOneUps() {
    for (const oneUp of this.stage.oneUps ?? []) {
      if (oneUp.collected) {
        continue;
      }
      if (lengthSq(this.ufo.pos.x - oneUp.x, this.ufo.pos.y - oneUp.y) < 56) {
        oneUp.collected = true;
        this.ufo.left = clamp(this.ufo.left + 1, 0, 99);
      }
    }
  }

  activateGoalsIfReady() {
    const allRareCollected = this.stage.rareEarths.every((rare) => rare.collected);
    for (const goal of this.stage.goals) {
      goal.active = allRareCollected;
    }
  }

  updateGoals() {
    for (const goal of this.stage.goals) {
      if (!goal.active || goal.cleared) {
        continue;
      }
      const inside = lengthSq(this.ufo.pos.x - goal.x, this.ufo.pos.y - goal.y) < CO.CIRCLELEN;
      if (inside) {
        this.ufo.ingoal = 1;
        this.ufo.spd.x *= 0.9;
        this.ufo.spd.y *= 0.9;
        goal.wait -= 1;
        if (goal.wait <= 0) {
          goal.cleared = true;
          this.cleared = true;
          this.message = `${this.stage.label} CLEAR  ${this.time.toFixed(2)}s`;
        }
      } else if (goal.wait > 0) {
        goal.wait = CO.GOALWAIT;
      }
    }
  }

  isUfoInAnyActiveGoal() {
    return this.stage.goals.some((goal) => (
      goal.active && !goal.cleared && lengthSq(this.ufo.pos.x - goal.x, this.ufo.pos.y - goal.y) < CO.CIRCLELEN
    ));
  }

  rareCount() {
    const collected = this.stage.rareEarths.filter((rare) => rare.collected).length;
    return { collected, total: this.stage.rareEarths.length };
  }

  goalStatus() {
    if (this.cleared) {
      return "Clear";
    }
    if (!this.stage.goals.some((goal) => goal.active)) {
      return "Locked";
    }
    const wait = Math.min(...this.stage.goals.filter((goal) => goal.active).map((goal) => goal.wait));
    return `Open (${Math.max(0, wait)})`;
  }
}

export function loadUfoCollisionPoints(ufocoliBmp) {
  const points = [];
  for (let y = 0; y < ufocoliBmp.height; y += 1) {
    for (let x = 0; x < ufocoliBmp.width; x += 1) {
      const color = ufocoliBmp.data[x + y * ufocoliBmp.width];
      const r = color & 255;
      const g = (color >>> 8) & 255;
      const b = (color >>> 16) & 255;
      if (r === 0 && g === 255 && b === 0) {
        points.push({ x: 0.25 * (x - 20 + 0.5), y: 0.25 * (y - 20 + 0.5) });
      }
    }
  }
  return points;
}
