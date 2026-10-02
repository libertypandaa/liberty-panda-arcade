/* Catalog metadata comes only from the approved registry; history is account scoped. */
(() => {
 const client = window.HubClient;
 const continuation = document.querySelector('[data-auth-continue]');
 continuation?.addEventListener('click', () => window.HubAccess?.clearPending());
 let revision = 0, user = null;
 const greeting = document.querySelector('[data-auth-greeting]');
 const link = document.querySelector('[data-account-link]');
 const summary = document.querySelector('[data-player-summary]');
 const output = document.querySelector('[data-player-games]');
 const status = document.querySelector('[data-player-summary-status]');
 const catalog = document.querySelector('[data-game-catalog]');
 const library = document.querySelector('[data-game-library]');
 const libraryStatus = document.querySelector('[data-library-status]');
 const libraryLogin = document.querySelector('[data-library-login]');
 const search = document.querySelector('#catalog-search');
 const games = window.HubGames?.list() || [];
 const played = new Set();
 const launched = new Set();
 function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
 }
 function card(game) {
  const article = element('article', '', 'card game-card');
  article.dataset.gameCard = game.id;
  const cover = element('a', '', 'cover'); cover.href = window.HubGames.asset(game.shell);
  const img = element('img'); img.src = window.HubGames.asset(game.cover); img.alt = game.title; img.loading = 'lazy';
  cover.append(img);
  const body = element('div', '', 'game-body');
  body.append(element('p', game.studio || 'Liberman Games', 'kicker'));
  const heading = element('h3'), details = element('a', game.title); details.href = cover.href; heading.append(details); body.append(heading);
  if (game.description) body.append(element('p', game.description, 'muted'));
  const play = element('button', 'Играть', 'button primary play-game'); play.type = 'button'; play.dataset.gameId = game.id;
  const install = element('a', 'На телефон', 'button secondary'); install.dataset.installLink = ''; install.href = window.HubGames.asset(game.shell + 'install/');
  body.append(play, install); article.append(cover, body); return article;
 }
 function renderCatalog() {
  if (!catalog) return;
  const query = (search?.value || '').trim().toLocaleLowerCase();
  const matches = games.filter(game => game.title.toLocaleLowerCase().includes(query));
  catalog.replaceChildren(...matches.map(card));
  document.querySelector('[data-catalog-empty]').hidden = matches.length !== 0;
 }
 function renderLibrary(message) {
  library?.replaceChildren(...games.filter(game => played.has(game.id)).map(card));
  if (libraryLogin) libraryLogin.hidden = !!user;
  if (libraryStatus) libraryStatus.textContent = message || (played.size ? 'Игры из вашей истории и текущего сеанса. Это не список установленных приложений.' : 'Вы ещё не запускали игры в этом сеансе. Выберите игру на главной.');
 }
 renderCatalog(); search?.addEventListener('input', renderCatalog);
 renderLibrary('Войдите, чтобы увидеть игры из вашей истории.');
 window.addEventListener('hub:playerchange', () => {
  const game = window.HubPlayer?.current()?.game;
  if (user && game) { launched.add(game.id); played.add(game.id); renderLibrary(); }
 });
 if (!client) return;
 function name() {
  const profile = document.querySelector('[data-auth-name]');
  if (greeting) greeting.textContent = user ? 'Привет, ' + (profile?.textContent || 'игрок') + '!' : 'Добро пожаловать!';
 }
 const profile = document.querySelector('[data-auth-name]');
 if (profile) new MutationObserver(name).observe(profile, {childList:true, characterData:true, subtree:true});
 async function refresh(ticket) {
  if (!summary || !user) return;
  output.replaceChildren();
  if (!window.HubStats?.enabled()) {
   status.textContent = 'История из аналитики отключена. Это не влияет на доступ к играм.';
   renderLibrary('История прошлых сессий недоступна без согласия на аналитику. Здесь появятся игры, запущенные сейчас.');
   return;
  }
  status.textContent = 'Загрузка…';
  const {data,error} = await client.rpc('my_game_stats', {p_guest:null});
  if (ticket !== revision) return;
  if (error) throw new Error('history unavailable');
  status.textContent = data?.length ? 'Сохранённая игровая история' : 'В аккаунте пока нет записанных игровых сессий.';
  for (const entry of data || []) {
   const game = window.HubGames?.get(entry.game);
   if (game) played.add(game.id);
   const row = element('p', (game?.title || entry.game) + ' · ' + Math.floor((entry.activeSeconds || 0) / 60) + ' мин игры · ' + (entry.matches || 0) + ' матчей');
   output.append(row);
  }
  renderLibrary();
 }
 function schedule() {
  const ticket = ++revision;
  setTimeout(() => refresh(ticket).catch(() => {
   if (ticket !== revision) return;
   if (status) status.textContent = 'Не удалось загрузить игровую историю. Попробуйте позже.';
   renderLibrary('История временно недоступна. Вы можете выбрать игру на главной.');
  }), 0);
 }
 client.auth.onAuthStateChange((_event,session) => {
  const nextUser = session?.user || null;
  if (nextUser?.id !== user?.id) { played.clear(); launched.clear(); }
  user = nextUser;
  const pending = window.HubAccess?.pending();
  if (continuation) {
   continuation.hidden = !(user && pending);
   if (user && pending) { continuation.href = pending.url; continuation.textContent = 'Продолжить: ' + pending.title; }
  }
  if (summary) summary.hidden = !user;
  output?.replaceChildren();
  if (link) link.textContent = user ? 'Мой профиль' : 'Войти или зарегистрироваться';
  renderLibrary(user ? 'Загрузка истории…' : 'Войдите, чтобы увидеть игры из вашей истории.');
  name(); schedule();
 });
 window.HubStats?.subscribe(() => { played.clear(); launched.forEach(id => played.add(id)); renderLibrary(); schedule(); });
})();
