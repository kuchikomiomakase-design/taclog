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
  const VIEWS = ["dash", "analyze", "channel", "ask", "matches", "contact", "settings"];

  function route() {
    const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "analyze";
    VIEWS.forEach((k) => { $("view-" + k).hidden = k !== v; });
    document.querySelectorAll(".nav a").forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === "#" + v ? "page" : "false"));
    if (v === "settings") renderSettings();
    if (v === "contact") loadContact();
    if (v === "analyze" && APP.team) renderFolder();
    if (v === "dash" && window.renderDash) window.renderDash();
  }

  /* ---------- game titles ---------- */
  function pickGame() {
    let g = null; try { g = localStorage.getItem("taclog.game." + APP.team.id); } catch (e) {}
    const list = APP.team.games && APP.team.games.length ? APP.team.games : ["valorant"];
    APP.game = list.includes(g) ? g : list[0];
  }
  function renderGameBar() {
    const bar = $("gameBar"), list = APP.team.games || ["valorant"];
    bar.replaceChildren(h("span", { class: "eyebrow" }, "Title"),
      ...list.map((id) => { const b = h("button", { type: "button", class: "gtab", "aria-pressed": id === APP.game ? "true" : "false" }, TL.gameName(id));
        b.onclick = () => { APP.game = id; try { localStorage.setItem("taclog.game." + APP.team.id, id); } catch (e) {} renderGameBar(); loadMatches(); renderAnalyzeGate(); };
        return b; }),
      APP.team.role === "admin" ? h("a", { href: "#settings", class: "small", style: "margin-left:4px" }, "+ タイトルを追加") : null);
  }
  function renderAnalyzeGate() {
    const g = TL.GAMES.find((x) => x.id === APP.game), ready = !g || g.ready;
    $("gameSoon").hidden = ready; $("folderCard").hidden = !ready; $("manualBox").hidden = !ready;
    if (!ready) $("gameSoonName").textContent = g.name;
  }

  function renderHeader() {
    TL.header([{ href: "#dash", label: "ダッシュボード" }, { href: "#analyze", label: "録画を分析" }, { href: "#channel", label: "チャンネル" }, { href: "#ask", label: "AIに質問" }, { href: "#matches", label: "試合一覧" }, { href: "#contact", label: "お問い合わせ" }, { href: "#settings", label: "設定" }]);
    updateBadge();
    if (APP.teams.length > 1) {
      const sel = h("select", { class: "teamsel", "aria-label": "チームを切り替える" }, APP.teams.map((t) => h("option", { value: t.id }, t.name)));
      sel.value = APP.team.id; sel.onchange = () => { TL.setTeam(sel.value); location.reload(); };
      document.querySelector(".nav").prepend(sel);
    }
  }

  /* ---------- matches ---------- */
  async function loadMatches() {
    const { data, error } = await sb.from("matches").select("*").eq("team_id", APP.team.id).eq("game", APP.game || "valorant").order("date", { ascending: false }).order("created_at", { ascending: false });
    if (error) { status(TL.errText(error)); return; }
    APP.matches = data || []; renderMatches(); renderChannel(); if (!$("view-dash").hidden && window.renderDash) window.renderDash();
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
        const { error } = await sb.from("matches").delete().eq("id", m.id); if (error) status(TL.errText(error)); else { try { if (window.TLFolder) await TLFolder.unmarkByFile(APP.team.id, m.file); } catch (e) {} loadMatches(); renderFolder(); } };
      return h("div", { class: "matchrow" },
        h("div", { style: "display:grid;gap:4px;min-width:0" },
          h("div", { class: "row" }, h("strong", {}, fmtDate(m.date) + (m.opp ? " vs " + m.opp : "")), h("span", { class: "pill " + (w > l ? "win" : w < l ? "loss" : "mute") }, w + "−" + l), sel,
            h("span", { class: "small muted" }, rs.length + "ラウンド ・ 最初は" + sideJa(m.start_side) + (fkAll ? " ・ FK取得 " + fkUs + "/" + fkAll : ""))),
          m.comps && m.comps.left && m.comps.left.length ? h("span", { class: "small muted" }, "構成:" + m.comps.left.join(" / ")) : null),
        canDel ? del : h("span"));
    }));
  }

  /* ---------- channel ---------- */
  const seenKey = () => "taclog.seen." + APP.team.id;
  function seenSet() { try { return new Set(JSON.parse(localStorage.getItem(seenKey()) || "[]")); } catch (e) { return new Set(); } }
  function markSeen(ids) { const s = seenSet(); ids.forEach((i) => s.add(i)); try { localStorage.setItem(seenKey(), JSON.stringify([...s].slice(-2000))); } catch (e) {} }
  function firstVisitInit() { try { if (localStorage.getItem(seenKey()) == null) markSeen(APP.matches.filter((m) => Date.now() - new Date(m.created_at).getTime() > 864e5).map((m) => m.id)); } catch (e) {} }
  const isNew = (m, seen) => !seen.has(m.id);
  function updateBadge() {
    const a = document.querySelector('.nav a[href="#channel"]'); if (!a || !APP.team) return;
    const seen = seenSet(), n = APP.matches.filter((m) => isNew(m, seen)).length;
    a.replaceChildren(document.createTextNode("チャンネル"), ...(n ? [h("span", { class: "dot", "aria-label": "新しい試合 " + n + "件" })] : []));
  }
  const pct = (a, b) => b ? Math.round(a / b * 100) + "%" : "—";
  function renderChannel() {
    const feed = $("feed"); if (!feed || !APP.team) return;
    firstVisitInit();
    const seen = seenSet(), ms = APP.matches, newCount = ms.filter((m) => isNew(m, seen)).length;
    $("seenAll").hidden = !newCount; $("seenAll").onclick = () => { markSeen(ms.map((m) => m.id)); renderChannel(); };
    updateBadge();
    if (!ms.length) { feed.replaceChildren(h("div", { class: "empty" }, h("strong", {}, "まだ試合がありません"), h("span", {}, "録画を分析すると、ここに投稿のように流れてきます。"))); return; }
    feed.replaceChildren(...ms.map((m) => {
      const rs = m.rounds || [], fresh = isNew(m, seen);
      const w = rs.filter((r) => r.win === true).length, l = rs.filter((r) => r.win === false).length;
      const att = rs.filter((r) => r.side === "attack" && r.win != null), def = rs.filter((r) => r.side === "defense" && r.win != null);
      const fk = rs.filter((r) => r.fk === "us" || r.fk === "them"), fkUs = fk.filter((r) => r.fk === "us");
      const missing = !m.map || !m.date;
      const id = (k) => "c_" + k + "_" + m.id;
      const date = h("input", { type: "date", id: id("date"), value: m.date || "" });
      const opp = h("input", { id: id("opp"), maxlength: "40", placeholder: "例:練習相手A", value: m.opp || "" });
      const map = h("select", { id: id("map") }, h("option", { value: "" }, "マップを選ぶ"), MAPS.map(([v, n]) => h("option", { value: v }, n))); map.value = m.map || "";
      const yt = h("input", { id: id("yt"), type: "url", placeholder: "https://www.youtube.com/watch?v=...", value: m.yt || "" });
      const msg = h("span", { class: "small muted" });
      const save = h("button", { class: "btn small primary", type: "button" }, "保存");
      save.onclick = async () => {
        save.disabled = true;
        const patch = { date: date.value || null, opp: opp.value.trim(), map: map.value, yt: yt.value.trim() };
        const { error } = await sb.from("matches").update(patch).eq("id", m.id);
        save.disabled = false;
        if (error) { msg.textContent = TL.errText(error); return; }
        Object.assign(m, patch); markSeen([m.id]); renderMatches(); renderChannel();
      };
      const ok = h("button", { class: "btn small ghost", type: "button", hidden: !fresh }, "確認した");
      ok.onclick = () => { markSeen([m.id]); renderChannel(); };
      return h("article", { class: "post" + (fresh ? " new" : ""), id: "post_" + m.id },
        h("div", { class: "spread" },
          h("div", { class: "row" }, fresh ? h("span", { class: "newbadge" }, "NEW") : null,
            h("strong", { style: "font-size:17px" }, (m.date ? fmtDate(m.date) : "日付未設定") + (m.opp ? " vs " + m.opp : "")),
            h("span", { class: "pill " + (m.map ? "mute" : "warn") }, m.map ? mapName(m.map) : "マップ未設定"),
            h("span", { class: "pill " + (w > l ? "win" : w < l ? "loss" : "mute") }, w + "−" + l)),
          h("span", { class: "small muted" }, "読み込み:" + new Date(m.created_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }))),
        h("div", { class: "stats4" },
          h("div", {}, h("span", { class: "k" }, "アタック取得率"), h("span", { class: "v" }, pct(att.filter((r) => r.win).length, att.length))),
          h("div", {}, h("span", { class: "k" }, "ディフェンス取得率"), h("span", { class: "v" }, pct(def.filter((r) => r.win).length, def.length))),
          h("div", {}, h("span", { class: "k" }, "ファーストキル取得率"), h("span", { class: "v" }, pct(fkUs.length, fk.length))),
          h("div", {}, h("span", { class: "k" }, "ファーストラウンド"), h("span", { class: "v" }, [1, 13].map((n) => { const r = rs.find((x) => x.n === n); return r ? (r.win === true ? "○" : r.win === false ? "×" : "?") : "-"; }).join(" ")))),
        missing ? h("p", { class: "small", style: "color:var(--warn);font-weight:700;margin:0" }, "日付とマップを入れると、マップごとの集計に使えるようになります。") : null,
        h("div", { class: "editgrid" },
          h("label", { for: id("date") }, "日付", date), h("label", { for: id("opp") }, "相手(メモ用)", opp),
          h("label", { for: id("map") }, "マップ", map), h("label", { for: id("yt") }, "YouTubeのURL", yt)),
        h("div", { class: "row" }, save, ok, msg));
    }));
  }

  /* ---------- contact ---------- */
  let contactData = [];
  const readKey = () => "taclog.contactRead";
  function contactUnread() { let r = 0; try { r = Number(localStorage.getItem(readKey()) || 0); } catch (e) {} return contactData.filter((i) => i.last_staff_at && new Date(i.last_staff_at).getTime() > r).length; }
  function contactBadge() {
    const a = document.querySelector('.nav a[href="#contact"]'); if (!a) return;
    const n = contactUnread();
    a.replaceChildren(document.createTextNode("お問い合わせ"), ...(n ? [h("span", { class: "dot", "aria-label": "新しい返信 " + n + "件" })] : []));
  }
  async function loadContact() {
    try { const r = await TL.api("/api/contact", { action: "list" }); contactData = r.inquiries || []; } catch (e) { $("cMsg").textContent = TL.errText(e); return; }
    if (location.hash === "#contact") { try { localStorage.setItem(readKey(), String(Date.now())); } catch (e) {} }
    renderContact(); contactBadge();
  }
  function renderContact() {
    const box = $("cList");
    if (!contactData.length) { box.replaceChildren(h("div", { class: "empty" }, h("strong", {}, "まだお問い合わせはありません"), h("span", {}, "上のフォームから送ると、ここにやりとりが表示されます。"))); return; }
    box.replaceChildren(...contactData.map((i) => {
      const reply = h("textarea", { rows: "2", maxlength: "4000", placeholder: "返信を書く", "aria-label": "返信" });
      const btn = h("button", { class: "btn small primary", type: "button" }, "返信する");
      btn.onclick = async () => { const t = reply.value.trim(); if (!t) return; btn.disabled = true; try { await TL.api("/api/contact", { action: "reply", inquiryId: i.id, body: t }); reply.value = ""; await loadContact(); } catch (e) { status(TL.errText(e)); } btn.disabled = false; };
      const waiting = !i.messages.some((m) => m.author === "staff");
      return h("article", { class: "card" },
        h("div", { class: "spread" }, h("strong", {}, i.subject), h("span", { class: "pill " + (i.status === "closed" ? "win" : waiting ? "warn" : "") }, i.status === "closed" ? "対応済み" : waiting ? "返信待ち" : "やりとり中")),
        h("div", { class: "thread2" }, i.messages.map((m) => h("div", { class: "msg " + m.author }, m.body, h("small", {}, (m.author === "staff" ? "TacLog運営 ・ " : "") + new Date(m.created_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }))))),
        h("div", { style: "display:grid;gap:8px" }, reply, h("div", { class: "row" }, btn)));
    }));
  }
  function setupContact() {
    $("cForm").addEventListener("submit", async (e) => {
      e.preventDefault(); const b = $("cSend"); b.disabled = true; $("cMsg").textContent = "";
      try { await TL.api("/api/contact", { action: "create", subject: $("cSubject").value, body: $("cBody").value, teamId: APP.team && APP.team.id }); $("cSubject").value = ""; $("cBody").value = ""; $("cMsg").textContent = "送信しました。返事はこの画面に届きます。"; await loadContact(); }
      catch (err) { $("cMsg").textContent = TL.errText(err); }
      b.disabled = false;
    });
  }

  /* ---------- ask ---------- */
  const TPL = ["ファーストラウンド(1・13ラウンド目)の取得率は?", "ファーストキルの取得率は?", "ファーストキルを取ったラウンドの勝率は?", "配信者のファーストキル率とファーストデス率は?", "配信者の生存率と、平均で何秒生きているかは?", "〈期間:例 この1週間〉の〈マップ〉で、アタックのときのラウンド取得率は?", "選手ごとのファーストキル数は?", "最初に倒されることが多いのは誰?", "設置が早いラウンドと遅いラウンドで勝率は違う?", "〈マップ〉の〈A/B〉サイトに設置したラウンドの勝率は?", "キャラごとにスキルを構えている時間は?", "スキルを残しすぎて倒されている人はいる?", "ウルトを温存しすぎていない?ウルトが溜まっているときのキルとデスは?", "少人数戦(2v2・1v1など)の勝率は?", "リテイクとポストプラントの勝率は?", "速攻とゆっくり攻めるのはどっちが勝ってる?", "〈マップ〉で撃ち合いに勝てている場所と負けている場所は?"];
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
      try { const ans = await TL.api("/api/ask", { teamId: APP.team.id, game: APP.game, question: q, history: chat.slice(-2) }); renderAnswer(box, ans || {}); chat.push({ q, a: String((ans && ans.answer) || "") }); }
      catch (err) { box.replaceChildren(h("p", {}, TL.errText(err))); }
      finally { $("askBtn").disabled = false; }
    });
  }


  /* ---------- recording folder ---------- */
  let folderBusy = false;
  const dateOf = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  async function renderFolder() {
    if (folderBusy) return;
    const body = $("folderBody"), name = $("folderName");
    body.replaceChildren(); name.textContent = "";
    if (!TLFolder.supported) { body.append(h("p", { class: "small muted" }, "録画フォルダの自動読み取りは、パソコン版のGoogle ChromeかMicrosoft Edgeで使えます。下の「手動で選んで分析する」から録画を選んでください。")); return; }
    const delBox = h("input", { type: "checkbox", id: "delAfterQuick" }); delBox.checked = await TLFolder.getDeleteAfter();
    delBox.onchange = async () => { await TLFolder.setDeleteAfter(delBox.checked); const hh = await TLFolder.handle(); if (hh && delBox.checked) await TLFolder.permission(hh, true, "readwrite"); if ($("delAfter")) $("delAfter").checked = delBox.checked; };
    body.append(h("label", { class: "check", for: "delAfterQuick" }, delBox, h("span", {}, h("strong", {}, "分析後、録画を自動で削除する"), h("span", { class: "small muted" }, "オンにすると、パソコンの容量を圧迫しません(YouTubeのアーカイブは残ります)。"))));
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
    const fresh = [], done = [];
    const failed = [];
    for (const v of vids) { if (v.recording) continue; if (await TLFolder.isDone(APP.team.id, v)) done.push(v); else { const why = await TLFolder.failedReason(APP.team.id, v); if (why) failed.push({ v, why }); else fresh.push(v); } }
    if (failed.length) {
      const fl = h("div", { style: "display:grid;gap:8px" });
      failed.slice(0, 10).forEach(({ v, why }) => fl.append(h("div", { class: "member" }, h("div", { style: "display:grid;gap:2px;min-width:0" }, h("strong", { style: "overflow-wrap:anywhere" }, v.name), h("span", { class: "small", style: "color:var(--loss)" }, why)),
        h("button", { class: "btn small", type: "button", onclick: async () => { await TLFolder.unmarkFailed(APP.team.id, v); autoPaused = false; renderFolder(); } }, "もう一度分析する"))));
      body.append(h("p", { class: "small muted" }, "分析できなかった録画です。自動ではやり直しません(AIの料金が何度もかからないように)。"), fl);
    }
    const recheck = h("button", { class: "btn small", type: "button", onclick: () => renderFolder() }, "フォルダをもう一度確認");
    const recNow = vids.filter((v) => v.recording);
    if (recNow.length) body.append(h("p", { class: "small muted" }, "書き込み中のファイルがあります(" + recNow[0].name + ")。録画やコピーが終わってから約1分半で、ここに出てきます。"));
    const autoOn = await TLFolder.getAuto();
    if (!fresh.length) {
      const st = vids.stats || { files: 0, others: [] };
      const why = !vids.length ? (st.files ? "このフォルダに動画ファイルが見つかりません(見つかったファイル:" + st.others.join("、") + (st.files > st.others.length ? " ほか" : "") + ")。MP4・MKVなどの動画を入れてください。" : "このフォルダ「" + hd.name + "」は空です。動画を入れたフォルダと、連携したフォルダが同じか確認してください。")
        : done.length ? "フォルダ内の動画 " + done.length + "本は、このパソコンで分析ずみです。もう一度分析したいときは、下の「もう一度分析する」を押してください。" : "";
      if (why) body.append(h("p", { class: "small muted" }, why));
      if (done.length) {
        const dl = h("div", { style: "display:grid;gap:8px" });
        done.slice(0, 10).forEach((v) => dl.append(h("div", { class: "member" }, h("div", { style: "display:grid;gap:2px;min-width:0" }, h("strong", { style: "overflow-wrap:anywhere" }, v.name), h("span", { class: "small muted" }, new Date(v.mtime).toLocaleString("ja-JP") + " ・ " + Math.round(v.size / 1048576) + "MB")),
          h("button", { class: "btn small", type: "button", onclick: async () => { await TLFolder.unmarkDone(APP.team.id, v); autoPaused = false; renderFolder(); } }, "もう一度分析する"))));
        body.append(dl);
      }
      body.append(h("div", { class: "row" }, recheck, h("a", { href: "#settings", class: "small" }, "連携するフォルダを変える")));
    }
    if (!fresh.length) { body.append(h("div", { class: "empty" }, h("strong", {}, "新しい録画はありません"), h("span", {}, autoOn ? "このページを開いている間は、1分ごとにフォルダを確認して、新しい録画ができたら自動で分析します。" : "配信が終わったら、このページを開くと自動で見つかります。"))); return; }
    const list = h("div", { style: "display:grid;gap:8px" });
    fresh.slice(0, 10).forEach((v) => list.append(h("div", { class: "member" }, h("div", { style: "display:grid;gap:2px;min-width:0" }, h("strong", { style: "overflow-wrap:anywhere" }, v.name), h("span", { class: "small muted" }, new Date(v.mtime).toLocaleString("ja-JP") + " ・ " + Math.round(v.size / 1048576) + "MB")),
      h("span", { class: "pill warn", id: "st_" + encodeURIComponent(v.name) }, "未分析"))));
    const go = h("button", { class: "btn primary", type: "button" }, fresh.length > 1 ? "新しい録画 " + Math.min(fresh.length, 10) + "本を分析する" : "この録画を分析する");
    const stop = h("button", { class: "btn", type: "button", hidden: true }, "止める");
    const delOn = await TLFolder.getDeleteAfter();
    const note = h("p", { class: "small muted" }, "分析中はこのページを開いたままにしてください。1時間の録画でおよそ数分です。マップはあとで試合一覧から設定できます。" + (delOn ? "分析が終わった録画は、このパソコンから自動で削除します(YouTubeのアーカイブは残ります)。" : ""));
    body.append(h("p", {}, "新しい録画が " + fresh.length + " 本あります。"), list, h("div", { class: "row" }, recheck), h("div", { class: "row" }, go, stop), note);
    if (autoOn) body.append(h("p", { class: "small", style: "color:var(--accent-text);font-weight:700" }, "自動で分析を始めます…"));
    let stopped = false;
    stop.onclick = () => { stopped = true; autoPaused = true; window.ANALYZER && ANALYZER.stop(); };
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
          if (!ok) {
            if (stopped) { set("止めました", "loss"); continue; }
            const er = (ANALYZER.error && ANALYZER.error()) || {};
            if (["rate_limited", "not_granted", "images_unavailable", "sampling_disabled"].includes(er.code)) { set((er.message || "分析できませんでした").slice(0, 40), "loss"); stopped = true; autoPaused = true; break; }
            await TLFolder.markFailed(APP.team.id, v, er.message || "分析できませんでした。"); set(er.code === "not_valorant" ? "VALORANTではない動画" : "分析できませんでした", "loss"); continue;
          }
          const sv = await ANALYZER.saveLast({ date: dateOf(v.mtime), opp: "", map: "", yt: "" });
          await TLFolder.markDone(APP.team.id, v);
          set(sv && sv.merged && !sv.created ? "同じ試合にまとめました(別の視点)" : "保存しました", "win");
          if (delAfter) {
            if (!(await TLFolder.permission(hd, true, "readwrite"))) set("保存しました(削除は許可されませんでした)", "warn");
            else { try { await TLFolder.remove(hd, v.name, v); set("保存して削除しました", "win"); } catch (e) { set("保存しました(削除できませんでした)", "warn"); } }
          }
        } catch (e) { set(TL.errText(e).slice(0, 40), "loss"); if (String(e.message || "").includes("analysis limit")) { stopped = true; autoPaused = true; break; } try { await TLFolder.markFailed(APP.team.id, v, TL.errText(e)); } catch (x) {} }
      }
      folderBusy = false; go.disabled = false; stop.hidden = true; loadMatches();
      document.title = "✓ 分析が終わりました | TacLog"; setTimeout(() => { document.title = "TacLog"; }, 60000);
      if (!stopped) setTimeout(renderFolder, 2000);
    };
    if (autoOn && !autoPaused) setTimeout(() => { if (!folderBusy && !go.disabled) go.click(); }, 1500);
  }
  let autoPaused = false;

  /* ---------- settings ---------- */
  function renderTitles() {
    const t = APP.team, isAdmin = t.role === "admin", allowed = t.plan === "org" ? 99 : 1 + (t.extra_games || 0);
    const box = $("titleBox"), msg = $("titleMsg");
    const chosen = new Set(t.games || ["valorant"]);
    const extraNeeded = () => t.plan === "org" ? 0 : Math.max(0, chosen.size - 1);
    const sum = h("p", { class: "small muted" });
    const save = h("button", { class: "btn small primary", type: "button" }, "変更を保存");
    const upd = () => {
      const ex = extraNeeded(), changed = [...chosen].sort().join() !== [...(t.games || [])].sort().join();
      sum.textContent = t.plan === "org" ? "コーチ・組織プランなので、全タイトル込みです。" :
        "選択中:" + chosen.size + "タイトル(1つ目は無料" + (ex ? "、追加 " + ex + "タイトル × 月" + TL.ADDON_YEN + "円 = 月" + (ex * TL.ADDON_YEN).toLocaleString() + "円" : "") + ")";
      save.disabled = !isAdmin || !changed || chosen.size < 1;
      save.textContent = ex > (t.extra_games || 0) && t.plan !== "org" ? "支払いに進んで追加する" : "変更を保存";
    };
    box.replaceChildren(...TL.GAMES.map((g) => {
      const id = "t_" + g.id, inp = h("input", { type: "checkbox", id }); inp.checked = chosen.has(g.id); inp.disabled = !isAdmin;
      inp.onchange = () => { if (inp.checked) chosen.add(g.id); else chosen.delete(g.id); upd(); };
      return h("label", { class: "game", for: id, style: "--gc:" + g.color }, inp, h("span", { class: "gbar" }), h("span", { class: "gname" }, g.name), h("span", { class: "gsub" }, g.maker), h("span", { class: "pill " + (g.ready ? "win" : "mute"), style: "justify-self:start" }, g.ready ? "自動分析に対応" : "準備中"));
    }));
    save.onclick = async () => {
      save.disabled = true; msg.textContent = "";
      const games = [...chosen];
      try {
        if (extraNeeded() <= (t.extra_games || 0) || t.plan === "org") {
          // within what is paid for (or reducing): the server keeps billing in sync
          const r = await TL.api("/api/games", { teamId: t.id, games });
          if (r && r.url) { location.href = r.url; return; }
        } else {
          if (!TL.C.BILLING_ENABLED) throw new Error("タイトルの追加は準備中です。");
          const r = await TL.api("/api/games", { teamId: t.id, games });
          if (r && r.url) { location.href = r.url; return; }
        }
        t.games = games; pickGame(); renderGameBar(); loadMatches(); renderAnalyzeGate(); msg.textContent = "保存しました";
      } catch (e) { msg.textContent = TL.errText(e); }
      upd();
    };
    $("titleActions").replaceChildren(save, sum);
    if (!isAdmin) $("titleActions").replaceChildren(h("p", { class: "small muted" }, "タイトルの変更は、チームの管理者だけができます。"));
    upd();
  }

  async function renderSettings() {
    const t = APP.team, isAdmin = t.role === "admin";
    renderTitles();
    $("teamName").value = t.name; $("teamName").disabled = !isAdmin; $("saveTeam").hidden = !isAdmin;
    $("planName").textContent = PLAN_JA[t.plan] || t.plan;
    const mon = new Date().toISOString().slice(0, 7);
    const { data: u } = await sb.from("usage").select("*").eq("team_id", t.id).eq("month", mon).maybeSingle();
    const lim = TL.C.TRIAL_UNLIMITED ? { a: null, q: null } : t.plan === "free" ? { a: 2, q: 20 } : t.plan === "team" ? { a: null, q: 300 } : { a: null, q: null };
    $("usageText").textContent = "今月:分析 " + ((u && u.analyses) || 0) + (lim.a ? "/" + lim.a : "") + "本 ・ 質問 " + ((u && u.questions) || 0) + (lim.q ? "/" + lim.q : "") + "回" + (TL.C.TRIAL_UNLIMITED ? "(試作期間中は無制限)" : "");
    const br = $("billingRow"); br.replaceChildren();
    if (t.comp_until && new Date(t.comp_until) > new Date()) br.append(h("span", { class: "pill data" }, "テスター特典:" + new Date(t.comp_until).toLocaleDateString("ja-JP") + "まで" + (PLAN_JA[t.plan] || t.plan) + "プランを無料で利用中"));
    if (isAdmin && t.plan === "free") {   // tester / invite code: paid plan for free for a while
      const inp = h("input", { type: "text", placeholder: "招待コード", "aria-label": "招待コード", style: "max-width:200px;text-transform:uppercase" });
      const go = h("button", { class: "btn small", type: "button" }, "コードを使う");
      go.onclick = async () => { go.disabled = true; try { const r = await TL.api("/api/redeem", { teamId: t.id, code: inp.value }); status("招待コードを使いました。" + new Date(r.until).toLocaleDateString("ja-JP") + "まで" + (PLAN_JA[r.plan] || r.plan) + "プランを無料で使えます。"); setTimeout(() => location.reload(), 1500); } catch (e) { status(TL.errText(e)); go.disabled = false; } };
      br.append(h("div", { class: "row", style: "gap:6px;width:100%" }, inp, go));
    }
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
    $("autoAn").checked = await TLFolder.getAuto();
    $("autoAn").onchange = async () => { await TLFolder.setAuto($("autoAn").checked); autoPaused = false; };
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
    pickGame(); renderGameBar(); renderAnalyzeGate();
    setupAsk(); setupContact();
    $("saveTeam").onclick = async () => { const { error } = await sb.from("teams").update({ name: $("teamName").value.trim() }).eq("id", APP.team.id); status(error ? TL.errText(error) : ""); if (!error) APP.team.name = $("teamName").value.trim(); };
    $("logout").onclick = async () => { await sb.auth.signOut(); location.href = "/"; };
    window.addEventListener("hashchange", route); route();
    loadContact();
    setInterval(() => { if (!folderBusy && APP.team) renderFolder(); if (APP.team && !document.querySelector("#feed :focus")) loadMatches(); if (!document.querySelector("#view-contact :focus")) loadContact(); }, 60000); // check the folder and new matches every minute
    loadMatches();
    const qp = new URLSearchParams(location.search); if (qp.get("billing") === "success") status("お支払いが完了しました。プランが切り替わるまで数秒かかることがあります。");
  })();
  function renderHeaderSafe() { TL.header([]); }
})();
