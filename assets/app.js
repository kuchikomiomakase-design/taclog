// TacLog app shell: routing, matches, AI questions, settings
window.TACLOG_MAPS = [["ascent","アセント"],["bind","バインド"],["haven","ヘイヴン"],["split","スプリット"],["icebox","アイスボックス"],["breeze","ブリーズ"],["fracture","フラクチャー"],["pearl","パール"],["lotus","ロータス"],["sunset","サンセット"],["abyss","アビス"],["corrode","カロード"]];
window.APP = { team: null, teams: [], me: null, matches: [], reloadMatches: () => {} };
(function () {
  const { $, h, sb } = TL;
  const MAPS = window.TACLOG_MAPS;
  const mapName = (id) => (MAPS.find((m) => m[0] === id) || [id, id])[1];
  const fmt = (s) => { s = Math.max(0, Math.round(s)); const hh = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (hh ? hh + ":" + String(m).padStart(2, "0") : m) + ":" + String(ss).padStart(2, "0"); };
  const fmtDate = (s) => { if (!s) return ""; const d = new Date(s + "T00:00:00"); return (d.getMonth() + 1) + "/" + d.getDate() + "(" + "日月火水木金土"[d.getDay()] + ")"; };
  const sideJa = (s) => s === "attack" ? "アタック" : s === "defense" ? "ディフェンス" : "?";
  const PLAN_JA = { free: "無料", team: "チーム", org: "コーチ・組織" };
  const status = (t) => { const s = $("status"); s.hidden = !t; s.textContent = t || ""; };
  const VIEWS = ["analyze", "ask", "matches", "settings"];

  function route() {
    const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "analyze";
    VIEWS.forEach((k) => { $("view-" + k).hidden = k !== v; });
    document.querySelectorAll(".nav a").forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === "#" + v ? "page" : "false"));
    if (v === "settings") renderSettings();
    if (v === "analyze" && APP.team) renderFolder();
  }

  function renderHeader() {
    TL.header([{ href: "#analyze", label: "録画を分析" }, { href: "#ask", label: "AIに質問" }, { href: "#matches", label: "試合一覧" }, { href: "#settings", label: "設定" }]);
    if (APP.teams.length > 1) {
      const sel = h("select", { class: "teamsel", "aria-label": "チームを切り替える" }, APP.teams.map((t) => h("option", { value: t.id }, t.name)));
      sel.value = APP.team.id; sel.onchange = () => { TL.setTeam(sel.value); location.reload(); };
      document.querySelector(".nav").prepend(sel);
    }
  }

  /* ---------- matches ---------- */
  async function loadMatches() {
    const { data, error } = await sb.from("matches").select("*").eq("team_id", APP.team.id).order("date", { ascending: false }).order("created_at", { ascending: false });
    if (error) { status(TL.errText(error)); return; }
    APP.matches = data || []; renderMatches();
  }
  APP.reloadMatches = loadMatches;

  function renderMatches() {
    const ms = APP.matches, rounds = ms.reduce((a, m) => a + (m.rounds || []).length, 0);
    $("qScope").textContent = ms.length ? "分析ずみ:" + ms.length + "試合 ・ " + rounds + "ラウンド" : "分析した試合はまだありません";
    const box = $("mList");
    if (!ms.length) { box.replaceChildren(h("div", { class: "empty" }, h("strong", {}, "まだ試合がありません"), h("span", {}, "「録画を分析」から録画を読み込んで保存すると、ここに並びます。"))); return; }
    box.replaceChildren(...ms.map((m) => {
      const rs = m.rounds || [], w = rs.filter((r) => r.win === true).length, l = rs.filter((r) => r.win === false).length;
      const fkUs = rs.filter((r) => r.fk === "us").length, fkAll = rs.filter((r) => r.fk === "us" || r.fk === "them").length;
      const sel = h("select", { "aria-label": "マップ", class: "teamsel" }, h("option", { value: "" }, "マップ未設定"), MAPS.map(([v, n]) => h("option", { value: v }, n)));
      sel.value = m.map || "";
      sel.onchange = async () => { const { error } = await sb.from("matches").update({ map: sel.value }).eq("id", m.id); if (error) status(TL.errText(error)); else m.map = sel.value; };
      const canDel = APP.team.role === "admin" || m.created_by === APP.me.id;
      const del = h("button", { class: "btn small danger", type: "button" }, "削除");
      let armed = false;
      del.onclick = async () => { if (!armed) { armed = true; del.textContent = "もう一度押すと削除"; setTimeout(() => { armed = false; del.textContent = "削除"; }, 3000); return; }
        const { error } = await sb.from("matches").delete().eq("id", m.id); if (error) status(TL.errText(error)); else loadMatches(); };
      return h("div", { class: "matchrow" },
        h("div", { style: "display:grid;gap:4px;min-width:0" },
          h("div", { class: "row" }, h("strong", {}, fmtDate(m.date) + (m.opp ? " vs " + m.opp : "")), h("span", { class: "pill " + (w > l ? "win" : w < l ? "loss" : "mute") }, w + "−" + l), sel,
            h("span", { class: "small muted" }, rs.length + "ラウンド ・ 最初は" + sideJa(m.start_side) + (fkAll ? " ・ FK取得 " + fkUs + "/" + fkAll : ""))),
          m.comps && m.comps.left && m.comps.left.length ? h("span", { class: "small muted" }, "構成:" + m.comps.left.join(" / ")) : null),
        canDel ? del : h("span"));
    }));
  }

  /* ---------- ask ---------- */
  const TPL = ["ファーストラウンド(1・13ラウンド目)の取得率は?", "ファーストキルの取得率は?", "ファーストキルを取ったラウンドの勝率は?", "〈期間:例 この1週間〉の〈マップ〉で、アタックのときのラウンド取得率は?", "選手ごとのファーストキル数は?", "最初に倒されることが多いのは誰?", "設置が早いラウンドと遅いラウンドで勝率は違う?", "〈マップ〉の〈A/B〉サイトに設置したラウンドの勝率は?"];
  const chat = [];
  function ytLink(url, sec) { try { const u = new URL(url); u.searchParams.set("t", Math.max(0, Math.floor(sec)) + "s"); return u.toString(); } catch (e) { return null; } }
  function renderAnswer(box, ans) {
    box.replaceChildren(h("p", {}, String(ans.answer || "")));
    const c = ans.chart;
    if (c && Array.isArray(c.bars) && c.bars.length) {
      const max = Math.max(1, ...c.bars.map((b) => Number(b.value) || 0));
      box.append(h("div", { class: "bars" }, h("strong", { class: "small" }, String(c.title || "")), c.bars.slice(0, 12).map((b) => h("div", { class: "barrow" }, h("span", {}, String(b.label)), h("span", { class: "track" }, h("i", { style: "width:" + Math.round((Number(b.value) || 0) / max * 100) + "%" })), h("span", { class: "mono", style: "text-align:right" }, (Number(b.value) || 0) + (c.unit || ""))))));
    }
    const sc = Array.isArray(ans.scenes) ? ans.scenes.slice(0, 5) : [];
    if (sc.length) {
      box.append(h("span", { class: "small muted" }, "根拠になった場面"));
      sc.forEach((s) => { const m = APP.matches.find((x) => x.id === s.match); const r = m && (m.rounds || []).find((x) => x.n === Number(s.round)); const sec = r ? (r.plantAt ?? r.start) : null; const link = m && m.yt && sec != null ? ytLink(m.yt, sec) : null;
        box.append(h("div", { class: "scene" }, h("span", {}, (m ? fmtDate(m.date) + (m.opp ? " vs " + m.opp : "") + " " : "") + "第" + s.round + "ラウンド" + (s.note ? " ・ " + s.note : "")), link ? h("a", { href: link, target: "_blank", rel: "noopener", class: "mono" }, "▶ " + fmt(sec)) : sec != null ? h("span", { class: "mono small muted" }, "動画の " + fmt(sec)) : null)); });
    }
  }
  function setupAsk() {
    TPL.forEach((t) => $("tpls").append(h("button", { type: "button", class: "chip", onclick: () => { $("q").value = t; $("q").focus(); } }, t)));
    $("askForm").addEventListener("submit", async (e) => {
      e.preventDefault(); const q = $("q").value.trim(); if (!q) return;
      if (!APP.matches.length) { status("まだ分析した試合がありません。先に「録画を分析」から1本入れてください。"); return; }
      const thread = $("thread"); if (thread.querySelector(".empty")) thread.replaceChildren();
      thread.append(h("div", { class: "bubble" }, q)); const box = h("div", { class: "answer" }, h("span", { class: "muted small" }, "考えています…")); thread.append(box);
      $("q").value = ""; $("askBtn").disabled = true;
      try { const ans = await TL.api("/api/ask", { teamId: APP.team.id, question: q, history: chat.slice(-2) }); renderAnswer(box, ans || {}); chat.push({ q, a: String((ans && ans.answer) || "") }); }
      catch (err) { box.replaceChildren(h("p", {}, TL.errText(err))); }
      finally { $("askBtn").disabled = false; }
    });
  }


  /* ---------- recording folder ---------- */
  let folderBusy = false;
  const dateOf = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  async function renderFolder() {
    const body = $("folderBody"), name = $("folderName");
    body.replaceChildren(); name.textContent = "";
    if (!TLFolder.supported) { body.append(h("p", { class: "small muted" }, "録画フォルダの自動読み取りは、パソコン版のGoogle ChromeかMicrosoft Edgeで使えます。下の「手動で選んで分析する」から録画を選んでください。")); return; }
    const hd = await TLFolder.handle();
    if (!hd) {
      body.append(h("p", { class: "small muted" }, "OBSの録画が保存されるフォルダを連携すると、ここに新しい録画が自動で出てきます。"),
        h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: async () => { try { await TLFolder.link(); renderFolder(); } catch (e) {} } }, "録画フォルダを連携する")));
      return;
    }
    name.textContent = "フォルダ:" + hd.name;
    if (!(await TLFolder.permission(hd, false))) {
      body.append(h("p", { class: "small muted" }, "安全のため、ブラウザを開き直すたびにフォルダを読む許可が必要です。"),
        h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: async () => { if (await TLFolder.permission(hd, true)) renderFolder(); } }, "録画フォルダを読み込む")));
      return;
    }
    let vids = [];
    try { vids = await TLFolder.videos(hd); } catch (e) { body.append(h("p", { class: "notice" }, "フォルダを読めませんでした。設定画面から連携し直してください。")); return; }
    const fresh = [];
    for (const v of vids) if (!v.recording && !(await TLFolder.isDone(APP.team.id, v))) fresh.push(v);
    const recNow = vids.filter((v) => v.recording);
    if (recNow.length) body.append(h("p", { class: "small muted" }, "録画中のファイルがあります(" + recNow[0].name + ")。配信が終わってから分析できます。"));
    if (!fresh.length) { body.append(h("div", { class: "empty" }, h("strong", {}, "新しい録画はありません"), h("span", {}, "配信が終わったら、このページを開くと自動で見つかります。"))); return; }
    const list = h("div", { style: "display:grid;gap:8px" });
    fresh.slice(0, 10).forEach((v) => list.append(h("div", { class: "member" }, h("div", { style: "display:grid;gap:2px;min-width:0" }, h("strong", { style: "overflow-wrap:anywhere" }, v.name), h("span", { class: "small muted" }, new Date(v.mtime).toLocaleString("ja-JP") + " ・ " + Math.round(v.size / 1048576) + "MB")),
      h("span", { class: "pill warn", id: "st_" + encodeURIComponent(v.name) }, "未分析"))));
    const go = h("button", { class: "btn primary", type: "button" }, fresh.length > 1 ? "新しい録画 " + Math.min(fresh.length, 10) + "本を分析する" : "この録画を分析する");
    const stop = h("button", { class: "btn", type: "button", hidden: true }, "止める");
    const note = h("p", { class: "small muted" }, "分析中はこのページを開いたままにしてください。3時間の録画で数分かかります。マップはあとで試合一覧から設定できます。");
    body.append(h("p", {}, "新しい録画が " + fresh.length + " 本あります。"), list, h("div", { class: "row" }, go, stop), note);
    let stopped = false;
    stop.onclick = () => { stopped = true; window.ANALYZER && ANALYZER.stop(); };
    go.onclick = async () => {
      if (folderBusy) return; folderBusy = true; stopped = false; go.disabled = true; stop.hidden = false;
      const delAfter = await TLFolder.getDeleteAfter();
      for (const v of fresh.slice(0, 10)) {
        if (stopped) break;
        const st = document.getElementById("st_" + encodeURIComponent(v.name));
        const set = (t, cls) => { if (st) { st.textContent = t; st.className = "pill " + cls; } };
        set("分析中…", "");
        try {
          $("manualBox").open = true;
          await ANALYZER.loadFile(v.file);
          const ok = await ANALYZER.runAnalysis();
          if (!ok) { set(stopped ? "止めました" : "分析できませんでした", "loss"); continue; }
          await ANALYZER.saveLast({ date: dateOf(v.mtime), opp: "", map: "", yt: "" });
          await TLFolder.markDone(APP.team.id, v);
          set("保存しました", "win");
          if (delAfter) { try { await TLFolder.remove(hd, v.name); } catch (e) {} }
        } catch (e) { set(TL.errText(e).slice(0, 40), "loss"); if (String(e.message || "").includes("analysis limit")) break; }
      }
      folderBusy = false; go.disabled = false; stop.hidden = true; loadMatches();
    };
  }

  /* ---------- settings ---------- */
  async function renderSettings() {
    const t = APP.team, isAdmin = t.role === "admin";
    $("teamName").value = t.name; $("teamName").disabled = !isAdmin; $("saveTeam").hidden = !isAdmin;
    $("planName").textContent = PLAN_JA[t.plan] || t.plan;
    const mon = new Date().toISOString().slice(0, 7);
    const { data: u } = await sb.from("usage").select("*").eq("team_id", t.id).eq("month", mon).maybeSingle();
    const lim = t.plan === "free" ? { a: 2, q: 20 } : t.plan === "team" ? { a: null, q: 300 } : { a: null, q: null };
    $("usageText").textContent = "今月:分析 " + ((u && u.analyses) || 0) + (lim.a ? "/" + lim.a : "") + "本 ・ 質問 " + ((u && u.questions) || 0) + (lim.q ? "/" + lim.q : "") + "回";
    const br = $("billingRow"); br.replaceChildren();
    if (isAdmin) {
      if (!TL.C.BILLING_ENABLED) br.append(h("span", { class: "small muted" }, "有料プランは準備中です。"));
      else if (t.plan === "free") { ["team", "org"].forEach((p) => br.append(h("button", { class: "btn small" + (p === "team" ? " primary" : ""), type: "button", onclick: () => billing("/api/checkout", { plan: p }) }, PLAN_JA[p] + "プランにする"))); }
      else br.append(h("button", { class: "btn small", type: "button", onclick: () => billing("/api/portal", {}) }, "支払い・解約の管理"));
    }
    // members
    const { data: mem } = await sb.from("team_members").select("user_id, role, display_name, can_stream").eq("team_id", t.id).order("joined_at");
    $("members").replaceChildren(...(mem || []).map((m) => {
      const mine = m.user_id === APP.me.id;
      const tog = h("input", { type: "checkbox", id: "cs_" + m.user_id }); tog.checked = m.can_stream; tog.disabled = !(mine || isAdmin);
      tog.onchange = async () => { const { error } = await sb.from("team_members").update({ can_stream: tog.checked }).eq("team_id", t.id).eq("user_id", m.user_id); if (error) { status(TL.errText(error)); tog.checked = !tog.checked; } };
      return h("div", { class: "member" }, h("div", { class: "row" }, h("strong", {}, (m.display_name || "名前なし") + (mine ? "(あなた)" : "")), h("span", { class: "pill mute" }, m.role === "admin" ? "管理者" : "メンバー")),
        h("label", { class: "row", for: "cs_" + m.user_id, style: "font-weight:400;display:flex" }, tog, "配信する"));
    }));
    const ib = $("inviteBox"); ib.replaceChildren();
    if (isAdmin) {
      const out = h("input", { readonly: true, "aria-label": "招待リンク", style: "flex:1 1 260px", placeholder: "「招待リンクを作る」を押してください" });
      const copy = h("button", { class: "btn small", type: "button" }, "コピー");
      copy.onclick = () => navigator.clipboard.writeText(out.value).then(() => copy.textContent = "コピーしました").catch(() => out.select());
      const mk = h("button", { class: "btn small primary", type: "button" }, "招待リンクを作る");
      mk.onclick = async () => { const { data, error } = await sb.rpc("create_invite", { t: t.id }); if (error) status(TL.errText(error)); else out.value = location.origin + "/invite?t=" + data; };
      ib.append(h("div", { class: "row" }, mk), h("div", { class: "row" }, out, copy), h("span", { class: "small muted" }, "リンクは14日間有効です。"));
    }
    // linked accounts
    const ids = (APP.me.identities || []).map((i) => i.provider);
    const row = (name, desc, state) => h("div", { class: "member" }, h("div", { style: "display:grid;gap:2px;min-width:0" }, h("strong", {}, name), h("span", { class: "small muted" }, desc)), state);
    const fh = TLFolder.supported ? await TLFolder.handle() : null;
    const folderState = !TLFolder.supported ? h("span", { class: "pill mute" }, "このブラウザでは使えません")
      : h("div", { class: "row" }, fh ? h("span", { class: "pill win" }, "連携ずみ:" + fh.name) : null,
          h("button", { class: "btn small", type: "button", onclick: async () => { try { await TLFolder.link(); renderSettings(); } catch (e) {} } }, fh ? "選び直す" : "連携する"),
          fh ? h("button", { class: "btn small ghost", type: "button", onclick: async () => { await TLFolder.unlink(); renderSettings(); } }, "解除") : null);
    $("delAfter").checked = await TLFolder.getDeleteAfter();
    $("delAfter").onchange = async () => { await TLFolder.setDeleteAfter($("delAfter").checked); const hd = await TLFolder.handle(); if (hd && $("delAfter").checked) await TLFolder.permission(hd, true, "readwrite"); };
    $("links").replaceChildren(
      row("録画フォルダ", "OBSの録画が保存されるフォルダ。このパソコンのブラウザに記憶されます", folderState),
      row("Google", "ログインに使えます", ids.includes("google") ? h("span", { class: "pill win" }, "つながっています") : h("button", { class: "btn small", type: "button", onclick: () => sb.auth.linkIdentity ? sb.auth.linkIdentity({ provider: "google", options: { redirectTo: location.origin + "/app#settings" } }) : null }, "つなぐ")),
      row("Riotアカウント", "VALORANTの分析に必要です(Riotの承認後に使えるようになります)", h("span", { class: "pill mute" }, "準備中")),
      row("YouTubeチャンネル", "分析し忘れた配信に気づけるようになります", h("span", { class: "pill mute" }, "準備中")));
    // prefs
    const { data: pr } = await sb.from("notification_prefs").select("*").eq("team_id", t.id).eq("user_id", APP.me.id).maybeSingle();
    [["nArrived", "arrived"], ["nMissing", "missing"], ["nReport", "report"]].forEach(([id, k]) => { const el = $(id); el.checked = pr ? pr[k] : true;
      el.onchange = async () => { const { error } = await sb.from("notification_prefs").upsert({ team_id: t.id, user_id: APP.me.id, arrived: $("nArrived").checked, missing: $("nMissing").checked, report: $("nReport").checked }); $("prefsSaved").textContent = error ? TL.errText(error) : "保存しました"; }; });
    $("meMail").textContent = "ログイン中:" + (APP.me.email || "");
  }
  async function billing(path, body) { try { const r = await TL.api(path, { teamId: APP.team.id, ...body }); if (r && r.url) location.href = r.url; } catch (e) { status(TL.errText(e)); } }

  /* ---------- boot ---------- */
  (async () => {
    TL.footer();
    if (!sb) { renderHeaderSafe(); TL.notConfigured(); return; }
    const s = await TL.requireLogin(); if (!s) return;
    APP.me = s.user;
    try { APP.teams = await TL.myTeams(); } catch (e) { status(TL.errText(e)); return; }
    if (!APP.teams.length) { location.href = "/onboarding"; return; }
    APP.team = TL.currentTeam(APP.teams); TL.setTeam(APP.team.id);
    renderHeader();
    $("mMap").append(...MAPS.map(([v, n]) => h("option", { value: v }, n)));
    const d = new Date(); $("mDate").value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    setupAsk();
    $("saveTeam").onclick = async () => { const { error } = await sb.from("teams").update({ name: $("teamName").value.trim() }).eq("id", APP.team.id); status(error ? TL.errText(error) : ""); if (!error) APP.team.name = $("teamName").value.trim(); };
    $("logout").onclick = async () => { await sb.auth.signOut(); location.href = "/"; };
    window.addEventListener("hashchange", route); route();
    loadMatches();
    const qp = new URLSearchParams(location.search); if (qp.get("billing") === "success") status("お支払いが完了しました。プランが切り替わるまで数秒かかることがあります。");
  })();
  function renderHeaderSafe() { TL.header([]); }
})();
