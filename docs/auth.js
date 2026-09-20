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
      profileMessage(data ? 'Profile synced' : 'Choose a nickname to create your profile');
    } catch (_) {
      if (requestRevision === revision) profileMessage('Profile unavailable. Please try signing in again later.');
    }
  }

  function acceptSession(user) {
    const requestRevision = ++revision;
    currentUser = user;
    if (profileForm) profileForm.hidden = true;
    if (!user) {
      if (nameInput) nameInput.value = '';
      profileMessage('Sign in to manage your profile');
      renderSignedOut();
      return;
    }
    renderSignedIn(user);
    profileMessage('Loading profile...');
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
      profileMessage('Use 2 to 40 characters for your nickname');
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
      profileMessage('Profile saved');
    } catch (_) {
      if (requestRevision === revision) profileMessage('Could not save your profile. Please try again.');
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

  function renderSignedOut(message = "Not signed in") {
    setStatus(message);
    setText(nameNodes, "Guest player");
    setText(emailNodes, "Sign in with Google to sync progress");
    setText(accountNodes, "Guest");
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

    setStatus("Signed in");
    setText(nameNodes, displayName);
    setText(emailNodes, user.email || "Google account");
    setText(accountNodes, "Google");
    setHidden(signInButtons, true);
    setHidden(signOutButtons, false);

    avatarNodes.forEach((node) => {
      node.textContent = avatarUrl ? "" : displayName.slice(0, 2).toUpperCase();
      node.style.backgroundImage = avatarUrl ? `url("${avatarUrl}")` : "";
    });
  }

  async function signIn() {
    if (!client) {
      renderSignedOut("Auth not configured");
      return;
    }

    signInButtons.forEach((button) => { button.disabled = true; });
    setStatus('Connecting to Google...');
    try {
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) throw error;
    } catch (_) {
      setStatus('Google sign-in unavailable. Please try again later.');
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
      setStatus('Could not sign out. Please try again.');
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
      renderSignedOut("Auth setup needed");
      signInButtons.forEach((button) => {
        button.disabled = true;
        button.textContent = "Auth setup needed";
      });
      return;
    }

    if (!window.supabase?.createClient) {
      renderSignedOut("Auth SDK unavailable");
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

  initAuth().catch(() => renderSignedOut('Connection unavailable. Please reload to try again.'));
})();
