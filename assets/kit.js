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

  // Fights by location (location name the game shows under the minimap): kills and deaths of each recorded player there.
  // rows as in summarize. Returns [{agent, place, k, d}] plus team totals (agent "*").
  function places(rows) {
    const m = {};
    const add = (agent, place, key) => { place = String(place || "").trim(); if (!place) return; for (const a of [agent || "不明", "*"]) { const id = a + "|" + place.toLowerCase(); (m[id] = m[id] || { agent: a, place, k: 0, d: 0 })[key]++; } };
    rows.forEach((p) => (p.rounds || []).forEach((r) => { const kt = r.kit; if (!kt) return; (kt.kp || []).forEach((x) => add(p.agent, x, "k")); if (kt.dead && kt.dp) add(p.agent, kt.dp, "d"); }));
    return Object.values(m).sort((a, b) => (b.k + b.d) - (a.k + a.d));
  }

  // Team situations from the round list of each match (counted once per match):
  // man-advantage states reached (alive counts us v them), post-plant / retake, attack pace (time left at plant), timing of the first fight.
  function situations(roundLists) {
    const st = {}, out = { states: st, postPlant: [0, 0], retake: [0, 0], pace: { fast: [0, 0], mid: [0, 0], slow: [0, 0], none: [0, 0] }, firstFight: { early: [0, 0], mid: [0, 0], late: [0, 0] }, smallFight: [0, 0], plantState: {} };
    const inc = (a, win) => { a[1]++; if (win) a[0]++; };
    roundLists.forEach((rs) => (rs || []).forEach((r) => {
      if (r.win == null) return;
      const atk = r.side === "attack", planted = !!r.planted || r.plantAt != null;
      if (planted && atk) inc(out.postPlant, r.win);
      if (planted && !atk) inc(out.retake, r.win);
      if (atk) { const x = typeof r.plant === "number" ? r.plant : null; inc(out.pace[!planted ? "none" : x == null ? "mid" : x >= 60 ? "fast" : x >= 30 ? "mid" : "slow"], r.win); }
      const alv = Array.isArray(r.alv) ? r.alv : null; if (!alv) return;
      const seen = new Set(); let small = false;
      alv.forEach(([t, u, e]) => { if (u < 1 || e < 1) return; const k = u + "v" + e; if (!seen.has(k)) { seen.add(k); inc(st[k] = st[k] || [0, 0], r.win); } if (u <= 2 && e <= 2) small = true; });
      if (small) inc(out.smallFight, r.win);
      const first = alv.find((x) => x[1] < 5 || x[2] < 5);
      if (first) inc(out.firstFight[first[0] < 20 ? "early" : first[0] < 45 ? "mid" : "late"], r.win);
      if (planted && typeof r.plant === "number") { const tp = 100 - r.plant; let s = [5, 5]; alv.forEach(([t, u, e]) => { if (t <= tp) s = [u, e]; }); const k = (atk ? "post-plant " : "retake ") + s[0] + "v" + s[1]; inc(out.plantState[k] = out.plantState[k] || [0, 0], r.win); }
    }));
    return out;
  }
  const wr = (a) => a[0] + "/" + a[1] + (a[1] ? "(" + Math.round((a[0] / a[1]) * 100) + "%)" : "");
  function situationText(roundLists) {
    const o = situations(roundLists);
    const states = Object.entries(o.states).sort((a, b) => b[1][1] - a[1][1]).map(([k, v]) => k + "=" + wr(v)).join(" ");
    return "team situations (wins/rounds): post_plant_attack=" + wr(o.postPlant) + " retake_defense=" + wr(o.retake) +
      " attack_pace: fast(planted with 60s+ left)=" + wr(o.pace.fast) + " mid(30-59s left)=" + wr(o.pace.mid) + " slow(<30s left)=" + wr(o.pace.slow) + " no_plant=" + wr(o.pace.none) +
      " first_fight: within20s=" + wr(o.firstFight.early) + " 20-45s=" + wr(o.firstFight.mid) + " after45s=" + wr(o.firstFight.late) +
      " small_fight(both sides 2 or fewer at some point)=" + wr(o.smallFight) +
      "\nreached_state(us v them, round win rate when this state happened)=" + (states || "-") +
      "\nat_plant=" + (Object.entries(o.plantState).map(([k, v]) => k.replace(" ", "_") + "=" + wr(v)).join(" ") || "-");
  }
  function placeText(rows) {
    return places(rows).slice(0, 80).map((x) => "fight_place agent=" + (x.agent === "*" ? "TEAM" : String(x.agent).replace(/[,\s]+/g, "_")) + " place=" + x.place.replace(/[,\s]+/g, "_") + " kills=" + x.k + " deaths=" + x.d).join("\n");
  }

  // short per-round marks for the AI data text
  function marks(r) {
    const kt = r && r.kit; if (!kt || !(kt.al > 0)) return "";
    const h = (kt.h || []).map((v, i) => (v ? SLOT[i] + Math.round(v) : "")).filter(Boolean).join("/");
    const lf = (kt.lf || []).map((v, i) => (v ? SLOT[i] : "")).join("");
    const pl = (x) => String(x).replace(/[,\s]+/g, "_");
    return "+AL" + Math.round(kt.al) + (h ? "+H:" + h : "") + (lf ? "+L:" + lf : "") + (kt.us ? (kt.uu ? "+UU" : "+UH") : "") + (kt.ud ? "+DU" : "") + (kt.k != null ? "+K" + kt.k + (kt.ku ? "+KU" + kt.ku : "") : "") + ((kt.kp || []).length ? "+KP:" + kt.kp.map(pl).join("/") : "") + (kt.dead && kt.dp ? "+DP:" + pl(kt.dp) : "");
  }

  function summaryText(rows) {
    return summarize(rows).map((s) => "kit agent=" + String(s.agent).replace(/[,\s]+/g, "_") + ": rounds=" + s.rounds +
      " hold_sec_per_round(C/Q/E/X)=" + s.holdPerRound.join("/") + " hold_share=" + s.holdShare + "% takes_per_round=" + s.takesPerRound +
      " deaths=" + s.deaths + " skills_left_at_death_avg=" + (s.leftAtDeath ?? "-") + " deaths_with_2plus_left=" + s.deathsLeft2 + " skills_left_at_round_end_avg=" + (s.leftAtEnd ?? "-") +
      " ult_ready_at_start=" + s.ultStart + " ult_used=" + s.ultUsed + " ult_kept_unused=" + s.ultHeld + " ult_longest_kept_streak=" + s.ultStreakMax + " died_with_ult_ready=" + s.ultDeaths +
      " kills=" + s.kills + "(in " + s.killsRounds + " rounds) kills_while_ult_ready=" + s.killsUlt).join("\n");
  }

  // alive-count flow of a round, e.g. "4v5>4v4>2v3" (us v them)
  const flow = (r) => (Array.isArray(r.alv) && r.alv.length > 1 ? "+S:" + r.alv.slice(1).map((x) => x[1] + "v" + x[2]).join(">") : "");
  const K = { SLOT, summarize, marks, summaryText, places, placeText, situations, situationText, flow };
  if (typeof module !== "undefined" && module.exports) module.exports = K; else root.TLKit = K;
})(typeof window !== "undefined" ? window : this);
