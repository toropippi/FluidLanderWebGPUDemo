import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeUnityBmp } from "../src/bmp.js";
import { parseStageTextForTest } from "../src/stageData.js";
import { CO } from "../src/constants.js";

async function readText(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

async function readBinary(path) {
  const buffer = await readFile(new URL(path, import.meta.url));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

const data2 = parseStageTextForTest(await readText("../assets/resources/data2.txt"), "1-2");
assert.equal(data2.start.x, 19);
assert.equal(data2.start.y, 119);
assert.deepEqual(data2.goals.map((g) => [g.x, g.y]), [[158, 136]]);
assert.deepEqual(data2.rareEarths.map((r) => [r.x, r.y, r.superRare]), [
  [163, 23, false],
  [151, 72, false],
  [172, 103, false],
]);
assert.equal(data2.grav, 0.00043);
assert.equal(data2.jumpf, 0.0024);
assert.equal(data2.pullf, 0.0018);
assert.equal(data2.stageSpeed, 0.2);
assert.equal(data2.forceToUfoLimit, 0.8);

const data7 = parseStageTextForTest(await readText("../assets/resources/data7.txt"), "2-1");
assert.equal(data7.start.x, 15);
assert.equal(data7.start.y, 37);
assert.deepEqual(data7.goals.map((g) => [g.x, g.y]), [[175, 71]]);
assert.deepEqual(data7.rareEarths.map((r) => [r.x, r.y, r.superRare]), [[146, 122, false]]);
assert.equal(data7.grav, 0.00033);
assert.equal(data7.jumpf, 0.0012);
assert.equal(data7.pullf, 0.0008);
assert.equal(data7.stageSpeed, 1.0);
assert.equal(data7.forceToUfoLimit, 0.9);

const data18 = parseStageTextForTest(await readText("../assets/resources/data18.txt"), "5-2");
assert.equal(data18.start.x, 107);
assert.equal(data18.start.y, 111);
assert.deepEqual(data18.goals.map((g) => [g.x, g.y]), [[33, 26]]);
assert.deepEqual(data18.rareEarths.map((r) => [r.x, r.y, r.superRare]), [
  [22, 74, false],
  [150, 90, false],
  [173, 83, false],
  [137, 133, true],
]);
assert.deepEqual(data18.hearts.map((h) => [h.x, h.y]), [
  [63, 77],
  [36, 77],
  [147, 80],
  [179, 31],
]);
assert.deepEqual(data18.oneUps.map((o) => [o.x, o.y]), [[149, 18]]);
assert.deepEqual(data18.moveObjects.map((o) => [o.bmpId, o.x, o.y]), [
  [5, 56, 144],
  [6, 163, 90],
  [7, 31, 63],
]);

const data19 = parseStageTextForTest(await readText("../assets/resources/data19.txt"), "5-3");
assert.equal(data19.start.x, 13);
assert.equal(data19.start.y, 103);
assert.deepEqual(data19.goals.map((g) => [g.x, g.y]), [[182, 66]]);
assert.deepEqual(data19.rareEarths.map((r) => [r.x, r.y, r.superRare]), [
  [40, 93, false],
  [128, 93, false],
  [45, 22, false],
  [123, 55, false],
  [5, 116, true],
]);
assert.deepEqual(data19.oneUps.map((o) => [o.x, o.y]), [[10, 25]]);
assert.deepEqual(data19.moveObjects.map((o) => [o.bmpId, o.x, o.y]), [[8, 96, 74]]);
assert.equal(data19.moveObjectSpeedScale, 1);

const data19Modify = parseStageTextForTest(await readText("../assets/resources/data19.txt"), "5-3modify");
assert.equal(data19Modify.syntheticFluidStage, true);
assert.equal(data19Modify.start.x, 20);
assert.equal(data19Modify.start.y, 120);
assert.equal(data19Modify.moveObjectSpeedControl, true);
assert.equal(data19Modify.moveObjectSpeedScale, 0.5);
assert.deepEqual(data19Modify.goals, []);
assert.deepEqual(data19Modify.rareEarths, []);
assert.deepEqual(data19Modify.moveObjects.map((o) => [o.bmpId, o.x, o.y, o.syntheticShape.width, o.syntheticShape.height]), [[8, 96, 72, 30, 2]]);

for (const stage of ["2", "7", "18", "19"]) {
  for (const name of ["kabep", "kabex", "kabey", "kabew"]) {
    const bmp = decodeUnityBmp(await readBinary(`../assets/stage/${stage}/${name}.bmp`));
    assert.equal(bmp.width, CO.WX);
    assert.equal(bmp.height, CO.WY);
    assert.equal(bmp.data.length, CO.WX * CO.WY);
  }
}

const ufoColi = decodeUnityBmp(await readBinary("../assets/textures/ufo/ufocoli.bmp"));
assert.equal(ufoColi.width, 40);
assert.equal(ufoColi.height, 40);

for (const id of ["5", "6", "7", "8"]) {
  const objCfd = decodeUnityBmp(await readBinary(`../assets/textures/stageobjs/${id}cfdcoli.bmp`));
  assert.ok(objCfd.width > 0);
  assert.ok(objCfd.height > 0);
}

console.log("port tests passed");
