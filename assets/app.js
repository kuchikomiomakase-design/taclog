// TacLog app shell: routing, matches, AI questions, settings
window.TACLOG_MAPS = [["ascent","アセント"],["bind","バインド"],["haven","ヘイヴン"],["split","スプリット"],["icebox","アイスボックス"],["breeze","ブリーズ"],["fracture","フラクチャー"],["pearl","パール"],["lotus","ロータス"],["sunset","サンセット"],["abyss","アビス"],["corrode","カロード"],["summit","サミット"]];
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
    if (v === "ask" && APP.team) renderHist();
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
        if (APP.team.role !== "admin" || list.length < 2) return b;
        // admins can remove a title (at least one stays). Its matches are kept and come back if the title is added again.
        const x = h("button", { type: "button", class: "gx", title: TL.gameName(id) + " を外す", "aria-label": TL.gameName(id) + " を外す" }, "×");
        x.onclick = async (e) => {
          e.stopPropagation();
          const t = APP.team, paid = t.plan !== "org" && (t.extra_games || 0) > 0;
          if (!confirm("タイトル「" + TL.gameName(id) + "」を外しますか?\n\n・このタイトルの試合データは消えません(また追加すると見られます)\n" + (t.plan === "org" ? "・コーチ・組織プランは全タイトル込みなので、料金は変わりません" : paid ? "・追加タイトルの料金(月500円)が1つ分減ります" : "・料金は変わりません"))) return;
          try {
            await TL.api("/api/games", { teamId: t.id, games: list.filter((g) => g !== id) });
            t.games = list.filter((g) => g !== id); if (paid) t.extra_games = Math.max(0, t.games.length - 1);
            if (APP.game === id) APP.game = t.games[0];
            renderGameBar(); loadMatches(); renderAnalyzeGate();
          } catch (err) { status(TL.errText(err)); }
        };
        return h("span", { class: "gwrap" }, b, x); }),
      APP.team.role === "admin" ? h("a", { href: "#settings", class: "small", style: "margin-left:4px" }, "+ タイトルを追加") : null);
  }
  // "+" on the team bar: add a team (organization plan) or your own personal space, right here (no first-time setup again)
  function openAddTeam() {
    const org = APP.teams.find((t) => t.plan === "org" && t.role === "admin" && t.kind !== "solo");
    const hasSolo = APP.teams.some((t) => t.kind === "solo");
    const me = (APP.team && APP.team.display_name) || "";
    const dlg = h("dialog", { class: "card addteam-dlg", "aria-label": "チームを追加" });
    const close = () => { dlg.close(); dlg.remove(); };
    const msg = h("p", { class: "small", style: "margin:0" });
    const nameIn = h("input", { maxlength: "40", placeholder: "例:IGZIST Academy" }), myIn = h("input", { maxlength: "30", value: me });
    const gameSel = h("select", {}, TL.GAMES.map((g) => h("option", { value: g.id }, g.name))); gameSel.value = APP.game || "valorant";
    const orgTeams = org ? APP.teams.filter((t) => t.plan === "org" && t.kind !== "solo").length : 0;
    async function go(kind, confirmPay) {
      msg.textContent = "作成しています…"; dlg.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        const r = await Promise.race([TL.api("/api/addteam", { teamId: org ? org.id : APP.team.id, kind, name: nameIn.value, myName: myIn.value, game: gameSel.value, confirm: !!confirmPay }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("時間がかかりすぎています。ページを開き直して、もう一度試してください。")), 20000))]);
        if (!r || !r.teamId && !r.needConfirm) throw new Error("チームを作れませんでした。もう一度試してください。");
        if (r.needConfirm) { if (confirm("3チーム目からは、1チームにつき月" + r.yen.toLocaleString() + "円が組織プランに加わります(今月分は日割り)。追加しますか?")) return go(kind, true); msg.textContent = ""; return; }
        TL.setTeam(r.teamId); location.href = "/app#settings";
      } catch (e) { msg.textContent = TL.errText(e); } finally { dlg.querySelectorAll("button").forEach((b) => (b.disabled = false)); }
    }
    const teamBox = org
      ? h("div", { style: "display:grid;gap:10px" }, h("h3", {}, "チームを追加(組織プラン)"),
          h("p", { class: "small muted", style: "margin:0" }, "録画の設定とRiot連携は済んでいるので、名前を決めるだけです。" + (orgTeams < 2 ? "組織プランは2チームまで込みです(追加料金なし)。" : "3チーム目からは1チームにつき月2,480円です(10チームまで)。")),
          h("label", {}, "チーム名", nameIn), h("label", {}, "このチームでのあなたの表示名", myIn), h("label", {}, "ゲーム", gameSel),
          h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: () => go("team") }, "チームを追加")))
      : h("div", { style: "display:grid;gap:8px" }, h("h3", {}, "チームを増やすには"),
          h("p", { class: "small muted", style: "margin:0" }, "複数のチームを見るには、コーチ・組織プラン(月6,980円・2チーム込み)が必要です。追加したチームも組織プランになります。"),
          h("div", { class: "row" }, h("a", { class: "btn", href: "/pricing" }, "料金プランを見る")));
    const soloBox = hasSolo ? null : h("div", { style: "display:grid;gap:8px;border-top:1px solid var(--line);padding-top:12px" }, h("h3", {}, "個人用を作る"),
      h("p", { class: "small muted", style: "margin:0" }, "自分の録画(ランク・スクリム)で、自分のプレーだけを振り返るスペースです。無料(月2本)から使えて、個人プランは月1,280円です。"),
      h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => { if (!myIn.value.trim()) myIn.value = me || "自分"; go("solo"); } }, "個人用を作る")));
    dlg.append(h("div", { class: "spread" }, h("strong", {}, "チーム・個人用の追加"), h("button", { class: "btn small ghost", type: "button", onclick: close }, "閉じる")), teamBox, soloBox, msg);
    document.body.append(dlg); dlg.showModal();
  }
  // Teams you belong to (coaches / managers often look after several): switch with one click, "+" adds another team
  function renderTeamBar() {
    const bar = $("teamBar"); if (!bar) return;
    const add = h("button", { type: "button", class: "gtab addteam", title: "チームを追加", "aria-label": "チームを追加" }, "＋");
    add.onclick = openAddTeam;
    bar.replaceChildren(h("span", { class: "eyebrow" }, "Team"),
      ...APP.teams.map((t) => { const b = h("button", { type: "button", class: "gtab", "aria-pressed": t.id === APP.team.id ? "true" : "false" }, t.kind === "solo" ? "👤 " + t.name : t.name);
        b.onclick = () => { if (t.id === APP.team.id) return; TL.setTeam(t.id); location.reload(); }; return b; }), add);
  }
  function renderAnalyzeGate() {
    const g = TL.GAMES.find((x) => x.id === APP.game), ready = !g || g.ready;
    $("gameSoon").hidden = ready; $("folderCard").hidden = !ready; $("manualBox").hidden = !ready;
    if (!ready) $("gameSoonName").textContent = g.name;
  }

  function renderHeader() {
    TL.header([{ href: "#dash", label: "ダッシュボード" }, { href: "#analyze", label: "録画を分析" }, { href: "#channel", label: "チャンネル" }, { href: "#ask", label: "AIに質問" }, { href: "#matches", label: "試合一覧" }, { href: "#contact", label: "お問い合わせ" }, { href: "/billing", label: "お支払い" }, { href: "#settings", label: "設定" }]);
    updateBadge();
    renderTeamBar();
  }

  /* ---------- matches ---------- */
  async function loadMatches() {
    const { data, error } = await sb.from("matches").select("*").eq("team_id", APP.team.id).eq("game", APP.game || "valorant").order("date", { ascending: false }).order("created_at", { ascending: false });
    if (error) { status(TL.errText(error)); return; }
    APP.matches = (data || []).map((m) => (window.TLKit ? TLKit.cleanFk(m) : m)); renderMatches(); renderChannel(); if (!$("view-dash").hidden && window.renderDash) window.renderDash();
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
        h("div", { class: "row", style: "gap:6px" }, h("button", { class: "btn small", type: "button", onclick: () => openRoundEditor(m.id) }, "ラウンドを直す"), canDel ? del : null));
    }));
  }


  /* ---------- fix rounds by hand (anything the analysis could not read, or read wrong) ---------- */
  function openRoundEditor(matchId, focusRound, field) {
    const m = APP.matches.find((x) => x.id === matchId); if (!m) { status("その試合が見つかりません(別のチームかタイトルの試合かもしれません)。"); return; }
    const rs = JSON.parse(JSON.stringify(m.rounds || []));
    const AG = ["Astra","Breach","Brimstone","Chamber","Clove","Cypher","Deadlock","Fade","Gekko","Harbor","Iso","Jett","KAY/O","Killjoy","Neon","Omen","Phoenix","Raze","Reyna","Sage","Skye","Sova","Tejo","Veto","Viper","Vyse","Waylay","Yoru"];
    // team compositions can be fixed here too (a wrong composition makes the first-kill names wrong)
    const compSel = (side) => Array.from({ length: 5 }, (_, i) => { const v = ((m.comps && m.comps[side]) || [])[i] || ""; const sl = h("select", {}, [h("option", { value: "" }, "?"), ...AG.map((a) => h("option", { value: a }, a))]); sl.value = AG.includes(v) ? v : ""; return sl; });
    const compL = compSel("left"), compR = compSel("right");
    const agents = [...new Set([...((m.comps && m.comps.left) || []), ...((m.comps && m.comps.right) || [])])];
    const opt = (pairs, v) => { const s = h("select", {}, pairs.map(([val, label]) => h("option", { value: val }, label))); s.value = v == null ? "" : String(v); return s; };
    const agentSel = (v) => { const list = agents.slice(); const pairs = [["", "不明"]].concat(list.map((a) => [a, a])); if (v && !list.includes(v)) pairs.push([v, v + "(この試合にいない?)"]); return opt(pairs, v || ""); };
    const rows = rs.map((r) => {
      const win = opt([["", "不明"], ["true", "勝ち"], ["false", "負け"]], r.win == null ? "" : String(r.win));
      const side = opt([["attack", "アタック"], ["defense", "ディフェンス"]], r.side || "attack");
      const plant = opt([["", "設置なし"], ["A", "A"], ["B", "B"], ["C", "C"], ["?", "設置(サイト不明)"]], r.planted ? (r.site || "?") : "");
      const fk = opt([["", "不明"], ["us", "自チーム"], ["them", "相手"]], r.fk === "tie" ? "" : (r.fk || ""));
      const L = (m.comps && m.comps.left) || [], R = (m.comps && m.comps.right) || [];
      const teamSel = (v, list) => { const pairs = [["", "不明"]].concat(list.map((a) => [a, a])); return opt(pairs, list.includes(v) ? v : ""); };
      const by = teamSel(r.fkBy, r.fk === "us" ? L : r.fk === "them" ? R : []), vic = teamSel(r.fkVictim, r.fk === "us" ? R : r.fk === "them" ? L : []);
      // FK取った人 = the team that got the first kill, 最初に倒された人 = the other team (no other choice is possible)
      fk.onchange = () => { const own = fk.value === "us" ? L : fk.value === "them" ? R : [], opp = fk.value === "us" ? R : fk.value === "them" ? L : [];
        const b = by.value, v = vic.value; by.replaceChildren(...teamSel(b, own).childNodes); by.value = own.includes(b) ? b : ""; vic.replaceChildren(...teamSel(v, opp).childNodes); vic.value = opp.includes(v) ? v : ""; };
      const vd = h("input", { type: "checkbox", title: "強制終了したラウンド(数字に入れない)" }); vd.checked = !!r.void;
      const tr = h("tr", { class: r.n === focusRound ? "focus" : "" }, h("td", { class: "num" }, r.n), h("td", {}, win), h("td", {}, side), h("td", {}, plant), h("td", {}, fk), h("td", {}, by), h("td", {}, vic), h("td", { style: "text-align:center" }, vd));
      tr._get = () => {
        const o = { ...r, win: win.value === "" ? null : win.value === "true", side: side.value, fk: fk.value || null, fkBy: by.value || null, fkVictim: vic.value || null, void: vd.checked || undefined };
        o.planted = plant.value !== ""; o.site = plant.value && plant.value !== "?" ? plant.value : null; if (!o.planted) { o.plant = null; o.plantAt = null; }
        // the recording player's own first kill / first death follow the corrected names
        const me = m.comps && m.comps.me; if (me) { const k = (x) => String(x || "").toLowerCase().replace(/[^a-z]/g, ""); o.myFk = o.fk === "us" ? (o.fkBy ? k(o.fkBy) === k(me) : null) : o.fk ? false : null; o.myFd = o.fk === "them" ? (o.fkVictim ? k(o.fkVictim) === k(me) : null) : o.fk ? false : null; }
        if (JSON.stringify(o) !== JSON.stringify(r)) o.manual = true;
        return o;
      };
      return tr;
    });
    const dlg = h("dialog", { class: "card fix-dlg", "aria-label": "ラウンドを直す" });
    const msg = h("span", { class: "small" });
    const save = h("button", { class: "btn primary", type: "button" }, "保存");
    save.onclick = async () => {
      save.disabled = true; msg.textContent = "保存しています…";
      const out = rows.map((tr) => tr._get());
      const newComps = { left: compL.map((x) => x.value).filter(Boolean), right: compR.map((x) => x.value).filter(Boolean) };
      if (JSON.stringify(newComps) !== JSON.stringify({ left: (m.comps && m.comps.left) || [], right: (m.comps && m.comps.right) || [] })) {
        const { error: ce } = await sb.rpc("update_comps", { m: m.id, c: newComps });
        if (ce) { msg.textContent = /update_comps/.test(ce.message || "") ? "構成を直すには、管理者が設定(016)を済ませる必要があります。" : TL.errText(ce); save.disabled = false; return; }
        m.comps = { ...(m.comps || {}), ...newComps };
      }
      const { error } = await sb.rpc("update_rounds", { m: m.id, rs: out });
      if (error) { msg.textContent = /update_rounds/.test(error.message || "") ? "手直しを使うには、管理者が設定(014)を済ませる必要があります。" : TL.errText(error); save.disabled = false; return; }
      // tell the operator what was fixed (to improve the reading)
      try { const F = ["win", "side", "planted", "site", "fk", "fkBy", "fkVictim", "void"], changes = [];
        out.forEach((o, i) => { const r = rs[i] || {}; F.forEach((f) => { const a = r[f] ?? null, b = o[f] ?? null; if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ n: o.n, field: f, before: a, after: b }); }); });
        if (changes.length) TL.api("/api/fixlog", { teamId: APP.team.id, matchId: m.id, changes }).catch(() => {}); } catch (e) {}
      m.rounds = out; dlg.close(); dlg.remove(); status("直した内容を保存しました。ダッシュボードとAIの答えにも反映されます。"); renderMatches(); if (window.renderDash) window.renderDash();
    };
    const hint = { fk: "ファーストキル(最初に倒したのがどちらか、誰が誰を)", win: "勝敗", plant: "設置", side: "攻守" }[field] || "";
    dlg.append(
      h("div", { class: "spread" }, h("strong", {}, "ラウンドを直す:" + (m.date ? fmtDate(m.date) : "") + (m.opp ? " vs " + m.opp : "") + " " + (mapName(m.map) || "")), h("button", { class: "btn small ghost", type: "button", onclick: () => { dlg.close(); dlg.remove(); } }, "閉じる")),
      h("p", { class: "small muted", style: "margin:0" }, (focusRound ? "第" + focusRound + "ラウンド" + (hint ? "の" + hint : "") + "を直してください(色が付いた行)。" : "") + "読み取れなかった・間違えたところを選び直して保存すると、ダッシュボードやAIの答えに反映されます。録画を見返して確かめるのがおすすめです。"),
      h("div", { class: "fixcomp" }, h("span", { class: "small" }, "自チーム"), ...compL, h("span", { class: "small" }, "相手"), ...compR),
      h("div", { class: "tblbox", style: "max-height:60vh;overflow:auto" }, h("table", { class: "tbl dtbl fixtbl" },
        h("thead", {}, h("tr", {}, ["R", "勝敗", "攻守", "設置", "ファーストキル", "FKを取った人", "最初に倒された人", "無効"].map((t) => h("th", {}, t)))), h("tbody", {}, rows))),
      h("div", { class: "row" }, save, msg));
    document.body.append(dlg); dlg.showModal();
    const f = dlg.querySelector("tr.focus"); if (f) f.scrollIntoView({ block: "center" });
  }
  window.openRoundEditor = openRoundEditor;

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
    // rounds the analysis could not read (or read wrong): one click opens them to fix by hand
    const fx = Array.isArray(ans.fix) ? ans.fix.filter((f) => f && f.match && f.round).slice(0, 8) : [];
    if (fx.length) box.append(h("div", { class: "fixbox" }, h("span", { class: "small" }, "読み取れなかったところは、手で直せます:"),
      h("div", { class: "row", style: "gap:6px;flex-wrap:wrap" }, fx.map((f) => { const m = APP.matches.find((x) => x.id === f.match);
        return h("button", { class: "btn small", type: "button", onclick: () => openRoundEditor(f.match, Number(f.round), f.field) }, (m && m.date ? fmtDate(m.date) + " " : "") + "第" + f.round + "R" + ({ fk: "のFK", win: "の勝敗", plant: "の設置", side: "の攻守" }[f.field] || "") + "を直す"); }))));
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
  /* ---------- question history (like a chat app): saved per person, per team ---------- */
  let curThread = null, histOK = true;
  const emptyThread = () => h("div", { class: "empty" }, h("strong", {}, "まだ質問していません"), h("span", {}, "分析した試合のデータをもとに答えます。"));
  function newThread() { curThread = null; chat.length = 0; $("thread").replaceChildren(emptyThread()); renderHist(); }
  async function renderHist() {
    const box = $("qHist"), btn = $("qHistBtn"); if (!box || !APP.team) return;
    const { data, error } = await sb.from("ask_threads").select("id,title,updated_at").eq("team_id", APP.team.id).order("updated_at", { ascending: false }).limit(50);
    if (error) { histOK = false; box.replaceChildren(h("p", { class: "small muted", style: "margin:4px" }, "履歴を使うには、管理者が設定(008_ask_history.sql)を済ませる必要があります。")); return; }   // before 008_ask_history.sql is run
    histOK = true;
    btn.onclick = () => document.querySelector(".qside").classList.toggle("open");
    box.replaceChildren(...(data || []).map((t) => {
      const del = h("button", { type: "button", title: "この会話を削除", "aria-label": "削除" }, "×");
      del.onclick = async (e) => { e.stopPropagation(); await sb.from("ask_threads").delete().eq("id", t.id); if (curThread === t.id) newThread(); else renderHist(); };
      const row = h("div", { class: "qh" + (t.id === curThread ? " on" : ""), role: "button", tabindex: "0" }, h("span", { title: t.title || "" }, t.title || "(無題)"), h("small", {}, fmtDate(String(t.updated_at).slice(0, 10))), del);
      row.onclick = () => openThread(t.id); row.onkeydown = (e) => { if (e.key === "Enter") openThread(t.id); };
      return row;
    }));
    if (!(data || []).length) box.append(h("p", { class: "small muted", style: "margin:4px" }, "まだ履歴はありません。"));
  }
  async function openThread(id) {
    const { data, error } = await sb.from("ask_messages").select("question,answer").eq("thread_id", id).order("id");
    if (error) return;
    curThread = id; chat.length = 0; const thread = $("thread"); thread.replaceChildren();
    (data || []).forEach((m) => { thread.append(h("div", { class: "bubble" }, m.question)); const box = h("div", { class: "answer" }); renderAnswer(box, m.answer || {}); thread.append(box); chat.push({ q: m.question, a: String((m.answer && m.answer.answer) || "") }); });
    if (!(data || []).length) thread.replaceChildren(emptyThread());
    document.querySelector(".qside").classList.remove("open"); renderHist();
  }
  async function saveQA(q, ans) {
    if (!histOK || !APP.team) return;
    try {
      if (!curThread) { const { data, error } = await sb.from("ask_threads").insert({ team_id: APP.team.id, title: q.slice(0, 60) }).select("id").single(); if (error) throw error; curThread = data.id; }
      const a = { answer: ans.answer || "", chart: ans.chart || null, scenes: ans.scenes || [], fix: ans.fix || null, looked: !!ans.looked };
      await sb.from("ask_messages").insert({ thread_id: curThread, question: q, answer: a });
      await sb.from("ask_threads").update({ updated_at: new Date().toISOString() }).eq("id", curThread);
      renderHist();
    } catch (e) { histOK = false; }
  }
  function setupAsk() {
    $("qNew").onclick = newThread;
    renderHist();
    TPL.forEach((t) => $("tpls").append(h("button", { type: "button", class: "chip", onclick: () => { $("q").value = t; $("q").focus(); } }, t)));
    $("askForm").addEventListener("submit", async (e) => {
      e.preventDefault(); const q = $("q").value.trim(); if (!q) return;
      if (!APP.matches.length) { status("まだ分析した試合がありません。先に「録画を分析」から1本入れてください。"); return; }
      const thread = $("thread"); if (thread.querySelector(".empty")) thread.replaceChildren();
      thread.append(h("div", { class: "bubble" }, q)); const box = h("div", { class: "answer" }, h("span", { class: "muted small" }, "考えています…")); thread.append(box);
      $("q").value = ""; $("askBtn").disabled = true;
      try {
        let ans = await TL.api("/api/ask", { teamId: APP.team.id, game: APP.game, question: q, history: chat.slice(-2) });
        renderAnswer(box, ans || {});
        // the AI wants to see a round: send the pictures saved on this PC (if this PC analysed that match)
        const looks = Array.isArray(ans && ans.look) ? ans.look.slice(0, 2) : [];
        if (looks.length && window.TLSnaps && TLSnaps.supported) {
          const files = [];
          for (const l of looks) files.push(...(await TLSnaps.load(l.match, l.round, looks.length > 1 ? 5 : 8)));
          if (files.length) {
            const note = h("p", { class: "small muted" }, "そのラウンドの画像を確認しています…"); box.append(note);
            try {
              const images = await Promise.all(files.map((f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); })));
              const more = await TL.api("/api/ask", { mode: "look", teamId: APP.team.id, question: q, looks, images, draft: ans.answer || "" });
              ans = more; renderAnswer(box, ans || {}); box.append(h("p", { class: "small muted" }, "録画の画像も見て答えました(質問2回分)。"));
            } catch (e) { note.textContent = "画像の確認はできませんでした(" + TL.errText(e) + ")。上はデータからの答えです。"; }
          } else box.append(h("p", { class: "small muted" }, "この試合の画像がこのパソコンにないため、データだけで答えています(画像は分析したパソコンに保存されます)。"));
        }
        chat.push({ q, a: String((ans && ans.answer) || "") });
        saveQA(q, ans || {});
      }
      catch (err) { box.replaceChildren(h("p", {}, TL.errText(err))); }
      finally { $("askBtn").disabled = false; }
    });
  }


  /* ---------- round pictures kept on this PC ---------- */
  async function renderSnaps() {
    const box = $("snapBox"); if (!box) return;
    if (!window.TLSnaps || !TLSnaps.supported) { box.hidden = true; return; }
    const sel = $("snapDays"); sel.value = String(TLSnaps.days());
    sel.onchange = async () => { TLSnaps.setDays(+sel.value); await TLSnaps.cleanup(); show(); };
    const cb = $("contrib"); if (cb) { try { cb.checked = localStorage.getItem("taclog_contrib") === "1"; } catch (e) {} cb.onchange = () => { try { localStorage.setItem("taclog_contrib", cb.checked ? "1" : "0"); } catch (e) {} }; }
    $("snapClear").onclick = async () => { await TLSnaps.clearAll(); show(); };
    async function show() { const u = await TLSnaps.usage(); $("snapUse").textContent = u ? "今このブラウザでTacLogが使っている容量:約" + (u.used / 1e9 >= 1 ? (u.used / 1e9).toFixed(1) + "GB" : Math.round(u.used / 1e6) + "MB") + "(1マップ約20〜50MB)" : ""; }
    show();
  }
  document.addEventListener("DOMContentLoaded", () => setTimeout(renderSnaps, 500));
  if (document.readyState !== "loading") setTimeout(renderSnaps, 500);

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

  // delete the current team (admins only): type the name, then the server removes it and everything in it
  function renderDeleteTeam() {
    const box = $("delTeamBox"); if (!box || !APP.team) return;
    box.hidden = APP.team.role !== "admin"; if (box.hidden) return;
    $("delTeamCur").textContent = APP.team.name; const inp = $("delTeamName"), btn = $("delTeamBtn"), msg = $("delTeamMsg");
    inp.value = ""; btn.disabled = true; msg.textContent = "";
    // deleting never changes the plan: say so (people may only want to start over)
    const t = APP.team, pay = $("delTeamPay"), kids = APP.teams.filter((x) => x.parent_team === t.id).length;
    const warn = t.plan === "free" ? "" : t.parent_team ? "このチームは組織プランで追加したチームです。削除すると、組織の追加チームの料金(月2,480円)は1チーム分減ります。" :
      "プランは変わりません。チームを削除しても、プランを変更(解約)しない限り、毎月の料金はそのまま続きます。解約は、削除の前でも後でも、アカウントの「お支払いの管理」からできます。" + (t.plan === "org" ? "組織プランで追加したチームは、無料プランに戻ります。" : "");
    pay.hidden = !warn; pay.textContent = warn;
    inp.oninput = () => { btn.disabled = inp.value.trim() !== APP.team.name.trim(); };
    btn.onclick = async () => {
      if (!confirm("「" + APP.team.name + "」を完全に削除します。よろしいですか?" + (APP.team.plan !== "free" && !APP.team.parent_team ? "\n\n※ プランを変更しない限り、料金は変わりません。" : ""))) return;
      btn.disabled = true; msg.textContent = "削除しています…";
      try {
        const r = await TL.api("/api/delteam", { teamId: APP.team.id, confirmName: inp.value });
        if (r && r.next) { TL.setTeam(r.next); location.href = "/app"; } else location.href = "/onboarding";
      } catch (e) { msg.textContent = TL.errText(e); btn.disabled = false; }
    };
  }
  async function renderSettings() {
    renderDeleteTeam();
    const t = APP.team, isAdmin = t.role === "admin";
    renderTitles();
    $("teamName").value = t.name; $("teamName").disabled = !isAdmin; $("saveTeam").hidden = !isAdmin;
    $("planName").textContent = PLAN_JA[t.plan] || t.plan;
    const mon = new Date().toISOString().slice(0, 7);
    const { data: u } = await sb.from("usage").select("*").eq("team_id", t.id).eq("month", mon).maybeSingle();
    const lim = TL.C.TRIAL_UNLIMITED ? { a: null, q: null } : t.plan === "free" ? { a: 2, q: 20 } : t.plan === "team" ? { a: null, q: 300 } : t.plan === "org" ? { a: null, q: 600 } : t.plan === "solo" ? { a: null, q: 100 } : { a: null, q: null };
    $("usageText").textContent = "今月:分析 " + ((u && u.analyses) || 0) + (lim.a ? "/" + lim.a : "") + "本 ・ 質問 " + ((u && u.questions) || 0) + (lim.q ? "/" + lim.q : "") + "回" + (t.plan === "org" ? "(質問は組織の全チームで合計600回)" : "") + (TL.C.TRIAL_UNLIMITED ? "(試作期間中は無制限)" : "");
    if (t.plan === "team" || t.plan === "org" || t.plan === "solo") (async () => { try { const { data } = await sb.rpc("maps_today", { t: t.id }); const d = Array.isArray(data) ? data[0] : data; if (d && d.lim != null) $("usageText").textContent += " ・ 今日の分析 " + d.used + "/" + d.lim + "マップ分"; } catch (e) {} })();
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
    $("mMap").append(h("option", { value: "" }, "自動で判定する"), ...MAPS.map(([v, n]) => h("option", { value: v }, n)));   // empty = use the detected map
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
