# Extraction Notes (Unity -> WebGPU)

Source project analyzed:

- `C:\Users\5080\Documents\GitHub\FluidLander\FluidLander`
- `Assets/HLSL/NS.compute`
- `Assets/Scripts/MenyBullets.cs`
- `Assets/Scripts/Const.cs`

## Core Constants Found

- `WX = 192`
- `WY = 144`
- `DT = 1.0`
- `ALPHA = 1.79`
- `CFDFRAME_PAR_GAMEFRAME = 12`
- `POISSONLOOPNUM = 32 << option`
- velocity clamp near `limitf = 0.85`

## Unity Solver Order (Observed)

From `MenyBullets.Update()` CFD loop:

1. velocity helper update (`veloc`)
2. advection (`dcip*` or `upwind*`, and scalar advection for `YE`)
3. divergence (`div`)
4. pressure solve (`pressure0`, `pressure1`) in loop
5. pressure gradient subtraction (`rhs`)
6. gradient refresh (`newgrad*`) for CIP mode

## WebGPU Mapping Implemented Here

- `compute_velocity_gradient_u` + `compute_velocity_gradient_v` + `advect_velocity_cip` -> velocity transport with CIP-style interpolation
- `divergence` -> divergence build
- `jacobi_pressure` -> Poisson iterative pressure solve
- `project_velocity` -> `rhs` equivalent (subtract pressure gradient)
- `compute_dye_gradient` + `advect_dye_cip` -> scalar transport with CIP-style gradient/Hermite interpolation
- `apply_cavity_walls` -> no-slip walls + moving-lid cavity boundary condition
- `splat_velocity` / `splat_dye` -> user interaction force and color injection

## Intentional Simplifications

- Velocity transport now uses a CIP-style approach with explicit per-component gradient passes.
- Dye transport now uses a CIP-style approach with an explicit gradient pass and Hermite interpolation.
- Wall/object mapping (`kabemapping`, object buffers) is omitted in this initial web demo.
- Particle kernels (`ryuusi*`) are omitted in this initial web demo.
