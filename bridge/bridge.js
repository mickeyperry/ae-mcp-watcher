import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { execFile, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const TEMP_DIR       = join(tmpdir(), 'ae-mcp');
const SCRIPT_FILE    = join(TEMP_DIR, 'run.jsx');
const RESULT_FILE    = join(TEMP_DIR, 'result.json');
const TRIGGER_FILE   = join(TEMP_DIR, 'run.trigger');
const HEARTBEAT_FILE = join(TEMP_DIR, 'heartbeat.json');
const REVIVE_JSX     = join(dirname(fileURLToPath(import.meta.url)), 'revive.jsx');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureTempDir() {
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });
}

function heartbeatAgeMs() {
  try { return Date.now() - statSync(HEARTBEAT_FILE).mtimeMs; }
  catch { return Infinity; }
}

function findAfterFX() {
  try {
    const root = 'C:\\Program Files\\Adobe';
    const versions = readdirSync(root)
      .filter((n) => /^Adobe After Effects/i.test(n))
      .sort()
      .reverse();
    for (const v of versions) {
      const exe = join(root, v, 'Support Files', 'AfterFX.exe');
      if (existsSync(exe)) return exe;
    }
  } catch {}
  return null;
}

function aeProcessRunning() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq AfterFX.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    return /AfterFX\.exe/i.test(out);
  } catch { return false; }
}

// Re-inject the watcher into a running AE instance. AfterFX.exe -r forwards
// the script to the already-open instance instead of launching a new one.
let _lastReviveAt = 0;
function tryRevive() {
  if (Date.now() - _lastReviveAt < 15000) return false; // cooldown
  if (!aeProcessRunning()) return false;
  const exe = findAfterFX();
  if (!exe || !existsSync(REVIVE_JSX)) return false;
  _lastReviveAt = Date.now();
  try {
    const child = execFile(exe, ['-r', REVIVE_JSX], { windowsHide: true }, () => {});
    child.on('error', () => {});
    return true;
  } catch { return false; }
}

// Wait until the watcher consumes the trigger (or a result already appeared).
async function waitTriggerConsumed(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(TRIGGER_FILE) || existsSync(RESULT_FILE)) return true;
    await sleep(100);
  }
  return false;
}

async function waitForResult(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(RESULT_FILE)) {
      await sleep(80); // grace period for the write to finish (pre-1.1 watchers)
      return readFileSync(RESULT_FILE, 'utf8');
    }
    await sleep(200);
  }
  return null;
}

/**
 * Execute a block of ExtendScript in After Effects via the watcher.
 * Calls are serialized: the protocol uses a single set of files, so
 * concurrent tool calls must not interleave.
 */
let _chain = Promise.resolve();
export function runScript(userScript, opts) {
  const run = () => _runScript(userScript, opts);
  const p = _chain.then(run, run);
  _chain = p.catch(() => {});
  return p;
}

async function _runScript(userScript, { timeoutMs = 90000 } = {}) {
  ensureTempDir();

  for (const f of [RESULT_FILE, TRIGGER_FILE]) {
    try { if (existsSync(f)) unlinkSync(f); } catch {}
  }

  writeFileSync(SCRIPT_FILE, userScript, 'utf8');
  writeFileSync(TRIGGER_FILE, '1', 'utf8');

  // Phase 1: the watcher polls every 500ms, so the trigger should vanish
  // almost immediately. If it doesn't, the watcher is down — try to revive
  // it inside the running AE instead of making the caller wait blind.
  let consumed = await waitTriggerConsumed(3000);
  if (!consumed && tryRevive()) {
    consumed = await waitTriggerConsumed(12000);
  }
  if (!consumed) {
    try { unlinkSync(TRIGGER_FILE); } catch {}
    const age = heartbeatAgeMs();
    const ageTxt = age === Infinity ? 'never seen' : `${Math.round(age / 1000)}s ago`;
    return aeProcessRunning()
      ? `⚠️  After Effects is running but the AE MCP watcher is not responding (heartbeat: ${ageTxt}). ` +
        `Auto-revive was attempted — retry this call once; if it still fails, open Window → Extensions → AE MCP in After Effects.`
      : `⚠️  After Effects does not appear to be running. Launch After Effects — the AE MCP watcher auto-starts with it.`;
  }

  // Phase 2: AE took the job — now just wait for the result.
  const raw = await waitForResult(timeoutMs);
  if (!raw) {
    return `⚠️  After Effects picked up the script but returned no result within ${Math.round(timeoutMs / 1000)}s. ` +
      `AE may be showing a modal dialog or running a long operation — check the AE window, then retry.`;
  }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return raw; }

  if (!parsed.ok) {
    return `ExtendScript error: ${parsed.error}`;
  }
  if (parsed.value !== null && parsed.value !== undefined) {
    try {
      const inner = JSON.parse(parsed.value);
      return JSON.stringify(inner, null, 2);
    } catch {
      return parsed.value;
    }
  }
  return 'Done (no return value).';
}
