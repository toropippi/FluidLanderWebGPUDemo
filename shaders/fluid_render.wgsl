struct SimParams {
  grid : vec4<f32>,
  sim : vec4<f32>,
  pointer : vec4<f32>,
  pointer_delta : vec4<f32>,
  boundary : vec4<f32>,
};

struct VsOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@group(0) @binding(0) var<uniform> params : SimParams;
@group(0) @binding(1) var<storage, read> dye : array<f32>;

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

fn sample_dye(uv : vec2<f32>) -> f32 {
  let p = clamp(uv * vec2<f32>(params.grid.x, params.grid.y) - vec2<f32>(0.5, 0.5), vec2<f32>(0.0, 0.0), vec2<f32>(params.grid.x - 1.001, params.grid.y - 1.001));
  let i0 = vec2<i32>(i32(floor(p.x)), i32(floor(p.y)));
  let i1 = vec2<i32>(clamp_x(i0.x + 1), clamp_y(i0.y + 1));
  let f = fract(p);

  let s00 = dye[flatten(i0.x, i0.y)];
  let s10 = dye[flatten(i1.x, i0.y)];
  let s01 = dye[flatten(i0.x, i1.y)];
  let s11 = dye[flatten(i1.x, i1.y)];

  let sx0 = mix(s00, s10, f.x);
  let sx1 = mix(s01, s11, f.x);
  return mix(sx0, sx1, f.y);
}

fn palette(t0 : f32) -> vec3<f32> {
  let t = clamp(t0, 0.0, 1.0);
  let a = vec3<f32>(0.020, 0.050, 0.130);
  let b = vec3<f32>(0.080, 0.420, 0.820);
  let c = vec3<f32>(0.980, 0.790, 0.240);
  let d = vec3<f32>(0.980, 0.230, 0.090);
  let t1 = smoothstep(0.00, 0.45, t);
  let t2 = smoothstep(0.35, 0.80, t);
  let t3 = smoothstep(0.72, 1.00, t);
  let col1 = mix(a, b, t1);
  let col2 = mix(col1, c, t2);
  return mix(col2, d, t3);
}

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VsOut {
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0)
  );
  var uvs = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0)
  );

  var out : VsOut;
  out.position = vec4<f32>(positions[vid], 0.0, 1.0);
  out.uv = uvs[vid];
  return out;
}

@fragment
fn fs_main(inf : VsOut) -> @location(0) vec4<f32> {
  let d = sample_dye(inf.uv);
  let light = smoothstep(0.0, 1.0, d);
  let color = palette(light);
  let bloom = color * (0.08 + 0.92 * light);
  var out_col = bloom;
  if (params.boundary.x > 0.5) {
    let gx = i32(clamp(inf.uv.x * params.grid.x, 0.0, params.grid.x - 1.0));
    let gy = i32(clamp(inf.uv.y * params.grid.y, 0.0, params.grid.y - 1.0));
    if (is_wall_cell(gx, gy)) {
      out_col = mix(out_col, vec3<f32>(0.95, 0.95, 0.95), 0.65);
    }
  }
  return vec4<f32>(out_col, 1.0);
}
