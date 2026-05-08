import { mkdir, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const ROOT = resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SERVER_URL = process.env.CIP3D_URL || "http://127.0.0.1:8098/webgpu-3d-cip/";
const CDP_PORT = Number(process.env.CDP_PORT || 9350);
const REPEAT = Number(process.env.ABC_REPEAT || 3);
const LONG_RUNS = Number(process.env.ABC_LONG_RUNS || 1);
const SHORT_RUNS = Number(process.env.ABC_SHORT_RUNS || 5);
const LONG_FRAMES = Number(process.env.ABC_LONG_FRAMES || 15000);
const SHORT_FRAMES = Number(process.env.ABC_SHORT_FRAMES || 3000);
const SAMPLE_EVERY = Number(process.env.ABC_SAMPLE_EVERY || 1000);
const MAX_FRAMES_PER_SUBMIT = 64;
const BATCH = Math.min(MAX_FRAMES_PER_SUBMIT, Number(process.env.ABC_BATCH || MAX_FRAMES_PER_SUBMIT));
const FAST = process.env.ABC_FAST !== "0";
const FRAMES_PER_SUBMIT = Math.min(MAX_FRAMES_PER_SUBMIT, Number(process.env.ABC_FRAMES_PER_SUBMIT || BATCH));
const WARMUP_FRAMES_PER_SUBMIT = Math.min(MAX_FRAMES_PER_SUBMIT, Number(process.env.ABC_WARMUP_FRAMES_PER_SUBMIT || 2));
const PRESSURE = Number(process.env.ABC_PRESSURE || 16);
const MAX_ENERGY = Number(process.env.ABC_MAX_ENERGY || 10000);
const MAX_SPEED = Number(process.env.ABC_MAX_SPEED || 5);
const MAX_DIV = Number(process.env.ABC_MAX_DIV || 5);
const RUN_TIMEOUT_MS = Number(process.env.ABC_RUN_TIMEOUT_MS || 480000);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function cdpJson(path, init) {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`, init);
  if (!res.ok) {
    throw new Error(`${path} ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

async function waitForCdp() {
  for (let i = 0; i < 100; i += 1) {
    try {
      await cdpJson("/json/version");
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("CDP did not start");
}

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(SERVER_URL, { cache: "no-store" });
      if (res.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Server is not reachable: ${SERVER_URL}`);
}

class CdpTab {
  constructor(target, ws) {
    this.target = target;
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
    });
  }

  async eval(expression, timeoutMs = 30000) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeoutMs,
    });
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  }

  async close() {
    try {
      this.ws.close();
    } catch {}
    await cdpJson(`/json/close/${this.target.id}`).catch(() => null);
  }
}

async function openTab(url) {
  const target = await cdpJson(`/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    ws.onopen = resolveOpen;
    ws.onerror = rejectOpen;
  });
  const tab = new CdpTab(target, ws);
  await tab.send("Runtime.enable");
  await tab.send("Page.enable");
  return tab;
}

async function waitForApi(tab) {
  const ready = await tab.eval(`new Promise((resolve) => {
    const start = performance.now();
    function check() {
      const status = document.querySelector("#status")?.textContent || "";
      if (window.__cip3d && document.querySelector("#status")?.classList.contains("hidden")) {
        window.__cip3d.setRunning(false);
        resolve({ ok: true, status, state: window.__cip3d.getState() });
      } else if (performance.now() - start > 30000) {
        resolve({ ok: false, status });
      } else {
        setTimeout(check, 250);
      }
    }
    check();
  })`, 35000);
  if (!ready.ok) {
    throw new Error(`Page not ready: ${ready.status}`);
  }
  return ready.state;
}

async function runOne(tab, spec) {
  return await tab.eval(`(async () => {
    window.__cip3d.setRunning(false);
    window.__cip3d.reset();
    window.__cip3d.setRunning(false);
    return await window.__cip3d.runUntil({
      frame: ${spec.frames},
      pressure: ${PRESSURE},
      batch: ${BATCH},
      fast: ${FAST ? "true" : "false"},
      framesPerSubmit: ${FRAMES_PER_SUBMIT},
      warmupFramesPerSubmit: ${WARMUP_FRAMES_PER_SUBMIT},
      sampleEvery: ${SAMPLE_EVERY},
      maxEnergy: ${MAX_ENERGY},
      maxSpeed: ${MAX_SPEED},
      maxDiv: ${MAX_DIV},
      timeoutMs: ${RUN_TIMEOUT_MS}
    });
  })()`, RUN_TIMEOUT_MS + 60000);
}

function lineWriter(path) {
  const stream = createWriteStream(path, { flags: "a", encoding: "utf8" });
  return {
    path,
    write(row) {
      stream.write(`${JSON.stringify(row)}\n`);
    },
    close() {
      return new Promise((resolveClose) => stream.end(resolveClose));
    },
  };
}

function makeCombos() {
  const combos = [];
  for (const degenerate of ["old", "repair"]) {
    for (const rhsClamp of [false, true]) {
      for (const limit of [1.0, 0.85, 0.5]) {
        combos.push({ degenerate, rhsClamp, limit });
      }
    }
  }
  return combos;
}

async function main() {
  await waitForServer();
  const logDir = resolve(ROOT, "webgpu-3d-cip", "logs");
  await mkdir(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const log = lineWriter(resolve(logDir, `abc-matrix-${stamp}.jsonl`));
  const summaryPath = resolve(logDir, `abc-matrix-${stamp}-summary.json`);
  const profile = join(tmpdir(), `codex-cip3d-chrome-${stamp}`);
  await mkdir(profile, { recursive: true });

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-unsafe-webgpu",
    "--enable-features=UnsafeWebGPU,WebGPUDeveloperFeatures",
    "--ignore-gpu-blocklist",
    "--disable-gpu-sandbox",
    "--disable-frame-rate-limit",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--window-position=-32000,-32000",
    "--window-size=640,480",
    "about:blank",
  ], { stdio: "ignore" });

  const totals = {
    combos: 0,
    runs: 0,
    pass: 0,
    fail: 0,
  };
  const summaries = [];
  const startedAt = Date.now();

  try {
    await waitForCdp();
    for (const combo of makeCombos()) {
      totals.combos += 1;
      const comboKey = `deg=${combo.degenerate} rhs=${combo.rhsClamp ? "both" : "cipOnly"} limit=${combo.limit}`;
      const url = `${SERVER_URL}?v=${encodeURIComponent(`${stamp}-${comboKey}`)}&diag=0&rhsClamp=${combo.rhsClamp ? "1" : "0"}&limit=${combo.limit}&degenerate=${combo.degenerate}`;
      const tab = await openTab(url);
      const comboSummary = {
        combo,
        comboKey,
        runs: [],
        pass: true,
        firstFailure: null,
      };
      summaries.push(comboSummary);
      try {
        const state = await waitForApi(tab);
        log.write({ type: "combo_start", at: new Date().toISOString(), combo, state });
        console.log(`[combo] ${comboKey}`);
        for (let rep = 1; rep <= REPEAT; rep += 1) {
          const specs = [];
          for (let i = 1; i <= SHORT_RUNS; i += 1) {
            specs.push({ kind: "short", index: i, frames: SHORT_FRAMES });
          }
          for (let i = 1; i <= LONG_RUNS; i += 1) {
            specs.push({ kind: "long", index: i, frames: LONG_FRAMES });
          }
          for (const spec of specs) {
            totals.runs += 1;
            const runStartedAt = Date.now();
            console.log(`[run-start] ${comboKey} rep=${rep} ${spec.kind}${spec.index} frames=${spec.frames}`);
            const result = await runOne(tab, spec);
            const pass = result.stoppedBy === "target";
            if (pass) totals.pass += 1;
            else totals.fail += 1;
            const row = {
              type: "run",
              at: new Date().toISOString(),
              combo,
              rep,
              spec,
              pass,
              elapsedMs: Date.now() - runStartedAt,
              result,
            };
            comboSummary.runs.push(row);
            if (!pass && !comboSummary.firstFailure) {
              comboSummary.pass = false;
              comboSummary.firstFailure = row;
            }
            log.write(row);
            console.log(`[run-end] ${comboKey} rep=${rep} ${spec.kind}${spec.index} pass=${pass} stoppedBy=${result.stoppedBy} frame=${result.state.frame} energy=${result.last?.energy} maxSpeed=${result.last?.maxSpeed} div=${result.last?.divRms}`);
          }
        }
        log.write({ type: "combo_end", at: new Date().toISOString(), combo, pass: comboSummary.pass, firstFailure: comboSummary.firstFailure });
      } catch (error) {
        comboSummary.pass = false;
        comboSummary.firstFailure = { error: error.stack || String(error) };
        log.write({ type: "combo_error", at: new Date().toISOString(), combo, error: error.stack || String(error) });
        console.error(`[combo-error] ${comboKey}`, error);
      } finally {
        await tab.close();
      }
      await writeFile(summaryPath, JSON.stringify({ totals, summaries }, null, 2));
    }
  } finally {
    log.write({
      type: "done",
      at: new Date().toISOString(),
      totals,
      elapsedMs: Date.now() - startedAt,
      summaryPath,
    });
    await log.close();
    await writeFile(summaryPath, JSON.stringify({ totals, summaries }, null, 2));
    chrome.kill("SIGKILL");
    await sleep(500);
    await rm(profile, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ totals, logPath: log.path, summaryPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
