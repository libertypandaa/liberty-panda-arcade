/* Email OTP is separate from Google sign-in; Supabase owns verification. */
(() => {
  const root = document.querySelector('[data-email-auth]');
  if (!root) return;
  const client = window.HubClient;
  const form = root.querySelector('form');
  const email = root.querySelector('[data-email-address]');
  const code = root.querySelector('[data-email-code]');
  const codePanel = root.querySelector('[data-email-code-panel]');
  const submit = root.querySelector('[data-email-submit]');
  const resend = root.querySelector('[data-email-resend]');
  const change = root.querySelector('[data-email-change]');
  const status = root.querySelector('[data-email-status]');
  let address = '', busy = false, generation = 0, resendAfter = 0;
  function message(text) { status.textContent = text; }
  function controls() {
    submit.disabled = busy || !client;
    resend.disabled = busy || !client;
    change.disabled = busy;
    email.readOnly = busy || !!address;
    code.disabled = busy;
  }
  function reset() {
    generation++; busy = false; address = ''; resendAfter = 0;
    email.value = ''; code.value = ''; codePanel.hidden = true;
    code.required = false; submit.textContent = 'Отправить код';
    message(''); controls();
  }
  function failure(error, verifying) {
    if (error?.status === 429) return 'Слишком много попыток. Подождите перед повтором.';
    return verifying ? 'Не удалось проверить код. Проверьте его или запросите новый.' : 'Не удалось отправить код. Попробуйте позже.';
  }
  async function send() {
    if (!client || busy) return;
    const remaining = Math.ceil((resendAfter - Date.now()) / 1000);
    if (remaining > 0) { message('Подождите ' + remaining + ' сек. перед повторным запросом кода.'); return; }
    const target = address || email.value.trim();
    if (!target || !email.checkValidity()) { email.reportValidity(); return; }
    busy = true; controls(); message('Отправляем код…');
    const ticket = generation;
    try {
      const { error } = await client.auth.signInWithOtp({ email: target, options: { shouldCreateUser: true } });
      if (ticket !== generation) return;
      if (error) throw error;
      address = target; email.value = target; code.value = '';
      resendAfter = Date.now() + 60000;
      codePanel.hidden = false; code.required = true; submit.textContent = 'Подтвердить и войти';
      message('Код запрошен. Проверьте входящие письма и папку «Спам».');
    } catch (error) {
      if (ticket === generation) {
        if (error?.status === 429) resendAfter = Date.now() + 60000;
        message(failure(error, false));
      }
    } finally {
      if (ticket === generation) { busy = false; controls(); if (address) code.focus(); }
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!address) { await send(); return; }
    if (!client || busy) return;
    const token = code.value.trim();
    if (!/^[0-9]{6,10}$/.test(token)) { message('Введите цифровой код из письма.'); code.focus(); return; }
    busy = true; controls(); message('Проверяем код…');
    const ticket = generation;
    try {
      const { data, error } = await client.auth.verifyOtp({ email: address, token, type: 'email' });
      if (ticket !== generation) return;
      if (error || !data?.session) throw error || new Error('No session');
      reset(); root.hidden = true;
      // Supabase Auth state change updates the shared profile and analytics identity.
    } catch (error) {
      if (ticket === generation) { code.value = ''; message(failure(error, true)); }
    } finally {
      if (ticket === generation) { busy = false; controls(); code.focus(); }
    }
  });
  resend.addEventListener('click', send);
  change.addEventListener('click', () => { if (!busy) { const cooldown = resendAfter; reset(); resendAfter = cooldown; email.focus(); } });
  if (!client) { controls(); message('Вход по почте недоступен. Обновите страницу и попробуйте снова.'); return; }
  client.auth.onAuthStateChange((_event, session) => {
    reset(); root.hidden = !!session?.user;
  });
  controls();
})();
