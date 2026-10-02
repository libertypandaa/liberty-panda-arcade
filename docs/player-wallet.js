(() => {
  const panel = document.querySelector('[data-economy-panel]');
  if (!panel) return;
  let revision = 0;
  async function refresh() {
    const ticket = ++revision, user = window.HubAccount?.user()?.id;
    panel.replaceChildren(); panel.hidden = !user;
    if (!user) return;
    const heading = document.createElement('h3'); heading.textContent = 'Общий кошелёк';
    const status = document.createElement('p'); status.textContent = 'Загрузка баланса…';
    panel.append(heading,status);
    try {
      const data = await window.HubEconomy.wallet();
      if (ticket !== revision || window.HubAccount?.user()?.id !== user) return;
      if (!Number.isSafeInteger(data?.balance) || data.balance < 0) throw new Error('INVALID_BALANCE');
      status.textContent = data.balance.toLocaleString('ru-RU') + ' игровой валюты';
      const note = document.createElement('p'); note.textContent = data.economyEnabled === true ? 'Общий баланс для всех игр. Траты доступны только при подключении к интернету.' : 'Кошелёк подготовлен. Магазин, реальные платежи и рекламные награды ещё не открыты.';panel.append(note);
    } catch (_) {
      if (ticket !== revision || window.HubAccount?.user()?.id !== user) return;
      status.textContent = 'Баланс сейчас недоступен. Покупки за реальные деньги и реклама ещё не подключены.';
    }
  }
  window.HubClient?.auth.onAuthStateChange(() => { ++revision; panel.replaceChildren();panel.hidden=true;setTimeout(refresh,0); });
  window.addEventListener('hub:walletchange',refresh);
  window.addEventListener('online',refresh);
})();
