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

    await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.href.split("#")[0],
      },
    });
  }

  async function signOut() {
    if (!client) {
      return;
    }

    await client.auth.signOut({ scope: "local" });
    renderSignedOut();
  }

  async function initAuth() {
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

    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });

    client.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        renderSignedIn(session.user);
      } else {
        renderSignedOut();
      }
    });

    const { data, error } = await client.auth.getUser();

    if (error || !data?.user) {
      renderSignedOut();
      return;
    }

    renderSignedIn(data.user);
  }

  initAuth();
})();
