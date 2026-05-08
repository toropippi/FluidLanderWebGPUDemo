struct RenderParams {
  viewport : vec4<f32>,
  camera : vec4<f32>,
  style : vec4<f32>,
};

struct VsOut {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec4<f32>,
};

@group(0) @binding(0) var<storage, read> particles : array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params : RenderParams;

fn rotate_y(v : vec3<f32>, a : f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

fn rotate_x(v : vec3<f32>, a : f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_id : u32, @builtin(instance_index) instance_id : u32) -> VsOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0)
  );

  let p0 = particles[instance_id].xyz;
  var p = vec3<f32>(
    (p0.x - 16.0) / 16.0,
    (p0.y - 16.0) / 16.0,
    (p0.z - 16.0) / 16.0
  );
  p = rotate_y(p, params.camera.x);
  p = rotate_x(p, params.camera.y);

  let scale = params.camera.z;
  let pixel = params.camera.w;
  let ndc_pixel = vec2<f32>(2.0 / max(params.viewport.x, 1.0), 2.0 / max(params.viewport.y, 1.0));
  let pos2 = p.xy * scale;
  let offset = quad[vertex_id] * ndc_pixel * pixel;
  let depth = clamp(p.z * 0.5 + 0.5, 0.0, 1.0);
  let shade = mix(0.72, 1.0, depth);
  let alpha = params.style.x;

  var out : VsOut;
  out.position = vec4<f32>(pos2 + offset, 0.0, 1.0);
  out.color = vec4<f32>(vec3<f32>(shade), alpha);
  return out;
}

@fragment
fn fs_main(inf : VsOut) -> @location(0) vec4<f32> {
  return inf.color;
}
