import { CO } from "./constants.js";

export const UNITY_FLUID_QUALITY = {
  substeps: CO.CFDFRAME_PAR_GAMEFRAME,
  pressureLoops: 32,
  particleCount: 12000,
  gpuParticleCount: 24576,
  particleRespawnBase: 48,
};
