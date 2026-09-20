/* Liberty Panda Arcade game telemetry, protocol v1. No credentials or storage. */
(() => {
  const hubOrigin = 'https://libertypandaa.github.io';
  let session = null, enabled = false, playing = false, loaded = false;
  let elapsed = 0, previous = performance.now(), sentReady = null;
  const code = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(value);
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  function send(name, data = {}) {
    if (!enabled || !session || window.parent === window) return false;
    window.parent.postMessage({ type: 'lpa:event', protocol: 1, session,
      id: crypto.randomUUID(), name, data }, hubOrigin);
    return true;
  }
  function ready() {
    loaded = true;
    if (enabled && session !== sentReady && send('ready')) sentReady = session;
  }
  function flush() {
    if (elapsed >= 1) send('active_time', { seconds: Math.min(30, Math.floor(elapsed)) });
    elapsed = 0;
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window.parent || event.origin !== hubOrigin || message?.type !== 'lpa:config' || message.protocol !== 1) return;
    if (message.enabled && !uuid(message.session)) return;
    if (session !== message.session || !message.enabled) { elapsed = 0; sentReady = null; }
    session = message.session; enabled = message.enabled === true;
    previous = performance.now();
    if (loaded) ready();
  });
  function hello() {
    if (window.parent !== window) window.parent.postMessage({ type: 'lpa:hello', protocol: 1 }, hubOrigin);
  }
  hello();
  setInterval(() => {
    const now = performance.now();
    if (enabled && playing && !document.hidden) elapsed += Math.min(1.5, (now - previous) / 1000);
    previous = now;
    if (elapsed >= 15) flush();
    if (!enabled) hello();
  }, 1000);
  document.addEventListener('visibilitychange', () => { flush(); previous = performance.now(); });
  window.addEventListener('pagehide', flush);
  window.LibertyPandaAnalytics = Object.freeze({
    ready,
    setPlaying(value) { flush(); playing = value === true; previous = performance.now(); },
    matchStart(mode = 'default') {
      const match = crypto.randomUUID();
      return code(mode) && send('match_start', { match, mode }) ? match : null;
    },
    matchEnd(match, outcome, score = 0) {
      if (!uuid(match) || !['win','loss','draw','abandon'].includes(outcome) || !Number.isFinite(score)) return false;
      return send('match_end', { match, outcome, score: Math.round(Math.max(-1000000, Math.min(1000000, score))) });
    },
    tutorial(step, state) {
      return code(step) && ['start','complete'].includes(state) && send('tutorial', { step, state });
    },
    progress(level, percent) {
      return code(level) && Number.isFinite(percent) && percent >= 0 && percent <= 100 && send('progress', { level, percent });
    },
    achievement(id) { return code(id) && send('achievement', { achievement: id }); },
    error(id) { return code(id) && send('error', { code: id }); },
    custom(name, value = 1) {
      return code(name) && Number.isFinite(value) && Math.abs(value) <= 1000000 && send('custom', { name, value });
    },
  });
})();
