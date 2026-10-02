(() => {
  const base = new URL('./', document.currentScript.src);
  const games = Object.freeze(/* LPA_GAMES_START */ {
  "crystal-front-demo": {
    "id": "crystal-front-demo",
    "title": "Crystal Front",
    "studio": "Liberman Games",
    "description": "Тактические сражения и цветные комбинации.",
    "url": "https://libertypandaa.github.io/crystal-front-demo/",
    "shell": "games/crystal-front/",
    "icon": "assets/games/crystal-front-app-icon-192-v2.png",
    "cover": "assets/games/crystal-front-feature.png",
    "scoreUnit": "points",
    "playerExit": false,
    "analyticsEnabled": true
  },
  "clutter-cup": {
    "id": "clutter-cup",
    "title": "Clutter Cup",
    "studio": "Liberman Games",
    "description": "Гонки по кухне на необычных машинках.",
    "url": "https://libertypandaa.github.io/clutter-cup-playtest/",
    "shell": "games/clutter-cup/",
    "icon": "assets/games/clutter-cup/icon-192.png?v=20261001-1",
    "cover": "assets/games/clutter-cup/cover-1280x720.png?v=20261001-1",
    "scoreUnit": "milliseconds",
    "playerExit": false,
    "analyticsEnabled": true
  }
} /* LPA_GAMES_END */);
  Object.values(games).forEach(Object.freeze);
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
  window.HubGames = Object.freeze({ get, list: () => Object.values(games), selected, forPage, forInstall, asset: path => new URL(path, base).href });
})();
