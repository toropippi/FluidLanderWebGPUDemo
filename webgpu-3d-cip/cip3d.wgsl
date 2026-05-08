const WX : i32 = 32;
const WY : i32 = 32;
const WZ : i32 = 32;
const WXY : i32 = 1024;
const CELL_COUNT : u32 = 32768u;
const DT : f32 = 1.0;
const ALPHA : f32 = 1.72;
const CIP_VALUE_LIMIT : f32 = 1.0;
const SPEEDLIMIT : f32 = 1.0;
const CIP_TRANSVERSE_EPS : f32 = 0.001;
const USE_TRANSVERSE_REPAIR : bool = true;
const RHS_SPEED_CLAMP : f32 = 1.0;
const DIAG_HEADER_FLOATS : u32 = 32u;
const DIAG_MAX_FRAMES : u32 = 8192u;
const DIAG_STAGE_COUNT : u32 = 5u;
const DIAG_STRIDE : u32 = 16u;

const YU : u32 = 0u;
const YUN : u32 = 1u;
const YV : u32 = 2u;
const YVN : u32 = 3u;
const YW : u32 = 4u;
const YWN : u32 = 5u;
const YUT : u32 = 6u;
const YVT : u32 = 7u;
const YWT : u32 = 8u;
const YUV : u32 = 9u;
const YUW : u32 = 10u;
const YWU : u32 = 11u;
const YWV : u32 = 12u;
const YVU : u32 = 13u;
const YVW : u32 = 14u;
const GXU : u32 = 15u;
const GYU : u32 = 16u;
const GZU : u32 = 17u;
const GXV : u32 = 18u;
const GYV : u32 = 19u;
const GZV : u32 = 20u;
const GXW : u32 = 21u;
const GYW : u32 = 22u;
const GZW : u32 = 23u;
const GXU0 : u32 = 24u;
const GYU0 : u32 = 25u;
const GZU0 : u32 = 26u;
const GXV0 : u32 = 27u;
const GYV0 : u32 = 28u;
const GZV0 : u32 = 29u;
const GXW0 : u32 = 30u;
const GYW0 : u32 = 31u;
const GZW0 : u32 = 32u;
const VOR : u32 = 33u;
const YPN : u32 = 34u;
const DIV : u32 = 35u;

const WALL_X : u32 = 0u;
const WALL_Y : u32 = 1u;
const WALL_Z : u32 = 2u;
const WALL_P : u32 = 3u;

struct KernelParams {
  a : vec4<u32>,
  b : vec4<u32>,
  c : vec4<u32>,
};

struct SimParams {
  data : vec4<f32>,
  frame : vec4<u32>,
};

@group(0) @binding(0) var<storage, read_write> fields : array<f32>;
@group(0) @binding(1) var<storage, read_write> walls : array<u32>;
@group(0) @binding(2) var<storage, read_write> particles : array<vec4<f32>>;
@group(0) @binding(3) var<uniform> sim : SimParams;
@group(0) @binding(4) var<uniform> kp : KernelParams;
@group(0) @binding(5) var<storage, read_write> stats : array<f32>;

fn wrap(v : i32, n : i32) -> i32 {
  return ((v % n) + n) % n;
}

fn idx3(i : i32, j : i32, k : i32) -> u32 {
  return u32(wrap(i, WX) + wrap(j, WY) * WX + wrap(k, WZ) * WXY);
}

fn field_at(field : u32, cell : u32) -> u32 {
  return field * CELL_COUNT + cell;
}

fn wall_at(wall : u32, cell : u32) -> u32 {
  return wall * CELL_COUNT + cell;
}

fn rf(field : u32, cell : u32) -> f32 {
  return fields[field_at(field, cell)];
}

fn wf(field : u32, cell : u32, value : f32) {
  fields[field_at(field, cell)] = value;
}

fn rfi(field : u32, flat : i32) -> f32 {
  return fields[field_at(field, u32(flat))];
}

fn rwall(wall : u32, cell : u32) -> u32 {
  return walls[wall_at(wall, cell)];
}

fn cip_sign(d : f32) -> f32 {
  if (d > 0.0) { return -1.0; }
  if (d < 0.0) { return 1.0; }
  return 0.0;
}

fn cip_value3d(
  y_field : u32,
  gx_field : u32,
  gy_field : u32,
  gz_field : u32,
  i : i32,
  j : i32,
  k : i32,
  xx : f32,
  yy : f32,
  zz : f32
) -> f32 {
  let isn = cip_sign(xx);
  let jsn = cip_sign(yy);
  let ksn = cip_sign(zz);

  let im1x = i - i32(isn);
  let jm1y = j - i32(jsn);
  let km1z = k - i32(ksn);

  let c000 = idx3(i, j, k);
  let c100 = idx3(im1x, j, k);
  let c010 = idx3(i, jm1y, k);
  let c001 = idx3(i, j, km1z);
  let c110 = idx3(im1x, jm1y, k);
  let c101 = idx3(im1x, j, km1z);
  let c011 = idx3(i, jm1y, km1z);
  let c111 = idx3(im1x, jm1y, km1z);

  let c1 = rf(gx_field, c000);
  let g1 = rf(gy_field, c000);
  let m1 = rf(gz_field, c000);
  var d1 = rf(y_field, c000);

  var a1 = d1 - rf(y_field, c100) - rf(y_field, c010) + rf(y_field, c110);
  var e1 = d1 - rf(y_field, c010) - rf(y_field, c001) + rf(y_field, c011);
  var k1 = d1 - rf(y_field, c001) - rf(y_field, c100) + rf(y_field, c101);

  var j1 = -(rf(gy_field, c100) - g1) * isn;
  var n1 = -(rf(gx_field, c001) - c1) * ksn;
  var w1 = -(rf(gz_field, c010) - m1) * jsn;

  var h1 = -(rf(gx_field, c010) - c1) * jsn;
  var s1 = -(rf(gy_field, c001) - g1) * ksn;
  var u1 = -(rf(gz_field, c100) - m1) * isn;

  var i1 = j1 + h1 - a1 * isn * jsn;
  var p1 = n1 + u1 - k1 * isn * ksn;
  var r1 = w1 + s1 - e1 * jsn * ksn;

  var t1 = rf(y_field, c111) + rf(y_field, c001) - a1 - rf(y_field, c101) - rf(y_field, c011);
  t1 *= -isn * jsn * ksn;

  j1 = -(a1 * isn - j1 * jsn);
  n1 = -(k1 * ksn - n1 * isn);
  w1 = -(e1 * jsn - w1 * ksn);

  h1 = -(a1 * jsn - h1 * isn);
  s1 = -(e1 * ksn - s1 * jsn);
  u1 = -(k1 * isn - u1 * ksn);

  a1 = d1 - rf(y_field, c100);
  e1 = d1 - rf(y_field, c010);
  k1 = d1 - rf(y_field, c001);

  let b1 = -3.0 * a1 + (2.0 * c1 + rf(gx_field, c100)) * isn;
  let f1 = -3.0 * e1 + (2.0 * g1 + rf(gy_field, c010)) * jsn;
  let l1 = -3.0 * k1 + (2.0 * m1 + rf(gz_field, c001)) * ksn;

  a1 = (rf(gx_field, c100) + c1 - 2.0 * a1 * isn) * xx;
  e1 = (rf(gy_field, c010) + g1 - 2.0 * e1 * jsn) * yy;
  k1 = (rf(gz_field, c001) + m1 - 2.0 * k1 * ksn) * zz;

  d1 += ((a1 + b1 + h1 * yy + n1 * zz) * xx + c1 + (i1 + j1 * yy + t1 * zz) * yy + (u1 * zz + p1) * zz) * xx;
  d1 += ((e1 + f1 + s1 * zz) * yy + (w1 * zz + r1) * zz + g1) * yy + ((k1 + l1) * zz + m1) * zz;
  return d1;
}

@compute @workgroup_size(32, 1, 1)
fn veloc0(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = i32(gid.x);
  let j0 = i32(gid.y);
  let k0 = i32(gid.z);
  if (i >= WX || j0 >= WY || k0 >= WZ) { return; }
  let i1 = wrap(i + 1, WX);
  let j1 = wrap(j0 + 1, WY);
  let k1 = wrap(k0 + 1, WZ);
  let c = idx3(i, j0, k0);
  wf(YUT, c, 0.5 * (rf(YU, c) + rf(YU, idx3(i1, j0, k0))));
  wf(YVT, c, 0.5 * (rf(YV, c) + rf(YV, idx3(i, j1, k0))));
  wf(YWT, c, 0.5 * (rf(YW, c) + rf(YW, idx3(i, j0, k1))));
}

@compute @workgroup_size(32, 1, 1)
fn veloc1(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = i32(gid.x);
  let j0 = i32(gid.y);
  let k0 = i32(gid.z);
  if (i >= WX || j0 >= WY || k0 >= WZ) { return; }
  let im = wrap(i - 1, WX);
  let jm = wrap(j0 - 1, WY);
  let km = wrap(k0 - 1, WZ);
  let c = idx3(i, j0, k0);
  wf(YUV, c, 0.5 * (rf(YUT, c) + rf(YUT, idx3(i, jm, k0))));
  wf(YWV, c, 0.5 * (rf(YWT, c) + rf(YWT, idx3(i, jm, k0))));
  wf(YVU, c, 0.5 * (rf(YVT, c) + rf(YVT, idx3(im, j0, k0))));
  wf(YWU, c, 0.5 * (rf(YWT, c) + rf(YWT, idx3(im, j0, k0))));
  wf(YUW, c, 0.5 * (rf(YUT, c) + rf(YUT, idx3(i, j0, km))));
  wf(YVW, c, 0.5 * (rf(YVT, c) + rf(YVT, idx3(i, j0, km))));
}

@compute @workgroup_size(32, 1, 1)
fn advection_cip(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = i32(gid.x);
  let j0 = i32(gid.y);
  let k0 = i32(gid.z);
  if (i >= WX || j0 >= WY || k0 >= WZ) { return; }

  let u_field = kp.a.x;
  let v_field = kp.a.y;
  let w_field = kp.a.z;
  let fn_field = kp.a.w;
  let gxn_field = kp.b.x;
  let gyn_field = kp.b.y;
  let gzn_field = kp.b.z;
  let gxd_field = kp.b.w;
  let gyd_field = kp.c.x;
  let gzd_field = kp.c.y;
  let yd_field = kp.c.z;
  let wall_field = kp.c.w;

  let ijk = idx3(i, j0, k0);
  let xx = -rf(u_field, ijk) * DT;
  let yy = -rf(v_field, ijk) * DT;
  let zz = -rf(w_field, ijk) * DT;

  let isn = cip_sign(xx);
  let jsn = cip_sign(yy);
  let ksn = cip_sign(zz);

  let im1 = wrap(i - i32(isn), WX);
  let jm1 = wrap(j0 - i32(jsn), WY);
  let km1 = wrap(k0 - i32(ksn), WZ);
  let j = j0 * WX;
  let jm1b = jm1 * WX;
  let k = k0 * WXY;
  let km1b = km1 * WXY;
  let flat = i + j + k;

  let c1 = rfi(gxd_field, flat);
  let g1 = rfi(gyd_field, flat);
  let m1 = rfi(gzd_field, flat);
  var d1 = rfi(yd_field, flat);

  var a1 = d1 - rfi(yd_field, im1 + j + k) - rfi(yd_field, i + jm1b + k) + rfi(yd_field, im1 + jm1b + k);
  var e1 = d1 - rfi(yd_field, i + jm1b + k) - rfi(yd_field, i + j + km1b) + rfi(yd_field, i + jm1b + km1b);
  var k1 = d1 - rfi(yd_field, i + j + km1b) - rfi(yd_field, im1 + j + k) + rfi(yd_field, im1 + j + km1b);

  var j1 = -(rfi(gyd_field, im1 + j + k) - g1) * isn;
  var n1 = -(rfi(gxd_field, i + j + km1b) - c1) * ksn;
  var w1 = -(rfi(gzd_field, i + jm1b + k) - m1) * jsn;

  var h1 = -(rfi(gxd_field, i + jm1b + k) - c1) * jsn;
  var s1 = -(rfi(gyd_field, i + j + km1b) - g1) * ksn;
  var u1 = -(rfi(gzd_field, im1 + j + k) - m1) * isn;

  var i1 = j1 + h1 - a1 * isn * jsn;
  var p1 = n1 + u1 - k1 * isn * ksn;
  var r1 = w1 + s1 - e1 * jsn * ksn;

  var t1 = rfi(yd_field, im1 + jm1b + km1b) + rfi(yd_field, i + j + km1b) - a1 - rfi(yd_field, im1 + j + km1b) - rfi(yd_field, i + jm1b + km1b);
  t1 *= -isn * jsn * ksn;

  j1 = -(a1 * isn - j1 * jsn);
  n1 = -(k1 * ksn - n1 * isn);
  w1 = -(e1 * jsn - w1 * ksn);

  h1 = -(a1 * jsn - h1 * isn);
  s1 = -(e1 * ksn - s1 * jsn);
  u1 = -(k1 * isn - u1 * ksn);

  a1 = d1 - rfi(yd_field, im1 + j + k);
  e1 = d1 - rfi(yd_field, i + jm1b + k);
  k1 = d1 - rfi(yd_field, i + j + km1b);

  let b1 = -3.0 * a1 + (2.0 * c1 + rfi(gxd_field, im1 + j + k)) * isn;
  let f1 = -3.0 * e1 + (2.0 * g1 + rfi(gyd_field, i + jm1b + k)) * jsn;
  let l1 = -3.0 * k1 + (2.0 * m1 + rfi(gzd_field, i + j + km1b)) * ksn;

  a1 = (rfi(gxd_field, im1 + j + k) + c1 - 2.0 * a1 * isn) * xx;
  e1 = (rfi(gyd_field, i + jm1b + k) + g1 - 2.0 * e1 * jsn) * yy;
  k1 = (rfi(gzd_field, i + j + km1b) + m1 - 2.0 * k1 * ksn) * zz;

  if (rwall(wall_field, ijk) > 128u) {
    d1 += ((a1 + b1 + h1 * yy + n1 * zz) * xx + c1 + (i1 + j1 * yy + t1 * zz) * yy + (u1 * zz + p1) * zz) * xx;
    d1 += ((e1 + f1 + s1 * zz) * yy + (w1 * zz + r1) * zz + g1) * yy + ((k1 + l1) * zz + m1) * zz;
    wf(fn_field, ijk, clamp(d1, -CIP_VALUE_LIMIT, CIP_VALUE_LIMIT));
  }

  a1 = (3.0 * a1 + 2.0 * (b1 + h1 * yy + n1 * zz)) * xx + c1 + yy * (j1 * yy + i1 + t1 * zz) + zz * (p1 + u1 * zz);
  e1 = (3.0 * e1 + 2.0 * (f1 + j1 * xx + s1 * zz)) * yy + g1 + xx * (h1 * xx + i1 + t1 * zz) + zz * (r1 + w1 * zz);
  k1 = (3.0 * k1 + 2.0 * (l1 + u1 * xx + w1 * yy)) * zz + m1 + xx * (n1 * xx + p1 + t1 * yy) + yy * (r1 + s1 * yy);

  var gx_adv = a1;
  var gy_adv = e1;
  var gz_adv = k1;
  if (USE_TRANSVERSE_REPAIR && abs(xx) < CIP_TRANSVERSE_EPS) {
    gx_adv = 0.5 * (cip_value3d(yd_field, gxd_field, gyd_field, gzd_field, i + 1, j0, k0, xx, yy, zz) - cip_value3d(yd_field, gxd_field, gyd_field, gzd_field, i - 1, j0, k0, xx, yy, zz));
  }
  if (USE_TRANSVERSE_REPAIR && abs(yy) < CIP_TRANSVERSE_EPS) {
    gy_adv = 0.5 * (cip_value3d(yd_field, gxd_field, gyd_field, gzd_field, i, j0 + 1, k0, xx, yy, zz) - cip_value3d(yd_field, gxd_field, gyd_field, gzd_field, i, j0 - 1, k0, xx, yy, zz));
  }
  if (USE_TRANSVERSE_REPAIR && abs(zz) < CIP_TRANSVERSE_EPS) {
    gz_adv = 0.5 * (cip_value3d(yd_field, gxd_field, gyd_field, gzd_field, i, j0, k0 + 1, xx, yy, zz) - cip_value3d(yd_field, gxd_field, gyd_field, gzd_field, i, j0, k0 - 1, xx, yy, zz));
  }

  if (rwall(wall_field, ijk) >= 128u) {
    let x0idx = wrap(i - 1, WX) + j + k;
    let x1idx = wrap(i + 1, WX) + j + k;
    wf(gxn_field, ijk, clamp(gx_adv - 0.5 * DT * (gx_adv * (rfi(u_field, x1idx) - rfi(u_field, x0idx)) + gy_adv * (rfi(v_field, x1idx) - rfi(v_field, x0idx)) + gz_adv * (rfi(w_field, x1idx) - rfi(w_field, x0idx))), -SPEEDLIMIT, SPEEDLIMIT));

    let y0idx = wrap(j0 - 1, WY) * WX + i + k;
    let y1idx = wrap(j0 + 1, WY) * WX + i + k;
    wf(gyn_field, ijk, clamp(gy_adv - 0.5 * DT * (gx_adv * (rfi(u_field, y1idx) - rfi(u_field, y0idx)) + gy_adv * (rfi(v_field, y1idx) - rfi(v_field, y0idx)) + gz_adv * (rfi(w_field, y1idx) - rfi(w_field, y0idx))), -SPEEDLIMIT, SPEEDLIMIT));

    let z0idx = wrap(k0 - 1, WZ) * WXY + i + j;
    let z1idx = wrap(k0 + 1, WZ) * WXY + i + j;
    wf(gzn_field, ijk, clamp(gz_adv - 0.5 * DT * (gx_adv * (rfi(u_field, z1idx) - rfi(u_field, z0idx)) + gy_adv * (rfi(v_field, z1idx) - rfi(v_field, z0idx)) + gz_adv * (rfi(w_field, z1idx) - rfi(w_field, z0idx))), -SPEEDLIMIT, SPEEDLIMIT));
  }
}

@compute @workgroup_size(32, 1, 1)
fn div(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = i32(gid.x);
  let j = i32(gid.y);
  let k = i32(gid.z);
  if (i >= WX || j >= WY || k >= WZ) { return; }
  let c = idx3(i, j, k);
  let d = rf(YUN, idx3(i + 1, j, k)) - rf(YUN, c) + rf(YVN, idx3(i, j + 1, k)) - rf(YVN, c) + rf(YWN, idx3(i, j, k + 1)) - rf(YWN, c);
  wf(DIV, c, d);
}

fn pressure_update(i : i32, j0 : i32, k0 : i32, parity : i32) {
  if (((i + j0 + k0) % 2) != parity) { return; }
  let c = idx3(i, j0, k0);
  var ff = rf(DIV, c);
  let p = rf(YPN, c);
  let c0 = idx3(i - 1, j0, k0);
  let c1 = idx3(i + 1, j0, k0);
  let c2 = idx3(i, j0 - 1, k0);
  let c3 = idx3(i, j0 + 1, k0);
  let c4 = idx3(i, j0, k0 - 1);
  let c5 = idx3(i, j0, k0 + 1);
  ff -= select(p, rf(YPN, c0), rwall(WALL_P, c0) != 0u);
  ff -= select(p, rf(YPN, c1), rwall(WALL_P, c1) != 0u);
  ff -= select(p, rf(YPN, c2), rwall(WALL_P, c2) != 0u);
  ff -= select(p, rf(YPN, c3), rwall(WALL_P, c3) != 0u);
  ff -= select(p, rf(YPN, c4), rwall(WALL_P, c4) != 0u);
  ff -= select(p, rf(YPN, c5), rwall(WALL_P, c5) != 0u);
  let wall_active = select(0.0, 1.0, rwall(WALL_P, c) > 128u);
  wf(YPN, c, p + (-0.1666666666667 * ff - p) * ALPHA * wall_active);
}

@compute @workgroup_size(32, 1, 1)
fn pressure0(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = i32(gid.x);
  let j = i32(gid.y);
  let k = i32(gid.z);
  if (i >= WX || j >= WY || k >= WZ) { return; }
  pressure_update(i, j, k, 0);
}

@compute @workgroup_size(32, 1, 1)
fn pressure1(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = i32(gid.x);
  let j = i32(gid.y);
  let k = i32(gid.z);
  if (i >= WX || j >= WY || k >= WZ) { return; }
  pressure_update(i, j, k, 1);
}

@compute @workgroup_size(32, 1, 1)
fn rhs(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = i32(gid.x);
  let j = i32(gid.y);
  let k = i32(gid.z);
  if (i >= WX || j >= WY || k >= WZ) { return; }
  let c = idx3(i, j, k);
  if (rwall(WALL_X, c) != 0u) {
    let raw = rf(YUN, c) - (rf(YPN, c) - rf(YPN, idx3(i - 1, j, k)));
    wf(YUN, c, select(raw, clamp(raw, -RHS_SPEED_CLAMP, RHS_SPEED_CLAMP), sim.frame.y != 0u));
  }
  if (rwall(WALL_Y, c) != 0u) {
    let raw = rf(YVN, c) - (rf(YPN, c) - rf(YPN, idx3(i, j - 1, k)));
    wf(YVN, c, select(raw, clamp(raw, -RHS_SPEED_CLAMP, RHS_SPEED_CLAMP), sim.frame.y != 0u));
  }
  if (rwall(WALL_Z, c) != 0u) {
    let raw = rf(YWN, c) - (rf(YPN, c) - rf(YPN, idx3(i, j, k - 1)));
    wf(YWN, c, select(raw, clamp(raw, -RHS_SPEED_CLAMP, RHS_SPEED_CLAMP), sim.frame.y != 0u));
  }
}

fn newgrad_write(gx_field : u32, gy_field : u32, gz_field : u32, yn_field : u32, y_field : u32, wall_field : u32, i : i32, j0 : i32, k0 : i32, mode : u32) {
  let i0 = wrap(i - 1, WX);
  let i1 = wrap(i + 1, WX);
  let j_1 = wrap(j0 - 1, WY);
  let j1v = wrap(j0 + 1, WY);
  let k_1 = wrap(k0 - 1, WZ);
  let k1v = wrap(k0 + 1, WZ);
  let j = j0 * WX;
  let j0b = j_1 * WX;
  let j1b = j1v * WX;
  let k = k0 * WXY;
  let k0b = k_1 * WXY;
  let k1b = k1v * WXY;
  let flat = i + j + k;
  let c = u32(flat);

  let oGX = rf(gx_field, c);
  let oGY = rf(gy_field, c);
  let oGZ = rf(gz_field, c);

  var dudx : f32;
  var dvdx : f32;
  var dwdx : f32;
  var dudy : f32;
  var dvdy : f32;
  var dwdy : f32;
  var dudz : f32;
  var dvdz : f32;
  var dwdz : f32;

  if (mode == 0u) {
    dudx = rf(GXU0, c) * DT * 0.1;
    dvdx = (rfi(GXV0, i + j1b + k) + rfi(GXV0, i + j + k) + rfi(GXV0, i0 + j1b + k) + rfi(GXV0, i0 + j + k)) * 0.25 * DT;
    dwdx = (rfi(GXW0, i + j + k1b) + rfi(GXW0, i + j + k) + rfi(GXW0, i0 + j + k1b) + rfi(GXW0, i0 + j + k)) * 0.25 * DT;
    dudy = rf(GYU0, c) * DT * 0.1;
    dvdy = (rfi(GYV0, i + j1b + k) + rfi(GYV0, i0 + j1b + k) + rfi(GYV0, i + j + k) + rfi(GYV0, i0 + j + k)) * 0.25 * DT;
    dwdy = (rfi(GYW0, i + j + k1b) + rfi(GYW0, i0 + j + k1b) + rfi(GYW0, i + j + k) + rfi(GYW0, i0 + j + k)) * 0.25 * DT;
    dudz = rf(GZU0, c) * DT * 0.1;
    dvdz = (rfi(GZV0, i + j1b + k) + rfi(GZV0, i0 + j1b + k) + rfi(GZV0, i + j + k) + rfi(GZV0, i0 + j + k)) * 0.25 * DT;
    dwdz = (rfi(GZW0, i + j + k1b) + rfi(GZW0, i0 + j + k1b) + rfi(GZW0, i + j + k) + rfi(GZW0, i0 + j + k)) * 0.25 * DT;
  } else if (mode == 1u) {
    dudx = (rfi(GXU0, i + j0b + k) + rfi(GXU0, i + j + k) + rfi(GXU0, i1 + j0b + k) + rfi(GXU0, i1 + j + k)) * 0.25 * DT;
    dvdx = rf(GXV0, c) * DT * 0.1;
    dwdx = (rfi(GXW0, i + j0b + k) + rfi(GXW0, i + j + k) + rfi(GXW0, i + j0b + k1b) + rfi(GXW0, i + j + k1b)) * 0.25 * DT;
    dudy = (rfi(GYU0, i + j0b + k) + rfi(GYU0, i + j + k) + rfi(GYU0, i1 + j0b + k) + rfi(GYU0, i1 + j + k)) * 0.25 * DT;
    dvdy = rf(GYV0, c) * DT * 0.1;
    dwdy = (rfi(GYW0, i + j0b + k) + rfi(GYW0, i + j + k) + rfi(GYW0, i + j0b + k1b) + rfi(GYW0, i + j + k1b)) * 0.25 * DT;
    dudz = (rfi(GZU0, i + j0b + k) + rfi(GZU0, i + j + k) + rfi(GZU0, i1 + j0b + k) + rfi(GZU0, i1 + j + k)) * 0.25 * DT;
    dvdz = rf(GZV0, c) * DT * 0.1;
    dwdz = (rfi(GZW0, i + j0b + k) + rfi(GZW0, i + j + k) + rfi(GZW0, i + j0b + k1b) + rfi(GZW0, i + j + k1b)) * 0.25 * DT;
  } else {
    dudx = (rfi(GXU0, i + j + k0b) + rfi(GXU0, i + j + k) + rfi(GXU0, i1 + j + k0b) + rfi(GXU0, i1 + j + k)) * 0.25 * DT;
    dvdx = (rfi(GXV0, i + j + k0b) + rfi(GXV0, i + j + k) + rfi(GXV0, i + j1b + k0b) + rfi(GXV0, i + j1b + k)) * 0.25 * DT;
    dwdx = rf(GXW0, c) * DT * 0.1;
    dudy = (rfi(GYU0, i + j + k0b) + rfi(GYU0, i + j + k) + rfi(GYU0, i1 + j + k0b) + rfi(GYU0, i1 + j + k)) * 0.25 * DT;
    dvdy = (rfi(GYV0, i + j + k0b) + rfi(GYV0, i + j + k) + rfi(GYV0, i + j1b + k0b) + rfi(GYV0, i + j1b + k)) * 0.25 * DT;
    dwdy = rf(GYW0, c) * DT * 0.1;
    dudz = (rfi(GZU0, i + j + k0b) + rfi(GZU0, i + j + k) + rfi(GZU0, i1 + j + k0b) + rfi(GZU0, i1 + j + k)) * 0.25 * DT;
    dvdz = (rfi(GZV0, i + j + k0b) + rfi(GZV0, i + j + k) + rfi(GZV0, i + j1b + k0b) + rfi(GZV0, i + j1b + k)) * 0.25 * DT;
    dwdz = rf(GZW0, c) * DT * 0.1;
  }

  if (rwall(wall_field, c) > 128u) {
    wf(gx_field, c, oGX + (rfi(yn_field, i1 + j + k) - rfi(yn_field, i0 + j + k) - rfi(y_field, i1 + j + k) + rfi(y_field, i0 + j + k)) * 0.5 - oGX * dudx - oGY * dvdx - oGZ * dwdx);
    wf(gy_field, c, oGY + (rfi(yn_field, i + j1b + k) - rfi(yn_field, i + j0b + k) - rfi(y_field, i + j1b + k) + rfi(y_field, i + j0b + k)) * 0.5 - oGX * dudy - oGY * dvdy - oGZ * dwdy);
    wf(gz_field, c, oGZ + (rfi(yn_field, i + j + k1b) - rfi(yn_field, i + j + k0b) - rfi(y_field, i + j + k1b) + rfi(y_field, i + j + k0b)) * 0.5 - oGX * dudz - oGY * dvdz - oGZ * dwdz);
  }
}

@compute @workgroup_size(32, 1, 1)
fn newgrad_x(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = i32(gid.x);
  let j = i32(gid.y);
  let k = i32(gid.z);
  if (i >= WX || j >= WY || k >= WZ) { return; }
  newgrad_write(GXU, GYU, GZU, YUN, YU, WALL_X, i, j, k, 0u);
}

@compute @workgroup_size(32, 1, 1)
fn newgrad_y(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = i32(gid.x);
  let j = i32(gid.y);
  let k = i32(gid.z);
  if (i >= WX || j >= WY || k >= WZ) { return; }
  newgrad_write(GXV, GYV, GZV, YVN, YV, WALL_Y, i, j, k, 1u);
}

@compute @workgroup_size(32, 1, 1)
fn newgrad_z(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = i32(gid.x);
  let j = i32(gid.y);
  let k = i32(gid.z);
  if (i >= WX || j >= WY || k >= WZ) { return; }
  newgrad_write(GXW, GYW, GZW, YWN, YW, WALL_Z, i, j, k, 2u);
}

@compute @workgroup_size(32, 1, 1)
fn exforce0(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x != 0u || gid.y != 0u || gid.z != 0u) { return; }
  if (sim.frame.x >= 9992u) { return; }
  for (var x = 11; x < 21; x += 1) {
    for (var y = 11; y < 21; y += 1) {
      let c = u32(9 + x * WX + y * WXY);
      wf(YUN, c, 0.3 + 0.11 * f32(x % 2) + 0.11 * f32(y % 2));
    }
  }
  for (var x = 13; x < 19; x += 1) {
    for (var y = 13; y < 19; y += 1) {
      let c = u32(23 + x * WX + y * WXY);
      wf(YUN, c, -0.15 - 0.05 * f32((x % 3) + 2) - 0.05 * f32((y % 3) + 2));
    }
  }
}

fn trilerp(field : u32, p : vec3<f32>) -> f32 {
  let ix = i32(p.x);
  let iy = i32(p.y);
  let iz = i32(p.z);
  let fx = p.x - f32(ix);
  let fy = p.y - f32(iy);
  let fz = p.z - f32(iz);
  let c000 = rf(field, idx3(ix, iy, iz));
  let c100 = rf(field, idx3(ix + 1, iy, iz));
  let c010 = rf(field, idx3(ix, iy + 1, iz));
  let c110 = rf(field, idx3(ix + 1, iy + 1, iz));
  let c001 = rf(field, idx3(ix, iy, iz + 1));
  let c101 = rf(field, idx3(ix + 1, iy, iz + 1));
  let c011 = rf(field, idx3(ix, iy + 1, iz + 1));
  let c111 = rf(field, idx3(ix + 1, iy + 1, iz + 1));
  let x00 = mix(c000, c100, fx);
  let x10 = mix(c010, c110, fx);
  let x01 = mix(c001, c101, fx);
  let x11 = mix(c011, c111, fx);
  return mix(mix(x00, x10, fy), mix(x01, x11, fy), fz);
}

@compute @workgroup_size(64, 1, 1)
fn particle_move(@builtin(global_invocation_id) gid : vec3<u32>) {
  let di = gid.x;
  let particle_count = u32(sim.data.x + 0.5);
  if (di >= particle_count) { return; }
  var p = particles[di].xyz;
  p.x += trilerp(YUN, p) * DT;
  p.y += trilerp(YVN, p) * DT;
  p.z += trilerp(YWN, p) * DT;

  if (p.x >= f32(WX) - 0.2 || p.x < 0.2) { p.x = f32(di % u32(WX)) + 0.5; }
  if (p.y >= f32(WY) - 0.2 || p.y < 0.2) { p.y = f32((di / u32(WX)) % u32(WY)) + 0.5; }
  if (p.z >= f32(WZ) - 0.2 || p.z < 0.2) { p.z = f32((di / u32(WXY)) % u32(WZ)) + 0.5; }
  particles[di] = vec4<f32>(p, particles[di].w);
}

@compute @workgroup_size(1, 1, 1)
fn gas_release(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x != 0u || gid.y != 0u || gid.z != 0u) { return; }
  var sum = 0.0;
  for (var i = 0u; i < CELL_COUNT; i += 1u) {
    sum += rf(YPN, i);
  }
  let mean = sum / f32(CELL_COUNT);
  for (var i = 0u; i < CELL_COUNT; i += 1u) {
    wf(YPN, i, rf(YPN, i) - mean);
  }
}

fn write_diag(stage : u32) {
  let frame = sim.frame.x;
  if (frame >= DIAG_MAX_FRAMES) { return; }

  var energy = 0.0;
  var max_speed2 = 0.0;
  var live_div2 = 0.0;
  var max_live_div = 0.0;
  var stored_div2 = 0.0;
  var max_stored_div = 0.0;
  var pressure2 = 0.0;
  var max_pressure = 0.0;
  var max_pressure_grad = 0.0;
  var max_pressure_grad_cell = 0.0;

  for (var k = 0; k < WZ; k += 1) {
    for (var j = 0; j < WY; j += 1) {
      for (var i = 0; i < WX; i += 1) {
        let c = idx3(i, j, k);
        let u = rf(YUN, c);
        let v = rf(YVN, c);
        let w = rf(YWN, c);
        let speed2 = u * u + v * v + w * w;
        energy += speed2;
        if (speed2 > max_speed2) {
          max_speed2 = speed2;
        }

        let live_div = rf(YUN, idx3(i + 1, j, k)) - u + rf(YVN, idx3(i, j + 1, k)) - v + rf(YWN, idx3(i, j, k + 1)) - w;
        let abs_live_div = abs(live_div);
        live_div2 += live_div * live_div;
        if (abs_live_div > max_live_div) {
          max_live_div = abs_live_div;
        }

        let stored_div = abs(rf(DIV, c));
        stored_div2 += stored_div * stored_div;
        if (stored_div > max_stored_div) {
          max_stored_div = stored_div;
        }

        let p = abs(rf(YPN, c));
        pressure2 += p * p;
        if (p > max_pressure) {
          max_pressure = p;
        }

        let dpx = abs(rf(YPN, c) - rf(YPN, idx3(i - 1, j, k)));
        let dpy = abs(rf(YPN, c) - rf(YPN, idx3(i, j - 1, k)));
        let dpz = abs(rf(YPN, c) - rf(YPN, idx3(i, j, k - 1)));
        let max_component = max(dpx, max(dpy, dpz));
        if (max_component > max_pressure_grad) {
          max_pressure_grad = max_component;
          max_pressure_grad_cell = f32(c);
        }
      }
    }
  }

  let base = DIAG_HEADER_FLOATS + (frame * DIAG_STAGE_COUNT + stage) * DIAG_STRIDE;
  stats[base + 0u] = f32(frame);
  stats[base + 1u] = f32(stage);
  stats[base + 2u] = energy;
  stats[base + 3u] = sqrt(max_speed2);
  stats[base + 4u] = sqrt(live_div2 / f32(CELL_COUNT));
  stats[base + 5u] = max_live_div;
  stats[base + 6u] = sqrt(pressure2 / f32(CELL_COUNT));
  stats[base + 7u] = max_pressure;
  stats[base + 8u] = max_pressure_grad;
  stats[base + 9u] = max_pressure_grad_cell;
  stats[base + 10u] = sqrt(stored_div2 / f32(CELL_COUNT));
  stats[base + 11u] = max_stored_div;
}

@compute @workgroup_size(1, 1, 1)
fn diag_after_cip(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x != 0u || gid.y != 0u || gid.z != 0u) { return; }
  write_diag(0u);
}

@compute @workgroup_size(1, 1, 1)
fn diag_after_div(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x != 0u || gid.y != 0u || gid.z != 0u) { return; }
  write_diag(1u);
}

@compute @workgroup_size(1, 1, 1)
fn diag_after_pressure(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x != 0u || gid.y != 0u || gid.z != 0u) { return; }
  write_diag(2u);
}

@compute @workgroup_size(1, 1, 1)
fn diag_after_rhs(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x != 0u || gid.y != 0u || gid.z != 0u) { return; }
  write_diag(3u);
}

@compute @workgroup_size(1, 1, 1)
fn diag_after_newgrad(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x != 0u || gid.y != 0u || gid.z != 0u) { return; }
  write_diag(4u);
}

@compute @workgroup_size(1, 1, 1)
fn energy_stats(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x != 0u || gid.y != 0u || gid.z != 0u) { return; }
  var energy = 0.0;
  var max_speed2 = 0.0;
  var pressure2 = 0.0;
  var max_pressure = 0.0;
  var div2 = 0.0;
  var max_div = 0.0;
  for (var i = 0u; i < CELL_COUNT; i += 1u) {
    let u = rf(YUN, i);
    let v = rf(YVN, i);
    let w = rf(YWN, i);
    let speed2 = u * u + v * v + w * w;
    energy += speed2;
    if (speed2 > max_speed2) {
      max_speed2 = speed2;
    }
    let p = abs(rf(YPN, i));
    pressure2 += p * p;
    if (p > max_pressure) {
      max_pressure = p;
    }
    let d = abs(rf(DIV, i));
    div2 += d * d;
    if (d > max_div) {
      max_div = d;
    }
  }
  stats[0] = energy;
  stats[1] = energy / f32(CELL_COUNT);
  stats[2] = sqrt(max_speed2);
  stats[3] = sqrt(pressure2 / f32(CELL_COUNT));
  stats[4] = max_pressure;
  stats[5] = sqrt(div2 / f32(CELL_COUNT));
  stats[6] = max_div;
  stats[7] = f32(sim.frame.x);
}
