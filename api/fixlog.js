// POST /api/fixlog {teamId, matchId, changes:[{n, field, before, after}]}
// When someone fixes rounds by hand, tell the operator's Discord contact channel what the analysis got wrong or could not read,
// so the reading can be improved (which match, which round, what changed, where in the recording).
const { send, fail, readBody, getUser, membership, rest, discord, noPing, env } = require("./_lib");
const NAME = { win: "勝敗", side: "攻守", site: "設置サイト", planted: "設置", fk: "ファーストキル", fkBy: "倒した人", fkVictim: "倒された人", void: "無効" };
const val = (v) => (v === true ? "はい/勝ち" : v === false ? "いいえ/負け" : v == null || v === "" ? "不明" : String(v)).slice(0, 30);

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const auth = await getUser(req); if (!auth) return fail(res, 401, "ログインしてください。");
    const body = await readBody(req);
    const m = await membership(body.teamId, auth); if (!m) return fail(res, 403, "このチームのメンバーではありません。");
    const ch = env("DISCORD_CONTACT_CHANNEL_ID"); if (!ch) return send(res, 200, { ok: true });
    const rows = await rest("matches?select=map,file,date,rounds&id=eq." + body.matchId + "&team_id=eq." + body.teamId, { service: true });
    const mt = rows && rows[0]; if (!mt) return send(res, 200, { ok: true });
    const changes = (Array.isArray(body.changes) ? body.changes : []).slice(0, 30);
    if (!changes.length) return send(res, 200, { ok: true });
    const fmt = (s) => (s == null ? "" : Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0"));
    const lines = changes.map((c) => { const r = (mt.rounds || []).find((x) => x.n === Number(c.n)) || {}; const t = r.st ?? r.start;
      return "R" + c.n + (t != null ? "(動画 " + fmt(t) + ")" : "") + " " + (NAME[c.field] || c.field) + ": " + val(c.before) + " → " + val(c.after); });
    await discord("channels/" + ch + "/messages", { method: "POST", body: { allowed_mentions: noPing,
      content: ("🛠 ラウンドが手で直されました\nチーム: " + ((m.teams && m.teams.name) || "?") + " ・ " + (mt.date || "") + " " + (mt.map || "") + " ・ " + (mt.file || "") + "\n" + lines.join("\n")).slice(0, 1900) } });
    send(res, 200, { ok: true });
  } catch (e) { send(res, 200, { ok: true }); }   // never bother the user with this
};
