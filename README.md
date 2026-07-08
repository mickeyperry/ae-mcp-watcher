# AE MCP Watcher

A tiny After Effects CEP extension that lets an [MCP](https://modelcontextprotocol.io) server (or any local tool) drive After Effects with ExtendScript — no sockets, no network, just three files in a temp folder.

```
MCP server (Node)                      After Effects (CEP extension)
─────────────────                      ─────────────────────────────
bridge.js runScript(jsx)
  ├─ writes  %TEMP%\ae-mcp\run.jsx
  ├─ writes  %TEMP%\ae-mcp\run.trigger ──▶ watcher polls every 500ms,
  │                                        sees trigger, evals run.jsx
  └─ waits for result.json  ◀───────────── writes result.json (atomic)
```

## Why it doesn't lose connection

- **Auto-start service** — an invisible second extension (`com.ae-mcp.watcher.service`) starts with After Effects, so the watcher runs even if you never open the panel.
- **Self-healing** — both the panel and the service call `AE_MCP_ensure()` on a timer; if the scheduled poll task went quiet (modal dialog, engine hiccup), it restarts automatically. Watcher state lives on `$.global`, so it survives the panel being closed and reopened.
- **Heartbeat** — the watcher touches `heartbeat.json` every ~4s. The bridge uses it to tell you *why* a call failed ("AE not running" vs "watcher stale") instead of a blind timeout.
- **Fast-fail + auto-revive** — if the trigger isn't consumed within 3s, the bridge injects `revive.jsx` into the running AE instance via `AfterFX.exe -r` and retries, instead of hanging for 30s.
- **Atomic results** — results are written to a temp file and renamed, so the reader never sees a half-written JSON.
- **Serialized calls** — `runScript()` queues concurrent calls; the single-file protocol can't be interleaved.

## Install

**ZXP (recommended):** grab `dist/ae-mcp-watcher-*.zxp` (or the latest [release](../../releases)) and install with [aescripts ZXP Installer](https://aescripts.com/learn/zxp-installer/) or Adobe's `UPIA`/`ExManCmd`.

**Dev mode:** copy `src/` to `%APPDATA%\Adobe\CEP\extensions\com.ae-mcp.watcher\` and enable PlayerDebugMode:

```powershell
Set-ItemProperty "HKCU:\SOFTWARE\Adobe\CSXS.11" PlayerDebugMode 1
```

Restart After Effects. The watcher starts on its own; the status panel is under **Window → Extensions → AE MCP**.

## Use from Node

`bridge/bridge.js` is the reference client:

```js
import { runScript } from './bridge.js';
const projectName = await runScript('return app.project.file ? app.project.file.name : "unsaved";');
```

Point your MCP server's tools at `runScript()` and you're done. Keep `revive.jsx` next to `bridge.js` — it's what auto-revive injects.

## Security notes

- **No network access.** The extension opens no ports and makes no requests. Transport is files in `%TEMP%\ae-mcp\`, readable/writable only with your user account's permissions.
- **No secrets.** There are no keys, tokens, or account identifiers anywhere in this repo.
- **Trust model:** the watcher executes any ExtendScript dropped into `%TEMP%\ae-mcp\run.jsx`. Anything that can write to your temp folder already runs code as you, so this adds no new privilege — but be aware the panel is, by design, a local code-execution endpoint for tools you run.

## Build the ZXP

```powershell
./build.ps1            # downloads ZXPSignCmd if needed, self-signs, outputs dist/
```

The self-signed certificate (`cert/`) is generated on first build and is **not** committed.

## License

MIT
