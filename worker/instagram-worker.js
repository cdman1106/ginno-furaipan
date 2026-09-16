const DAY = 24 * 60 * 60;
const THIRTY_DAYS = 30 * DAY;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      return connectPage(request, env);
    }

    if (url.pathname === "/oauth/start") {
      return startOAuth(request, env);
    }

    if (url.pathname === "/instagram/callback") {
      return oauthCallback(request, env);
    }

    if (url.pathname === "/instagram") {
      return publicInstagramFeed(request, env);
    }

    if (url.pathname === "/health") {
      return json({ ok: true, service: "ginno-furaipan-instagram" });
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refreshAndSync(env));
  },
};

function requiredEnv(env) {
  const names = [
    "IG_APP_ID",
    "IG_APP_SECRET",
    "IG_REDIRECT_URI",
    "CONNECT_KEY",
  ];
  const missing = names.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}

function graphBase(env) {
  const version = env.IG_GRAPH_VERSION || "v25.0";
  return `https://graph.instagram.com/${version}`;
}

function connectUrlAllowed(url, env) {
  return url.searchParams.get("key") === env.CONNECT_KEY;
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{color-scheme:light;--navy:#101a2b;--gold:#b88b42;--paper:#f7f3eb;--ink:#20242b}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP","Hiragino Kaku Gothic ProN",sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}
    .card{width:min(100%,520px);background:#fff;border-radius:24px;padding:30px 24px;box-shadow:0 18px 60px rgba(16,26,43,.14)}
    .brand{font-family:"Noto Serif JP",serif;font-weight:700;color:var(--navy);font-size:25px;margin:0 0 8px}.eyebrow{font-size:12px;letter-spacing:.16em;color:var(--gold);font-weight:700;margin-bottom:10px}
    h1{font-size:24px;line-height:1.5;margin:0 0 14px;color:var(--navy)}p{line-height:1.8;margin:0 0 18px}.note{font-size:13px;color:#657080;background:#f5f6f8;border-radius:14px;padding:14px 16px}.status{background:#edf8ef;color:#24613a;border-radius:14px;padding:14px 16px;font-weight:700}
    .steps{display:grid;gap:12px;margin:22px 0}.step{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1px solid #e7e9ee;border-radius:16px}.num{width:28px;height:28px;border-radius:50%;background:var(--navy);color:#fff;display:grid;place-items:center;font-weight:700;flex:none}.step strong{display:block;margin-bottom:3px;color:var(--navy)}
    .btn{display:block;width:100%;border:0;border-radius:15px;background:var(--navy);color:#fff;text-decoration:none;text-align:center;padding:16px 18px;font-weight:700;font-size:16px;cursor:pointer}.btn.secondary{background:#fff;color:var(--navy);border:1px solid #ccd2dc;margin-bottom:10px}.small{font-size:12px;color:#7b8491;text-align:center;margin-top:14px}
  </style>
</head>
<body><main class="card">${body}</main></body>
</html>`;
}

async function connectPage(request, env) {
  requiredEnv(env);
  const url = new URL(request.url);
  if (!connectUrlAllowed(url, env)) {
    return new Response("Not Found", { status: 404 });
  }

  const key = encodeURIComponent(env.CONNECT_KEY);
  const testerUrl = env.IG_TESTER_INVITE_URL || "https://www.instagram.com/accounts/manage_access/";
  const body = `
    <div class="eyebrow">INSTAGRAM CONNECTION</div>
    <p class="brand">洋食や 銀のフライパン</p>
    <h1>Instagram連携をお願いします</h1>
    <p>ホームページに最新のInstagram投稿を自動表示するための設定です。パスワードを制作者へ伝える必要はありません。</p>
    <div class="steps">
      <div class="step"><span class="num">1</span><div><strong>最初の1回だけ：招待を承認</strong><span>下のボタンからInstagramを開き、「Ginno Furaipan Website」のテスター招待が表示された場合だけ承認してください。</span></div></div>
      <div class="step"><span class="num">2</span><div><strong>Instagramと連携</strong><span>銀のフライパンのInstagramアカウントを選び、Metaの画面で「許可」または「続行」を押してください。</span></div></div>
    </div>
    <a class="btn secondary" href="${escapeAttr(testerUrl)}" target="_blank" rel="noopener">① 招待を確認する</a>
    <a class="btn" href="/oauth/start?key=${key}">② Instagramと連携する</a>
    <p class="small">連携後はInstagramを更新するだけで、ホームページ側の表示も自動更新できます。</p>`;

  return html(pageShell("銀のフライパン Instagram連携", body));
}

async function startOAuth(request, env) {
  requiredEnv(env);
  const url = new URL(request.url);
  if (!connectUrlAllowed(url, env)) {
    return new Response("Not Found", { status: 404 });
  }

  const state = crypto.randomUUID().replaceAll("-", "");
  await env.IG_STORE.put(`oauth_state:${state}`, "1", { expirationTtl: 600 });

  const auth = new URL("https://www.instagram.com/oauth/authorize");
  auth.searchParams.set("client_id", env.IG_APP_ID);
  auth.searchParams.set("redirect_uri", env.IG_REDIRECT_URI);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "instagram_business_basic");
  auth.searchParams.set("state", state);
  auth.searchParams.set("enable_fb_login", "0");
  auth.searchParams.set("force_reauth", "true");

  return Response.redirect(auth.toString(), 302);
}

async function oauthCallback(request, env) {
  requiredEnv(env);
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") || "").replace(/#_$/, "");
  const state = url.searchParams.get("state") || "";
  const error = url.searchParams.get("error");

  if (error) {
    return html(pageShell("Instagram連携", `<h1>連携がキャンセルされました</h1><p>Instagram側で許可されなかったため、連携は行われていません。</p>`), 400);
  }

  if (!code || !state) {
    return html(pageShell("Instagram連携", `<h1>連携できませんでした</h1><p>必要な認証情報がありません。最初の連携ページからもう一度お試しください。</p>`), 400);
  }

  const validState = await env.IG_STORE.get(`oauth_state:${state}`);
  if (!validState) {
    return html(pageShell("Instagram連携", `<h1>連携ページの有効期限が切れました</h1><p>最初の連携ページからもう一度お試しください。</p>`), 400);
  }
  await env.IG_STORE.delete(`oauth_state:${state}`);

  try {
    const short = await exchangeAuthorizationCode(code, env);
    const long = await exchangeLongLivedToken(short.access_token, env);
    const token = long.access_token || short.access_token;
    const expiresIn = Number(long.expires_in || 5184000);

    const profile = await fetchProfile(token, env);
    const now = Math.floor(Date.now() / 1000);

    await env.IG_STORE.put("instagram_auth", JSON.stringify({
      accessToken: token,
      userId: profile.id,
      username: profile.username,
      accountType: profile.account_type || null,
      savedAt: now,
      expiresAt: now + expiresIn,
    }));

    await syncInstagram(env);

    const body = `
      <div class="eyebrow">CONNECTED</div>
      <p class="brand">洋食や 銀のフライパン</p>
      <h1>Instagramとの連携が完了しました</h1>
      <p class="status">✓ @${escapeHtml(profile.username || "ginno_furaipan")} と正常に連携しました。</p>
      <p>今後は、いつも通りInstagramを更新していただければ大丈夫です。この画面は閉じてください。</p>
      <p class="note">Instagramのパスワードはこのホームページや制作者には保存されません。</p>`;

    return html(pageShell("Instagram連携完了", body));
  } catch (err) {
    console.error("Instagram OAuth error", safeError(err));
    return html(pageShell("Instagram連携", `<h1>連携処理でエラーが発生しました</h1><p>設定を確認して、もう一度お試しください。</p><p class="note">エラー内容：${escapeHtml(err?.message || "unknown error")}</p>`), 500);
  }
}

async function exchangeAuthorizationCode(code, env) {
  const body = new URLSearchParams({
    client_id: env.IG_APP_ID,
    client_secret: env.IG_APP_SECRET,
    grant_type: "authorization_code",
    redirect_uri: env.IG_REDIRECT_URI,
    code,
  });

  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return parseApiResponse(res, "Instagram short-lived token exchange failed");
}

async function exchangeLongLivedToken(shortToken, env) {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", env.IG_APP_SECRET);
  url.searchParams.set("access_token", shortToken);

  const res = await fetch(url.toString());
  return parseApiResponse(res, "Instagram long-lived token exchange failed");
}

async function refreshLongLivedToken(token) {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);
  const res = await fetch(url.toString());
  return parseApiResponse(res, "Instagram token refresh failed");
}

async function fetchProfile(token, env) {
  const url = new URL(`${graphBase(env)}/me`);
  url.searchParams.set("fields", "id,username,account_type");
  url.searchParams.set("access_token", token);
  const res = await fetch(url.toString());
  return parseApiResponse(res, "Instagram profile request failed");
}

async function syncInstagram(env) {
  const raw = await env.IG_STORE.get("instagram_auth");
  if (!raw) return;

  const auth = JSON.parse(raw);
  const fields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp";

  const mediaUrl = new URL(`${graphBase(env)}/${auth.userId}/media`);
  mediaUrl.searchParams.set("fields", fields);
  mediaUrl.searchParams.set("limit", "18");
  mediaUrl.searchParams.set("access_token", auth.accessToken);

  const mediaRes = await fetch(mediaUrl.toString());
  const media = await parseApiResponse(mediaRes, "Instagram media request failed");
  const items = Array.isArray(media.data) ? media.data : [];
  const reels = items.filter((item) => item.media_product_type === "REELS");
  const posts = items.filter((item) => item.media_product_type !== "REELS");

  let stories = [];
  try {
    const storiesUrl = new URL(`${graphBase(env)}/${auth.userId}/stories`);
    storiesUrl.searchParams.set("fields", fields);
    storiesUrl.searchParams.set("access_token", auth.accessToken);
    const storiesRes = await fetch(storiesUrl.toString());
    const storyData = await parseApiResponse(storiesRes, "Instagram stories request failed");
    stories = Array.isArray(storyData.data) ? storyData.data : [];
  } catch (err) {
    console.warn("Stories sync skipped", safeError(err));
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    profile: {
      id: auth.userId,
      username: auth.username,
      accountType: auth.accountType,
    },
    posts,
    reels,
    stories,
  };

  await env.IG_STORE.put("instagram_public_feed", JSON.stringify(payload));
}

async function refreshAndSync(env) {
  const raw = await env.IG_STORE.get("instagram_auth");
  if (!raw) return;

  let auth = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);

  if (now - Number(auth.savedAt || 0) >= THIRTY_DAYS) {
    try {
      const refreshed = await refreshLongLivedToken(auth.accessToken);
      if (refreshed.access_token) {
        auth = {
          ...auth,
          accessToken: refreshed.access_token,
          savedAt: now,
          expiresAt: now + Number(refreshed.expires_in || 5184000),
        };
        await env.IG_STORE.put("instagram_auth", JSON.stringify(auth));
      }
    } catch (err) {
      console.error("Instagram token refresh error", safeError(err));
    }
  }

  try {
    await syncInstagram(env);
  } catch (err) {
    console.error("Instagram scheduled sync error", safeError(err));
  }
}

async function publicInstagramFeed(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(request, env) });
  }

  const raw = await env.IG_STORE.get("instagram_public_feed");
  if (!raw) {
    return json({ updatedAt: null, profile: null, posts: [], reels: [], stories: [] }, 200, corsHeaders(request, env));
  }

  return new Response(raw, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=120",
      ...corsHeaders(request, env),
    },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.SITE_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": allowed === "*" ? "*" : (origin === allowed ? origin : allowed),
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function parseApiResponse(res, message) {
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok || data?.error) {
    const apiMessage = data?.error?.message || data?.error_message || data?.raw || `HTTP ${res.status}`;
    throw new Error(`${message}: ${apiMessage}`);
  }
  return data;
}

function safeError(err) {
  return { name: err?.name, message: err?.message };
}

function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}
