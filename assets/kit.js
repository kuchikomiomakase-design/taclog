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

  // short per-round marks for the AI data text
  function marks(r) {
    const kt = r && r.kit; if (!kt || !(kt.al > 0)) return "";
    const h = (kt.h || []).map((v, i) => (v ? SLOT[i] + Math.round(v) : "")).filter(Boolean).join("/");
    const lf = (kt.lf || []).map((v, i) => (v ? SLOT[i] : "")).join("");
    return "+AL" + Math.round(kt.al) + (h ? "+H:" + h : "") + (lf ? "+L:" + lf : "") + (kt.us ? (kt.uu ? "+UU" : "+UH") : "") + (kt.ud ? "+DU" : "") + (kt.k != null ? "+K" + kt.k + (kt.ku ? "+KU" + kt.ku : "") : "");
  }

  function summaryText(rows) {
    return summarize(rows).map((s) => "kit agent=" + String(s.agent).replace(/[,\s]+/g, "_") + ": rounds=" + s.rounds +
      " hold_sec_per_round(C/Q/E/X)=" + s.holdPerRound.join("/") + " hold_share=" + s.holdShare + "% takes_per_round=" + s.takesPerRound +
      " deaths=" + s.deaths + " skills_left_at_death_avg=" + (s.leftAtDeath ?? "-") + " deaths_with_2plus_left=" + s.deathsLeft2 + " skills_left_at_round_end_avg=" + (s.leftAtEnd ?? "-") +
      " ult_ready_at_start=" + s.ultStart + " ult_used=" + s.ultUsed + " ult_kept_unused=" + s.ultHeld + " ult_longest_kept_streak=" + s.ultStreakMax + " died_with_ult_ready=" + s.ultDeaths +
      " kills=" + s.kills + "(in " + s.killsRounds + " rounds) kills_while_ult_ready=" + s.killsUlt).join("\n");
  }

  const K = { SLOT, summarize, marks, summaryText };
  if (typeof module !== "undefined" && module.exports) module.exports = K; else root.TLKit = K;
})(typeof window !== "undefined" ? window : this);
