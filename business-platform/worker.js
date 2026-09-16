const enc = new TextEncoder();
const dec = new TextDecoder();
const ONE_DAY = 86400;
const THIRTY_DAYS = ONE_DAY * 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") return Response.redirect(`${baseUrl(env)}/admin`, 302);
      if (url.pathname === "/health") return json({ ok: true, service: "instagram-feed-platform" });

      if (url.pathname === "/admin" && request.method === "GET") return adminPage(request, env);
      if (url.pathname === "/admin/login" && request.method === "POST") return adminLogin(request, env);
      if (url.pathname === "/admin/logout" && request.method === "POST") return adminLogout(env);
      if (url.pathname === "/admin/sites" && request.method === "POST") return createSite(request, env);
      if (url.pathname.startsWith("/admin/sites/") && request.method === "POST") return adminSiteAction(request, env);

      if (url.pathname === "/connect" && request.method === "GET") return clientConnectPage(request, env);
      if (url.pathname === "/oauth/start" && request.method === "GET") return oauthStart(request, env);
      if (url.pathname === "/oauth/callback" && request.method === "GET") return oauthCallback(request, env);

      if (url.pathname.startsWith("/api/feed/") && request.method === "GET") return publicFeed(request, env);
      if (url.pathname === "/embed.js" && request.method === "GET") return embedScript(request, env);

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error(error);
      return html(shell("エラー", `<h1>エラーが発生しました</h1><p>${escapeHtml(error?.message || "Unknown error")}</p>`), 500);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(syncAllSites(env));
  },
};

function requireConfig(env) {
  const required = ["ADMIN_PASSWORD", "SESSION_SECRET", "TOKEN_ENCRYPTION_KEY", "IG_APP_ID", "IG_APP_SECRET", "BASE_URL"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing settings: ${missing.join(", ")}`);
}

function baseUrl(env) {
  return String(env.BASE_URL || "").replace(/\/$/, "");
}

async function adminPage(request, env) {
  requireConfig(env);
  if (!(await hasAdminSession(request, env))) return html(loginPage());

  const sites = await listSites(env);
  const rows = [];
  for (const site of sites) {
    const connected = !!(await env.PLATFORM.get(`auth:${site.id}`));
    const connectUrl = `${baseUrl(env)}/connect?site=${encodeURIComponent(site.id)}&token=${encodeURIComponent(site.connectToken)}`;
    const embed = `<div data-instagram-feed="${site.id}"></div>\n<script src="${baseUrl(env)}/embed.js" data-site="${site.id}" defer></script>`;
    rows.push(`
      <article class="site-card">
        <div class="site-top"><div><span class="status ${connected ? "ok" : "wait"}">${connected ? "Instagram接続済み" : "未接続"}</span><h3>${escapeHtml(site.name)}</h3><a href="${escapeAttr(site.siteUrl)}" target="_blank" rel="noopener">${escapeHtml(site.siteUrl)}</a></div></div>
        <label>お客様に送るInstagram接続URL</label>
        <div class="copy-row"><input readonly value="${escapeAttr(connectUrl)}"><button type="button" data-copy="${escapeAttr(connectUrl)}">コピー</button></div>
        <label>ホームページに貼るコード</label>
        <textarea readonly>${escapeHtml(embed)}</textarea>
        <div class="actions">
          <a class="button" href="${escapeAttr(connectUrl)}" target="_blank">接続画面を確認</a>
          <form method="post" action="/admin/sites/${site.id}"><input type="hidden" name="action" value="sync"><button class="button secondary">今すぐ同期</button></form>
        </div>
      </article>`);
  }

  return html(shell("Instagram連携 管理", `
    <header class="admin-head"><div><p class="eyebrow">INSTAGRAM FEED PLATFORM</p><h1>店舗Instagram連携</h1><p>店舗URLを登録 → お客様に接続URLを送る → 埋め込みコードをホームページへ貼るだけ。</p></div><form method="post" action="/admin/logout"><button class="link-button">ログアウト</button></form></header>
    <section class="panel">
      <h2>新しい店舗を追加</h2>
      <form class="new-site" method="post" action="/admin/sites">
        <label>店舗名<input name="name" required placeholder="例：銀のフライパン"></label>
        <label>ホームページURL<input name="siteUrl" required type="url" placeholder="https://example.com"></label>
        <button class="button primary">店舗を登録</button>
      </form>
      <p class="hint">Instagramのパスワードは入力しません。店主さん本人がMeta公式画面で接続を許可します。</p>
    </section>
    <section class="site-list"><h2>登録店舗</h2>${rows.length ? rows.join("") : `<p class="empty">まだ店舗がありません。</p>`}</section>
    <script>document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',async()=>{await navigator.clipboard.writeText(b.dataset.copy);b.textContent='コピー済み';setTimeout(()=>b.textContent='コピー',1200)}));</script>
  `));
}

function loginPage() {
  return shell("管理ログイン", `
    <div class="login-card"><p class="eyebrow">INSTAGRAM FEED PLATFORM</p><h1>管理ページ</h1><p>あなたの事業用管理ページです。</p>
      <form method="post" action="/admin/login"><label>管理パスワード<input type="password" name="password" required autocomplete="current-password"></label><button class="button primary">ログイン</button></form>
      <p class="hint">ここで使うのはあなたの管理パスワードです。お客様のInstagramパスワードではありません。</p>
    </div>`);
}

async function adminLogin(request, env) {
  const form = await request.formData();
  const input = String(form.get("password") || "");
  if (!constantTimeEqual(input, env.ADMIN_PASSWORD)) return html(loginPage().replace("あなたの事業用管理ページです。", "<strong class='error'>パスワードが違います。</strong>"), 401);
  const cookie = await issueSessionCookie(env);
  return new Response(null, { status: 302, headers: { Location: `${baseUrl(env)}/admin`, "Set-Cookie": cookie } });
}

function adminLogout(env) {
  return new Response(null, { status: 302, headers: { Location: `${baseUrl(env)}/admin`, "Set-Cookie": "admin_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" } });
}

async function createSite(request, env) {
  if (!(await hasAdminSession(request, env))) return new Response("Unauthorized", { status: 401 });
  const form = await request.formData();
  const name = String(form.get("name") || "").trim();
  const siteUrlRaw = String(form.get("siteUrl") || "").trim();
  if (!name || !siteUrlRaw) throw new Error("店舗名とURLを入力してください。");
  const u = new URL(siteUrlRaw);
  if (!/^https?:$/.test(u.protocol)) throw new Error("URLはhttps://またはhttp://で入力してください。");
  const id = crypto.randomUUID();
  const site = { id, name, siteUrl: u.origin, connectToken: randomToken(24), createdAt: new Date().toISOString() };
  await env.PLATFORM.put(`site:${id}`, JSON.stringify(site));
  return redirect("/admin", env);
}

async function adminSiteAction(request, env) {
  if (!(await hasAdminSession(request, env))) return new Response("Unauthorized", { status: 401 });
  const id = new URL(request.url).pathname.split("/").pop();
  const form = await request.formData();
  if (form.get("action") === "sync") await syncSite(env, id);
  return redirect("/admin", env);
}

async function clientConnectPage(request, env) {
  requireConfig(env);
  const url = new URL(request.url);
  const site = await getSite(env, url.searchParams.get("site"));
  const token = url.searchParams.get("token") || "";
  if (!site || !constantTimeEqual(token, site.connectToken)) return new Response("Not Found", { status: 404 });
  const already = !!(await env.PLATFORM.get(`auth:${site.id}`));
  const start = `/oauth/start?site=${encodeURIComponent(site.id)}&token=${encodeURIComponent(site.connectToken)}`;
  return html(shell("Instagram連携", `
    <div class="client-card"><p class="eyebrow">INSTAGRAM CONNECTION</p><h1>${escapeHtml(site.name)}</h1><p>ホームページにInstagramの最新投稿を自動表示するための連携です。</p>
    <div class="safe"><strong>Instagramのパスワードを制作者へ伝える必要はありません。</strong><span>このあとMeta公式の画面で、店舗アカウントを選んで許可するだけです。</span></div>
    ${already ? `<p class="status ok big">現在Instagramと接続済みです。再接続する場合は下のボタンを押してください。</p>` : ""}
    <a class="button primary large" href="${escapeAttr(start)}">Instagramと接続する</a><p class="hint center">通常は1〜2分で完了します。</p></div>`));
}

async function oauthStart(request, env) {
  const url = new URL(request.url);
  const site = await getSite(env, url.searchParams.get("site"));
  const token = url.searchParams.get("token") || "";
  if (!site || !constantTimeEqual(token, site.connectToken)) return new Response("Not Found", { status: 404 });
  const state = randomToken(32);
  await env.PLATFORM.put(`state:${state}`, JSON.stringify({ siteId: site.id }), { expirationTtl: 600 });
  const auth = new URL("https://www.instagram.com/oauth/authorize");
  auth.searchParams.set("client_id", env.IG_APP_ID);
  auth.searchParams.set("redirect_uri", `${baseUrl(env)}/oauth/callback`);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "instagram_business_basic");
  auth.searchParams.set("state", state);
  auth.searchParams.set("enable_fb_login", "0");
  auth.searchParams.set("force_reauth", "true");
  return Response.redirect(auth.toString(), 302);
}

async function oauthCallback(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return html(shell("Instagram連携", `<h1>連携がキャンセルされました</h1><p>Instagramへの変更はありません。</p>`), 400);
  const code = String(url.searchParams.get("code") || "").replace(/#_$/, "");
  const state = String(url.searchParams.get("state") || "");
  const stateRaw = state ? await env.PLATFORM.get(`state:${state}`) : null;
  if (!code || !stateRaw) return html(shell("Instagram連携", `<h1>認証の有効期限が切れました</h1><p>接続URLからもう一度お試しください。</p>`), 400);
  await env.PLATFORM.delete(`state:${state}`);
  const { siteId } = JSON.parse(stateRaw);
  const site = await getSite(env, siteId);
  if (!site) throw new Error("店舗設定が見つかりません。");

  const short = await exchangeCode(code, env);
  const long = await exchangeLongToken(short.access_token, env);
  const accessToken = long.access_token || short.access_token;
  const profile = await getInstagramProfile(accessToken);
  const now = Math.floor(Date.now() / 1000);
  const auth = { accessToken, userId: profile.id, username: profile.username, accountType: profile.account_type || null, savedAt: now, expiresAt: now + Number(long.expires_in || 5184000) };
  await env.PLATFORM.put(`auth:${siteId}`, await encryptJson(auth, env));
  await syncSite(env, siteId);

  return html(shell("連携完了", `<div class="client-card"><p class="eyebrow">CONNECTED</p><h1>Instagram連携が完了しました</h1><p class="status ok big">✓ @${escapeHtml(profile.username || "Instagram")} と接続しました。</p><p>今後はいつも通りInstagramを更新するだけで大丈夫です。この画面は閉じてください。</p></div>`));
}

async function exchangeCode(code, env) {
  const body = new URLSearchParams({ client_id: env.IG_APP_ID, client_secret: env.IG_APP_SECRET, grant_type: "authorization_code", redirect_uri: `${baseUrl(env)}/oauth/callback`, code });
  const res = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  return apiJson(res, "Instagram認証コード交換に失敗しました");
}

async function exchangeLongToken(token, env) {
  const u = new URL("https://graph.instagram.com/access_token");
  u.searchParams.set("grant_type", "ig_exchange_token"); u.searchParams.set("client_secret", env.IG_APP_SECRET); u.searchParams.set("access_token", token);
  return apiJson(await fetch(u), "長期トークンの取得に失敗しました");
}

async function refreshToken(token) {
  const u = new URL("https://graph.instagram.com/refresh_access_token");
  u.searchParams.set("grant_type", "ig_refresh_token"); u.searchParams.set("access_token", token);
  return apiJson(await fetch(u), "トークン更新に失敗しました");
}

async function getInstagramProfile(token) {
  const u = new URL("https://graph.instagram.com/me");
  u.searchParams.set("fields", "id,username,account_type"); u.searchParams.set("access_token", token);
  return apiJson(await fetch(u), "Instagramプロフィール取得に失敗しました");
}

async function syncSite(env, siteId) {
  const site = await getSite(env, siteId);
  const encrypted = await env.PLATFORM.get(`auth:${siteId}`);
  if (!site || !encrypted) return;
  let auth = await decryptJson(encrypted, env);
  const now = Math.floor(Date.now() / 1000);
  if (now - Number(auth.savedAt || 0) >= THIRTY_DAYS) {
    try {
      const refreshed = await refreshToken(auth.accessToken);
      if (refreshed.access_token) {
        auth = { ...auth, accessToken: refreshed.access_token, savedAt: now, expiresAt: now + Number(refreshed.expires_in || 5184000) };
        await env.PLATFORM.put(`auth:${siteId}`, await encryptJson(auth, env));
      }
    } catch (e) { console.warn("refresh failed", siteId, e?.message); }
  }

  const fields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp";
  const mediaUrl = new URL(`https://graph.instagram.com/${auth.userId}/media`);
  mediaUrl.searchParams.set("fields", fields); mediaUrl.searchParams.set("limit", "18"); mediaUrl.searchParams.set("access_token", auth.accessToken);
  const media = await apiJson(await fetch(mediaUrl), "Instagram投稿取得に失敗しました");
  const items = Array.isArray(media.data) ? media.data : [];

  let stories = [];
  try {
    const storyUrl = new URL(`https://graph.instagram.com/${auth.userId}/stories`);
    storyUrl.searchParams.set("fields", fields); storyUrl.searchParams.set("access_token", auth.accessToken);
    const storyData = await apiJson(await fetch(storyUrl), "Stories取得に失敗しました");
    stories = Array.isArray(storyData.data) ? storyData.data : [];
  } catch (e) { console.warn("stories skipped", siteId, e?.message); }

  await env.PLATFORM.put(`feed:${siteId}`, JSON.stringify({
    updatedAt: new Date().toISOString(),
    profile: { id: auth.userId, username: auth.username, accountType: auth.accountType },
    posts: items.filter(x => x.media_product_type !== "REELS"),
    reels: items.filter(x => x.media_product_type === "REELS"),
    stories,
  }));
}

async function syncAllSites(env) {
  const sites = await listSites(env);
  for (const site of sites) {
    try { await syncSite(env, site.id); } catch (e) { console.error("sync", site.id, e?.message); }
  }
}

async function publicFeed(request, env) {
  const siteId = new URL(request.url).pathname.split("/").pop();
  const site = await getSite(env, siteId);
  if (!site) return json({ error: "site_not_found" }, 404);
  const raw = await env.PLATFORM.get(`feed:${siteId}`) || JSON.stringify({ updatedAt: null, profile: null, posts: [], reels: [], stories: [] });
  const origin = request.headers.get("Origin") || "";
  const allowed = new URL(site.siteUrl).origin;
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=120", "Access-Control-Allow-Origin": origin === allowed ? origin : allowed, "Vary": "Origin" };
  return new Response(raw, { headers });
}

function embedScript(request, env) {
  const script = `(async()=>{const s=document.currentScript;const id=s.dataset.site;const root=document.querySelector('[data-instagram-feed="'+id+'"]');if(!root)return;const base=${JSON.stringify(baseUrl(env))};root.innerHTML='<div style="padding:18px;text-align:center;font:14px sans-serif">Instagramを読み込み中...</div>';try{const r=await fetch(base+'/api/feed/'+encodeURIComponent(id));const d=await r.json();const items=[...(d.posts||[]),...(d.reels||[])].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).slice(0,6);const stories=(d.stories||[]).slice(0,6);let h='<style>.igw{font-family:-apple-system,BlinkMacSystemFont,sans-serif}.igw-stories{display:flex;gap:10px;overflow:auto;margin:0 0 14px}.igw-story{width:64px;flex:0 0 64px;text-align:center;text-decoration:none;color:inherit}.igw-story img,.igw-story video{width:58px;height:58px;border-radius:50%;object-fit:cover;border:2px solid #d78a31;padding:2px}.igw-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.igw-grid a{aspect-ratio:1;display:block;overflow:hidden;background:#eee}.igw-grid img,.igw-grid video{width:100%;height:100%;object-fit:cover}.igw-empty{padding:18px;text-align:center}</style><div class="igw">';if(stories.length){h+='<div class="igw-stories">'+stories.map(x=>'<a class="igw-story" href="'+(x.permalink||'#')+'" target="_blank" rel="noopener">'+(x.media_type==='VIDEO'?'<video muted playsinline src="'+x.media_url+'"></video>':'<img loading="lazy" src="'+x.media_url+'" alt="">')+'</a>').join('')+'</div>';}h+=items.length?'<div class="igw-grid">'+items.map(x=>'<a href="'+x.permalink+'" target="_blank" rel="noopener">'+(x.media_type==='VIDEO'?'<img loading="lazy" src="'+(x.thumbnail_url||'')+'" alt="">':'<img loading="lazy" src="'+x.media_url+'" alt="">')+'</a>').join('')+'</div>':'<div class="igw-empty">Instagramの投稿はまだありません。</div>';h+='</div>';root.innerHTML=h}catch(e){root.innerHTML='<div style="padding:18px;text-align:center;font:14px sans-serif">Instagramを読み込めませんでした。</div>'}})();`;
  return new Response(script, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}

async function listSites(env) {
  const out = [];
  let cursor;
  do {
    const list = await env.PLATFORM.list({ prefix: "site:", cursor });
    for (const k of list.keys) { const raw = await env.PLATFORM.get(k.name); if (raw) out.push(JSON.parse(raw)); }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return out.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function getSite(env, id) {
  if (!id) return null;
  const raw = await env.PLATFORM.get(`site:${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function apiJson(res, message) {
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok || data?.error) throw new Error(`${message}: ${data?.error?.message || data?.error_message || data?.raw || `HTTP ${res.status}`}`);
  return data;
}

async function issueSessionCookie(env) {
  const exp = Math.floor(Date.now()/1000) + ONE_DAY;
  const payload = String(exp);
  const sig = await hmac(payload, env.SESSION_SECRET);
  return `admin_session=${payload}.${sig}; Path=/; Max-Age=${ONE_DAY}; HttpOnly; Secure; SameSite=Lax`;
}

async function hasAdminSession(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)admin_session=([^;]+)/);
  if (!match) return false;
  const [exp, sig] = match[1].split(".");
  if (!exp || !sig || Number(exp) < Math.floor(Date.now()/1000)) return false;
  return constantTimeEqual(sig, await hmac(exp, env.SESSION_SECRET));
}

async function hmac(text, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
  return bytesToHex(sig);
}

async function encryptionKey(env) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(env.TOKEN_ENCRYPTION_KEY));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptJson(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(value));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), data));
  return JSON.stringify({ iv: bytesToBase64(iv), data: bytesToBase64(encrypted) });
}

async function decryptJson(raw, env) {
  const obj = JSON.parse(raw);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(obj.iv) }, await encryptionKey(env), base64ToBytes(obj.data));
  return JSON.parse(dec.decode(plain));
}

function shell(title, body) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title><style>
  :root{--navy:#111b2e;--blue:#2266e3;--bg:#f5f7fb;--ink:#1b2230;--muted:#6f7887;--line:#e2e7ef;--ok:#1e7c45;--wait:#9b6815}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif;padding:24px}main{max-width:920px;margin:auto}.eyebrow{font-size:12px;font-weight:800;letter-spacing:.13em;color:var(--blue)}h1{font-size:30px;margin:5px 0 9px;color:var(--navy)}h2{font-size:20px;color:var(--navy)}h3{margin:8px 0 4px}.panel,.site-card,.login-card,.client-card{background:#fff;border:1px solid var(--line);border-radius:20px;padding:22px;box-shadow:0 10px 35px rgba(17,27,46,.06)}.login-card,.client-card{max-width:520px;margin:7vh auto}.admin-head{display:flex;justify-content:space-between;gap:20px;align-items:start;margin-bottom:20px}.new-site{display:grid;grid-template-columns:1fr 1.4fr auto;gap:12px;align-items:end}label{display:block;font-size:13px;font-weight:700;color:var(--navy);margin:10px 0}input,textarea{width:100%;border:1px solid #ccd4e0;border-radius:12px;padding:13px;font:inherit;margin-top:6px;background:#fff}textarea{min-height:84px}.button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:12px;padding:13px 17px;background:var(--navy);color:#fff;text-decoration:none;font-weight:750;cursor:pointer}.primary{background:var(--blue)}.secondary{background:#eef2f8;color:var(--navy)}.large{width:100%;font-size:16px;padding:16px}.link-button{border:0;background:none;color:var(--muted);cursor:pointer}.hint{font-size:12px;color:var(--muted);line-height:1.65}.center{text-align:center}.site-list{margin-top:26px}.site-card{margin:14px 0}.site-card label{margin-top:16px}.site-card a:not(.button){color:#436083;font-size:13px}.copy-row{display:grid;grid-template-columns:1fr auto;gap:8px}.copy-row button{border:0;background:#edf2fb;border-radius:10px;padding:0 16px;font-weight:700}.actions{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}.actions form{margin:0}.status{display:inline-block;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:800}.status.ok{background:#e8f7ee;color:var(--ok)}.status.wait{background:#fff3dc;color:var(--wait)}.status.big{border-radius:14px;font-size:14px;padding:14px;display:block}.safe{background:#f0f5ff;border-radius:15px;padding:16px;margin:20px 0}.safe strong,.safe span{display:block}.safe span{font-size:13px;color:var(--muted);margin-top:5px;line-height:1.6}.error{color:#b72626}.empty{color:var(--muted)}@media(max-width:700px){body{padding:14px}.new-site{grid-template-columns:1fr}.admin-head{display:block}.copy-row{grid-template-columns:1fr}.copy-row button{padding:12px}.panel,.site-card,.login-card,.client-card{padding:18px}h1{font-size:25px}}
  </style></head><body><main>${body}</main></body></html>`;
}

function html(body, status=200){return new Response(body,{status,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer"}})}
function json(v,status=200){return new Response(JSON.stringify(v),{status,headers:{"Content-Type":"application/json; charset=utf-8"}})}
function redirect(path,env){return new Response(null,{status:302,headers:{Location:`${baseUrl(env)}${path}`}})}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function escapeAttr(v){return escapeHtml(v)}
function randomToken(bytes=24){return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)))}
function bytesToHex(bytes){return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("")}
function bytesToBase64(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
function base64ToBytes(s){const bin=atob(s);return Uint8Array.from(bin,c=>c.charCodeAt(0))}
function constantTimeEqual(a,b){a=String(a);b=String(b);if(a.length!==b.length)return false;let out=0;for(let i=0;i<a.length;i++)out|=a.charCodeAt(i)^b.charCodeAt(i);return out===0}
