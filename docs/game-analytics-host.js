/* The hub alone owns game selection, consent, identity and session IDs. */
(() => {
  const stats = window.HubStats;
  if (!stats || !window.HubPlayer) return;
  let bound = null, loaded = false, session = null, context = null, ready = false;
  let windowStart = 0, messages = 0;
  let seen = new Set(), matches = new Set(), finished = new Set();
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  function validDocument() {
    if (!bound || window.HubPlayer.current() !== bound || window.HubGames.selected(bound.frame)?.id !== bound.game.id) return false;
    // Public hub and trusted games share an origin. Inspect the loaded URL,
    // including the launch nonce; an old document or redirect is not sufficient.
    try {
      const actual = new URL(bound.frame.contentWindow.location.href), expected = new URL(bound.url);
      return actual.origin === expected.origin && actual.pathname === expected.pathname && actual.searchParams.get('launch') === bound.id;
    } catch { return false; }
  }
  function config() {
    if (!loaded || !validDocument()) return;
    bound.frame.contentWindow.postMessage({ type: 'lpa:config', protocol: 1, enabled: !!session, session }, new URL(bound.game.url).origin);
  }
  function stop() {
    if (session && context === stats.context() && stats.enabled()) {
      for (const match of matches) if (!finished.has(match)) {
        finished.add(match);
        stats.gameEvent(bound.game.id, session, 'match_end', { match, outcome: 'abandon', score: 0 });
      }
      stats.gameEvent(bound.game.id, session, 'session_end', {});
    }
    session = null; ready = false; config();
  }
  function sync() {
    if (session && (context !== stats.context() || !stats.enabled() || !validDocument())) stop();
    if (!session && loaded && validDocument() && stats.enabled()) {
      session = crypto.randomUUID(); context = stats.context(); ready = false;
      seen = new Set(); matches = new Set(); finished = new Set();
      messages = 0; windowStart = performance.now();
      stats.gameEvent(bound.game.id, session, 'session_start', {});
    }
    config();
  }
  function bind() {
    const next = window.HubPlayer.current();
    if (next === bound) return;
    stop(); bound = next; loaded = false;
    if (!bound) return;
    const current = bound;
    current.frame.addEventListener('load', () => {
      if (bound !== current) return;
      stop(); loaded = validDocument(); sync();
    });
    // Playback can start before the optional auth SDK finishes loading.
    try { if (current.frame.contentDocument?.readyState === 'complete' && validDocument()) { loaded = true; sync(); } } catch { /* Not the trusted document yet. */ }
  }
  window.addEventListener('hub:playerclosing', () => { stop(); bound = null; loaded = false; });
  window.addEventListener('hub:playerchange', bind);
  stats.subscribe(sync);
  window.addEventListener('pagehide', stop);
  window.addEventListener('message', event => {
    if (!loaded || !validDocument() || event.source !== bound.frame.contentWindow || event.origin !== new URL(bound.game.url).origin) return;
    const data = event.data;
    if (data?.type === 'lpa:hello' && data.protocol === 1) { sync(); return; }
    if (!session || context !== stats.context() || !stats.enabled() || data?.type !== 'lpa:event' || data.protocol !== 1 || data.session !== session || !uuid(data.id) || seen.has(data.id)) return;
    if (!['ready','active_time','match_start','match_end','tutorial','progress','achievement','error','custom'].includes(data.name)) return;
    if (!data.data || typeof data.data !== 'object' || Array.isArray(data.data) || JSON.stringify(data.data).length > 512) return;
    const now = performance.now();
    if (now - windowStart > 60000) { windowStart = now; messages = 0; }
    if (++messages > 120 || seen.size >= 4000) return;
    let payload = data.data;
    if (data.name === 'ready') {
      if (ready) return;
      ready = true; payload = { load_ms: Math.min(600000, Math.max(0, Math.round(now - bound.started))) };
      stats.track('game_ready', bound.game.id);
    }
    if (data.name === 'active_time' && (document.hidden || !ready || !Number.isInteger(payload.seconds) || payload.seconds < 1 || payload.seconds > 30)) return;
    if (data.name === 'match_start') {
      if (!uuid(payload.match) || matches.has(payload.match)) return;
      matches.add(payload.match);
    }
    if (data.name === 'match_end') {
      if (!matches.has(payload.match) || finished.has(payload.match) || !['win','loss','draw','abandon'].includes(payload.outcome) || !Number.isFinite(payload.score) || Math.abs(payload.score) > 1000000) return;
      finished.add(payload.match);
    }
    if (data.name === 'custom' && bound.game.id === 'clutter-cup') return;
    seen.add(data.id);
    stats.gameEvent(bound.game.id, session, data.name, payload, data.id);
  });
  bind();
})();
