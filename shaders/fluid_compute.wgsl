struct SimParams {
  // x=gridWidth, y=gridHeight, z=1/gridWidth, w=1/gridHeight
  grid : vec4<f32>,
  // x=dt, y=velocityDissipation, z=dyeDissipation, w=unused
  sim : vec4<f32>,
  // x=pointerX, y=pointerY, z=pointerDown(0|1), w=pointerRadius
  pointer : vec4<f32>,
  // x=deltaX, y=deltaY, z=forceScale, w=dyeAmount
  pointer_delta : vec4<f32>,
  // x=useCavityWalls(0|1), y=lidVelocity, z=wallThicknessCells, w=unused
  boundary : vec4<f32>,
};

@group(0) @binding(0) var<uniform> params : SimParams;
@group(0) @binding(1) var<storage, read_write> field0 : array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> field1 : array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> field2 : array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> field3 : array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> scalar0 : array<f32>;
@group(0) @binding(6) var<storage, read_write> scalar1 : array<f32>;
@group(0) @binding(7) var<storage, read_write> scalar2 : array<f32>;
@group(0) @binding(8) var<storage, read_write> scalar3 : array<f32>;

const WORKGROUP_X : u32 = 16u;
const WORKGROUP_Y : u32 = 16u;
const VELOCITY_LIMIT : f32 = 0.85;

fn width_i() -> i32 {
  return i32(params.grid.x + 0.5);
}

fn height_i() -> i32 {
  return i32(params.grid.y + 0.5);
}

fn clamp_x(x : i32) -> i32 {
  return clamp(x, 0, width_i() - 1);
}

fn clamp_y(y : i32) -> i32 {
  return clamp(y, 0, height_i() - 1);
}

fn flatten(x : i32, y : i32) -> u32 {
  return u32(y * width_i() + x);
}

fn wall_cells() -> i32 {
  return max(1, i32(params.boundary.z + 0.5));
}

fn is_wall_cell(x : i32, y : i32) -> bool {
  let t = wall_cells();
  let w = width_i();
  let h = height_i();
  return x < t || x >= (w - t) || y < t || y >= (h - t);
}

fn hermite1(f0 : f32, f1 : f32, m0 : f32, m1 : f32, t : f32) -> f32 {
  let t2 = t * t;
  let t3 = t2 * t;
  let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
  let h10 = t3 - 2.0 * t2 + t;
  let h01 = -2.0 * t3 + 3.0 * t2;
  let h11 = t3 - t2;
  return h00 * f0 + h10 * m0 + h01 * f1 + h11 * m1;
}

fn sample_scalar0_cip(cell_pos : vec2<f32>) -> f32 {
  let p = clamp(cell_pos - vec2<f32>(0.5, 0.5), vec2<f32>(0.0, 0.0), vec2<f32>(params.grid.x - 1.001, params.grid.y - 1.001));
  let i0 = vec2<i32>(i32(floor(p.x)), i32(floor(p.y)));
  let i1 = vec2<i32>(clamp_x(i0.x + 1), clamp_y(i0.y + 1));
  let f = fract(p);

  let idx00 = flatten(i0.x, i0.y);
  let idx10 = flatten(i1.x, i0.y);
  let idx01 = flatten(i0.x, i1.y);
  let idx11 = flatten(i1.x, i1.y);

  let s00 = scalar0[idx00];
  let s10 = scalar0[idx10];
  let s01 = scalar0[idx01];
  let s11 = scalar0[idx11];

  let g00 = field2[idx00];
  let g10 = field2[idx10];
  let g01 = field2[idx01];
  let g11 = field2[idx11];

  let row0 = hermite1(s00, s10, g00.x, g10.x, f.x);
  let row1 = hermite1(s01, s11, g01.x, g11.x, f.x);

  let gy0 = mix(g00.y, g10.y, f.x);
  let gy1 = mix(g01.y, g11.y, f.x);

  let s = hermite1(row0, row1, gy0, gy1, f.y);
  let s_min = min(min(s00, s10), min(s01, s11));
  let s_max = max(max(s00, s10), max(s01, s11));
  return clamp(s, s_min, s_max);
}

fn sample_velocity0_cip(cell_pos : vec2<f32>) -> vec2<f32> {
  let p = clamp(cell_pos - vec2<f32>(0.5, 0.5), vec2<f32>(0.0, 0.0), vec2<f32>(params.grid.x - 1.001, params.grid.y - 1.001));
  let i0 = vec2<i32>(i32(floor(p.x)), i32(floor(p.y)));
  let i1 = vec2<i32>(clamp_x(i0.x + 1), clamp_y(i0.y + 1));
  let f = fract(p);

  let idx00 = flatten(i0.x, i0.y);
  let idx10 = flatten(i1.x, i0.y);
  let idx01 = flatten(i0.x, i1.y);
  let idx11 = flatten(i1.x, i1.y);

  let v00 = field0[idx00];
  let v10 = field0[idx10];
  let v01 = field0[idx01];
  let v11 = field0[idx11];

  let gu00 = field2[idx00];
  let gu10 = field2[idx10];
  let gu01 = field2[idx01];
  let gu11 = field2[idx11];

  let gv00 = field3[idx00];
  let gv10 = field3[idx10];
  let gv01 = field3[idx01];
  let gv11 = field3[idx11];

  let ux0 = hermite1(v00.x, v10.x, gu00.x, gu10.x, f.x);
  let ux1 = hermite1(v01.x, v11.x, gu01.x, gu11.x, f.x);
  let uy0 = mix(gu00.y, gu10.y, f.x);
  let uy1 = mix(gu01.y, gu11.y, f.x);
  let u = hermite1(ux0, ux1, uy0, uy1, f.y);

  let vx0 = hermite1(v00.y, v10.y, gv00.x, gv10.x, f.x);
  let vx1 = hermite1(v01.y, v11.y, gv01.x, gv11.x, f.x);
  let vy0 = mix(gv00.y, gv10.y, f.x);
  let vy1 = mix(gv01.y, gv11.y, f.x);
  let v = hermite1(vx0, vx1, vy0, vy1, f.y);

  let u_min = min(min(v00.x, v10.x), min(v01.x, v11.x));
  let u_max = max(max(v00.x, v10.x), max(v01.x, v11.x));
  let v_min = min(min(v00.y, v10.y), min(v01.y, v11.y));
  let v_max = max(max(v00.y, v10.y), max(v01.y, v11.y));
  return vec2<f32>(clamp(u, u_min, u_max), clamp(v, v_min, v_max));
}

@compute @workgroup_size(WORKGROUP_X, WORKGROUP_Y, 1)
fn compute_velocity_gradient_u(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width_i() || y >= height_i()) {
    return;
  }

  let x_l = clamp_x(x - 1);
  let x_r = clamp_x(x + 1);
  let y_b = clamp_y(y - 1);
  let y_t = clamp_y(y + 1);
  let idx = flatten(x, y);

  let gx = 0.5 * (field0[flatten(x_r, y)].x - field0[flatten(x_l, y)].x);
  let gy = 0.5 * (field0[flatten(x, y_t)].x - field0[flatten(x, y_b)].x);
  field1[idx] = vec2<f32>(gx, gy);
}

@compute @workgroup_size(WORKGROUP_X, WORKGROUP_Y, 1)
fn compute_velocity_gradient_v(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width_i() || y >= height_i()) {
    return;
  }

  let x_l = clamp_x(x - 1);
  let x_r = clamp_x(x + 1);
  let y_b = clamp_y(y - 1);
  let y_t = clamp_y(y + 1);
  let idx = flatten(x, y);

  let gx = 0.5 * (field0[flatten(x_r, y)].y - field0[flatten(x_l, y)].y);
  let gy = 0.5 * (field0[flatten(x, y_t)].y - field0[flatten(x, y_b)].y);
  field1[idx] = vec2<f32>(gx, gy);
}

@compute @workgroup_size(WORKGROUP_X, WORKGROUP_Y, 1)
fn advect_velocity_cip(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width_i() || y >= height_i()) {
    return;
  }

  let idx = flatten(x, y);
  let vel = field0[idx];
  let cell = vec2<f32>(f32(x) + 0.5, f32(y) + 0.5);
  let back = cell - params.sim.x * vel;

  var v = sample_velocity0_cip(back) * params.sim.y;
  let v_len = length(v);
  if (v_len > VELOCITY_LIMIT) {
    v = v * (VELOCITY_LIMIT / v_len);
  }
  field1[idx] = v;
}

@compute @workgroup_size(WORKGROUP_X, WORKGROUP_Y, 1)
fn diffuse_velocity(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width_i() || y >= height_i()) {
    return;
  }

  let idx = flatten(x, y);
  if (params.boundary.x > 0.5 && is_wall_cell(x, y)) {
    field1[idx] = field0[idx];
    return;
  }

  let x_l = clamp_x(x - 1);
  let x_r = clamp_x(x + 1);
  let y_b = clamp_y(y - 1);
  let y_t = clamp_y(y + 1);

  let v = field0[idx];
  let lap =
    field0[flatten(x_l, y)] +
    field0[flatten(x_r, y)] +
    field0[flatten(x, y_b)] +
    field0[flatten(x, y_t)] -
    4.0 * v;

  var out_v = v + params.sim.w * lap;
  let v_len = length(out_v);
  if (v_len > VELOCITY_LIMIT) {
    out_v = out_v * (VELOCITY_LIMIT / v_len);
  }
  field1[idx] = out_v;
}

@compute @workgroup_size(WORKGROUP_X, WORKGROUP_Y, 1)
fn divergence(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width_i() || y >= height_i()) {
    return;
  }

  let x_l = clamp_x(x - 1);
  let x_r = clamp_x(x + 1);
  let y_b = clamp_y(y - 1);
  let y_t = clamp_y(y + 1);

  let v_l = field0[flatten(x_l, y)];
  let v_r = field0[flatten(x_r, y)];
  let v_b = field0[flatten(x, y_b)];
  let v_t = field0[flatten(x, y_t)];
  let idx = flatten(x, y);

  scalar0[idx] = 0.5 * ((v_r.x - v_l.x) + (v_t.y - v_b.y));
}

@compute @workgroup_size(WORKGROUP_X, WORKGROUP_Y, 1)
fn clear_scalar(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width_i() || y >= height_i()) {
    return;
  }
  scalar0[flatten(x, y)] = 0.0;
}

@compute @workgroup_size(WORKGROUP_X, WORKGROUP_Y, 1)
fn jacobi_pressure(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width_i() || y >= height_i()) {
    return;
  }

  let x_l = clamp_x(x - 1);
  let x_r = clamp_x(x + 1);
  let y_b = clamp_y(y - 1);
  let y_t = clamp_y(y + 1);

  let idx = flatten(x, y);
  let p_l = scalar1[flatten(x_l, y)];
  let p_r = scalar1[flatten(x_r, y)];
  let p_b = scalar1[flatten(x, y_b)];
  let p_t = scalar1[flatten(x, y_t)];
  let div = scalar0[idx];

  scalar2[idx] = 0.25 * (p_l + p_r + p_b + p_t - div);
}

@compute @workgroup_size(WORKGROUP_X, WORKGROUP_Y, 1)
fn project_velocity(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width_i() || y >= height_i()) {
    return;
  }

  let x_l = clamp_x(x - 1);
  let x_r = clamp_x(x + 1);
  let y_b = clamp_y(y - 1);
  let y_t = clamp_y(y + 1);
  let idx = flatten(x, y);

  let p_l = scalar0[flatten(x_l, y)];
  let p_r = scalar0[flatten(x_r, y)];
  let p_b = scalar0[flatten(x, y_b)];
  let p_t = scalar0[flatten(x, y_t)];

  let grad = vec2<f32>(0.5 * (p_r - p_l), 0.5 * (p_t - p_b));
  var v = field0[idx] - grad;
  let v_len = length(v);
  if (v_len > VELOCITY_LIMIT) {
    v = v * (VELOCITY_LIMIT / v_len);
  }
  field1[idx] = v;
}

@compute @workgroup_size(WORKGROUP_X, WORKGROUP_Y, 1)
fn apply_cavity_walls(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (params.boundary.x < 0.5) {
    return;
  }

  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width_i() || y >= height_i()) {
    return;
  }
  if (!is_wall_cell(x, y)) {
    return;
  }

  let t = wall_cells();
  let w = width_i();
  let h = height_i();
  let idx = flatten(x, y);
  let is_left = x < t;
  let is_right = x >= (w - t);
  let is_bottom = y < t;
  let is_top = y >= (h - t);

  var v = vec2<f32>(0.0, 0.0);
  if (is_top && !is_left && !is_right) {
    v.x = params.boundary.y;
  }
  if (is_bottom) {
    v = vec2<f32>(0.0, 0.0);
  }
  field0[idx] = v;
}

@compute @workgroup_size(WORKGROUP_X, WORKGROUP_Y, 1)
fn apply_cavity_dye_walls(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (params.boundary.x < 0.5) {
    return;
  }

  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width_i() || y >= height_i()) {
    return;
  }
  if (!is_wall_cell(x, y)) {
    return;
  }
  scalar0[flatten(x, y)] = 0.0;
}

@compute @workgroup_size(WORKGROUP_X, WORKGROUP_Y, 1)
fn inject_cavity_tracer(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (params.boundary.x < 0.5) {
    return;
  }

  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width_i() || y >= height_i()) {
    return;
  }
  if (is_wall_cell(x, y)) {
    return;
  }

  let t = wall_cells();
  let h = height_i();
  let band_top = h - t - 2;
  let band_bottom = h - t - 6;
  if (y < band_bottom || y > band_top) {
    return;
  }

  let xn = f32(x) / max(1.0, params.grid.x - 1.0);
  let pattern = 0.2 + 0.8 * (0.5 + 0.5 * sin(12.0 * xn));
  let idx = flatten(x, y);
  scalar0[idx] = min(1.5, scalar0[idx] + params.boundary.w * pattern);
}

@compute @workgroup_size(WORKGROUP_X, WORKGROUP_Y, 1)
fn compute_dye_gradient(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width_i() || y >= height_i()) {
    return;
  }

  let x_l = clamp_x(x - 1);
  let x_r = clamp_x(x + 1);
  let y_b = clamp_y(y - 1);
  let y_t = clamp_y(y + 1);
  let idx = flatten(x, y);

  let gx = 0.5 * (scalar0[flatten(x_r, y)] - scalar0[flatten(x_l, y)]);
  let gy = 0.5 * (scalar0[flatten(x, y_t)] - scalar0[flatten(x, y_b)]);
  field1[idx] = vec2<f32>(gx, gy);
}

@compute @workgroup_size(WORKGROUP_X, WORKGROUP_Y, 1)
fn advect_dye_cip(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width_i() || y >= height_i()) {
    return;
  }

  let idx = flatten(x, y);
  let vel = field0[idx];
  let cell = vec2<f32>(f32(x) + 0.5, f32(y) + 0.5);
  let back = cell - params.sim.x * vel;
  scalar1[idx] = sample_scalar0_cip(back) * params.sim.z;
}

@compute @workgroup_size(WORKGROUP_X, WORKGROUP_Y, 1)
fn splat_velocity(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width_i() || y >= height_i()) {
    return;
  }
  if (params.pointer.z < 0.5) {
    return;
  }

  let idx = flatten(x, y);
  let cell = vec2<f32>(f32(x) + 0.5, f32(y) + 0.5);
  let dp = cell - params.pointer.xy;
  let radius_sq = max(params.pointer.w * params.pointer.w, 1.0);
  let influence = exp(-dot(dp, dp) / radius_sq);
  let impulse = params.pointer_delta.xy * params.pointer_delta.z * influence;

  var v = field0[idx] + impulse;
  let v_len = length(v);
  if (v_len > VELOCITY_LIMIT) {
    v = v * (VELOCITY_LIMIT / v_len);
  }
  field0[idx] = v;
}

@compute @workgroup_size(WORKGROUP_X, WORKGROUP_Y, 1)
fn splat_dye(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width_i() || y >= height_i()) {
    return;
  }
  if (params.pointer.z < 0.5) {
    return;
  }

  let idx = flatten(x, y);
  let cell = vec2<f32>(f32(x) + 0.5, f32(y) + 0.5);
  let dp = cell - params.pointer.xy;
  let radius_sq = max(params.pointer.w * params.pointer.w, 1.0);
  let influence = exp(-dot(dp, dp) / radius_sq);
  let add = influence * params.pointer_delta.w;
  scalar0[idx] = min(1.5, scalar0[idx] + add);
}
