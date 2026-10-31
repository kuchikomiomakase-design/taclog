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

  const LOGO = '<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><rect x="1.5" y="1.5" width="27" height="27" rx="4" fill="none" stroke="var(--ink)" stroke-width="2"></rect><path d="M8 10.5h14M15 10.5v12" stroke="var(--accent)" stroke-width="3.2" stroke-linecap="round"></path><circle cx="22.5" cy="21" r="3" fill="var(--loss)"></circle></svg>';

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
      "<span>TacLogはRiot Gamesが承認・後援するものではなく、Riot Gamesまたはその関係者の見解を反映するものではありません。VALORANTはRiot Games, Inc.の商標または登録商標です。</span>";
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
    const { data, error } = await sb.from("team_members").select("team_id, role, display_name, can_stream, teams(id, name, plan)").eq("user_id", s.user.id);
    if (error) throw error;
    return (data || []).filter((r) => r.teams).map((r) => ({ id: r.teams.id, name: r.teams.name, plan: r.teams.plan, role: r.role, display_name: r.display_name, can_stream: r.can_stream }));
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
    if (m.includes("Invalid login")) return "メールアドレスかパスワードが違います。";
    if (m.includes("already registered")) return "このメールアドレスはすでに登録されています。ログインしてください。";
    return m || "うまくいきませんでした。もう一度試してください。";
  };

  window.TL = { sb, configured, C, $, h, header, footer, notConfigured, session, requireLogin, myTeams, currentTeam, setTeam, api, errText };
})();
