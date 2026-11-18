// POST /api/vision  {teamId, prompt, images:[base64 jpeg]}  ->  {text}
// Reads small cropped screenshots of a recording with Claude. The recording itself never leaves the user's PC.
const { send, fail, readBody, getUser, membership, claude, rest , noLimit } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const auth = await getUser(req); if (!auth) return fail(res, 401, "ログインしてください。");
    const body = await readBody(req);
    const m = await membership(body.teamId, auth); if (!m) return fail(res, 403, "このチームのメンバーではありません。");
    // monthly map limit (team 40 / org 40 per team / solo 20) + bought extra maps; once used up, no more reading (saves AI cost).
    // Before 019_monthly_maps.sql this check is skipped.
    const MONTHLY = { team: 40, org: 40, solo: 20 }, plan = (m.teams && m.teams.plan) || "free";
    if (MONTHLY[plan]) {
      try {
        const jst = new Date(Date.now() + 9 * 3600e3).toISOString(), from = jst.slice(0, 8) + "01";
        const u = await rest("usage_daily?select=maps&team_id=eq." + body.teamId + "&day=gte." + from, { service: true });
        const used = (u || []).reduce((a, r) => a + (r.maps || 0), 0);
        if (used >= MONTHLY[plan]) {
          const t = await rest("teams?select=extra_maps,no_limit,pov_option&id=eq." + body.teamId, { service: true }), tm = (t && t[0]) || {};
          if (!tm.no_limit && !(tm.extra_maps > 0)) {
            // another player's view of an already analysed match (cheap reads, tasks "pov...") is still fine with the all-views option
            const views = (plan === "org" || tm.pov_option) && /^pov/.test(String(body.task || ""));
            if (!views) return fail(res, 429, "monthly map limit", "monthly_map_limit");
          }
        }
      } catch (e) {}
    }
    const prompt = String(body.prompt || "").slice(0, 6000);
    const images = Array.isArray(body.images) ? body.images.slice(0, 8) : [];
    if (!prompt || !images.length) return fail(res, 400, "画像がありません。");
    if (images.some((b) => typeof b !== "string" || b.length > 3_500_000)) return fail(res, 400, "画像が大きすぎます。");
    const content = images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }));
    content.push({ type: "text", text: prompt + "\n\nReply with the JSON only." });
    const text = await claude({ content, maxTokens: 8000, teamId: body.teamId, kind: "vision" + (/^[a-z]{1,12}$/.test(String(body.task || "")) ? ":" + body.task : ""), model: body.fast === true ? (process.env.FAST_MODEL || "claude-haiku-5-5") : undefined }); // fast = simple text reading
    send(res, 200, { text });
  } catch (e) {
    fail(res, e.status || 500, e.status ? e.message : "読み取りに失敗しました。", e.code);
  }
};
