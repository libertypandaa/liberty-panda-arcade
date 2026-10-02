(() => {
  const config = window.LIBERTY_PANDA_AUTH_CONFIG || {};
  const authStatusNodes = document.querySelectorAll("[data-auth-status]");
  const signInButtons = document.querySelectorAll("[data-auth-action='sign-in']");
  const signOutButtons = document.querySelectorAll("[data-auth-action='sign-out']");
  const nameNodes = document.querySelectorAll("[data-auth-name]");
  const emailNodes = document.querySelectorAll("[data-auth-email]");
  const avatarNodes = document.querySelectorAll("[data-auth-avatar]");
  const accountNodes = document.querySelectorAll("[data-auth-account]");

  let client = null;
  let currentUser = null;
  let resolveAccount;
  const accountReady = new Promise(resolve => { resolveAccount = resolve; });
  window.HubAccount = { ready: accountReady, user: () => currentUser };
  let revision = 0;
  const profileForm = document.querySelector('[data-profile-form]');
  const nameInput = document.querySelector('[data-profile-name]');
  const profileStatus = document.querySelector('[data-profile-status]');

  function profileMessage(message) {
    if (profileStatus) profileStatus.textContent = message;
  }

  async function loadProfile(user, requestRevision) {
    try {
      const { data, error } = await client.from('profiles')
        .select('display_name,avatar_url').eq('id', user.id).maybeSingle();
      if (requestRevision !== revision) return;
      if (error) throw error;
      const name = data?.display_name || displayNameFor(user);
      setText(nameNodes, name);
      if (nameInput) nameInput.value = name;
      if (profileForm) profileForm.hidden = false;
      profileMessage(data ? 'Профиль загружен' : 'Выберите никнейм для профиля');
    } catch (_) {
      if (requestRevision === revision) profileMessage('Профиль недоступен. Попробуйте войти позже.');
    }
  }

  function acceptSession(user) {
    const requestRevision = ++revision;
    currentUser = user;
    resolveAccount(user);
    if (profileForm) profileForm.hidden = true;
    if (!user) {
      if (nameInput) nameInput.value = '';
      profileMessage('Войдите, чтобы изменить профиль');
      renderSignedOut();
      return;
    }
    renderSignedIn(user);
    profileMessage('Загружаем профиль…');
    // Keep database calls outside the synchronous Auth event callback.
    setTimeout(() => {
      if (requestRevision === revision) loadProfile(user, requestRevision);
    }, 0);
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!currentUser || !nameInput) return;
    const name = nameInput.value.trim();
    if (name.length < 2 || name.length > 40) {
      profileMessage('Никнейм должен содержать от 2 до 40 символов');
      return;
    }
    const requestRevision = revision;
    const button = profileForm.querySelector('button');
    button.disabled = true;
    try {
      const { data, error } = await client.from('profiles').upsert({
        id: currentUser.id,
        display_name: name,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' }).select('display_name').single();
      if (requestRevision !== revision) return;
      if (error) throw error;
      setText(nameNodes, data.display_name);
      profileMessage('Профиль сохранён');
    } catch (_) {
      if (requestRevision === revision) profileMessage('Не удалось сохранить профиль. Попробуйте ещё раз.');
    } finally {
      button.disabled = false;
    }
  }

  function isConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseAnonKey);
  }

  function setText(nodes, value) {
    nodes.forEach((node) => {
      node.textContent = value;
    });
  }

  function setHidden(nodes, hidden) {
    nodes.forEach((node) => {
      node.hidden = hidden;
    });
  }

  function setStatus(message) {
    setText(authStatusNodes, message);
  }

  function displayNameFor(user) {
    return user?.user_metadata?.name || user?.user_metadata?.full_name || user?.email || "Player";
  }

  function avatarFor(user) {
    return user?.user_metadata?.avatar_url || "";
  }

  function renderSignedOut(message = "Вход не выполнен") {
    setStatus(message);
    setText(nameNodes, "Войдите в аккаунт");
    setText(emailNodes, "Войдите через Google или код на почту");
    setText(accountNodes, "Не выполнен вход");
    setHidden(signInButtons, false);
    setHidden(signOutButtons, true);

    avatarNodes.forEach((node) => {
      node.textContent = "LP";
      node.style.backgroundImage = "";
    });
  }

  function renderSignedIn(user) {
    const displayName = displayNameFor(user);
    const avatarUrl = avatarFor(user);

    setStatus("Вы вошли");
    setText(nameNodes, displayName);
    setText(emailNodes, user.email || "Аккаунт Google");
    setText(accountNodes, user.app_metadata?.provider === "email" ? "Email" : "Google");
    setHidden(signInButtons, true);
    setHidden(signOutButtons, false);

    avatarNodes.forEach((node) => {
      node.textContent = avatarUrl ? "" : displayName.slice(0, 2).toUpperCase();
      node.style.backgroundImage = avatarUrl ? `url("${avatarUrl}")` : "";
    });
  }

  async function signIn() {
    if (!client) {
      renderSignedOut("Вход пока не настроен");
      return;
    }

    signInButtons.forEach((button) => { button.disabled = true; });
    setStatus('Подключаемся к Google…');
    try {
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) throw error;
    } catch (_) {
      setStatus('Вход через Google недоступен. Попробуйте позже.');
      window.HubStats?.track('auth_error');
    } finally {
      signInButtons.forEach((button) => { button.disabled = false; });
    }
  }

  async function signOut() {
    if (!client) {
      return;
    }

    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
      acceptSession(null);
    } catch (_) {
      setStatus('Не удалось выйти. Попробуйте ещё раз.');
    }
  }

  async function initAuth() {
    profileForm?.addEventListener('submit', saveProfile);
    signInButtons.forEach((button) => {
      button.addEventListener("click", signIn);
    });

    signOutButtons.forEach((button) => {
      button.addEventListener("click", signOut);
    });

    if (!isConfigured()) {
      resolveAccount(null);
      renderSignedOut("Вход пока не настроен");
      signInButtons.forEach((button) => {
        button.disabled = true;
        button.textContent = "Вход пока не настроен";
      });
      return;
    }

    if (!window.supabase?.createClient) {
      resolveAccount(null);
      renderSignedOut("Не удалось загрузить модуль входа");
      return;
    }

    client = window.HubClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });

    client.auth.onAuthStateChange((_event, session) => {
      acceptSession(session?.user || null);
    });

  }

  initAuth().catch(() => { resolveAccount(null); renderSignedOut('Подключение недоступно. Попробуйте обновить страницу.'); });
})();
