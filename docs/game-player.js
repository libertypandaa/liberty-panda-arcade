/* Each launch gets a fresh iframe: old WindowProxy messages cannot enter a new session. */
(() => {
  let launch = null, returnFocus = null;
  const overlay = document.querySelector('#game-overlay');
  if (!overlay) return;
  const emit = name => window.dispatchEvent(new CustomEvent(name));
  function retire() {
    if (launch) emit('hub:playerclosing');
    launch = null;
    const frame = document.querySelector('#game-frame');
    if (frame) {
      const blank = frame.cloneNode(false);
      for (const key of ['src','data-game-id','data-launch-id']) blank.removeAttribute(key);
      frame.replaceWith(blank);
    }
  }
  async function fullscreen() {
    if (!launch) return;
    try { await overlay.requestFullscreen(); } catch { /* Full viewport remains usable. */ }
  }
  async function open(id) {
    const game = window.HubGames.get(id);
    if (!game) return false;
    retire(); returnFocus = document.activeElement;
    const frame = document.querySelector('#game-frame'), launchId = crypto.randomUUID();
    const url = new URL(game.url); url.searchParams.set('launch', launchId);
    launch = Object.freeze({ game, frame, id: launchId, url: url.href, started: performance.now() });
    frame.dataset.gameId = game.id; frame.dataset.launchId = launchId; frame.title = game.title;
    overlay.hidden = false; overlay.setAttribute('aria-label', game.title + ' player');
    document.body.classList.add('game-open');
    emit('hub:playerchange');
    frame.src = url.href;
    document.querySelector('#close-game')?.focus();
    await fullscreen(); return true;
  }
  async function close() {
    retire(); overlay.hidden = true; document.body.classList.remove('game-open');
    emit('hub:playerchange');
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    returnFocus?.focus?.();
  }
  window.HubPlayer = Object.freeze({ open, close, fullscreen, current: () => launch });
  document.querySelector('#fullscreen-game')?.addEventListener('click', fullscreen);
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && launch) close(); });
})();
