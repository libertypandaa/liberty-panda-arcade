(() => {
  let pending = false, reloading = false;
  const active = () => document.querySelector('#game-overlay')?.hidden === false;
  const workers = new Set();
  function activate(worker) {
    if (active()) { workers.add(worker); return; }
    worker?.postMessage({ type: 'SKIP_WAITING' });
  }
  function requestReload() {
    if (active()) { pending = true; return; }
    if (reloading) return;
    reloading = true; window.location.reload();
  }
  window.addEventListener('hub:playerchange', () => {
    if (active()) return;
    for (const worker of workers) activate(worker);
    workers.clear();
    if (pending) { pending = false; requestReload(); }
  });
  window.HubUpdates = Object.freeze({ requestReload, activate });
})();
