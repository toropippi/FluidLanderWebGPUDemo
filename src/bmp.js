export function decodeUnityBmp(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    throw new Error("Not a BMP file");
  }

  const width = view.getUint32(18, true);
  const height = view.getUint32(22, true);
  const bitsPerPixel = view.getUint16(28, true);
  if (bitsPerPixel !== 24) {
    throw new Error(`Unsupported BMP depth: ${bitsPerPixel}`);
  }

  const dataOffset = view.getUint32(10, true) || 54;
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const data = new Uint32Array(width * height);

  for (let srcY = 0; srcY < height; srcY += 1) {
    const dstY = height - srcY - 1;
    const row = dataOffset + srcY * rowStride;
    for (let x = 0; x < width; x += 1) {
      const p = row + x * 3;
      const b = bytes[p + 0];
      const g = bytes[p + 1];
      const r = bytes[p + 2];
      data[x + dstY * width] = b * 65536 + g * 256 + r;
    }
  }

  return { width, height, data };
}

export async function loadUnityBmp(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Failed to load BMP: ${path}`);
  }
  return decodeUnityBmp(await res.arrayBuffer());
}

export function redOfUnityColor(color) {
  return color & 255;
}

export function greenOfUnityColor(color) {
  return (color >>> 8) & 255;
}

export function blueOfUnityColor(color) {
  return (color >>> 16) & 255;
}
