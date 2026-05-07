# FluidLander Browser Port

This repository is a static browser port of two early FluidLander stages:

- `C:\Users\5080\Documents\GitHub\FluidLander\FluidLander`
- Implemented stages:
  - `1-2` from Unity `Assets/Resources/data2.txt` and `Assets/stage/2`
  - `2-1` from Unity `Assets/Resources/data7.txt` and `Assets/stage/7`

## What Is Carried Over

- Unity stage text parsing for UFO start, goal, rare earth, gravity, thrust, flow coupling, and stage speed.
- Unity BMP decoding for `kabep.bmp`, `kabex.bmp`, `kabey.bmp`, and `kabew.bmp`.
- Unity texture assets for stage art, UFO, goal, and rare earth.
- UFO movement formulas from `Ufo.cs`: rotation, thrust, gravity, damping, `fastkey`, wall collision, HP, and restart.
- Goal and rare-earth logic from `GoalWhite.cs` and `RareEarth.cs`.
- A separated 192 x 144 fluid field structure modeled after `NS.compute` / `MenyBullets.cs`.

The current playable slice uses WebGPU compute by default for the separated Unity-style fluid buffers. CPU JavaScript remains only as a fast fallback when WebGPU is unavailable.

## Files

- `index.html`: single-page demo entrypoint
- `src/main.js`: browser game loop + HUD
- `src/stageData.js`: Unity stage data parser
- `src/bmp.js`: Unity-compatible BMP decoder
- `src/fluidGpu.js`: WebGPU separated 192 x 144 fluid buffers, wall/UFO mapping, pressure solve, and UFO pressure readback
- `src/fluid.js`: CPU fallback fluid path for non-WebGPU browsers
- `src/game.js`: UFO, rare earth, goal, HP, restart logic
- `src/render.js`: Canvas renderer using original assets
- `assets/`: copied Unity stage/resource/texture files needed for 1-2 and 2-1
- `tests/port.test.mjs`: parser and BMP regression tests

## Run Locally

Use a static file server, then open the local URL.

Example with Node:

```bash
npx serve .
```

Then open the displayed local URL.

Windows quick launch:

- Double-click `run_local_server.bat` in repository root.
- It starts a no-cache local server at `http://127.0.0.1:8097` and opens your browser automatically with a cache-busting URL.

## Controls

- Rotate left: `ArrowLeft` or `A`
- Rotate right: `ArrowRight` or `D`
- Thrust: `Space`, `Z`, `X`, or `Enter`
- Stage selector: choose `1-2` or `2-1`
- Quality selector: `Unity loop` is the default and keeps the 12 substeps / 32 pressure loops count. `Playable GPU` and `High GPU` remain available for weaker hardware.
- Restart button: reload current stage

## Tests

```bash
npm test
```
