// Ability / ult numbers per player (agent), built from the per-round "kit" data the analyzer stores for each recorded view.
// Shared by the dashboard (browser: window.TLKit) and the AI questions (api/ask.js: require).
// Every number only counts time AFTER the barrier dropped (combat phase) and while the player was alive: the buy phase is never included.
//
// round.kit = { al: seconds alive in the combat phase, h: [C,Q,E,X] seconds an ability was held out (equipped, not the gun),
//               hn: number of separate times an ability was taken out, lf: [C,Q,E] 1 = still had that ability at death / round end,
//               dead: died this round, us: ult ready when the round started, uu: ult used this round, ud: died with ult ready,
//               k: kills (null = not read), ku: kills while ult was ready }
(function (root) {
  const SLOT = ["C", "Q", "E", "X"];
  const r1 = (x) => Math.round(x * 10) / 10;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

  // rows: [{agent, rounds:[...]}] in time order (one entry per recorded view)
  function summarize(rows) {
    const by = {};
    rows.forEach((p) => {
      const k = p.agent || "不明";
      const s = (by[k] = by[k] || { agent: k, rounds: 0, alive: 0, hold: [0, 0, 0, 0], takes: 0, deaths: 0, leftAtDeath: 0, deathsLeft2: 0, leftAtEnd: 0, ends: 0,
        ultStart: 0, ultUsed: 0, ultHeld: 0, ultStreakMax: 0, ultDeaths: 0, kills: 0, killsRead: 0, killsUlt: 0, ultRoundsAlive: 0 });
      let streak = 0;
      (p.rounds || []).forEach((r) => {
        const kt = r.kit; if (!kt || !(kt.al > 0)) { streak = 0; return; }
        s.rounds++; s.alive += kt.al; (kt.h || []).forEach((v, i) => { s.hold[i] += v || 0; }); s.takes += kt.hn || 0;
        const left = (kt.lf || []).filter(Boolean).length;
        if (kt.dead) { s.deaths++; s.leftAtDeath += left; if (left >= 2) s.deathsLeft2++; if (kt.ud) s.ultDeaths++; } else { s.ends++; s.leftAtEnd += left; }
        if (kt.us) { s.ultStart++; s.ultRoundsAlive += kt.al; if (kt.uu) { s.ultUsed++; streak = 0; } else { s.ultHeld++; streak++; s.ultStreakMax = Math.max(s.ultStreakMax, streak); } } else streak = 0;
        if (kt.k != null) { s.killsRead++; s.kills += kt.k; s.killsUlt += kt.ku || 0; }
      });
    });
    return Object.values(by).filter((s) => s.rounds).map((s) => ({
      agent: s.agent, rounds: s.rounds,
      holdPerRound: s.hold.map((v) => r1(v / s.rounds)),                 // seconds per round for C, Q, E, X
      holdShare: pct(s.hold.reduce((a, b) => a + b, 0), s.alive),        // % of alive combat time with an ability out
      takesPerRound: r1(s.takes / s.rounds),
      deaths: s.deaths, leftAtDeath: s.deaths ? r1(s.leftAtDeath / s.deaths) : null, deathsLeft2: s.deathsLeft2,
      leftAtEnd: s.ends ? r1(s.leftAtEnd / s.ends) : null,
      ultStart: s.ultStart, ultUsed: s.ultUsed, ultHeld: s.ultHeld, ultStreakMax: s.ultStreakMax, ultDeaths: s.ultDeaths,
      killsRounds: s.killsRead, kills: s.kills, killsUlt: s.killsUlt,
    })).sort((a, b) => b.rounds - a.rounds);
  }

  // Fights from the minimap + kill feed of every death in a round (r.fights: {t, k: killer agent, v: victim agent, g: killer on our team, p: place}).
  // One recording is enough: every death of both teams is read. matches: [{map, rounds}] (each match once).
  // Returns per place: kills / deaths of each of OUR agents there, plus team totals (agent "*").
  function places(matches) {
    const m = {};
    const add = (agent, place, key) => { place = String(place || "").trim(); if (!place || place === "?") return; for (const a of [agent || "?", "*"]) { const id = a.toLowerCase() + "|" + place.toLowerCase().replace(/\s+/g, ""); (m[id] = m[id] || { agent: a, place, k: 0, d: 0 })[key]++; } };
    matches.forEach((mt) => (mt.rounds || []).forEach((r) => (r.fights || []).forEach((f) => {
      const pl = (mt.map ? mt.map + ":" : "") + f.p;
      if (f.g === true) add(f.k, pl, "k"); else if (f.g === false) add(f.v, pl, "d");
    })));
    return Object.values(m).sort((a, b) => (b.k + b.d) - (a.k + a.d));
  }
  // kills / deaths of each of our agents over all rounds (from the fights)
  function teamKD(matches) {
    const m = {}; const g = (a) => (m[a] = m[a] || { agent: a, k: 0, d: 0, rounds: 0 });
    matches.forEach((mt) => (mt.rounds || []).forEach((r) => { if (!Array.isArray(r.fights) || !r.fights.length) return; const seen = new Set();
      r.fights.forEach((f) => { if (f.g === true && f.k && f.k !== "?") { g(f.k).k++; seen.add(f.k); } if (f.g === false && f.v && f.v !== "?") { g(f.v).d++; seen.add(f.v); } });
      seen.forEach((a) => g(a).rounds++); }));
    return Object.values(m).sort((a, b) => b.k - a.k);
  }
  // Team situations from the round list of each match (counted once per match):
  // man-advantage states reached (alive counts us v them), post-plant / retake, attack pace (time left at plant), timing of the first fight.
  function situations(roundLists) {
    const st = {}, out = { states: st, postPlant: [0, 0], retake: [0, 0], pace: { fast: [0, 0], mid: [0, 0], slow: [0, 0], none: [0, 0] }, firstFight: { early: [0, 0], mid: [0, 0], late: [0, 0] }, smallFight: [0, 0], plantState: {},
      pistol: [0, 0], pistolAtk: [0, 0], pistolDef: [0, 0], defNone: [0, 0], noPlantRem: { atkWin: [], atkLoss: [], defWin: [], defLoss: [] }, site: {} };
    const inc = (a, win) => { a[1]++; if (win) a[0]++; };
    roundLists.forEach((rs) => (rs || []).forEach((r, ri) => {
      if (r.win == null || r.void) return;   // void = ended by force in a custom game
      if (r.n === 1 || r.n === 13) { inc(out.pistol, r.win); inc(r.side === "attack" ? out.pistolAtk : out.pistolDef, r.win); }
      const atk = r.side === "attack", planted = !!r.planted || r.plantAt != null;
      // rounds without a plant: how much time was left when the round ended (barrier drop -> next score change)
      if (!planted) {
        if (!atk) inc(out.defNone, r.win);
        const nx = rs[ri + 1];
        if (r.st != null && nx && nx.start != null) { const rem = Math.max(0, Math.min(100, Math.round(100 - (nx.start - r.st)))); out.noPlantRem[(atk ? "atk" : "def") + (r.win ? "Win" : "Loss")].push(rem); }
      }
      if (planted && atk) inc(out.postPlant, r.win);
      if (planted && !atk) inc(out.retake, r.win);
      if (atk) { const x = typeof r.plant === "number" ? r.plant : null; inc(out.pace[!planted ? "none" : x == null ? "mid" : x >= 60 ? "fast" : x >= 30 ? "mid" : "slow"], r.win); }
      const alv = Array.isArray(r.alv) ? r.alv : null; if (!alv) return;
      const seen = new Set(); let small = false;
      alv.forEach(([t, u, e]) => { if (u < 1 || e < 1) return; const k = u + "v" + e; if (!seen.has(k)) { seen.add(k); inc(st[k] = st[k] || [0, 0], r.win); } if (u <= 2 && e <= 2) small = true; });
      if (small) inc(out.smallFight, r.win);
      const first = alv.find((x) => x[1] < 5 || x[2] < 5);
      if (first) inc(out.firstFight[first[0] < 20 ? "early" : first[0] < 45 ? "mid" : "late"], r.win);
      if (planted && typeof r.plant === "number") { const tp = 100 - r.plant; let s = [5, 5]; alv.forEach(([t, u, e]) => { if (t <= tp) s = [u, e]; }); const k = (atk ? "post-plant " : "retake ") + s[0] + "v" + s[1]; inc(out.plantState[k] = out.plantState[k] || [0, 0], r.win);
        // per site and side: numbers at the moment of the plant (advantage / even / disadvantage for our team)
        if (r.site) { const key = (atk ? "attack" : "defense") + ":" + r.site, x = (out.site[key] = out.site[key] || { adv: [0, 0], even: [0, 0], dis: [0, 0], us: 0, them: 0, n: 0 });
          inc(x[s[0] > s[1] ? "adv" : s[0] === s[1] ? "even" : "dis"], r.win); x.us += s[0]; x.them += s[1]; x.n++; } }
    }));
    return out;
  }
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) + "(" + a.length + "R)" : "-");
  const wr = (a) => a[0] + "/" + a[1] + (a[1] ? "(" + Math.round((a[0] / a[1]) * 100) + "%)" : "");
  function situationText(roundLists) {
    const o = situations(roundLists);
    const states = Object.entries(o.states).sort((a, b) => b[1][1] - a[1][1]).map(([k, v]) => k + "=" + wr(v)).join(" ");
    return "team situations (wins/rounds): pistol_rounds(1st and 13th round)=" + wr(o.pistol) + " (attack " + wr(o.pistolAtk) + ", defense " + wr(o.pistolDef) + ") post_plant_attack=" + wr(o.postPlant) + " retake_defense=" + wr(o.retake) +
      " attack_pace: fast(planted with 60s+ left)=" + wr(o.pace.fast) + " mid(30-59s left)=" + wr(o.pace.mid) + " slow(<30s left)=" + wr(o.pace.slow) + " no_plant=" + wr(o.pace.none) +
      " first_fight: within20s=" + wr(o.firstFight.early) + " 20-45s=" + wr(o.firstFight.mid) + " after45s=" + wr(o.firstFight.late) +
      " small_fight(both sides 2 or fewer at some point)=" + wr(o.smallFight) +
      "\nreached_state(us v them, round win rate when this state happened)=" + (states || "-") +
      "\nat_plant=" + (Object.entries(o.plantState).map(([k, v]) => k.replace(" ", "_") + "=" + wr(v)).join(" ") || "-") +
      "\nat_plant_by_site=" + (Object.entries(o.site).map(([k, v]) => k + "(avg " + (v.us / v.n).toFixed(1) + "v" + (v.them / v.n).toFixed(1) + " advantage=" + wr(v.adv) + " even=" + wr(v.even) + " disadvantage=" + wr(v.dis) + ")").join(" ") || "-") +
      "\nno_plant: defense_enemy_did_not_plant=" + wr(o.defNone) + " avg_time_left_when_round_ended(sec): attack_won=" + avg(o.noPlantRem.atkWin) + " attack_lost=" + avg(o.noPlantRem.atkLoss) + " defense_won=" + avg(o.noPlantRem.defWin) + " defense_lost=" + avg(o.noPlantRem.defLoss);
  }
  function placeText(matches) {
    const kd = teamKD(matches).map((x) => "team_kd agent=" + String(x.agent).replace(/[,\s]+/g, "_") + " kills=" + x.k + " deaths=" + x.d).join("\n");
    return (kd ? kd + "\n" : "") + places(matches).slice(0, 80).map((x) => "fight_place agent=" + (x.agent === "*" ? "TEAM" : String(x.agent).replace(/[,\s]+/g, "_")) + " place=" + x.place.replace(/[,\s]+/g, "_") + " kills=" + x.k + " deaths=" + x.d).join("\n");
  }

  // short per-round marks for the AI data text
  function marks(r) {
    const kt = r && r.kit; if (!kt || !(kt.al > 0)) return "";
    const h = (kt.h || []).map((v, i) => (v ? SLOT[i] + Math.round(v) : "")).filter(Boolean).join("/");
    const lf = (kt.lf || []).map((v, i) => (v ? SLOT[i] : "")).join("");
    const pl = (x) => String(x).replace(/[,\s]+/g, "_");
    return "+AL" + Math.round(kt.al) + (h ? "+H:" + h : "") + (lf ? "+L:" + lf : "") + (kt.us ? (kt.uu ? "+UU" : "+UH") : "") + (kt.ud ? "+DU" : "") + (kt.k != null ? "+K" + kt.k + (kt.ku ? "+KU" + kt.ku : "") : "");
  }

  function summaryText(rows) {
    return summarize(rows).map((s) => "kit agent=" + String(s.agent).replace(/[,\s]+/g, "_") + ": rounds=" + s.rounds +
      " hold_sec_per_round(C/Q/E/X)=" + s.holdPerRound.join("/") + " hold_share=" + s.holdShare + "% takes_per_round=" + s.takesPerRound +
      " deaths=" + s.deaths + " skills_left_at_death_avg=" + (s.leftAtDeath ?? "-") + " deaths_with_2plus_left=" + s.deathsLeft2 + " skills_left_at_round_end_avg=" + (s.leftAtEnd ?? "-") +
      " ult_ready_at_start=" + s.ultStart + " ult_used=" + s.ultUsed + " ult_kept_unused=" + s.ultHeld + " ult_longest_kept_streak=" + s.ultStreakMax + " died_with_ult_ready=" + s.ultDeaths +
      " kills=" + s.kills + "(in " + s.killsRounds + " rounds) kills_while_ult_ready=" + s.killsUlt).join("\n");
  }


  // Location names per map (as the game shows them under the minimap; English / Japanese client) and common nicknames players use.
  // Given to the AI so it can match place names in either language, group them by area, and understand nicknames in questions.
  const CALLOUTS = {
    ascent: "A Main/Aメイン(Aロング), A Lobby/Aロビー, A Garden/Aガーデン, A Rafters/Aラフター, A Heaven/Aヘヴン, A Site/Aサイト, A Generator/Aジェネレーター, A Window(窓), A Short(Aショート), Mid Catwalk/中央キャットウォーク, Mid Top/中央トップ, Mid Bottom/中央ボトム, Mid Courtyard/中央コートヤード(ミッド), Mid Pizza/中央ピザ, Mid Market/中央マーケット, Mid Link/中央リンク, B Main/Bメイン, B Lobby/Bロビー, B Site/Bサイト, B Back(バックサイト), B Boathouse/Bボートハウス, Defender Side Spawn/ディフェンス側スポーン(CTスポーン), Attacker Side Spawn/アタック側スポーン(Tスポーン)",
    haven: "A Tower/Aタワー, A Site/Aサイト, A Long/Aロング, A Link/Aリンク, A Short/Aショート, A Lobby/Aロビー, A Garden/Aガーデン, B Back/Bバック, B Site/Bサイト, Mid Courtyard/中央コートヤード, Mid Window/中央ウィンドウ, Mid Doors/中央ドア, C Window/Cウィンドウ, C Short/Cショート, C Link/Cリンク, C Lobby/Cロビー, C Cubby/Cカビー, C Long/Cロング, C Site/Cサイト, Defender Side Spawn/ディフェンス側スポーン, Attacker Side Spawn/アタック側スポーン",
    split: "A Back/Aバック, A Site/Aサイト, A Main/Aメイン, A Lobby/Aロビー, A Screens/Aスクリーン, A Rafters/Aラフター(ヘブン), A Tower/Aタワー, A Ramps/Aランプ, A Sewer/A下水道, Mid Vent/中央ベント, Mid Top/中央トップ, Mid Bottom/中央ボトム, Mid Mail/中央メール, B Stairs/B階段, B Tower/Bタワー, B Link/Bリンク, B Rafters/Bラフター(ヘブン), B Alley/Bアリー, B Site/Bサイト, B Main/Bメイン, B Lobby/Bロビー, B Back/Bバック, Defender Side Spawn/ディフェンス側スポーン, Attacker Side Spawn/アタック側スポーン",
    fracture: "A Main/Aメイン, A Door/Aドア, A Rope/Aロープ, A Link/Aリンク, A Drop/Aドロップ, A Site/Aサイト, Antenna/アンテナ, Bridge/ブリッジ, B Main/Bメイン, B Tunnel/トンネル, B Tree/ツリー, B Canteen/カンティーン, B Link/Bリンク, B Plaza/広場, B Bench/ベンチ, B Tower/Bタワー, B Site/Bサイト, Defender Side Spawn/ディフェンス側スポーン(CTベース), Attacker Side Spawn/アタック側スポーン(Tベース)",
    lotus: "A Top/Aトップ, A Drop/Aドロップ, A Hut/A小屋, A Stairs/A階段, A Site/Aサイト, A Tree/Aツリー, A Door/A扉, A Main/Aメイン, A Link/Aリンク, A Rubble/Aがれき, A Root/Aルート, A Lobby/Aロビー, B Upper/Bアッパー, B Site/Bサイト, B Main/Bメイン, B Pillars/Bピラー, C Hall/Cホール, C Gravel/C砂利道, C Link/Cリンク, C Waterfall/C滝, C Site/Cサイト, C Bend/Cベンド, C Main/Cメイン, C Door/C扉, C Mound/Cマウンド, C Lobby/Cロビー, Defender Side Spawn/ディフェンス側スポーン, Attacker Side Spawn/アタック側スポーン",
    bind: "A Tower/Aタワー, A Lamps/Aランプ, A Site/Aサイト(ヘブン・トリプル), A Bath/A浴場(シャワー), A Teleporter/Aテレポーター, A Short/Aショート, A Lobby/Aロビー, A Exit/A出口, A Link/Aリンク, A Cubby/A小部屋, B Hall/Bホール, B Elbow/Bエルボー, B Site/Bサイト(黒コン・ザリガニ), B Garden/Bガーデン, B Window/Bウィンドウ(窓), B Teleporter/Bテレポーター, B Exit/B出口, B Long/Bロング, B Short/Bショート, B Link/Bリンク, B Fountain/Bファウンテン(噴水), Attacker Side Cave/アタック側ケイヴ, Defender Side Spawn/ディフェンス側スポーン(CTベース), Attacker Side Spawn/アタック側スポーン(Tベース)",
    icebox: "A Rafters/Aラフター, A Site/Aサイト, A Screen/Aスクリーン, A Pipes/Aパイプ, A Nest/Aネスト, A Belt/Aベルト, Mid Boiler/中央ボイラー, Mid Pallet/中央パレット, Mid Blue/中央ブルー, B Back/Bバック, B Snowman/B雪だるま, B Hut/B小屋, B Kitchen/Bキッチン, B Fence/Bフェンス, B Hall/Bホール, B Cubby/B小部屋, B Orange/Bオレンジ, B Tube/Bチューブ, B Site/Bサイト, B Yellow/Bイエロー, B Green/Bグリーン, B Shack/B小部屋, B Garage/Bガレージ, Defender Side Spawn/ディフェンス側スポーン, Attacker Side Spawn/アタック側スポーン",
    breeze: "A Lobby/Aロビー, A Main/Aメイン, A Shop(石垣), A Site/Aサイト(かに・えび), A Bridge/Aブリッジ, A Hall/Aホール, A Stairs(階段), A Yellow(イエロー), A Metal Doors/メタルドア, A Rope/ロープ, Mid Bottom/ボトム, Mid Top/トップ, Mid Wood Doors(DD), Mid Chute/シュート, Mid Nest/ネスト, B Window/ウィンドウ, B Main/Bメイン, B Elbow/エルボー, B Tunnel/トンネル, B Wall/ウォール, B Site/Bサイト, B Back/バック, CT, Defender Side Spawn/ディフェンス側スポーン, Attacker Side Spawn/アタック側スポーン",
    pearl: "A Secret/Aシークレット, A Flowers/Aフラワー, A Dugout/Aダグアウト, A Site/Aサイト(エルボー), A Link/Aリンク, A Art/Aアート, A Main/Aメイン, A Restaurant/Aレストラン, Defender Side Records/ディフェンス側レコード, Defender Side Water/ディフェンス側ウォーター, Mid Connector/中央コネクター, Mid Doors/中央ドア(DD), Mid Plaza/中央プラザ(ミッド), Mid Shops/中央ショップ, Mid Top/中央トップ(ウィンドウ), B Hall/Bホール, B Screen/Bスクリーン, B Site/Bサイト, B Tower/Bタワー(ヘヴン), B Tunnel/Bトンネル, B Link/Bリンク(Bショート), B Main/Bメイン(Bロング・柱), B Ramp/Bスロープ, B Club/Bクラブ, Defender Side Spawn/ディフェンス側スポーン(CTベース), Attacker Side Spawn/アタック側スポーン(Tベース)",
    sunset: "Defender Spawn/ディフェンス側スポーン, A Alley/Aアリー, A Link/Aリンク, A Site/Aサイト, A Elbow/Aエルボー, A Main/Aメイン, A Lobby/Aロビー, Mid Top/中央トップ, Mid Courtyard/中央コートヤード, Mid Tiles/中央タイル, Mid Bottom/中央ボトム, B Boba/Bボバ, B Site/Bサイト, B Market/Bマーケット, B Main/Bメイン, B Lobby/Bロビー, Attacker Spawn/アタック側スポーン",
    abyss: "A Secret/Aシークレット, A Security/Aセキュリティー, A Link/Aリンク, A Vent/A換気通路, A Tower/Aタワー, A Site/Aサイト, A Bridge/Aブリッジ, A Main/Aメイン, A Lobby/Aロビー, Mid Top/中央トップ, Mid Library/中央ライブラリ, Mid Catwalk/中央キャットウォーク, Mid Bend/中央ベンド, Mid Bottom/中央ボトム, B Tower/Bタワー, B Link/Bリンク, B Site/Bサイト, B Danger/Bデンジャー, B Main/Bメイン, B Nest/Bネスト, B Lobby/Bロビー, Defender Side Spawn/ディフェンス側スポーン, Attacker Side Spawn/アタック側スポーン",
    corrode: "B Arch/Bアーチ, B Tower/Bタワー, B Elbow/Bエルボー, B Site/Bサイト, B Link/Bリンク, B Main/Bメイン, B Lobby/Bロビー, Mid Window/中央ウィンドウ, Mid Top/中央トップ, Mid Stairs/中央階段, Mid Bottom/中央ボトム, A Crane/Aクレーン, A Elbow/Aエルボー, A Site/Aサイト, A Yard/Aヤード, A Pocket/Aポケット, A Link/Aリンク, A Main/Aメイン, A Lobby/Aロビー, Defender Side Spawn/ディフェンス側スポーン, Attacker Side Spawn/アタック側スポーン",
    summit: "B Drop/Bドロップ, B Tower/Bタワー, B Gym/Bジム, B Site/Bサイト, B Trophy/Bトロフィー, B Link/Bリンク, B Main/Bメイン, B Lobby/Bロビー, Mid Window/中央ウィンドウ, Mid Bottom/中央ボトム, Mid Bend/中央ベンド, Mid Fountain/中央ファウンテン, Mid Tiles/中央タイル, Mid Top/中央トップ, A Hall/Aホール, A Art/Aアート, A Cave/Aケイヴ, A Link/Aリンク, A Garden/Aガーデン, A Site/Aサイト, A Main/Aメイン, A Lobby/Aロビー, Defender Side Spawn/ディフェンス側スポーン, Attacker Side Spawn/アタック側スポーン",
  };
  // Which map has these location names? (location names read from the screen, English or Japanese) -> {map, hits, second}
  const norm = (x) => String(x || "").toLowerCase().replace(/[\s・_\-]+/g, "");
  let NAMES = null;
  function guessMap(names) {
    if (!NAMES) { NAMES = {}; for (const [m, txt] of Object.entries(CALLOUTS)) { const set = new Set(); txt.split(/,\s*/).forEach((it) => { const main = it.replace(/\(.*?\)/g, ""); main.split("/").forEach((x) => { if (x.trim()) set.add(norm(x)); }); const nick = it.match(/\((.*?)\)/); if (nick) nick[1].split(/[・、]/).forEach((x) => set.add(norm(x))); }); NAMES[m] = set; } }
    const generic = new Set(["asite", "bsite", "csite", "aサイト", "bサイト", "cサイト", "amain", "bmain", "aメイン", "bメイン", "alobby", "blobby", "aロビー", "bロビー", "alink", "blink", "aリンク", "bリンク", "midtop", "midbottom", "中央トップ", "中央ボトム", "defendersidespawn", "attackersidespawn", "ディフェンス側スポーン", "アタック側スポーン", "defenderspawn", "attackerspawn"]);
    const score = {};
    [...new Set(names.map(norm))].filter((n) => n && !generic.has(n)).forEach((n) => { for (const [m, set] of Object.entries(NAMES)) if (set.has(n)) score[m] = (score[m] || 0) + 1; });
    const top = Object.entries(score).sort((a, b) => b[1] - a[1]);
    return top.length ? { map: top[0][0], hits: top[0][1], second: top[1] ? top[1][1] : 0 } : null;
  }
  function calloutText(mapIds) {
    return [...new Set(mapIds)].filter((m) => CALLOUTS[m]).map((m) => "callouts map=" + m + ": " + CALLOUTS[m]).join("\n");
  }

  // alive-count flow of a round, e.g. "4v5>4v4>2v3" (us v them)
  const flow = (r) => (Array.isArray(r.alv) && r.alv.length > 1 ? "+S:" + r.alv.slice(1).map((x) => x[1] + "v" + x[2]).join(">") : "") +
    (Array.isArray(r.fights) && r.fights.length ? "+FT:" + r.fights.map((f) => f.t + "s_" + String(f.k).replace(/[,\s>]+/g, "") + ">" + String(f.v).replace(/[,\s>]+/g, "") + (f.g === true ? "(us)" : f.g === false ? "(them)" : "") + "@" + String(f.p).replace(/[,\s]+/g, "_")).join("/") : "");
  const K = { guessMap, teamKD, CALLOUTS, calloutText, SLOT, summarize, marks, summaryText, places, placeText, situations, situationText, flow };
  if (typeof module !== "undefined" && module.exports) module.exports = K; else root.TLKit = K;
})(typeof window !== "undefined" ? window : this);
