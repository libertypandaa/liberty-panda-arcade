/* Copy this versioned SDK into the public game build. No account tokens enter the game. */
(() => {
  const origin = 'https://libertypandaa.github.io';
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  const launchId = new URL(location.href).searchParams.get('launch');
  const embedded = window.parent !== window && uuid(launchId);
  let configured = false, readyResolve, closeInProgress = false, exitAvailable = false, exitAcknowledged = false;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const pending = new Map();
  const post = data => { if (embedded) window.parent.postMessage({...data, protocol:1, launchId}, origin); };
  function hello() { post({type:'lpa:player:hello', capabilities:{close:exitAvailable}}); }
  function request(action, params = {}) {
    if (!configured) return Promise.reject(new Error('PLATFORM_UNAVAILABLE'));
    if (!['capabilities','wallet','catalog','inventory','purchase'].includes(action)) return Promise.reject(new Error('INVALID_ACTION'));
    if (pending.size >= 4) return Promise.reject(new Error('TOO_MANY_REQUESTS'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('REQUEST_TIMEOUT')); },15000);
      pending.set(requestId,{resolve,reject,timer});
      post({type:'lpa:economy:request',requestId,action,params});
    });
  }
  window.addEventListener('message', event => {
    if (!embedded || event.source !== window.parent || event.origin !== origin) return;
    const data = event.data;
    if (!data || data.protocol !== 1 || data.launchId !== launchId) return;
    if (data.type === 'lpa:player:config' && data.capabilities?.close === true) {
      configured = true; readyResolve(true);
      // The initial hello can precede iframe load. Acknowledge once after trust is established.
      if (exitAvailable && !exitAcknowledged) { exitAcknowledged = true; hello(); }
    } else if (data.type === 'lpa:economy:response' && uuid(data.requestId)) {
      const call = pending.get(data.requestId);
      if (!call) return;
      clearTimeout(call.timer); pending.delete(data.requestId);
      if (data.ok === true) call.resolve(data.result);
      else call.reject(new Error(typeof data.error === 'string' ? data.error.slice(0,80) : 'REQUEST_FAILED'));
    }
  });
  window.addEventListener('pagehide', () => {
    for (const call of pending.values()) {clearTimeout(call.timer);call.reject(new Error('PAGE_CLOSED'));}
    pending.clear();
  });
  const api = {
    ready,
    available: () => configured,
    // Call only after wiring a visible Exit button and safe local-save handler.
    enableExit() { exitAvailable = true; if (configured) exitAcknowledged = true; hello(); },
    async exit({save,stop,fallback} = {}) {
      if (closeInProgress) return false;
      closeInProgress = true;
      try {
        if (save) await save();
        if (stop) await stop();
        if (configured) post({type:'lpa:player:close',requestId:crypto.randomUUID()});
        else if (fallback) await fallback();
        return configured;
      } finally { closeInProgress = false; }
    },
    wallet: () => request('wallet'),
    capabilities: () => request('capabilities'),
    catalog: () => request('catalog'),
    inventory: () => request('inventory'),
    // Persist operationId before purchase. Reuse it after timeout; never retry with a new ID.
    purchase: (productId,operationId) => {
      if (!uuid(operationId) || typeof productId !== 'string' || !/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(productId)) return Promise.reject(new Error('INVALID_PURCHASE'));
      return request('purchase',{productId,operationId});
    },
  };
  window.LibertyPanda = Object.freeze(api);
  if (embedded) { hello(); for (const delay of [300,1000,3000]) setTimeout(() => {if (!configured) hello();},delay); }
  setTimeout(() => {if (!configured) readyResolve(false);},5000);
})();
