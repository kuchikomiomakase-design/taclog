// POST /api/ask  {teamId, question, history:[{q,a}]}  ->  {answer, chart, scenes}
const { send, fail, readBody, getUser, membership, rest, claude, parseJSON, PLAN_LIMITS } = require("./_lib");

const MAPS = { ascent: "アセント", bind: "バインド", haven: "ヘイヴン", split: "スプリット", icebox: "アイスボックス", breeze: "ブリーズ", fracture: "フラクチャー", pearl: "パール", lotus: "ロータス", sunset: "サンセット", abyss: "アビス", corrode: "カロード" };
const clean = (s) => String(s || "").replace(/[,\s]+/g, "_").slice(0, 30);

function dataText(matches) {
  return matches.map((m) => {
    const rs = (m.rounds || []).map((r) => [
      r.n, r.side === "attack" ? "A" : "D", r.win == null ? "?" : r.win ? "W" : "L",
      r.planted ? (r.plant != null ? r.plant : "P") : "-", r.site || "-",
      (r.fk === "us" ? "F" : r.fk === "them" ? "f" : r.fk === "tie" ? "T" : "-") + (r.fkBy ? ":" + clean(r.fkBy) : ""),
      r.plantAt != null ? r.plantAt : r.start
    ].join(",")).join(" ");
    return "match=" + m.id + " date=" + (m.date || "") + " opp=" + clean(m.opp || "?") + " map=" + (MAPS[m.map] || "未設定") +
      " comp=" + ((m.comps && m.comps.left) || []).join("/") + "\nrounds: " + rs;
  }).join("\n");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const auth = await getUser(req); if (!auth) return fail(res, 401, "ログインしてください。");
    const body = await readBody(req);
    const m = await membership(body.teamId, auth); if (!m) return fail(res, 403, "このチームのメンバーではありません。");
    const question = String(body.question || "").trim().slice(0, 300);
    if (!question) return fail(res, 400, "質問を入れてください。");
    const plan = (m.teams && m.teams.plan) || "free", lim = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    // monthly question limit
    const month = new Date().toISOString().slice(0, 7);
    const u = await rest("usage?select=questions,analyses&team_id=eq." + body.teamId + "&month=eq." + month, { service: true });
    const used = u && u[0] ? u[0].questions : 0;
    if (used >= lim.questions) return fail(res, 429, "question limit", "question_limit");

    const since = new Date(Date.now() - lim.days * 864e5).toISOString().slice(0, 10);
    const matches = await rest("matches?select=id,date,opp,map,comps,rounds&team_id=eq." + body.teamId + "&or=(date.gte." + since + ",date.is.null)&order=date.desc&limit=200", { token: auth.token });
    if (!matches || !matches.length) return fail(res, 400, "まだ分析した試合がありません。");

    const history = Array.isArray(body.history) ? body.history.slice(-2).map((x) => "Q: " + String(x.q || "").slice(0, 300) + "\nA: " + String(x.a || "").slice(0, 1200)).join("\n") : "";
    const today = new Date().toISOString().slice(0, 10);
    const prompt = "あなたはVALORANTチームの分析コーチです。下のデータは、このチームのスクリムをラウンドごとに記録したものです。データだけを根拠に、日本語で、短く具体的に答えてください。数字は必ずデータから数えて、割合は「〇/〇(〇%)」のように分母も書いてください。データにないこと(個人のK/D/Aなど)は「まだ記録していない」と正直に伝えてください。今日は" + today + "です。\n\n" +
      "データの読み方: 各試合の rounds は「ラウンド番号,自チームの攻守(A=アタック D=ディフェンス),結果(W=勝ち L=負け ?=不明),設置時の残り秒数(-=設置なし P=設置あり時間不明),設置サイト(A/B/C、-=不明または設置なし),ファーストキル(F=自チームが取った f=相手に取られた T=ほぼ同時 -=不明。「:」の後ろは最初のキルを取った人の名前。Me(配信者)は配信している本人。相手の名前はエージェント名のこともある),動画の秒数」をスペース区切りで並べたもの。自チームがアタックのときの設置は自チームの設置、ディフェンスのときは相手の設置。1と13ラウンド目がファーストラウンド(ピストルラウンド)。\n" +
      (plan === "free" ? "(無料プランのため、直近" + lim.days + "日分のデータだけを渡しています)\n" : "") + "\n" +
      dataText(matches) + "\n\n" + (history ? "これまでの会話:\n" + history + "\n\n" : "") + "質問: " + question + "\n\n" +
      "返答はJSONのみ: {\"answer\":\"答えの文章\",\"chart\":null または {\"title\":\"グラフの題\",\"unit\":\"%\",\"bars\":[{\"label\":\"ラベル\",\"value\":数値}]},\"scenes\":[{\"match\":\"試合のmatch=の値\",\"round\":ラウンド番号,\"note\":\"短い説明\"}]}。グラフが役立つ質問ではchartを入れる。scenesは根拠になったラウンドを最大5件。";

    const text = await claude({ content: [{ type: "text", text: prompt.slice(0, 240000) }], maxTokens: 3000, teamId: body.teamId, kind: "ask" });
    const ans = parseJSON(text) || { answer: text, chart: null, scenes: [] };

    await rest("usage?on_conflict=team_id,month", { method: "POST", service: true, prefer: "resolution=merge-duplicates", body: { team_id: body.teamId, month, questions: used + 1, analyses: u && u[0] ? u[0].analyses : 0 } });
    send(res, 200, ans);
  } catch (e) {
    fail(res, e.status || 500, e.status ? e.message : "答えを作れませんでした。もう一度試してください。", e.code);
  }
};
