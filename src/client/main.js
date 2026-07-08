(function () {
  function evalScript(script, cb) {
    if (window.__adobe_cep__ && window.__adobe_cep__.evalScript) {
      window.__adobe_cep__.evalScript(script, cb || function () {});
    } else {
      console.warn("CEP not available");
      if (cb) cb("error");
    }
  }

  var dot        = document.getElementById("dot");
  var statusText = document.getElementById("statusText");
  var stats      = document.getElementById("stats");
  var toggleBtn  = document.getElementById("toggleBtn");

  var isRunning = false;

  function setRunning(running) {
    isRunning = running;
    dot.className = "dot " + (running ? "running" : "stopped");
    statusText.className = "status-text " + (running ? "running" : "stopped");
    statusText.textContent = running ? "RUNNING" : "STOPPED";
    toggleBtn.className = "btn " + (running ? "stop" : "start");
    toggleBtn.textContent = running ? "Stop Watcher" : "Start Watcher";
  }

  function setConnecting() {
    dot.className = "dot connecting";
    statusText.className = "status-text";
    statusText.textContent = "Connecting…";
    toggleBtn.className = "btn";
    toggleBtn.textContent = "—";
  }

  function updateStats(data) {
    if (data && typeof data.cmdCount !== "undefined") {
      stats.innerHTML =
        "Commands processed: <span>" + data.cmdCount + "</span><br>" +
        "Last command: <span>" + (data.lastCmd || "—") + "</span>" +
        (data.restartCount ? "<br>Auto-restarts: <span>" + data.restartCount + "</span>" : "");
    }
  }

  // AE_MCP_ensure() is self-healing: it starts the watcher if it isn't
  // running (unless the user pressed Stop) and restarts it if it went stale.
  function tick() {
    evalScript("AE_MCP_ensure()", function (result) {
      try {
        var data = JSON.parse(result);
        setRunning(data.running);
        updateStats(data);
      } catch (e) {
        // ExtendScript not ready yet — keep connecting state
        setConnecting();
      }
    });
  }

  window.toggleWatcher = function () {
    evalScript(isRunning ? "AE_MCP_stop()" : "AE_MCP_start()", function () { tick(); });
  };

  tick();
  setInterval(tick, 1000);
})();
