// TacLog dashboard: team performance at a glance, computed in the browser from the saved matches (no AI, no cost).
(function () {
  const { $, h } = TL;
  const MAPS = () => window.TACLOG_MAPS || [];
  const mapName = (id) => (MAPS().find((m) => m[0] === id) || [id, id || "未設定"])[1];
  const F = { map: "", from: "", to: "" };

  const rate = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const pctText = (a, b) => (b ? rate(a, b) + "%" : "—");
  const known = (rs) => rs.filter((r) => r.win === true || r.win === false);
  const wins = (rs) => rs.filter((r) => r.win === true).length;
  function result(m) { const rs = m.rounds || [], w = wins(rs), l = rs.filter((r) => r.win === false).length; return w > l ? "W" : l > w ? "L" : null; }
  const dateKey = (m) => (m.date || String(m.created_at || "").slice(0, 10)) + "|" + (m.created_at || "");

  function filtered() {
    return (APP.matches || []).filter((m) => {
      if (F.map && m.map !== F.map) return false;
      const d = m.date || String(m.created_at || "").slice(0, 10);
      if (F.from && (!d || d < F.from)) return false;
      if (F.to && (!d || d > F.to)) return false;
      return true;
    }).sort((a, b) => (dateKey(a) < dateKey(b) ? -1 : 1));
  }

  // one tile: label, big number, small fraction, thin meter
  function tile(label, a, b, sub, tone) {
    const r = rate(a, b);
    return h("div", { class: "dtile" + (tone ? " " + tone : "") },
      h("span", { class: "dk" }, label),
      h("span", { class: "dv" }, r == null ? "—" : String(r), r == null ? null : h("small", {}, "%")),
      h("div", { class: "dmeter", role: "presentation" }, h("i", { style: "width:" + (r || 0) + "%" })),
      h("span", { class: "ds" }, b ? a + " / " + b + (sub ? " ・ " + sub : "") : (sub || "データなし")));
  }

  function trendChart(ms) {
    const pts = ms.slice(-20).map((m) => { const rs = known(m.rounds || []); return { m, v: rate(wins(rs), rs.length), w: wins(rs), n: rs.length }; }).filter((p) => p.v != null);
    const box = h("div", { class: "dchart" });
    if (pts.length < 2) { box.append(h("div", { class: "empty" }, h("strong", {}, "試合が2つ以上になると表示されます"), h("span", {}, "録画を分析すると、試合ごとのラウンド勝率がここに並びます。"))); return box; }
    const cw = ($("dashBody") && $("dashBody").clientWidth) || 760, W = Math.max(300, Math.min(900, cw - 40)), H = W < 500 ? 200 : 240, L = 40, R = 16, T = 14, B = 30, iw = W - L - R, ih = H - T - B;
    const x = (i) => L + (pts.length === 1 ? iw / 2 : (i * iw) / (pts.length - 1)), y = (v) => T + ih - (v / 100) * ih;
    const NS = "http://www.w3.org/2000/svg", el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "試合ごとのラウンド勝率の推移(直近" + pts.length + "試合)", class: "dsvg" });
    [0, 50, 100].forEach((v) => {
      svg.append(el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 50 ? "ref" : "grid" }));
      const t = el("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", class: "tick" }); t.textContent = v + "%"; svg.append(t);
    });
    svg.append(el("polyline", { points: pts.map((p, i) => x(i) + "," + y(p.v)).join(" "), class: "line" }));
    const tip = h("div", { class: "dtip", hidden: true });
    pts.forEach((p, i) => {
      const g = el("g", { tabindex: "0", class: "pt" });
      g.append(el("circle", { cx: x(i), cy: y(p.v), r: 14, class: "hit" }), el("circle", { cx: x(i), cy: y(p.v), r: 4.5, class: "dot " + (result(p.m) === "W" ? "w" : result(p.m) === "L" ? "l" : "") }));
      const on = () => {
        tip.hidden = false;
        tip.replaceChildren(h("strong", {}, (p.m.date || "日付なし") + " ・ " + mapName(p.m.map)), h("span", {}, "ラウンド勝率 " + p.v + "%(" + p.w + "/" + p.n + ")"), h("span", {}, result(p.m) === "W" ? "勝ち" : result(p.m) === "L" ? "負け" : "引き分け/不明"));
        const bw = box.clientWidth, px = (x(i) / W) * bw; tip.style.left = Math.min(Math.max(px - 90, 0), bw - 180) + "px"; tip.style.top = Math.max((y(p.v) / H) * box.clientHeight - 78, 0) + "px";
      };
      g.addEventListener("mouseenter", on); g.addEventListener("focus", on);
      g.addEventListener("mouseleave", () => (tip.hidden = true)); g.addEventListener("blur", () => (tip.hidden = true));
      svg.append(g);
    });
    const lt = el("text", { x: L, y: H - 8, class: "tick" }); lt.textContent = "古い"; svg.append(lt);
    const rt = el("text", { x: W - R, y: H - 8, "text-anchor": "end", class: "tick" }); rt.textContent = "新しい"; svg.append(rt);
    box.append(svg, tip);
    return box;
  }

  const bar = (r) => h("span", { class: "dbar" }, h("span", { class: "dtrack" }, h("i", { style: "width:" + (r || 0) + "%" })), h("b", {}, r == null ? "—" : r + "%"));

  function mapTable(ms) {
    const by = {};
    ms.forEach((m) => { (by[m.map || ""] = by[m.map || ""] || []).push(m); });
    const rows = Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([k, list]) => {
      const rs = list.flatMap((m) => m.rounds || []);
      const att = known(rs.filter((r) => r.side === "attack")), def = known(rs.filter((r) => r.side === "defense"));
      const fk = rs.filter((r) => r.fk === "us" || r.fk === "them");
      const W = list.filter((m) => result(m) === "W").length, Lo = list.filter((m) => result(m) === "L").length;
      return h("tr", {}, h("td", {}, mapName(k)), h("td", { class: "num" }, list.length), h("td", { class: "num" }, W + "勝 " + Lo + "敗"),
        h("td", {}, bar(rate(W, W + Lo))), h("td", {}, bar(rate(wins(att), att.length))), h("td", {}, bar(rate(wins(def), def.length))), h("td", {}, bar(rate(fk.filter((r) => r.fk === "us").length, fk.length))));
    });
    return h("div", { class: "tblbox" }, h("table", { class: "tbl dtbl" },
      h("thead", {}, h("tr", {}, ["マップ", "試合", "勝敗", "試合勝率", "アタック取得率", "ディフェンス取得率", "FK取得率"].map((t) => h("th", {}, t)))),
      h("tbody", {}, rows)));
  }

  function siteTable(rs) {
    const row = (label, list) => {
      const sites = ["A", "B", "C"].map((s) => { const x = known(list.filter((r) => r.site === s)); return { s, n: list.filter((r) => r.site === s).length, w: wins(x), k: x.length }; }).filter((x) => x.n);
      if (!sites.length) return [h("tr", {}, h("td", {}, label), h("td", { colspan: "3", class: "muted" }, "データなし"))];
      return sites.map((x, i) => h("tr", {}, h("td", {}, i ? "" : label), h("td", {}, x.s + "サイト"), h("td", { class: "num" }, x.n + "回"), h("td", {}, bar(rate(x.w, x.k)))));
    };
    const att = rs.filter((r) => r.side === "attack" && r.planted), def = rs.filter((r) => r.side === "defense" && r.planted);
    return h("div", { class: "tblbox" }, h("table", { class: "tbl dtbl" },
      h("thead", {}, h("tr", {}, ["", "サイト", "設置", "そのラウンドの勝率"].map((t) => h("th", {}, t)))),
      h("tbody", {}, ...row("アタック(自チームが設置)", att), ...row("ディフェンス(相手が設置=リテイク)", def))));
  }

  // ---- players (each recorded point of view = one teammate, by agent) ----
  let POVS = {}, povKey = "";
  async function loadPovs() {
    const ids = (APP.matches || []).map((m) => m.id);
    const key = ids.join(",");
    if (!ids.length || key === povKey) return false;
    povKey = key;
    try {
      const { data, error } = await TL.sb.from("match_povs").select("match_id,agent,rounds").in("match_id", ids.slice(0, 300));
      if (error) return false;
      POVS = {}; (data || []).forEach((p) => { (POVS[p.match_id] = POVS[p.match_id] || []).push(p); });
      return true;
    } catch (e) { return false; }
  }
  function playerTable(ms) {
    const by = {};
    ms.forEach((m) => (POVS[m.id] || []).forEach((p) => { const k = p.agent || "不明"; (by[k] = by[k] || { matches: 0, rs: [] }); by[k].matches++; by[k].rs.push(...(p.rounds || [])); }));
    const names = Object.keys(by);
    if (!names.length) return null;
    const rows = names.sort((a, b) => by[b].rs.length - by[a].rs.length).map((k) => {
      const rs = by[k].rs, fkK = rs.filter((r) => r.myFk === true || r.myFk === false), fdK = rs.filter((r) => r.myFd === true || r.myFd === false);
      const sv = rs.filter((r) => r.myDead === true || r.myDead === false), dead = sv.filter((r) => r.myDead === true && r.myDeathT != null);
      const life = dead.length ? Math.round(dead.reduce((a, r) => a + r.myDeathT, 0) / dead.length) + "秒" : "—";
      return h("tr", {}, h("td", {}, k), h("td", { class: "num" }, by[k].matches), h("td", { class: "num" }, rs.length),
        h("td", {}, bar(rate(fkK.filter((r) => r.myFk).length, fkK.length))), h("td", {}, bar(rate(fdK.filter((r) => r.myFd).length, fdK.length))),
        h("td", {}, bar(rate(sv.filter((r) => r.myDead === false).length, sv.length))), h("td", { class: "num" }, life));
    });
    return h("section", { class: "card dsec" }, h("h3", {}, "選手別(録画した視点ごと)"),
      h("p", { class: "small muted" }, "同じ試合を何人かが録画すると、その人(使ったエージェント)ごとに分かれます。チームの数字は1試合として1回だけ数えています。"),
      h("div", { class: "tblbox" }, h("table", { class: "tbl dtbl" }, h("thead", {}, h("tr", {}, ["エージェント", "試合", "ラウンド", "ファーストキル率", "ファーストデス率", "生存率", "平均生存時間"].map((t) => h("th", {}, t)))), h("tbody", {}, rows))));
  }

  // Abilities and ult per agent (from each recorded view; only the combat phase after the barrier drops, while alive)
  function kitTable(ms) {
    if (!window.TLKit) return null;
    const rows = [];
    ms.forEach((m) => { const pv = POVS[m.id] || []; if (pv.length) pv.forEach((p) => rows.push({ agent: p.agent, rounds: p.rounds })); else if (m.comps && m.comps.me) rows.push({ agent: m.comps.me, rounds: m.rounds }); });
    const list = TLKit.summarize(rows);
    if (!list.length) return null;
    const flag = (txt, bad, why) => h("td", { class: "num" }, txt, bad ? h("span", { class: "pill warn", style: "margin-left:6px", title: why }, "多い") : null);
    const tr = list.map((s) => {
      const holdMax = Math.max(...s.holdPerRound.slice(0, 3));
      return h("tr", {}, h("td", {}, s.agent), h("td", { class: "num" }, s.rounds),
        ...s.holdPerRound.map((v, i) => h("td", { class: "num" }, v + "秒", i < 3 && v >= 10 && v === holdMax ? h("span", { class: "pill warn", style: "margin-left:6px", title: "1ラウンドに10秒以上構えています" }, "長い") : null)),
        flag(s.holdShare == null ? "—" : s.holdShare + "%", s.holdShare > 15, "生きている時間の15%以上スキルを構えています"),
        flag(s.leftAtDeath == null ? "—" : s.leftAtDeath + "個", s.leftAtDeath >= 1.5, "倒されたときにスキルが平均1.5個以上残っています"),
        flag(s.ultHeld + "R(最長" + s.ultStreakMax + "連続)", s.ultStreakMax >= 3, "ウルトを3ラウンド以上続けて温存しました"),
        h("td", { class: "num" }, s.ultDeaths + "回"),
        h("td", { class: "num" }, s.killsRounds ? s.kills + "(" + s.killsUlt + ")" : "—"));
    });
    return h("section", { class: "card dsec" }, h("h3", {}, "スキルとウルト(エージェント別)"),
      h("p", { class: "small muted" }, "録画した人の視点から数えています。バリアが消えてから(購入フェーズは含みません)倒されるかラウンドが終わるまでの分です。C・Q・E・X は画面下のスキル欄の左から順番(Xはウルト)。"),
      h("div", { class: "tblbox" }, h("table", { class: "tbl dtbl" }, h("thead", {}, h("tr", {}, ["エージェント", "ラウンド", "構え C", "構え Q", "構え E", "構え X", "構えていた割合", "倒されたときの残りスキル", "ウルト温存", "ウルトを持ったままデス", "キル(ウルト中)"].map((t) => h("th", {}, t)))), h("tbody", {}, tr))));
  }

  // Team situations (post-plant, retake, attack pace, small fights, clutches) and fights by location
  function situationSection(ms) {
    if (!window.TLKit) return null;
    const o = TLKit.situations(ms.map((m) => m.rounds)), t = (label, a, sub) => tile(label, a[0], a[1], sub);
    const st = o.states, pick = (k) => st[k] || [0, 0];
    const clutch = Object.keys(st).filter((k) => /^1v[1-5]$/.test(k)).reduce((a, k) => [a[0] + st[k][0], a[1] + st[k][1]], [0, 0]);
    return h("section", { class: "card dsec" }, h("h3", {}, "状況別の勝率"),
      h("p", { class: "small muted" }, "人数はバリアが消えてからの生存人数(自分たちv相手)。攻めの速さは、アタックで設置したときの残り時間で分けています。"),
      h("div", { class: "dgrid" }, t("ポストプラント(アタック設置後)", o.postPlant), t("リテイク(ディフェンス)", o.retake), t("少人数戦(両方2人以下)", o.smallFight), t("クラッチ(1人残り)", clutch)),
      h("div", { class: "dgrid" }, t("速攻(残り60秒以上で設置)", o.pace.fast), t("ふつう(残り30〜59秒)", o.pace.mid), t("ゆっくり(残り30秒未満)", o.pace.slow), t("設置なし(アタック)", o.pace.none)),
      h("div", { class: "dgrid" }, t("人数有利 5v4", pick("5v4")), t("人数不利 4v5", pick("4v5")), t("2v2", pick("2v2")), t("1v1", pick("1v1"))));
  }
  function placeTable(ms) {
    if (!window.TLKit) return null;
    const rows = [];
    ms.forEach((m) => { const pv = POVS[m.id] || []; if (pv.length) pv.forEach((p) => rows.push({ agent: p.agent, rounds: p.rounds })); else if (m.comps && m.comps.me) rows.push({ agent: m.comps.me, rounds: m.rounds }); });
    const list = TLKit.places(rows).filter((x) => x.agent !== "*" && x.k + x.d >= 2).slice(0, 30);
    if (!list.length) return null;
    return h("section", { class: "card dsec" }, h("h3", {}, "場所ごとの撃ち合い(エージェント別)"),
      h("p", { class: "small muted" }, "録画した人がキルした場所と、倒された場所(ゲームがミニマップの下に出す場所の名前)。撃ち合い勝率 = キル ÷(キル+デス)。"),
      h("div", { class: "tblbox" }, h("table", { class: "tbl dtbl" }, h("thead", {}, h("tr", {}, ["エージェント", "場所", "キル", "デス", "撃ち合い勝率"].map((x) => h("th", {}, x)))),
        h("tbody", {}, list.map((x) => h("tr", {}, h("td", {}, x.agent), h("td", {}, x.place), h("td", { class: "num" }, x.k), h("td", { class: "num" }, x.d), h("td", {}, bar(rate(x.k, x.k + x.d)))))))));
  }

  function filters() {
    const sel = h("select", { "aria-label": "マップ", class: "teamsel" }, h("option", { value: "" }, "すべてのマップ"), ...MAPS().map(([v, n]) => h("option", { value: v }, n)));
    sel.value = F.map; sel.onchange = () => { F.map = sel.value; render(); };
    const from = h("input", { type: "date", "aria-label": "いつから", value: F.from }), to = h("input", { type: "date", "aria-label": "いつまで", value: F.to });
    from.onchange = () => { F.from = from.value; render(); }; to.onchange = () => { F.to = to.value; render(); };
    const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    const quick = (label, days) => h("button", { class: "btn small" + ((days == null ? !F.from && !F.to : F.from === iso(new Date(Date.now() - days * 864e5)) && !F.to) ? " on" : ""), type: "button", onclick: () => { F.from = days == null ? "" : iso(new Date(Date.now() - days * 864e5)); F.to = ""; render(); } }, label);
    return h("div", { class: "dfilters" }, sel, quick("全期間", null), quick("7日", 7), quick("30日", 30), h("span", { class: "row", style: "gap:6px;align-items:center" }, from, h("span", { class: "muted" }, "〜"), to),
      h("button", { class: "btn small", type: "button", style: "margin-left:auto", onclick: () => window.print() }, "PDFで保存・印刷"));
  }

  function render() {
    const box = $("dashBody"); if (!box || !APP.team) return;
    const ms = filtered(), rs = ms.flatMap((m) => m.rounds || []);
    box.replaceChildren(filters());
    if (!(APP.matches || []).length) { box.append(h("div", { class: "empty" }, h("strong", {}, "まだ試合がありません"), h("span", {}, "録画を分析すると、ここに勝率やファーストキルの数字が並びます。"))); return; }
    if (!ms.length) { box.append(h("div", { class: "empty" }, h("strong", {}, "この条件の試合はありません"), h("span", {}, "マップや期間を変えてみてください。"))); return; }

    const W = ms.filter((m) => result(m) === "W").length, Lo = ms.filter((m) => result(m) === "L").length;
    const all = known(rs), att = known(rs.filter((r) => r.side === "attack")), def = known(rs.filter((r) => r.side === "defense"));
    const last5 = ms.slice(-5);
    const fk = rs.filter((r) => r.fk === "us" || r.fk === "them"), fkUs = fk.filter((r) => r.fk === "us"), fkThem = fk.filter((r) => r.fk === "them");
    const pistol = known(rs.filter((r) => r.n === 1 || r.n === 13));
    const myK = rs.filter((r) => r.myFk === true || r.myFk === false), myD = rs.filter((r) => r.myFd === true || r.myFd === false);
    const sv = rs.filter((r) => r.myDead === true || r.myDead === false), dead = sv.filter((r) => r.myDead === true && r.myDeathT != null);
    const avgLife = dead.length ? Math.round(dead.reduce((a, r) => a + r.myDeathT, 0) / dead.length) : null;
    const lifeTile = h("div", { class: "dtile" }, h("span", { class: "dk" }, "配信者の平均生存時間(死んだラウンド)"), h("span", { class: "dv" }, avgLife == null ? "—" : String(avgLife), avgLife == null ? null : h("small", {}, "秒")), h("span", { class: "ds" }, dead.length ? dead.length + "ラウンド ・ 開始から倒されるまで" : "データなし"));

    const recent = h("div", { class: "dtile" }, h("span", { class: "dk" }, "直近5試合"),
      h("span", { class: "dv" }, String(rate(last5.filter((m) => result(m) === "W").length, last5.filter((m) => result(m)).length) ?? "—"), h("small", {}, "%")),
      h("div", { class: "dform" }, last5.map((m) => { const r = result(m); return h("span", { class: "pill " + (r === "W" ? "win" : r === "L" ? "loss" : "mute"), title: (m.date || "") + " " + mapName(m.map) }, r === "W" ? "勝" : r === "L" ? "負" : "−"); })),
      h("span", { class: "ds" }, last5.length + "試合"));

    box.append(
      h("div", { class: "dgrid" }, tile("試合勝率", W, W + Lo, "ラウンド勝率 " + pctText(wins(all), all.length)), tile("アタック取得率", wins(att), att.length), tile("ディフェンス取得率", wins(def), def.length), recent),
      h("div", { class: "dgrid" }, tile("ファーストキル取得率", fkUs.length, fk.length), tile("FKを取ったラウンドの勝率", wins(known(fkUs)), known(fkUs).length), tile("FKを取られたラウンドの勝率", wins(known(fkThem)), known(fkThem).length), tile("ピストル(1・13R)取得率", wins(pistol), pistol.length)),
      playerTable(ms) || (myK.length || myD.length || sv.length ? h("div", { class: "dgrid" }, tile("配信者のファーストキル率", myK.filter((r) => r.myFk).length, myK.length, "録画した人"), tile("配信者のファーストデス率", myD.filter((r) => r.myFd).length, myD.length, "録画した人"), tile("配信者の生存率", sv.filter((r) => r.myDead === false).length, sv.length, "最後まで生き残ったラウンド"), lifeTile) : null),
      situationSection(ms),
      kitTable(ms),
      placeTable(ms),
      h("section", { class: "card dsec" }, h("h3", {}, "ラウンド勝率の推移(直近20試合)"), h("p", { class: "small muted" }, "点にマウスを乗せると、その試合の内容が出ます。点線は50%。緑の点は勝った試合、赤は負けた試合です。"), trendChart(ms)),
      h("div", { class: "dcols" },
        h("section", { class: "card dsec" }, h("h3", {}, "マップ別"), mapTable(ms)),
        h("section", { class: "card dsec" }, h("h3", {}, "設置サイト別"), h("p", { class: "small muted" }, "アタックは設置してからの勝率、ディフェンスは相手に設置されてからの勝率(リテイク)です。"), siteTable(rs))));
  }

  function renderWithAds() { render(); loadPovs().then((changed) => { if (changed && !$("view-dash").hidden) render(); }); const ad = $("adDash"); if (!ad) return; if (APP.team && APP.team.plan === "free" && window.TLAds) { TLAds.fill(ad, "dash", { title: "デバイスを見直すなら" }); TLAds.wide($("adWide")); } else { ad.hidden = true; if ($("adWide")) $("adWide").hidden = true; } }
  window.renderDash = renderWithAds;
})();
