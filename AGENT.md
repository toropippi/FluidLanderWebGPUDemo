# AGENT.md

## Goal
This repository aims to publish a **touchable 2D fluid demo on the web** as fast as possible.
Priority order:

1. Ship a working demo quickly (browser-first).
2. Improve stability, quality, and extensibility after it works.
3. Expand to other implementations later (Rust/wgpu or Unity assets) only if needed.

## Progress Tracking (Required)
For all future tasks, record progress in `PROGRESS.txt`.

- Add one log entry when a task starts.
- Add one log entry when a task finishes.
- If blocked, add a block note with reason and next action.
- Use this format:
  - `[YYYY-MM-DD HH:MM] [STATUS] short description`
  - `STATUS`: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`

## Recommended Architecture (Default)
Use **Option A: TypeScript + WebGPU (WGSL)** as the default.

- Reason: browser demo is fastest, low OS dependency, easy to publish.
- Hosting: GitHub Pages / Vercel.
- References: rely on official WebGPU samples and W3C spec as primary sources.

### Alternatives (Only with clear reason)
- Option B: Rust + wgpu + wasm (if native expansion is a strong requirement).
- Option C: Unity URP + WebGPU (only if Unity asset reuse is highly valuable).

## Expected Directory Structure
- `src/`: WebGPU setup, input, rendering, update loop.
- `shaders/`: `fluid_step.wgsl`, `render.wgsl`, etc.
- `public/`: `index.html`.
- `docs/` or `dist/`: static deploy output.

## Demo Requirements (Minimum Bar)
- Full-screen 2D fluid visualization.
- Mouse drag injects force (stir interaction).
- Minimal HUD (`FPS`, resolution, iteration count, etc.).
- Clear fallback message for non-WebGPU environments.

## Acceptance Criteria
- Fluid is visible at startup (no black screen).
- Left-drag changes fluid behavior.
- HUD provides minimum runtime visibility.
- `README` includes run steps, browser support notes, and license.

## Implementation Order (Fixed)
1. WebGPU initialization (`adapter` / `device` / `canvas context`).
2. Minimal render pass (fullscreen quad).
3. Fluid data layout (velocity + dye/density).
4. Mouse input to external force injection.
5. One simulation update step (simplified first), then stabilize.

## Simulation Policy (Stability First)
- Start with 2D and prioritize "looks fluid enough."
- First priority is numerical stability (avoid blow-up/divergence).
- Candidate methods:
  - Semi-Lagrangian advection (velocity + dye).
  - Simple diffusion/viscosity.
  - Pressure projection if feasible.
- Performance targets:
  - Ideal: 60 FPS, acceptable first target: 30 FPS.
  - Keep simulation grid resolution separate from screen resolution (example: `256^2`).
  - Expose viscosity/force/dye amount as UI parameters.

## Using Logic from Previous Unity Project (Extraction Strategy)
- Prefer a **new repository boundary** to avoid dependency/history mix.
- Bring only:
  - Math/algorithm core (fluid step logic).
  - Parameter design.
- Separate Unity-dependent parts (`MonoBehaviour`, wrappers, Unity rendering path).
- Do not include image/audio assets until rights are clear (`CC0`-safe assets only).

## Prompting Rules for AI Implementation
- Provide instructions as: `spec -> acceptance criteria -> implementation order`.
- If AI chooses algorithm/method, require explicit selection rationale.
- Expected outputs:
  - Structure plan (`src/`, `shaders/`, `public/`).
  - Required file set.
  - Minimum-operational README content.

## Non-Goals (Early Stage)
- Complex 3D fluid.
- Large-scale rendering optimization before baseline completion.
- Parallel support for Unity/Web/Native at the same time.

## Notes
WebGPU support varies by environment. Add fallback guidance in `README`, and include a link to WebGPU support status information.
