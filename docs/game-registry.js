(() => {
  const base = new URL('./', document.currentScript.src);
  const games = Object.freeze({
    'crystal-front-demo': Object.freeze({ id: 'crystal-front-demo', title: 'Crystal Front Demo',
      url: 'https://libertypandaa.github.io/crystal-front-demo/', shell: 'games/crystal-front/',
      icon: 'assets/games/crystal-front-app-icon-192-v2.png', cover: 'assets/games/crystal-front-feature.png', scoreUnit: 'points' }),
    'clutter-cup': Object.freeze({ id: 'clutter-cup', title: 'Clutter Cup',
      url: 'https://libertypandaa.github.io/clutter-cup-playtest/', shell: 'games/clutter-cup/',
      icon: 'assets/games/clutter-cup/icon-192.png', cover: 'assets/games/clutter-cup/cover-1280x720.png', scoreUnit: 'milliseconds' }),
  });
  const get = id => Object.hasOwn(games, id) ? games[id] : null;
  function selected(frame = document.querySelector('#game-frame')) {
    const game = get(frame?.dataset.gameId);
    if (!game) return null;
    try {
      const url = new URL(frame.src), expected = new URL(game.url);
      return url.origin === expected.origin && url.pathname === expected.pathname && !url.username && !url.password ? game : null;
    } catch { return null; }
  }
  function forPage() {
    return Object.values(games).find(game => location.pathname.startsWith(new URL(game.shell, base).pathname)) || null;
  }
  function forInstall(href) {
    try {
      const url = new URL(href, base);
      return Object.values(games).find(game => {
        const shell = new URL(game.shell, base);
        return url.origin === shell.origin && url.pathname.startsWith(shell.pathname);
      }) || null;
    } catch { return null; }
  }
  window.HubGames = Object.freeze({ get, selected, forPage, forInstall, asset: path => new URL(path, base).href });
})();
