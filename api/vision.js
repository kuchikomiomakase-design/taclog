// POST /api/vision  {teamId, prompt, images:[base64 jpeg]}  ->  {text}
// Reads small cropped screenshots of a recording with Claude. The recording itself never leaves the user's PC.
const { send, fail, readBody, getUser, membership, claude } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const auth = await getUser(req); if (!auth) return fail(res, 401, "ログインしてください。");
    const body = await readBody(req);
    const m = await membership(body.teamId, auth); if (!m) return fail(res, 403, "このチームのメンバーではありません。");
    const prompt = String(body.prompt || "").slice(0, 6000);
    const images = Array.isArray(body.images) ? body.images.slice(0, 8) : [];
    if (!prompt || !images.length) return fail(res, 400, "画像がありません。");
    if (images.some((b) => typeof b !== "string" || b.length > 3_500_000)) return fail(res, 400, "画像が大きすぎます。");
    const content = images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }));
    content.push({ type: "text", text: prompt + "\n\nReply with the JSON only." });
    const text = await claude({ content, maxTokens: 8000, teamId: body.teamId, kind: "vision" + (/^[a-z]{1,12}$/.test(String(body.task || "")) ? ":" + body.task : "") });
    send(res, 200, { text });
  } catch (e) {
    fail(res, e.status || 500, e.status ? e.message : "読み取りに失敗しました。", e.code);
  }
};
