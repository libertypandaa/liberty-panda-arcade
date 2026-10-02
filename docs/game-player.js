/* Each launch gets a fresh iframe: old WindowProxy messages cannot enter a new session. */
(() => {
  let launch = null, returnFocus = null, generation = 0, loaded = false;
  const overlay = document.querySelector('#game-overlay');
  if (!overlay) return;
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  const emit = name => window.dispatchEvent(new CustomEvent(name));
  function trusted(current = launch) {
    if (!current || current !== launch || !loaded) return false;
    try {
      const actual = new URL(current.frame.contentWindow.location.href), expected = new URL(current.url);
      return actual.origin === expected.origin && actual.pathname === expected.pathname && actual.searchParams.get('launch') === current.id;
    } catch { return false; }
  }
  function configure() {
    if (!trusted()) return;
    launch.frame.contentWindow.postMessage({type:'lpa:player:config',protocol:1,launchId:launch.id,capabilities:{close:true}},new URL(launch.game.url).origin);
  }
  function retire() {
    if (launch) emit('hub:playerclosing');
    launch = null; loaded = false;
    overlay.classList.remove('game-has-exit');
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
    const ticket = ++generation;
    if (!window.HubAccess || !await window.HubAccess.allowed(game.id) || ticket !== generation) return false;
    retire(); returnFocus = document.activeElement;
    const frame = document.querySelector('#game-frame'), launchId = crypto.randomUUID();
    const url = new URL(game.url); url.searchParams.set('launch', launchId);
    launch = Object.freeze({ game, frame, id: launchId, url: url.href, started: performance.now() });
    const current = launch;
    frame.addEventListener('load', () => {
      if (current !== launch) return;
      loaded = true;
      if (!trusted(current)) { loaded = false; overlay.classList.remove('game-has-exit'); return; }
      configure();
      emit('hub:playerready');
    });
    frame.dataset.gameId = game.id; frame.dataset.launchId = launchId; frame.title = game.title;
    overlay.hidden = false; overlay.setAttribute('aria-label', game.title + ' player');
    document.body.classList.add('game-open');
    emit('hub:playerchange');
    frame.src = url.href;
    document.querySelector('#close-game')?.focus();
    await fullscreen(); return current === launch;
  }
  async function close() {
    ++generation;
    retire(); overlay.hidden = true; document.body.classList.remove('game-open');
    emit('hub:playerchange');
    const focus = returnFocus;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    if (!launch) focus?.focus?.();
  }
  window.HubPlayer = Object.freeze({ open, close, fullscreen, current: () => launch, trusted });
  document.querySelector('#fullscreen-game')?.addEventListener('click', fullscreen);
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && launch) close(); });
  window.addEventListener('message', event => {
    if (!trusted() || event.source !== launch.frame.contentWindow || event.origin !== new URL(launch.game.url).origin) return;
    const data = event.data;
    if (!data || Array.isArray(data) || data.protocol !== 1 || !uuid(data.launchId) || data.launchId !== launch.id) return;
    if (data.type === 'lpa:player:hello') {
      configure();
      // Only approved releases with an actual Exit button may hide the fallback controls.
      if (launch.game.playerExit === true && data.capabilities?.close === true) overlay.classList.add('game-has-exit');
    } else if (data.type === 'lpa:player:close' && uuid(data.requestId)) {
      close();
    }
  });
})();
