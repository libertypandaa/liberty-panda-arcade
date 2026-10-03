/* Read-only UI. Only the server membership check authorizes access. */
(() => {
  'use strict';
  const el = name => document.querySelector('[data-admin-' + name + ']');
  const client = window.HubClient;
  const dashboard = el('dashboard'), open = el('open'), close = el('close');
  const status = text => { el('status').textContent = text; };
  let actor = null, epoch = 0, request = 0, opened = false;
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString('ru-RU') : 'Нет данных';
  const text = value => typeof value === 'string' && value ? value : 'Неизвестно';
  const seconds = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? number(Math.round(value / 60)) + ' мин' : 'Нет данных';
  function clear() {
    request++;
    dashboard.hidden = true;
    for (const name of ['metrics', 'daily', 'versions', 'results', 'errors', 'updated']) el(name).replaceChildren();
  }
  function reset(message) {
    epoch++; opened = false; clear(); close.hidden = true;
    open.disabled = !actor || !client;
    status(message);
  }
  function table(target, labels, rows) {
    const container = el(target); container.replaceChildren();
    if (!rows.length) { const p = document.createElement('p'); p.textContent = 'За выбранный период записей нет.'; container.append(p); return; }
    const t = document.createElement('table'), head = document.createElement('thead'), tr = document.createElement('tr');
    labels.forEach(label => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; tr.append(th); });
    head.append(tr); t.append(head);
    const body = document.createElement('tbody');
    rows.forEach(row => { const line = document.createElement('tr'); row.forEach(value => { const td = document.createElement('td'); td.textContent = value; line.append(td); }); body.append(line); });
    t.append(body); container.append(t);
  }
  function metric(label, value) {
    const card = document.createElement('div'); card.className = 'metric';
    const title = document.createElement('span'), count = document.createElement('strong');
    title.textContent = label; count.textContent = value; card.append(title, count); el('metrics').append(card);
  }
  function dates() {
    const from = el('from').value, to = el('to').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('INVALID_RANGE');
    const start = Date.parse(from + 'T00:00:00Z'), last = Date.parse(to + 'T00:00:00Z');
    if (!Number.isFinite(start) || !Number.isFinite(last) || last < start || last - start > 30 * 86400000) throw new Error('INVALID_RANGE');
    return { from, to };
  }
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }
  // RPC field mapping is intentionally isolated and follows ADMIN_CONTRACT.md.
  async function load() {
    if (!actor || !client || !opened) return;
    let range;
    try { range = dates(); } catch (_) { status('Выберите корректный период: не более 31 дня.'); return; }
    clear(); const ticket = request, generation = epoch, user = actor;
    const current = () => opened && epoch === generation && request === ticket && actor === user;
    open.disabled = true; status('Проверяем права и загружаем статистику…');
    try {
      const access = await rpc('lpa_admin_access');
      if (!current()) return;
      if (access?.access?.allowed !== true || access?.contractVersion !== 1) throw { code: '42501' };
      const report = await rpc('lpa_admin_analytics', { p_game_id: el('game').value || null, p_date_from: range.from, p_date_to: range.to });
      if (!current()) return;
      render(report);
      dashboard.hidden = false; close.hidden = false;
      status('Доступ подтверждён сервером. Кабинет работает только на чтение.');
    } catch (error) {
      if (!current()) return;
      clear();
      open.disabled = false;
      status(error?.code === '42501' ? 'Нет доступа к кабинету владельца. На сайте вы можете продолжать играть.' : 'Сервер кабинета недоступен. Данные не загружены; попробуйте снова.');
    } finally { if (epoch === generation && request === ticket) open.disabled = false; }
  }
  function render(report) {
    if (!report || report.contractVersion !== 1 || report.access?.allowed !== true || !report.summary || !Array.isArray(report.activity) || !Array.isArray(report.results) || !Array.isArray(report.versions)) throw new Error('INVALID_REPORT');
    const s = report.summary;
    metric('Активные игроки за период', number(s.players)); metric('Сессии', number(s.sessions)); metric('Активное время', seconds(s.activeSeconds));
    metric('Матчи с результатом', number(s.matches)); metric('Завершены без выхода', number(s.completedMatches)); metric('Победы', number(s.wins));
    table('daily', ['Дата UTC', 'Игра', 'Активные игроки', 'Сессии', 'Активное время'], report.activity.map(r => [text(r.date), text(r.gameId), number(r.players), number(r.sessions), seconds(r.activeSeconds)]));
    table('versions', ['Игра', 'Версия', 'Сборка', 'Сессии'], report.versions.map(r => [text(r.gameId), text(r.version), text(r.buildId), number(r.sessions)]));
    table('results', ['Игра', 'Победы', 'Поражения', 'Ничьи', 'Выходы', 'Средний результат'], report.results.map(r => [text(r.gameId), number(r.wins), number(r.losses), number(r.draws), number(r.abandons), r.meanScore == null ? 'Нет данных' : number(r.meanScore) + (['ms', 'milliseconds'].includes(r.scoreUnit) ? ' мс' : r.scoreUnit === 'points' ? ' очк.' : '')]));
    el('errors').textContent = s.errors == null ? 'Ошибки: данные пока недоступны.' : 'Полученные события ошибок: ' + number(s.errors);
    if (Array.isArray(report.games)) {
      const selected = el('game').value; el('game').replaceChildren();
      const all = document.createElement('option'); all.value = ''; all.textContent = 'Все игры'; el('game').append(all);
      report.games.forEach(game => { if (typeof game.id !== 'string') return; const option = document.createElement('option'); option.value = game.id; option.textContent = text(game.title); el('game').append(option); });
      el('game').value = selected;
    }
    el('updated').textContent = 'Обновлено: ' + (typeof report.generatedAt === 'string' && Number.isFinite(Date.parse(report.generatedAt)) ? new Date(report.generatedAt).toLocaleString('ru-RU') : 'время сервера неизвестно');
  }
  const today = new Date(); el('to').value = today.toISOString().slice(0, 10);
  el('from').value = new Date(today.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  open.addEventListener('click', () => { opened = true; load(); });
  close.addEventListener('click', () => reset('Кабинет закрыт. Игровой аккаунт остаётся авторизованным.'));
  el('filters').addEventListener('submit', event => { event.preventDefault(); load(); });
  window.addEventListener('offline', () => reset('Нет подключения. Для кабинета владельца необходим интернет.'));
  window.addEventListener('pagehide', () => reset('Откройте кабинет заново.'));
  if (!client?.auth) { reset('Модуль входа недоступен. Обновите страницу и попробуйте снова.'); return; }
  client.auth.onAuthStateChange((event, session) => {
    const next = session?.user?.id || null;
    if (next !== actor || event === 'SIGNED_OUT') { actor = next; reset(actor ? 'Аккаунт подтверждён. Нажмите «Открыть кабинет» для проверки прав.' : 'Войдите, затем откройте кабинет.'); }
  });
})();
