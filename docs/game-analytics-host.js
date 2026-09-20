/* The hub owns consent, identity, session IDs, and database access. */
(() => {
  const stats = window.HubStats;
  const frame = document.querySelector('#game-frame');
  const overlay = document.querySelector('#game-overlay');
  if (!stats || !frame || !overlay) return;
  const origin = 'https://libertypandaa.github.io';
  const game = 'crystal-front-demo';
  let session = null, context = null, started = 0, ready = false;
  let windowStart = 0, messages = 0;
  function config() {
    frame.contentWindow?.postMessage({ type: 'lpa:config', protocol: 1,
      enabled: !!session, session }, origin);
  }
  function sync() {
    const next = stats.context();
    if (session && (overlay.hidden || next !== context || !stats.enabled())) {
      if (next === context && stats.enabled()) stats.gameEvent(session, 'session_end', {});
      session = null; ready = false; config();
    }
    if (!overlay.hidden && !session && stats.enabled()) {
      session = crypto.randomUUID(); context = next; started = performance.now();
      stats.gameEvent(session, 'session_start', {}); config();
    }
  }
  stats.subscribe(sync);
  new MutationObserver(sync).observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
  frame.addEventListener('load', config);
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== origin || overlay.hidden) return;
    const data = event.data;
    if (data?.type === 'lpa:hello' && data.protocol === 1) { sync(); config(); return; }
    if (!session || !stats.enabled() || data?.type !== 'lpa:event' || data.protocol !== 1 || data.session !== session) return;
    if (typeof data.id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data.id)) return;
    if (!['ready','active_time','match_start','match_end','tutorial','progress','achievement','error','custom'].includes(data.name)) return;
    if (!data.data || typeof data.data !== 'object' || Array.isArray(data.data) || JSON.stringify(data.data).length > 512) return;
    const now = performance.now();
    if (now - windowStart > 60000) { windowStart = now; messages = 0; }
    if (++messages > 120) return;
    let payload = data.data;
    if (data.name === 'ready') {
      if (ready) return;
      ready = true;
      payload = { load_ms: Math.min(600000, Math.round(now - started)) };
      stats.track('game_ready', game);
    }
    if (data.name === 'active_time' && (document.hidden || !ready)) return;
    stats.gameEvent(session, data.name, payload, data.id);
  });
  sync();
})();
