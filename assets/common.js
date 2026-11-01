// TacLog shared helpers (loaded on every page after supabase-js and config.js)
(function () {
  const C = window.TACLOG_CONFIG || {};
  const configured = C.SUPABASE_URL && !C.SUPABASE_URL.includes("YOUR-PROJECT");
  const sb = configured && window.supabase ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } }) : null;

  const $ = (id) => document.getElementById(id);
  const h = (t, a = {}, ...c) => {
    const e = document.createElement(t);
    for (const [k, v] of Object.entries(a || {})) {
      if (v === false || v == null) continue;
      if (k === "class") e.className = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const x of c.flat(Infinity)) { if (x == null || x === false) continue; e.append(x.nodeType ? x : document.createTextNode(String(x))); }
    return e;
  };

  const LOGO = '<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><path d="M3 3h18l6 6v18H9l-6-6z" fill="none" stroke="var(--accent)" stroke-width="2"></path><path d="M9 11h12M15 11v11" stroke="var(--ink)" stroke-width="3" stroke-linecap="square"></path><path d="M21 21l3 3" stroke="var(--data)" stroke-width="2.5"></path></svg>';
  // Supported titles. "ready" = automatic recording analysis is available.
  const GAMES = [
    { id: "valorant", name: "VALORANT", maker: "Riot Games", color: "#FF4655", ready: true },
    { id: "cs2", name: "Counter-Strike 2", short: "CS2", maker: "Valve", color: "#F2A93B", ready: false },
    { id: "ow2", name: "Overwatch 2", short: "OW2", maker: "Blizzard", color: "#F99E1A", ready: false },
    { id: "apex", name: "Apex Legends", maker: "EA / Respawn", color: "#DA292A", ready: false },
    { id: "fortnite", name: "Fortnite", maker: "Epic Games", color: "#9D4DFF", ready: false }
  ];
  const gameName = (id) => { const g = GAMES.find((x) => x.id === id); return g ? (g.short || g.name) : id; };
  const ADDON_YEN = 500;

  function header(links) {
    const el = $("topbar"); if (!el) return;
    el.className = "topbar";
    const nav = h("nav", { class: "nav", "aria-label": "メニュー" });
    (links || []).forEach((l) => nav.append(h("a", { href: l.href, "aria-current": location.pathname.replace(/\/$/, "") === l.href.replace(/\/$/, "") ? "page" : false }, l.label)));
    const logo = h("a", { class: "logo", href: "/" }); logo.innerHTML = LOGO + "<span>TacLog</span>";
    el.replaceChildren(logo, nav);
  }

  function footer() {
    const el = $("footer"); if (!el) return;
    el.className = "site";
    el.innerHTML = '<span><a href="/legal/terms">利用規約</a> ・ <a href="/legal/privacy">プライバシーポリシー</a> ・ <a href="/legal/tokushoho">特定商取引法に基づく表記</a> ・ <a href="/pricing">料金</a> ・ <a href="/app#contact">お問い合わせ</a></span>' +
      "<span>TacLogは非公式のファンメイドツールで、各ゲームの開発・運営会社(Riot Games、Valve、Blizzard Entertainment、Electronic Arts、Epic Gamesなど)が承認・後援するものではありません。VALORANTはRiot Games, Inc.の、その他のゲーム名はそれぞれの権利者の商標または登録商標です。</span>";
  }

  function notConfigured(target) {
    const el = target || $("main");
    if (el) el.prepend(h("div", { class: "notice" }, "まだSupabaseの設定が入っていません。assets/config.js に SUPABASE_URL と SUPABASE_ANON_KEY を入れてください(README の手順2)。"));
  }

  async function session() { if (!sb) return null; const { data } = await sb.auth.getSession(); return data.session || null; }

  async function requireLogin() {
    const s = await session();
    if (!s) { location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search); return null; }
    return s;
  }

  async function myTeams() {
    const s = await session(); if (!s) return [];
    const { data, error } = await sb.from("team_members").select("team_id, role, display_name, can_stream, teams(id, name, plan, games, extra_games)").eq("user_id", s.user.id);
    if (error) throw error;
    return (data || []).filter((r) => r.teams).map((r) => ({ id: r.teams.id, name: r.teams.name, plan: r.teams.plan, games: r.teams.games || ["valorant"], extra_games: r.teams.extra_games || 0, role: r.role, display_name: r.display_name, can_stream: r.can_stream }));
  }

  function currentTeam(teams) {
    let id = null; try { id = localStorage.getItem("taclog.team"); } catch (e) {}
    return teams.find((t) => t.id === id) || teams[0] || null;
  }
  function setTeam(id) { try { localStorage.setItem("taclog.team", id); } catch (e) {} }

  async function api(path, body) {
    const s = await session();
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + (s ? s.access_token : "") }, body: JSON.stringify(body || {}) });
    let data = null; try { data = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error((data && data.error) || "通信に失敗しました"); err.code = data && data.code; err.status = r.status; throw err; }
    return data;
  }

  const errText = (e) => {
    const m = String((e && e.message) || e || "");
    if (m.includes("analysis limit")) return "今月の分析回数の上限に達しました。チームプランにすると無制限になります。";
    if (m.includes("question limit")) return "今月の質問回数の上限に達しました。プランを変えると回数が増えます。";
    if (m.includes("member limit")) return "このチームはメンバーの上限に達しています。";
    if (m.includes("invalid invite")) return "この招待リンクは無効か、期限が切れています。チームの管理者に新しいリンクをもらってください。";
    if (m.includes("game limit")) return "使えるタイトルの数を超えています。タイトルを追加してください。";
    if (m.includes("Invalid login")) return "メールアドレスかパスワードが違います。";
    if (m.includes("already registered")) return "このメールアドレスはすでに登録されています。ログインしてください。";
    return m || "うまくいきませんでした。もう一度試してください。";
  };

  window.TL = { GAMES, gameName, ADDON_YEN, sb, configured, C, $, h, header, footer, notConfigured, session, requireLogin, myTeams, currentTeam, setTeam, api, errText };
})();
