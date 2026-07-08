// AE MCP Watcher â€” ExtendScript host
// File-based bridge: an MCP server writes %TEMP%/ae-mcp/run.jsx + run.trigger;
// this watcher evals the script and writes result.json back.
// Loaded by both the visible panel and the invisible auto-start service â€”
// state lives on $.global so a second load never resets a running watcher.

if (typeof $.global.__AE_MCP__ === "undefined") {
    $.global.__AE_MCP__ = {
        running: false,
        taskId: null,
        cmdCount: 0,
        restartCount: 0,
        lastCmd: "â€”",
        lastTick: 0,
        hbCountdown: 0,
        userStopped: false
    };
}

var __AE_MCP_DIR     = Folder.temp.fsName + "/ae-mcp";
var __AE_MCP_TRIGGER = __AE_MCP_DIR + "/run.trigger";
var __AE_MCP_SCRIPT  = __AE_MCP_DIR + "/run.jsx";
var __AE_MCP_RESULT  = __AE_MCP_DIR + "/result.json";
var __AE_MCP_HEART   = __AE_MCP_DIR + "/heartbeat.json";

function __AE_MCP_ensureDir() {
    var d = new Folder(__AE_MCP_DIR);
    if (!d.exists) d.create();
}

function __AE_MCP_writeFile(path, text) {
    try {
        var f = new File(path);
        f.encoding = "UTF-8";
        f.open("w");
        f.write(text);
        f.close();
        return true;
    } catch (e) { return false; }
}

function __AE_MCP_heartbeat() {
    var S = $.global.__AE_MCP__;
    __AE_MCP_writeFile(__AE_MCP_HEART,
        '{"ts":' + new Date().getTime() + ',"cmdCount":' + S.cmdCount + '}');
}

function __AE_MCP_poll() {
    var S = $.global.__AE_MCP__;
    if (!S.running) return;
    S.lastTick = new Date().getTime();

    // refresh heartbeat every ~4s so the MCP server can tell we're alive
    if (--S.hbCountdown <= 0) {
        S.hbCountdown = 8;
        __AE_MCP_heartbeat();
    }

    var trigger = new File(__AE_MCP_TRIGGER);
    if (!trigger.exists) return;
    trigger.remove();
    S.cmdCount++;

    var out = { ok: false, value: null, error: null };
    try {
        var sf = new File(__AE_MCP_SCRIPT);
        if (!sf.exists) {
            out.error = "run.jsx not found";
        } else {
            sf.encoding = "UTF-8";
            sf.open("r");
            var code = sf.read();
            sf.close();
            S.lastCmd = new Date().toLocaleTimeString();
            var ret = eval("(function(){\n" + code + "\n})()");
            out.ok = true;
            if (ret !== undefined) {
                try { out.value = JSON.stringify(ret); }
                catch (e1) { out.value = String(ret); }
            }
        }
    } catch (e2) {
        out.error = e2.toString() + (e2.line ? " (line " + e2.line + ")" : "");
    }

    // write to a tmp file then rename, so the reader never sees a half-written result
    try {
        var payload = JSON.stringify(out);
        var old = new File(__AE_MCP_RESULT);
        if (old.exists) old.remove();
        if (__AE_MCP_writeFile(__AE_MCP_RESULT + ".tmp", payload)) {
            var tf = new File(__AE_MCP_RESULT + ".tmp");
            if (!tf.rename("result.json")) {
                __AE_MCP_writeFile(__AE_MCP_RESULT, payload);
            }
        }
    } catch (e3) {}
}

function AE_MCP_start() {
    var S = $.global.__AE_MCP__;
    S.userStopped = false;
    if (S.running && S.taskId !== null) return AE_MCP_getStatus();
    __AE_MCP_ensureDir();
    var t = new File(__AE_MCP_TRIGGER);
    if (t.exists) t.remove();
    S.running = true;
    S.hbCountdown = 0;
    S.lastTick = new Date().getTime();
    S.taskId = app.scheduleTask("__AE_MCP_poll()", 500, true);
    __AE_MCP_heartbeat();
    return AE_MCP_getStatus();
}

function AE_MCP_stop() {
    var S = $.global.__AE_MCP__;
    S.running = false;
    S.userStopped = true;
    if (S.taskId !== null) {
        try { app.cancelTask(S.taskId); } catch (e) {}
        S.taskId = null;
    }
    // remove the heartbeat so the MCP server reports "stopped", not "stale"
    try { var h = new File(__AE_MCP_HEART); if (h.exists) h.remove(); } catch (e2) {}
    return AE_MCP_getStatus();
}

function AE_MCP_restart() {
    var S = $.global.__AE_MCP__;
    if (S.taskId !== null) {
        try { app.cancelTask(S.taskId); } catch (e) {}
        S.taskId = null;
    }
    S.running = false;
    S.restartCount++;
    return AE_MCP_start();
}

// Self-healing entry point: the panel and the background service call this
// on a timer. Starts the watcher unless the user explicitly stopped it, and
// restarts it if the scheduled task went quiet (modal dialog, engine reset).
function AE_MCP_ensure() {
    var S = $.global.__AE_MCP__;
    if (S.userStopped) return AE_MCP_getStatus();
    if (!S.running || S.taskId === null) return AE_MCP_start();
    if (new Date().getTime() - S.lastTick > 5000) return AE_MCP_restart();
    return AE_MCP_getStatus();
}

function AE_MCP_getStatus() {
    var S = $.global.__AE_MCP__;
    return JSON.stringify({
        running: S.running,
        userStopped: S.userStopped,
        cmdCount: S.cmdCount,
        restartCount: S.restartCount,
        lastCmd: S.lastCmd,
        staleMs: S.running ? (new Date().getTime() - S.lastTick) : -1
    });
}

// Auto-generated revive entry: injected into a running AE via `AfterFX.exe -r revive.jsx`
// to restart the watcher without reopening the panel. Do not edit - regenerate from watcher.jsx.
// Uses start (not ensure): revive only fires when a command was actually issued,
// so it deliberately overrides a manual Stop.
AE_MCP_start();
