(() => {
  const config = window.LIBERTY_PANDA_AUTH_CONFIG;
  if (!config || !window.supabase) return;
  const client = window.HubClient || window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  const key = 'lpa:analytics-consent';
  const guestKey = 'lpa:guest-secret';
  const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* Session-only choice when storage is unavailable. */ } };
  let consent = read(key) === 'yes';
  let guest = null;
  let userId = null;
  let ready = false;
  let generation = 0;
  let chain = Promise.resolve();
  let lastActor = null;
  const game = 'crystal-front-demo';
  const setText = (selector, value) => document.querySelectorAll(selector).forEach(n => { n.textContent = value; });
  function identity() {
    if (userId) return null;
    if (!guest) {
      const stored = read(guestKey);
      guest = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(stored || '') ? stored : crypto.randomUUID();
      write(guestKey, guest);
    }
    return guest;
  }
  function status(text) { setText('[data-stats-status]', text); }
  function resetDisplay() {
    setText('[data-stats-feature]', 'Featured game');
    setText('[data-stats-launches]', '—'); setText('[data-stats-visits]', '—');
    setText('[data-stats-last]', '—');
    document.querySelector('[data-stats-history]')?.replaceChildren();
  }
  async function refresh() {
    if (!consent || !ready) return;
    const version = generation;
    const { data, error } = await client.rpc('my_hub_stats', { p_guest: identity() });
    if (version !== generation) return;
    if (error) { status('Статистика временно недоступна'); return; }
    setText('[data-stats-launches]', data.launches);
    setText('[data-stats-visits]', data.visits);
    setText('[data-stats-last]', data.lastGame === game ? 'Crystal Front' : '—');
    setText('[data-stats-feature]', data.lastGame === game ? 'Last played' : 'Featured game');
    const history = document.querySelector('[data-stats-history]');
    if (history) {
      history.replaceChildren();
      for (const entry of data.history || []) {
        const row = document.createElement('li');
        row.textContent = `Crystal Front · ${new Date(entry.created_at).toLocaleString()}`;
        history.append(row);
      }
    }
    status(userId ? 'Статистика аккаунта' : 'Статистика этого браузера');
  }
  function track(kind, gameId = null) {
    if (!consent || !ready) return;
    const version = generation;
    const args = { p_id: crypto.randomUUID(), p_guest: identity(), p_kind: kind, p_game: gameId };
    chain = chain.catch(() => {}).then(async () => {
      if (generation !== version || !consent) return;
      const { error } = await client.rpc('record_hub_event', args);
      if (generation !== version) return;
      if (error) { status('Событие не сохранено: нет связи со статистикой'); return; }
      await refresh();
    }).catch(() => { status('Статистика временно недоступна'); });
  }
  window.HubStats = { track };
  function visit() {
    if (!ready || !consent) return;
    const actor = userId || identity();
    if (actor !== lastActor) { lastActor = actor; track('visit'); }
  }

  const notice = document.createElement('section');
  notice.setAttribute('aria-label', 'Статистика посещений');
  notice.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;z-index:10000;background:white;color:#17212b;border:1px solid #b8cec8;padding:16px;box-shadow:0 4px 20px #0002;max-width:620px;border-radius:6px;font:15px/1.5 system-ui';
  const text = document.createElement('p');
  text.textContent = 'Разрешить статистику посещений и запусков? Случайный код в браузере помогает узнавать возвращения. Игры доступны и без статистики.';
  notice.append(text);
  const privacy = document.createElement('a');
  privacy.href = new URL('privacy/', document.currentScript.src).href;
  privacy.textContent = 'Политика конфиденциальности';
  notice.append(privacy);
  function choice(label, enabled) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label;
    button.style.cssText = 'padding:10px 14px;margin:4px;border:1px solid #08776e;border-radius:4px;background:white;color:#08776e;cursor:pointer';
    button.addEventListener('click', () => {
      consent = enabled; generation++; lastActor = null;
      write(key, enabled ? 'yes' : 'no'); notice.hidden = true;
      document.querySelectorAll('[data-stats-consent]').forEach(n => { n.checked = enabled; });
      if (enabled) { visit(); observeLaunch(); } else { resetDisplay(); status('Статистика отключена'); }
    });
    notice.append(button);
  }
  choice('Разрешить', true); choice('Не разрешать', false);
  notice.hidden = read(key) !== null;
  document.body.append(notice);
  document.querySelectorAll('[data-stats-consent]').forEach(n => {
    n.checked = consent;
    n.addEventListener('change', () => {
      consent = n.checked; generation++; lastActor = null;
      write(key, consent ? 'yes' : 'no'); notice.hidden = true;
      if (consent) { visit(); observeLaunch(); } else { resetDisplay(); status('Статистика отключена'); }
    });
  });
  document.querySelector('[data-stats-delete]')?.addEventListener('click', async (event) => {
    if (!ready) return;
    const version = ++generation;
    consent = false; write(key, 'no'); notice.hidden = true;
    document.querySelectorAll('[data-stats-consent]').forEach(n => { n.checked = false; });
    event.target.disabled = true;
    try {
      await chain;
      if (version !== generation) return;
      const { error } = await client.rpc('delete_my_hub_stats', { p_guest: identity() });
      if (version !== generation) return;
      if (error) throw error;
      resetDisplay(); status('Статистика удалена, сбор отключён');
    } catch { status('Удаление не удалось. Повторите попытку.'); }
    finally { event.target.disabled = false; }
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== key) return;
    consent = event.newValue === 'yes'; generation++; lastActor = null;
    notice.hidden = event.newValue !== null;
    document.querySelectorAll('[data-stats-consent]').forEach(n => { n.checked = consent; });
    if (consent) { visit(); observeLaunch(); } else { resetDisplay(); status('Статистика отключена'); }
  });
  const admin = document.querySelector('[data-stats-admin]');
  async function loadAdmin() {
    if (!admin) return;
    admin.hidden = true;
    if (!userId) return;
    const version = generation;
    const { data, error } = await client.rpc('hub_admin_stats');
    if (error || version !== generation) return;
    const output = admin.querySelector('[data-stats-report]'); output.replaceChildren();
    const labels = { daily:'Активные за 24 часа',weekly:'Активные за 7 дней',monthly:'Активные за 30 дней',guestBrowsers:'Гостевые браузеры',accounts:'Аккаунты со статистикой',visits:'Посещения',launches:'Нажатия Play',ready:'Подтверждённые загрузки',installClicks:'Переходы к установке',installAvailable:'Браузер предложил установку',installed:'Подтверждённые установки',errors:'Сообщения об ошибках',returning:'Вернулись в другой день',registrations:'Регистрации за 30 дней' };
    for (const [k,label] of Object.entries(labels)) {
      const row = document.createElement('p'); row.textContent = `${label}: ${data[k] ?? 0}`; output.append(row);
    }
    const cohorts = data.retention || [1, 7, 30].map(day => ({ day, eligible: 0, returned: 0 }));
    for (const cohort of cohorts) {
      const row = document.createElement('p');
      row.textContent = `Возврат D${cohort.day}: ${cohort.eligible ? `${cohort.returned} / ${cohort.eligible}` : 'ещё нет данных'}`;
      output.append(row);
    }
    admin.hidden = false;
  }
  document.querySelector('[data-stats-refresh]')?.addEventListener('click', () => loadAdmin().catch(() => {}));
  client.auth.onAuthStateChange((_event, session) => {
    const next = session?.user?.id || null;
    if (ready && next === userId) return;
    userId = next; ready = true; generation++; resetDisplay();
    setTimeout(() => { visit(); observeLaunch(); refresh().catch(() => {}); loadAdmin().catch(() => {}); }, 0);
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-install-link]')) track('install_click', game);
  });
  window.addEventListener('beforeinstallprompt', () => track('install_available', location.pathname.includes('/games/') ? game : null));
  window.addEventListener('appinstalled', () => track('installed', location.pathname.includes('/games/') ? game : null));
  const overlay = document.querySelector('#game-overlay');
  const frame = document.querySelector('#game-frame');
  let active = false, reportedReady = false, reportedLaunch = false;
  function observeLaunch() {
    if (!overlay) return;
    if (!overlay.hidden && !active) { active = true; reportedReady = false; reportedLaunch = false; }
    else if (overlay.hidden) active = false;
    if (active && !reportedLaunch && ready && consent) { reportedLaunch = true; track('launch', game); }
  }
  if (overlay) {
    new MutationObserver(observeLaunch).observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
    observeLaunch();
  }
  window.addEventListener('message', event => {
    if (!active || event.source !== frame?.contentWindow || event.origin !== 'https://libertypandaa.github.io') return;
    if (event.data?.type === 'game_ready' && !reportedReady) { reportedReady = true; track('game_ready', game); }
  });
  frame?.addEventListener('error', () => { if (active) track('launch_error', game); });
  if (!consent) status('Статистика отключена');
})();
