// Invisible background service — loaded by CEP when AE starts (StartOn event).
// Its only job is to keep the ExtendScript watcher alive, so the MCP bridge
// works even if the user never opens the AE MCP panel.
(function () {
  function ping() {
    if (window.__adobe_cep__ && window.__adobe_cep__.evalScript) {
      window.__adobe_cep__.evalScript("AE_MCP_ensure()", function () {});
    }
  }
  ping();
  setInterval(ping, 5000);
})();
