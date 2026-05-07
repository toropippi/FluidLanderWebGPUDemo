export const CO = {
  WX: 192,
  WY: 144,
  TEXSCALE: 8,
  SPEED: 1.0,
  PRESSURER: 0.0015,
  DT: 1.0,
  ALPHA: 1.79,
  CFDFRAME_PAR_GAMEFRAME: 12,
  UFORADSPD: 0.053,
  CIRCLELEN: 49.0,
  GOALWAIT: 60,
  STARTLEFT: 6,
  PARTICLECOLOR_NOZ1: 255 + 22 * 256 + 5 * 65536,
};

export const DIFFICULTY = {
  easy: 0,
  normal: 1,
  hard: 2,
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function wrap(value, size) {
  return (value + size) % size;
}

export function idx(x, y) {
  return x + y * CO.WX;
}
