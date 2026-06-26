/* ════════════════════════════════════════════════════════
   spotify-auth.js
   OAuth2 Authorization Code + PKCE flow for Spotify.

   Why PKCE: this is a static site with no backend, so we can't
   safely store a client_secret. PKCE is the flow Spotify
   recommends precisely for this case (SPA / mobile / desktop
   apps where the secret can't be protected).

   Flow:
   1. login()      -> generate code_verifier + code_challenge,
                       stash verifier in sessionStorage, redirect
                       the browser to Spotify's /authorize page.
   2. (Spotify redirects back to callback.html with ?code=...)
   3. handleCallback() on callback.html exchanges the code for
      an access_token + refresh_token using the stashed verifier,
      stores both in sessionStorage, then redirects back to the
      main app.
   4. getValidAccessToken() returns the current token, silently
      refreshing it first if it has expired.

   IMPORTANT: Replace CLIENT_ID below with your own, obtained
   for free at https://developer.spotify.com/dashboard
   (see README.md for the exact steps).
════════════════════════════════════════════════════════ */

const SpotifyAuth = (() => {

  // ── Configuration — EDIT THIS ────────────────────────────
  // Get a free Client ID at https://developer.spotify.com/dashboard
  // and register `<your-site>/callback.html` as a Redirect URI there.
  const CLIENT_ID = "YOUR_SPOTIFY_CLIENT_ID_HERE";
  // ──────────────────────────────────────────────────────────

  const SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "playlist-read-private",
    "playlist-read-collaborative",
  ].join(" ");

  const STORAGE_KEY = "mixcast_spotify_tokens_v1";
  const VERIFIER_KEY = "mixcast_spotify_pkce_verifier";

  function redirectUri() {
    // Same directory as wherever index.html/callback.html are served from.
    const path = window.location.pathname.replace(/[^/]*$/, "callback.html");
    return `${window.location.origin}${path}`;
  }

  function isConfigured() {
    return !!CLIENT_ID && CLIENT_ID !== "YOUR_SPOTIFY_CLIENT_ID_HERE";
  }

  /* ── PKCE helpers ── */
  function randomString(length) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, (b) => chars[b % chars.length]).join("");
  }

  async function sha256Base64Url(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(digest);
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /* ── Step 1: kick off login ── */
  async function login() {
    if (!isConfigured()) {
      throw new Error(
        "Spotify Client IDが未設定です。js/spotify-auth.js の CLIENT_ID を設定してください。"
      );
    }
    const verifier = randomString(64);
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    const challenge = await sha256Base64Url(verifier);

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: redirectUri(),
      scope: SCOPES,
      code_challenge_method: "S256",
      code_challenge: challenge,
      state: randomString(16),
    });
    window.location.href = `https://accounts.spotify.com/authorize?${params}`;
  }

  /* ── Step 2: handle the redirect back (called from callback.html) ── */
  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");

    if (error) throw new Error(`Spotify認証が拒否されました（${error}）`);
    if (!code) throw new Error("認証コードが見つかりませんでした");

    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!verifier) throw new Error("検証情報が見つかりません。最初からやり直してください");

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    });

    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`トークン取得に失敗しました（HTTP ${res.status}）${detail ? ": " + detail : ""}`);
    }
    const data = await res.json();
    storeTokens(data);
    sessionStorage.removeItem(VERIFIER_KEY);
  }

  function storeTokens(data) {
    const record = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || readTokens()?.refresh_token,
      expires_at: Date.now() + (data.expires_in - 30) * 1000, // 30s safety margin
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  }

  function readTokens() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function refreshAccessToken(refreshToken) {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`トークン更新に失敗しました（HTTP ${res.status}）`);
    const data = await res.json();
    storeTokens(data);
    return readTokens().access_token;
  }

  /* ── Step 4: get a valid token, refreshing if needed ── */
  async function getValidAccessToken() {
    const tokens = readTokens();
    if (!tokens) return null;
    if (Date.now() < tokens.expires_at) return tokens.access_token;
    if (!tokens.refresh_token) { logout(); return null; }
    try {
      return await refreshAccessToken(tokens.refresh_token);
    } catch {
      logout();
      return null;
    }
  }

  function isLoggedIn() {
    return !!readTokens();
  }

  function logout() {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
  }

  return { login, handleCallback, getValidAccessToken, isLoggedIn, logout, isConfigured, redirectUri };
})();
