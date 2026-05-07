struct SimParams {
  grid : vec4<f32>,
  stage : vec4<f32>,
  ufo0 : vec4<f32>,
  ufo1 : vec4<f32>,
  nozzle : vec4<f32>,
};

struct ObjectParams {
  pos_spd : vec4<f32>,
  rot : vec4<f32>,
  extra : vec4<f32>,
};

struct ObjectInfo {
  spd_pos : vec4<f32>,
  rot : vec4<f32>,
};

struct ParticleParams {
  counts : vec4<f32>,
};

@group(0) @binding(0) var<uniform> sim : SimParams;
@group(0) @binding(1) var<storage, read_write> cells : array<f32>;
@group(0) @binding(2) var<storage, read> shape : array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> ufoe : array<f32>;
@group(0) @binding(4) var<uniform> obj : ObjectParams;
@group(0) @binding(5) var<storage, read_write> particles : array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> emitters : array<vec4<f32>>;
@group(0) @binding(7) var<uniform> pparams : ParticleParams;
@group(0) @binding(8) var<storage, read_write> object_infos : array<ObjectInfo>;

const WX : i32 = 192;
const WY : i32 = 144;
const STRIDE : u32 = 34u;
const YU : u32 = 0u;
const YUN : u32 = 1u;
const YV : u32 = 2u;
const YVN : u32 = 3u;
const YPN : u32 = 4u;
const DIV : u32 = 5u;
const DIVEX : u32 = 6u;
const YE : u32 = 7u;
const YEN : u32 = 8u;
const KP : u32 = 9u;
const KPORI : u32 = 10u;
const KX : u32 = 11u;
const KY : u32 = 12u;
const BASEU : u32 = 13u;
const BASEV : u32 = 14u;
const BASEP : u32 = 15u;
const BASEX : u32 = 16u;
const BASEY : u32 = 17u;
const GXU : u32 = 18u;
const GYU : u32 = 19u;
const GXV : u32 = 20u;
const GYV : u32 = 21u;
const GXE : u32 = 22u;
const GYE : u32 = 23u;
const GXU0 : u32 = 24u;
const GYU0 : u32 = 25u;
const GXV0 : u32 = 26u;
const GYV0 : u32 = 27u;
const GXE0 : u32 = 28u;
const GYE0 : u32 = 29u;
const YVU : u32 = 30u;
const YUV : u32 = 31u;
const YTTX : u32 = 32u;
const YTTY : u32 = 33u;
const LIMITF : f32 = 0.85;
const CIP_TRANSVERSE_EPS : f32 = 0.001;

fn cid(x : i32, y : i32) -> u32 {
  return u32(((y + WY) % WY) * WX + ((x + WX) % WX));
}

fn at(cell : u32, off : u32) -> u32 {
  return cell * STRIDE + off;
}

fn pat(cell : u32, off : u32) -> u32 {
  return cell * STRIDE + off;
}

fn read_cell(x : i32, y : i32, off : u32) -> f32 {
  return cells[at(cid(x, y), off)];
}

fn read_pcell(x : i32, y : i32, off : u32) -> f32 {
  return cells[pat(cid(x, y), off)];
}

fn write_cell(x : i32, y : i32, off : u32, value : f32) {
  cells[at(cid(x, y), off)] = value;
}

fn cut_off_clamp(f0 : f32, minv : f32, maxv : f32) -> f32 {
  var f1 = f0;
  if (f1 < minv) { f1 = 0.0; }
  if (f1 > maxv) { f1 = maxv; }
  return f1;
}

fn heat_grad_clamp(v : f32) -> f32 {
  var out = v;
  if (out < -1.2) { out = -1.0; }
  if (out > 1.2) { out = 1.0; }
  return out;
}

fn object_velocity(set_val : f32, x : f32, y : f32, axis : f32) -> f32 {
  let info = object_infos[u32(set_val - 2.0)];
  let dx = x - info.spd_pos.z;
  let dy = y - info.spd_pos.w;
  let sx = info.spd_pos.x;
  let sy = info.spd_pos.y;
  let radspd = info.rot.x;
  if (axis == 0.0) {
    return sx + (dx * cos(radspd) - dy * sin(radspd) - dx);
  }
  return sy + (dx * sin(radspd) + dy * cos(radspd) - dy);
}

@compute @workgroup_size(16, 16, 1)
fn reset_dynamic(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= WX || y >= WY) { return; }
  let c = cid(x, y);
  cells[at(c, KP)] = cells[at(c, KPORI)];
}

@compute @workgroup_size(64, 1, 1)
fn object_mapping(@builtin(global_invocation_id) gid : vec3<u32>) {
  let id = gid.x;
  let count = u32(obj.rot.w + 0.5);
  if (id >= count) { return; }
  let offset = u32(obj.rot.z + 0.5);
  let p = shape[offset + id] + vec2<f32>(0.5, 0.5);
  let rad = obj.rot.x;
  let x = i32(p.x * cos(rad) - p.y * sin(rad) + obj.pos_spd.x);
  let y = i32(p.x * sin(rad) + p.y * cos(rad) + obj.pos_spd.y);
  if (x >= 0 && x < WX && y >= 0 && y < WY) {
    cells[at(cid(x, y), KP)] = obj.rot.y;
  }
  if (id == 0u) {
    object_infos[u32(obj.rot.y - 2.0)] = ObjectInfo(
      vec4<f32>(obj.pos_spd.z, obj.pos_spd.w, obj.pos_spd.x, obj.pos_spd.y),
      vec4<f32>(obj.extra.x, 0.0, 0.0, 0.0)
    );
  }
}

@compute @workgroup_size(16, 16, 1)
fn kabe_mapping(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= WX || y >= WY) { return; }
  let c = cid(x, y);
  let kp = cells[at(c, KP)];
  let up_kp = read_cell(x, y - 1, KP);
  let left_kp = read_cell(x - 1, y, KP);

  if (kp <= 64.0) {
    if (cells[at(c, KX)] > 1.0) {
      cells[at(c, KX)] = kp;
      if (kp > 1.0) {
        cells[at(c, YUN)] = object_velocity(kp, f32(x), f32(y) + 0.5, 0.0);
        cells[at(c, GXU)] = 0.0;
        cells[at(c, GYU)] = 0.0;
      }
    }
    if (cells[at(c, KY)] > 1.0) {
      cells[at(c, KY)] = kp;
      if (kp > 1.0) {
        cells[at(c, YVN)] = object_velocity(kp, f32(x) + 0.5, f32(y), 1.0);
        cells[at(c, GXV)] = 0.0;
        cells[at(c, GYV)] = 0.0;
      }
    }
  } else {
    if (up_kp <= 64.0) {
      if (cells[at(c, KY)] > 1.0) {
        cells[at(c, KY)] = up_kp;
        if (up_kp > 1.0) {
          cells[at(c, YVN)] = object_velocity(up_kp, f32(x) + 0.5, f32(y), 1.0);
          cells[at(c, GXV)] = 0.0;
          cells[at(c, GYV)] = 0.0;
        }
      }
    } else {
      cells[at(c, KY)] = 255.0;
    }
    if (left_kp <= 64.0) {
      if (cells[at(c, KX)] > 1.0) {
        cells[at(c, KX)] = left_kp;
        if (left_kp > 1.0) {
          cells[at(c, YUN)] = object_velocity(left_kp, f32(x), f32(y) + 0.5, 0.0);
          cells[at(c, GXU)] = 0.0;
          cells[at(c, GYU)] = 0.0;
        }
      }
    } else {
      cells[at(c, KX)] = 255.0;
    }
  }
}

@compute @workgroup_size(16, 16, 1)
fn copy_velocity(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= WX || y >= WY) { return; }
  let c = cid(x, y);
  cells[at(c, YU)] = cells[at(c, YUN)];
  cells[at(c, YV)] = cells[at(c, YVN)];
}

@compute @workgroup_size(16, 16, 1)
fn velocity_average(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= WX || y >= WY) { return; }
  let c = cid(x, y);
  let tv = read_cell(x, y, YVN) + read_cell(x, y + 1, YVN);
  let tu = read_cell(x, y, YUN) + read_cell(x + 1, y, YUN);
  cells[at(c, YVU)] = 0.25 * (tv + read_cell(x - 1, y, YVN) + read_cell(x - 1, y + 1, YVN));
  cells[at(c, YUV)] = 0.25 * (tu + read_cell(x, y - 1, YUN) + read_cell(x + 1, y - 1, YUN));
  cells[at(c, YTTX)] = 0.5 * tu;
  cells[at(c, YTTY)] = 0.5 * tv;
}

@compute @workgroup_size(16, 16, 1)
fn copy_gradients(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= WX || y >= WY) { return; }
  let c = cid(x, y);
  cells[at(c, GXU0)] = cells[at(c, GXU)];
  cells[at(c, GYU0)] = cells[at(c, GYU)];
  cells[at(c, GXV0)] = cells[at(c, GXV)];
  cells[at(c, GYV0)] = cells[at(c, GYV)];
  cells[at(c, GXE0)] = cells[at(c, GXE)];
  cells[at(c, GYE0)] = cells[at(c, GYE)];
}

@compute @workgroup_size(16, 16, 1)
fn cip_velocity(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= WX || y >= WY) { return; }
  let c = cid(x, y);

  {
    let xx = -read_cell(x, y, YU) * sim.stage.y;
    let yy = -read_cell(x, y, YVU) * sim.stage.y;
    var isn = 0;
    var jsn = 0;
    var u_im1 = read_cell(x, y, YU);
    if (xx > 0.0) { isn = -1; u_im1 = read_cell(x + 1, y, YU); }
    if (xx < 0.0) { isn = 1; u_im1 = read_cell(x - 1, y, YU); }
    if (yy > 0.0) { jsn = -1; }
    if (yy < 0.0) { jsn = 1; }
    let im1x = x - isn;
    let jm1y = y - jsn;
    let u0 = read_cell(x, y, YU);
    let u_j = read_cell(x, jm1y, YU);
    let gxd0 = read_cell(x, y, GXU0);
    let gyd0 = read_cell(x, y, GYU0);
    let gxd_im1 = read_cell(im1x, y, GXU0);
    let gyd_j = read_cell(x, jm1y, GYU0);
    var a1 = u0 - u_j - u_im1 + read_cell(im1x, jm1y, YU);
    let b0 = read_cell(im1x, y, GYU0) - gyd0;
    var d1 = (-a1 - b0 * f32(jsn)) * f32(isn);
    var c1 = (-a1 - (read_cell(x, jm1y, GXU0) - gxd0) * f32(isn)) * f32(jsn);
    var g1 = (c1 - b0) * f32(isn);
    a1 = gxd_im1 + gxd0 - 2.0 * f32(isn) * (u0 - u_im1);
    var b1 = gyd_j + gyd0 - 2.0 * f32(jsn) * (u0 - u_j);
    let e1 = 3.0 * (u_im1 - u0) + (gxd_im1 + 2.0 * gxd0) * f32(isn);
    let f1 = 3.0 * (u_j - u0) + (gyd_j + 2.0 * gyd0) * f32(jsn);
    a1 = a1 * xx;
    b1 = b1 * yy;
    if (cells[at(c, KX)] > 128.0) {
      let val = ((a1 + c1 * yy + e1) * xx + g1 * yy + gxd0) * xx + ((b1 + d1 * xx + f1) * yy + gyd0) * yy + u0;
      cells[at(c, YUN)] = clamp(val, -LIMITF, LIMITF);
    }
    let gx = (3.0 * a1 + 2.0 * (c1 * yy + e1)) * xx + (d1 * yy + g1) * yy + gxd0;
    let gy = (3.0 * b1 + 2.0 * (d1 * xx + f1)) * yy + (c1 * xx + g1) * xx + gyd0;
    if (cells[at(c, KX)] > 128.0) {
      let gxv = gx - 0.5 * sim.stage.y * (gx * (read_cell(x + 1, y, YU) - read_cell(x - 1, y, YU)) + gy * (read_cell(x + 1, y, YVU) - read_cell(x - 1, y, YVU)));
      var uj0 = read_cell(x, y - 1, YU);
      var uj1 = read_cell(x, y + 1, YU);
      if (isn == 1) { uj0 = u_j; }
      if (isn == -1) { uj1 = u_j; }
      let gyv = gy - 0.5 * sim.stage.y * (gx * (uj1 - uj0) + gy * (read_cell(x, y + 1, YVU) - read_cell(x, y - 1, YVU)));
      cells[at(c, GXU)] = clamp(gxv, -LIMITF, LIMITF);
      cells[at(c, GYU)] = clamp(gyv, -LIMITF, LIMITF);
    }
  }

  {
    let xx = -read_cell(x, y, YUV) * sim.stage.y;
    let yy = -read_cell(x, y, YV) * sim.stage.y;
    var isn = 0;
    var jsn = 0;
    var v_im1 = read_cell(x, y, YV);
    if (xx > 0.0) { isn = -1; v_im1 = read_cell(x + 1, y, YV); }
    if (xx < 0.0) { isn = 1; v_im1 = read_cell(x - 1, y, YV); }
    if (yy > 0.0) { jsn = -1; }
    if (yy < 0.0) { jsn = 1; }
    let im1x = x - isn;
    let jm1y = y - jsn;
    let v0 = read_cell(x, y, YV);
    let v_j = read_cell(x, jm1y, YV);
    let gxd0 = read_cell(x, y, GXV0);
    let gyd0 = read_cell(x, y, GYV0);
    let gxd_im1 = read_cell(im1x, y, GXV0);
    let gyd_j = read_cell(x, jm1y, GYV0);
    var a1 = v0 - v_j - v_im1 + read_cell(im1x, jm1y, YV);
    let b0 = read_cell(im1x, y, GYV0) - gyd0;
    var d1 = (-a1 - b0 * f32(jsn)) * f32(isn);
    var c1 = (-a1 - (read_cell(x, jm1y, GXV0) - gxd0) * f32(isn)) * f32(jsn);
    var g1 = (c1 - b0) * f32(isn);
    a1 = gxd_im1 + gxd0 - 2.0 * f32(isn) * (v0 - v_im1);
    var b1 = gyd_j + gyd0 - 2.0 * f32(jsn) * (v0 - v_j);
    let e1 = 3.0 * (v_im1 - v0) + (gxd_im1 + 2.0 * gxd0) * f32(isn);
    let f1 = 3.0 * (v_j - v0) + (gyd_j + 2.0 * gyd0) * f32(jsn);
    a1 = a1 * xx;
    b1 = b1 * yy;
    if (cells[at(c, KY)] > 128.0) {
      let val = ((a1 + c1 * yy + e1) * xx + g1 * yy + gxd0) * xx + ((b1 + d1 * xx + f1) * yy + gyd0) * yy + v0;
      cells[at(c, YVN)] = clamp(val, -LIMITF, LIMITF);
    }
    let gx = (3.0 * a1 + 2.0 * (c1 * yy + e1)) * xx + (d1 * yy + g1) * yy + gxd0;
    let gy = (3.0 * b1 + 2.0 * (d1 * xx + f1)) * yy + (c1 * xx + g1) * xx + gyd0;
    if (cells[at(c, KY)] > 128.0) {
      let raw_gxv = gx - 0.5 * sim.stage.y * (gx * (read_cell(x + 1, y, YUV) - read_cell(x - 1, y, YUV)) + gy * (read_cell(x + 1, y, YV) - read_cell(x - 1, y, YV)));
      let limited_gxv = clamp(raw_gxv, -abs(gxd0), abs(gxd0));
      let gxv = select(raw_gxv, limited_gxv, abs(xx) < CIP_TRANSVERSE_EPS);
      var vj0 = read_cell(x, y - 1, YV);
      var vj1 = read_cell(x, y + 1, YV);
      if (jsn == 1) { vj0 = v_j; }
      if (jsn == -1) { vj1 = v_j; }
      let gyv = gy - 0.5 * sim.stage.y * (gx * (read_cell(x, y + 1, YUV) - read_cell(x, y - 1, YUV)) + gy * (vj1 - vj0));
      cells[at(c, GXV)] = clamp(gxv, -LIMITF, LIMITF);
      cells[at(c, GYV)] = clamp(gyv, -LIMITF, LIMITF);
    }
  }
}

@compute @workgroup_size(16, 16, 1)
fn cip_heat(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= WX || y >= WY) { return; }
  let c = cid(x, y);
  let xx = -cells[at(c, YTTX)] * sim.stage.y;
  let yy = -cells[at(c, YTTY)] * sim.stage.y;
  var isn = 0;
  var jsn = 0;
  if (xx > 0.0) { isn = -1; }
  if (xx < 0.0) { isn = 1; }
  if (yy > 0.0) { jsn = -1; }
  if (yy < 0.0) { jsn = 1; }
  let im1x = x - isn;
  let jm1y = y - jsn;
  let e0 = read_cell(x, y, YE);
  let e_im1 = read_cell(im1x, y, YE);
  let e_j = read_cell(x, jm1y, YE);
  let gxd0 = cells[at(c, GXE0)];
  let gyd0 = cells[at(c, GYE0)];
  var a1 = e0 - e_j - e_im1 + read_cell(im1x, jm1y, YE);
  let b0 = read_cell(im1x, y, GYE0) - gyd0;
  var d1 = (-a1 - b0 * f32(jsn)) * f32(isn);
  var c1 = (-a1 - (read_cell(x, jm1y, GXE0) - gxd0) * f32(isn)) * f32(jsn);
  var g1 = (c1 - b0) * f32(isn);
  a1 = read_cell(im1x, y, GXE0) + gxd0 - 2.0 * f32(isn) * (e0 - e_im1);
  var b1 = read_cell(x, jm1y, GYE0) + gyd0 - 2.0 * f32(jsn) * (e0 - e_j);
  let e1 = 3.0 * (e_im1 - e0) + (read_cell(im1x, y, GXE0) + 2.0 * gxd0) * f32(isn);
  let f1 = 3.0 * (e_j - e0) + (read_cell(x, jm1y, GYE0) + 2.0 * gyd0) * f32(jsn);
  a1 = a1 * xx;
  b1 = b1 * yy;
  if (cells[at(c, KP)] > 128.0) {
    let val = ((a1 + c1 * yy + e1) * xx + g1 * yy + gxd0) * xx + ((b1 + d1 * xx + f1) * yy + gyd0) * yy + e0;
    cells[at(c, YEN)] = clamp(val, -1.2, 1.2);
  }
  let gx = (3.0 * a1 + 2.0 * (c1 * yy + e1)) * xx + (d1 * yy + g1) * yy + gxd0;
  let gy = (3.0 * b1 + 2.0 * (d1 * xx + f1)) * yy + (c1 * xx + g1) * xx + gyd0;
  if (cells[at(c, KP)] > 128.0) {
    let gxv = gx - 0.5 * sim.stage.y * (gx * (read_cell(x + 1, y, YTTX) - read_cell(x - 1, y, YTTX)) + gy * (read_cell(x + 1, y, YTTY) - read_cell(x - 1, y, YTTY)));
    let gyv = gy - 0.5 * sim.stage.y * (gx * (read_cell(x, y + 1, YTTX) - read_cell(x, y - 1, YTTX)) + gy * (read_cell(x, y + 1, YTTY) - read_cell(x, y - 1, YTTY)));
    cells[at(c, GXE)] = heat_grad_clamp(gxv);
    cells[at(c, GYE)] = heat_grad_clamp(gyv);
  }
}

@compute @workgroup_size(16, 16, 1)
fn copy_heat(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= WX || y >= WY) { return; }
  let c = cid(x, y);
  var heat = cells[at(c, YEN)];
  if (heat > 0.05) { heat = heat * 0.99999 - 0.000013; }
  if (heat < -0.05) { heat = heat * 0.99999 + 0.000013; }
  if (sim.nozzle.x > 0.5) {
    let dx = sim.nozzle.x - f32(x);
    let dy = sim.nozzle.y - f32(y);
    if (dx * dx + dy * dy < 5.9) { heat = heat + 1.0; }
  }
  heat = clamp(heat, -1.0, 1.0);
  cells[at(c, YE)] = heat;
  cells[at(c, YEN)] = heat;
}

@compute @workgroup_size(16, 16, 1)
fn newgrad_u(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= WX || y >= WY) { return; }
  let c = cid(x, y);
  if (cells[at(c, KX)] > 128.0) {
    cells[at(c, GXU)] = cells[at(c, GXU)] + 0.5 * (read_cell(x + 1, y, YUN) - read_cell(x - 1, y, YUN) - read_cell(x + 1, y, YU) + read_cell(x - 1, y, YU));
    cells[at(c, GYU)] = cells[at(c, GYU)] + 0.5 * (read_cell(x, y + 1, YUN) - read_cell(x, y - 1, YUN) - read_cell(x, y + 1, YU) + read_cell(x, y - 1, YU));
  }
}

@compute @workgroup_size(16, 16, 1)
fn newgrad_v(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= WX || y >= WY) { return; }
  let c = cid(x, y);
  if (cells[at(c, KY)] > 128.0) {
    cells[at(c, GXV)] = cells[at(c, GXV)] + 0.5 * (read_cell(x + 1, y, YVN) - read_cell(x - 1, y, YVN) - read_cell(x + 1, y, YV) + read_cell(x - 1, y, YV));
    cells[at(c, GYV)] = cells[at(c, GYV)] + 0.5 * (read_cell(x, y + 1, YVN) - read_cell(x, y - 1, YVN) - read_cell(x, y + 1, YV) + read_cell(x, y - 1, YV));
  }
}

@compute @workgroup_size(16, 16, 1)
fn divergence(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= WX || y >= WY) { return; }
  let c = cid(x, y);
  var divexp = cells[at(c, DIVEX)];
  cells[at(c, DIV)] = read_cell(x + 1, y, YUN) - read_cell(x, y, YUN) + read_cell(x, y + 1, YVN) - read_cell(x, y, YVN) - 0.005 * divexp;
  if (divexp > 0.0) { divexp = max(0.0, divexp - 1.0); }
  if (divexp < 0.0) { divexp = min(0.0, divexp + 1.0); }
  cells[at(c, DIVEX)] = divexp;
}

@compute @workgroup_size(128, 1, 1)
fn pressure0(@builtin(global_invocation_id) gid : vec3<u32>) {
  var i = gid.x * 2u + 1u;
  let j = i / u32(WX);
  if (j >= u32(WY)) { return; }
  i = i - j * u32(WX) - select(0u, 1u, (j % 2u) == 1u);
  pressure_impl(i32(i), i32(j));
}

@compute @workgroup_size(128, 1, 1)
fn pressure1(@builtin(global_invocation_id) gid : vec3<u32>) {
  var i = gid.x * 2u + 1u;
  let j = i / u32(WX);
  if (j >= u32(WY)) { return; }
  i = i - j * u32(WX) - select(0u, 1u, (j % 2u) == 0u);
  pressure_impl(i32(i), i32(j));
}

fn pressure_impl(x : i32, y : i32) {
  let c = cid(x, y);
  if (cells[at(c, KP)] <= 128.0) { return; }
  let p = cells[at(c, YPN)];
  var ff = cells[at(c, DIV)];
  let ids = array<u32, 4>(cid(x - 1, y), cid(x + 1, y), cid(x, y - 1), cid(x, y + 1));
  for (var n = 0; n < 4; n = n + 1) {
    let nc = ids[n];
    ff = ff - select(p, cells[at(nc, YPN)], cells[at(nc, KP)] > 64.0);
  }
  cells[at(c, YPN)] = p - (0.25 * ff + p) * sim.stage.x;
}

@compute @workgroup_size(16, 16, 1)
fn rhs(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= WX || y >= WY) { return; }
  let c = cid(x, y);
  if (cells[at(c, KX)] > 128.0) {
    cells[at(c, YUN)] = cells[at(c, YUN)] - (read_cell(x, y, YPN) - read_cell(x - 1, y, YPN));
  }
  if (cells[at(c, KY)] > 128.0) {
    cells[at(c, YVN)] = cells[at(c, YVN)] - (read_cell(x, y, YPN) - read_cell(x, y - 1, YPN));
  }
}

@compute @workgroup_size(1, 1, 1)
fn ufopressure() {
  var l = 0.0;
  var r = 0.0;
  var u = 0.0;
  var d = 0.0;
  var il = 0.0;
  var ir = 0.0;
  var iu = 0.0;
  var idn = 0.0;
  var cool = 0.0;
  let ux = i32(sim.ufo0.x);
  let uy = i32(sim.ufo0.y);
  for (var i = 0; i < 14; i = i + 1) {
    for (var j = 0; j < 14; j = j + 1) {
      let i6 = clamp(i + ux - 6, 0, WX - 1);
      let i7 = clamp(i + ux - 7, 0, WX - 1);
      let i8 = clamp(i + ux - 8, 0, WX - 1);
      let j6 = clamp(j + uy - 6, 0, WY - 1);
      let j7 = clamp(j + uy - 7, 0, WY - 1);
      let j8 = clamp(j + uy - 8, 0, WY - 1);
      let k = read_cell(i7, j7, KP);
      if (k == 2.0 || k == 3.0) {
        if (read_cell(i7, j8, KP) == 255.0) { u = u + read_cell(i7, j8, YPN); iu = iu + 1.0; cool = cool + cut_off_clamp(-read_cell(i7, j8, YE), 0.17, 1.0); }
        if (read_cell(i8, j7, KP) == 255.0) { l = l + read_cell(i8, j7, YPN); il = il + 1.0; cool = cool + cut_off_clamp(-read_cell(i8, j7, YE), 0.17, 1.0); }
        if (read_cell(i6, j7, KP) == 255.0) { r = r - read_cell(i6, j7, YPN); ir = ir + 1.0; cool = cool + cut_off_clamp(-read_cell(i6, j7, YE), 0.17, 1.0); }
        if (read_cell(i7, j6, KP) == 255.0) { d = d - read_cell(i7, j6, YPN); idn = idn + 1.0; cool = cool + cut_off_clamp(-read_cell(i7, j6, YE), 0.17, 1.0); }
      }
    }
  }
  cool = cut_off_clamp(cool, 7.0, 200.0);
  ufoe[0] = ufoe[0] + l / il + r / ir;
  ufoe[1] = ufoe[1] + u / iu + d / idn;
  ufoe[2] = ufoe[2] + cool;
}

fn emitter_for(id : u32, write_id : u32, emitter_count : u32) -> vec4<f32> {
  let e = (id * 37u + write_id * 53u) % max(1u, emitter_count);
  return emitters[e];
}

fn respawn_particle(id : u32, write_id : u32, emitter_count : u32) -> vec4<f32> {
  let e = emitter_for(id, write_id, emitter_count);
  let jx = f32((id * 17u + write_id * 23u) % 1000u) * 0.001;
  let jy = f32((id * 31u + write_id * 19u) % 1000u) * 0.001;
  return vec4<f32>(e.x + jx, e.y + jy, e.z, 0.0);
}

fn sample_particle_velocity(pos : vec2<f32>) -> vec2<f32> {
  let x = clamp(i32(pos.x), 0, WX - 2);
  let y = clamp(i32(pos.y), 0, WY - 2);
  let sx = clamp(pos.x - f32(x), 0.0, 1.0);
  let sy = clamp(pos.y - f32(y), 0.0, 1.0);
  let u0 = read_pcell(x, y, YUN) * (1.0 - sx) + read_pcell(x + 1, y, YUN) * sx;
  let u1 = read_pcell(x, y + 1, YUN) * (1.0 - sx) + read_pcell(x + 1, y + 1, YUN) * sx;
  let v0 = read_pcell(x, y, YVN) * (1.0 - sx) + read_pcell(x + 1, y, YVN) * sx;
  let v1 = read_pcell(x, y + 1, YVN) * (1.0 - sx) + read_pcell(x + 1, y + 1, YVN) * sx;
  return vec2<f32>(u0 * (1.0 - sy) + u1 * sy, v0 * (1.0 - sy) + v1 * sy);
}

@compute @workgroup_size(128, 1, 1)
fn particle_update(@builtin(global_invocation_id) gid : vec3<u32>) {
  let id = gid.x;
  let particle_count = u32(pparams.counts.x + 0.5);
  let emitter_count = u32(pparams.counts.y + 0.5);
  let write_id = u32(pparams.counts.z + 0.5) % max(1u, particle_count);
  let stage_spawn_count = u32(pparams.counts.w + 0.5);
  let nozzle_spawn_count = max(1u, u32(f32(particle_count) * 768.0 / 262144.0 + 0.5));
  if (id >= particle_count || emitter_count == 0u) { return; }

  var p = particles[id];
  let ring_offset = (id + particle_count - write_id) % particle_count;
  if (ring_offset < stage_spawn_count) {
    p = respawn_particle(id, write_id, emitter_count);
  } else if (sim.nozzle.x > 0.5 && ring_offset < stage_spawn_count + nozzle_spawn_count) {
    let jx = f32((id * 17u + write_id * 11u) % 1000u) / 500.0 - 1.0;
    let jy = f32((id * 31u + write_id * 7u) % 1000u) / 500.0 - 1.0;
    p = vec4<f32>(sim.nozzle.x + jx, sim.nozzle.y + jy, 333567.0, 0.0);
  }

  let vel = sample_particle_velocity(p.xy);

  let particle_dt = max(1.0, sim.stage.z);
  p.x = p.x + vel.x * particle_dt;
  p.y = p.y + vel.y * particle_dt;
  p.w = p.w + 1.0;

  if (p.x < 0.0 || p.y < 0.1 || p.x >= f32(WX) - 0.1 || p.y >= f32(WY) - 0.1) {
    p = vec4<f32>(0.0, 0.0, p.z, p.w);
  }

  particles[id] = p;
}
