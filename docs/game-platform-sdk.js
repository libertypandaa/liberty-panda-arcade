/* Copy this versioned SDK into the public game build. No account tokens enter the game. */
(() => {
  const origin = 'https://libertypandaa.github.io';
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  const launchId = new URL(location.href).searchParams.get('launch');
  const embedded = window.parent !== window && uuid(launchId);
  let configured = false, readyResolve, closeInProgress = false, exitAvailable = false, exitAcknowledged = false, closed=false, accountGameId=null;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const pending = new Map();
  const accountPending=new Map(),accountListeners=new Set();
  let accountGeneration=0,accountExpiryTimer=null;
  let account=Object.freeze({status:'unknown',reason:'not_confirmed',gameId:null,storageNamespace:null,expiresAt:null,epoch:-1,contextSessionId:null,generation:0});
  const post = data => { if (embedded&&!closed) window.parent.postMessage({...data, protocol:1, launchId}, origin); };
  function hello() { post({type:'lpa:player:hello', capabilities:{close:exitAvailable}}); }
  function invalidatePending(error) {
    for(const call of [...pending.values(),...accountPending.values()]){clearTimeout(call.timer);call.reject(new Error(error));}
    pending.clear();accountPending.clear();
  }
  function applyAccount(value) {
    const changed=value.epoch!==account.epoch||value.contextSessionId!==account.contextSessionId||value.status!==account.status||value.storageNamespace!==account.storageNamespace;
    if(changed){++accountGeneration;invalidatePending('ACCOUNT_CONTEXT_CHANGED');}
    account=Object.freeze({...value,generation:accountGeneration});clearTimeout(accountExpiryTimer);
    if(account.status==='ready')accountExpiryTimer=setTimeout(()=>{
      if(account.status==='ready'&&Date.now()>=account.expiresAt)applyAccount({...account,status:'expired',reason:'session_expired',storageNamespace:null,expiresAt:null});
    },Math.min(2147483647,Math.max(0,account.expiresAt-Date.now())));
    for(const listener of accountListeners){try{listener(account);}catch{/* Consumer callbacks cannot break the protocol. */}}
  }
  function validContext(value){
    return value&&['ready','absent','expired','changed','unknown'].includes(value.status)&&typeof value.reason==='string'&&typeof value.gameId==='string'&&Number.isSafeInteger(value.epoch)&&value.epoch>=0&&uuid(value.contextSessionId)&&
      (value.status==='ready'?(/^lpa:save:v1:[0-9a-f]{64}$/.test(value.storageNamespace)&&Number.isFinite(value.expiresAt)&&value.expiresAt>Date.now()):value.storageNamespace===null&&value.expiresAt===null);
  }
  function getAccountContext(){
    currentAccount();
    if(!configured)return Promise.resolve(account);
    if(accountPending.size>=4)return Promise.reject(new Error('TOO_MANY_REQUESTS'));
    const requestId=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{accountPending.delete(requestId);reject(new Error('REQUEST_TIMEOUT'));},15000);
      accountPending.set(requestId,{resolve,reject,timer});
      post({type:'lpa:account:request',contextVersion:1,requestId,epoch:account.epoch<0?null:account.epoch,contextSessionId:account.contextSessionId});
    });
  }
  function currentAccount(){
    if(account.status==='ready'&&Date.now()>=account.expiresAt)applyAccount({...account,status:'expired',reason:'session_expired',storageNamespace:null,expiresAt:null});
    return account;
  }
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
    if (closed || !embedded || event.source !== window.parent || event.origin !== origin) return;
    const data = event.data;
    if (!data || data.protocol !== 1 || data.launchId !== launchId) return;
    if(['lpa:account:response','lpa:account:changed'].includes(data.type)){
      if(data.contextVersion!==1||!validContext(data.context)||(accountGameId!==null&&data.context.gameId!==accountGameId)||data.context.epoch<account.epoch||(data.context.epoch===account.epoch&&account.contextSessionId&&data.context.contextSessionId!==account.contextSessionId))return;
      const call=data.type==='lpa:account:response'&&uuid(data.requestId)?accountPending.get(data.requestId):null;
      if(data.type==='lpa:account:response'&&!call)return;
      accountGameId=data.context.gameId;
      // Remove this response's request before invalidating other generations.
      if(call){clearTimeout(call.timer);accountPending.delete(data.requestId);}
      applyAccount(data.context);call?.resolve(account);return;
    }
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
    closed=true;configured=false;
    invalidatePending('PAGE_CLOSED');
    applyAccount({...account,status:'unknown',reason:'page_closed',storageNamespace:null,expiresAt:null});
  });
  const api = {
    version:'1.1.0',
    ready,
    getAccountContext,
    accountContext:currentAccount,
    onAccountContextChange(listener){if(typeof listener!=='function')throw new TypeError('Expected callback');accountListeners.add(listener);return()=>accountListeners.delete(listener);},
    isAccountContextCurrent(value){return !closed&&value?.status==='ready'&&account.status==='ready'&&Date.now()<account.expiresAt&&value.gameId===account.gameId&&value.generation===account.generation&&value.epoch===account.epoch&&value.contextSessionId===account.contextSessionId&&value.storageNamespace===account.storageNamespace;},
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
