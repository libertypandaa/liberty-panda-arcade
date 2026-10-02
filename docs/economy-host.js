/* The shell owns identity, RPC names, catalog prices and purchase confirmation. */
(() => {
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  const product = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(value);
  let bound = null, boundUser = null, calls = new Map(), busyPurchase = false, windowStart = 0, count = 0;
  const currentUser = () => window.HubAccount?.user()?.id || null;
  let identity = currentUser(), identityRevision = 0;
  function observeIdentity(next) {
    if (identity !== next) { identity = next; ++identityRevision; calls = new Map(); boundUser = next; }
  }
  function watchIdentity() {
    window.HubClient?.auth?.onAuthStateChange((_event,session) => observeIdentity(session?.user?.id || null));
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded',watchIdentity,{once:true});
  else watchIdentity();
  function errorCode(error) {
    const text = String(error?.message || '').toUpperCase();
    if (text.includes('AUTHENTICATION_REQUIRED')) return 'ACCOUNT_REQUIRED';
    for (const code of ['INSUFFICIENT_FUNDS','PRICE_CHANGED','PRICE_QUOTE_REQUIRED','PRODUCT_UNAVAILABLE','GAME_UNAVAILABLE','IDEMPOTENCY_CONFLICT','ACCOUNT_REQUIRED','ECONOMY_DISABLED','ACCOUNT_BLOCKED']) if (text.includes(code)) return code;
    return ['PGRST202','42883','42P01'].includes(error?.code) ? 'ECONOMY_UNAVAILABLE' : 'REQUEST_FAILED';
  }
  async function rpc(name, params) {
    if (!currentUser() || !window.HubClient) throw new Error('ACCOUNT_REQUIRED');
    const {data,error} = await window.HubClient.rpc(name, params);
    if (error) throw Object.assign(new Error(errorCode(error)),{code:error.code});
    return data;
  }
  const quoteKey = (actor, game, operation) => 'lpa:purchase-quote:v1:' + encodeURIComponent(actor) + ':' + game + ':' + operation;
  function readQuote(key, actor, game, params) {
    let raw;
    try { raw = localStorage.getItem(key); } catch { throw new Error('STORAGE_UNAVAILABLE'); }
    if (raw === null) return null;
    let quote;
    try { quote = JSON.parse(raw); } catch { throw new Error('INVALID_SAVED_QUOTE'); }
    if (!quote || quote.actor !== actor || quote.gameId !== game.id || quote.operationId !== params.operationId || quote.productId !== params.productId ||
        !Number.isSafeInteger(quote.price) || quote.price < 0 || !Number.isSafeInteger(quote.priceVersion) || quote.priceVersion < 1) throw new Error('INVALID_SAVED_QUOTE');
    return quote;
  }
  function storeQuote(key, quote) {
    try {
      const raw = JSON.stringify(quote); localStorage.setItem(key,raw);
      if (localStorage.getItem(key) !== raw) throw new Error('Write did not persist');
    } catch { throw new Error('STORAGE_UNAVAILABLE'); }
  }
  function clearQuote(key) { try { localStorage.removeItem(key); } catch { /* A retained confirmed quote is safe to recover again. */ } }
  async function run(action, game, params, valid) {
    if (action === 'capabilities') return rpc('lpa_capabilities', {});
    if (action === 'wallet') return rpc('lpa_wallet', {});
    if (action === 'catalog') return rpc('lpa_catalog', {p_game_id:game.id});
    if (action === 'inventory') return rpc('lpa_inventory', {p_game_id:game.id});
    if (busyPurchase) throw new Error('PURCHASE_BUSY');
    busyPurchase = true;
    try {
      const actor = currentUser(), key = quoteKey(actor,game.id,params.operationId);
      let quote = readQuote(key,actor,game,params);
      const prior = await rpc('lpa_purchase_status',{p_request_id:params.operationId});
      if (!valid()) throw new Error('SESSION_CHANGED');
      if (prior) {
        if (prior.gameId !== game.id || prior.productId !== params.productId || (quote && prior.priceVersion !== quote.priceVersion)) throw new Error('IDEMPOTENCY_CONFLICT');
        clearQuote(key);
        window.dispatchEvent(new CustomEvent('hub:walletchange'));
        return prior;
      }
      if (!quote) {
        const catalog = await rpc('lpa_catalog', {p_game_id:game.id});
        if (!valid()) throw new Error('SESSION_CHANGED');
        const item = Array.isArray(catalog) && catalog.find(row => row.id === params.productId);
        if (!item || !Number.isSafeInteger(item.price) || item.price < 0 || !Number.isSafeInteger(item.priceVersion) || item.priceVersion < 1) throw new Error('PRODUCT_UNAVAILABLE');
        if (!window.confirm(game.title + '\n' + item.title + '\nСтоимость: ' + item.price + ' игровой валюты.\nКупить?')) throw new Error('CANCELLED');
        if (!valid()) throw new Error('SESSION_CHANGED');
        quote = {actor,gameId:game.id,operationId:params.operationId,productId:params.productId,priceVersion:item.priceVersion,price:item.price};
        storeQuote(key,quote);
      }
      if (!valid()) throw new Error('SESSION_CHANGED');
      const receipt = await rpc('lpa_purchase',{p_game_id:game.id,p_product_id:params.productId,p_request_id:params.operationId,p_price_version:quote.priceVersion});
      if (valid()) { clearQuote(key); window.dispatchEvent(new CustomEvent('hub:walletchange')); }
      return receipt;
    } finally { busyPurchase = false; }
  }
  window.HubEconomy = Object.freeze({wallet:() => rpc('lpa_wallet',{}), catalog:gameId => rpc('lpa_catalog',{p_game_id:gameId})});
  window.addEventListener('message', event => {
    const launch = window.HubPlayer?.current();
    if (!launch || !window.HubPlayer.trusted(launch) || event.source !== launch.frame.contentWindow || event.origin !== new URL(launch.game.url).origin) return;
    const data = event.data, user = currentUser();
    observeIdentity(user);
    const identityTicket = identityRevision;
    if (!data || data.type !== 'lpa:economy:request' || data.protocol !== 1 || data.launchId !== launch.id || !uuid(data.requestId)) return;
    if (!['capabilities','wallet','catalog','inventory','purchase'].includes(data.action)) return;
    if (!data.params || typeof data.params !== 'object' || Array.isArray(data.params)) return;
    if (data.action === 'purchase' && (!product(data.params.productId) || !uuid(data.params.operationId) || Object.keys(data.params).some(k=>!['productId','operationId'].includes(k)))) return;
    if (data.action !== 'purchase' && Object.keys(data.params).length) return;
    if (bound !== launch || boundUser !== user) {bound=launch;boundUser=user;calls=new Map();windowStart=Date.now();count=0;}
    const valid = () => identityTicket === identityRevision && window.HubPlayer.current() === launch && window.HubPlayer.trusted(launch) && currentUser() === user;
    const reply = payload => { if (valid()) launch.frame.contentWindow.postMessage({type:'lpa:economy:response',protocol:1,launchId:launch.id,requestId:data.requestId,...payload},new URL(launch.game.url).origin); };
    const signature = JSON.stringify([data.action,data.params.productId,data.params.operationId]);
    // Expire only settled replies. Pending work stays deduplicated until it finishes.
    const now = Date.now();
    for (const [key,call] of calls) if (call.settled && now-call.used > 300000) calls.delete(key);
    const old = calls.get(data.requestId);
    if (old) { old.used=now; if (old.signature !== signature) reply({ok:false,error:'IDEMPOTENCY_CONFLICT'});else old.promise.then(reply);return; }
    while (calls.size >= 128) {
      const oldest = [...calls].filter(([,call])=>call.settled).sort((a,b)=>a[1].used-b[1].used)[0];
      if (!oldest) break;
      calls.delete(oldest[0]);
    }
    if (Date.now()-windowStart > 60000) {windowStart=Date.now();count=0;}
    if (++count>30 || [...calls.values()].filter(call=>!call.settled).length>=16 || calls.size>=128) {reply({ok:false,error:'TOO_MANY_REQUESTS'});return;}
    const promise = (user ? run(data.action,launch.game,data.params,valid) : Promise.reject(new Error('ACCOUNT_REQUIRED')))
      .then(result=>({ok:true,result}),error=>({ok:false,error:['ACCOUNT_REQUIRED','ECONOMY_UNAVAILABLE','INSUFFICIENT_FUNDS','PRICE_CHANGED','PRICE_QUOTE_REQUIRED','PRODUCT_UNAVAILABLE','GAME_UNAVAILABLE','IDEMPOTENCY_CONFLICT','ECONOMY_DISABLED','ACCOUNT_BLOCKED','PURCHASE_BUSY','SESSION_CHANGED','CANCELLED','STORAGE_UNAVAILABLE','INVALID_SAVED_QUOTE'].includes(error?.message)?error.message:'REQUEST_FAILED'}));
    const memo = {signature,promise,settled:false,used:now};
    calls.set(data.requestId,memo);promise.then(payload=>{memo.settled=true;reply(payload);});
  });
})();
