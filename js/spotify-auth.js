/* ════════════════════════════════════════════════════════
   spotify-auth.js
   OAuth2 Authorization Code + PKCE flow for Spotify.

   ベータ公開時の設定方法:
   デプロイ前に、下の HARDCODED_CLIENT_ID にご自身の Spotify Client ID を
   貼り付けてください。これにより、訪問者は個別設定なしで「Spotifyで
   ログイン」を押すだけで使えるようになります（一般公開時はこちらを推奨）。

   個人利用や動作確認だけなら、ヘッダーの「Spotifyでログイン」ボタンから
   ダイアログ経由で入力することも可能です（localStorageに保存され、
   HARDCODED_CLIENT_ID より優先されます）。

   Client ID の取得: https://developer.spotify.com/dashboard
   （取得手順は README.md を参照）
════════════════════════════════════════════════════════ */

const SpotifyAuth = (() => {

  // ── Client ID ────────────────────────────────────────
  // ベータ公開前に、ここにご自身の Spotify Client ID を貼り付けてください。
  // 一般ユーザーはこの値を自動的に使うため、個別設定は不要になります。
  const HARDCODED_CLIENT_ID = "7e48ee5d5db74137bb3398ae8653bd7d";

  const CLIENT_ID_KEY  = "mixcast_spotify_client_id";
  const STORAGE_KEY    = "mixcast_spotify_tokens_v1";
  const VERIFIER_KEY   = "mixcast_spotify_pkce_verifier";
  // ──────────────────────────────────────────────────────

  const SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "playlist-read-private",
    "playlist-read-collaborative",
  ].join(" ");

  /* ── Client ID management ── */

  /** Returns the active Client ID (localStorage > hardcoded), or "" if none. */
  function getClientId() {
    const stored = (localStorage.getItem(CLIENT_ID_KEY) || "").trim();
    if (stored && stored !== "YOUR_SPOTIFY_CLIENT_ID_HERE") return stored;
    const hc = (HARDCODED_CLIENT_ID || "").trim();
    if (hc && hc !== "YOUR_SPOTIFY_CLIENT_ID_HERE") return hc;
    return "";
  }

  /** Persist a Client ID entered at runtime (no file editing needed). */
  function setClientId(id) {
    const trimmed = (id || "").trim();
    if (trimmed) {
      localStorage.setItem(CLIENT_ID_KEY, trimmed);
    }
  }

  /** True when a usable Client ID is available. */
  function isConfigured() {
    return !!getClientId();
  }

  function redirectUri() {
    const path = window.location.pathname.replace(/[^/]*$/, "callback.html");
    return `${window.location.origin}${path}`;
  }

  /* ── PKCE helpers ── */

  function randomString(length) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, (b) => chars[b % chars.length]).join("");
  }

  async function sha256Base64Url(text) {
    const data   = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const bytes  = new Uint8Array(digest);
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /* ── Step 1: kick off login ── */
  async function login() {
    const clientId = getClientId();
    if (!clientId) {
      throw new Error("Spotify Client IDが設定されていません");
    }
    const verifier   = randomString(64);
    const challenge  = await sha256Base64Url(verifier);
    sessionStorage.setItem(VERIFIER_KEY, verifier);

    const params = new URLSearchParams({
      client_id:              clientId,
      response_type:          "code",
      redirect_uri:           redirectUri(),
      scope:                  SCOPES,
      code_challenge_method:  "S256",
      code_challenge:         challenge,
      state:                  randomString(16),
    });
    window.location.href = `https://accounts.spotify.com/authorize?${params}`;
  }

  /* ── Step 2: handle the redirect (called from callback.html) ── */
  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get("code");
    const error  = params.get("error");

    if (error) throw new Error(`Spotify認証が拒否されました（${error}）`);
    if (!code)  throw new Error("認証コードが見つかりませんでした");

    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!verifier) throw new Error("検証情報が見つかりません。最初からやり直してください");

    const body = new URLSearchParams({
      client_id:     getClientId(),
      grant_type:    "authorization_code",
      code,
      redirect_uri:  redirectUri(),
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
    storeTokens(await res.json());
    sessionStorage.removeItem(VERIFIER_KEY);
  }

  /* ── Token storage helpers ── */

  function storeTokens(data) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      access_token:  data.access_token,
      refresh_token: data.refresh_token || readTokens()?.refresh_token,
      expires_at:    Date.now() + (data.expires_in - 30) * 1000,
    }));
  }

  function readTokens() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async function refreshAccessToken(refreshToken) {
    const body = new URLSearchParams({
      client_id:     getClientId(),
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
    });
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`トークン更新に失敗しました（HTTP ${res.status}）`);
    storeTokens(await res.json());
    return readTokens().access_token;
  }

  /* ── Step 4: get a valid token ── */
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

  function isLoggedIn() { return !!readTokens(); }

  function logout() {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
  }

  return {
    login, handleCallback, getValidAccessToken,
    isLoggedIn, logout,
    isConfigured, getClientId, setClientId,
    redirectUri,
  };
})();
