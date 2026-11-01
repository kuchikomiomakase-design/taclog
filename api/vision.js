// POST /api/vision  {teamId, prompt, images:[base64 jpeg]}  ->  {text}
// Reads small cropped screenshots of a recording with Claude. The recording itself never leaves the user's PC.
const { send, fail, readBody, getUser, membership, claude, rest } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const auth = await getUser(req); if (!auth) return fail(res, 401, "ログインしてください。");
    const body = await readBody(req);
    const m = await membership(body.teamId, auth); if (!m) return fail(res, 403, "このチームのメンバーではありません。");
    // team plan: 6 maps a day; once reached, no more reading today (saves AI cost). Before 010_daily_maps.sql this check is skipped.
    if (m.teams && m.teams.plan === "team") {
      try {
        const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
        const u = await rest("usage_daily?select=maps&team_id=eq." + body.teamId + "&day=eq." + day, { service: true });
        if (u && u[0] && u[0].maps >= 6) return fail(res, 429, "daily map limit", "daily_map_limit");
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
