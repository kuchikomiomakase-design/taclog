// POST /api/contact
//   {action:"list"}                              -> {inquiries:[...]}   (also pulls new replies from the Discord threads)
//   {action:"create", subject, body, teamId?}    -> {inquiry}
//   {action:"reply", inquiryId, body}            -> {ok:true}
// Each inquiry gets its own thread in the Discord contact channel. Anything a person (not a bot) writes in that
// thread comes back to the user as a reply. Writing "!完了" or "!close" in the thread marks it as resolved.
const { send, fail, readBody, getUser, rest, discord, noPing, env } = require("./_lib");

const clip = (s, n) => String(s || "").trim().slice(0, n);
const CLOSE = /^\s*!(完了|close)\s*$/i;

async function syncThread(inq) {
  if (!inq.discord_thread_id) return;
  const after = inq.last_synced_id || inq.discord_thread_id;
  const msgs = await discord("channels/" + inq.discord_thread_id + "/messages?limit=50&after=" + after);
  if (!Array.isArray(msgs) || !msgs.length) return;
  msgs.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const rows = []; let closed = false, staffAt = null;
  for (const m of msgs) {
    if (m.author && m.author.bot) continue;
    const text = String(m.content || "").trim();
    if (CLOSE.test(text)) { closed = true; continue; }
    if (!text) continue;
    rows.push({ inquiry_id: inq.id, author: "staff", body: text.slice(0, 4000), discord_message_id: m.id, created_at: m.timestamp });
    staffAt = m.timestamp;
  }
  if (rows.length) await rest("inquiry_messages?on_conflict=discord_message_id", { method: "POST", service: true, prefer: "resolution=ignore-duplicates", body: rows });
  const patch = { last_synced_id: msgs[msgs.length - 1].id };
  if (staffAt) patch.last_staff_at = staffAt;
  if (closed) patch.status = "closed";
  await rest("inquiries?id=eq." + inq.id, { method: "PATCH", service: true, body: patch });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const auth = await getUser(req); if (!auth) return fail(res, 401, "ログインしてください。");
    const uid = auth.user.id;
    const body = await readBody(req);

    if (body.action === "create") {
      const subject = clip(body.subject, 80), text = clip(body.body, 4000);
      if (!subject || !text) return fail(res, 400, "件名と内容を入れてください。");
      const since = new Date(Date.now() - 864e5).toISOString();
      const recent = await rest("inquiries?select=id&user_id=eq." + uid + "&created_at=gte." + since, { service: true });
      if (recent && recent.length >= 5) return fail(res, 429, "お問い合わせは1日5件までです。時間をおいて送ってください。");
      let team = null;
      if (/^[0-9a-f-]{36}$/i.test(String(body.teamId || ""))) {
        const t = await rest("team_members?select=display_name,teams(name,plan)&team_id=eq." + body.teamId + "&user_id=eq." + uid, { token: auth.token });
        if (t && t[0]) team = { id: body.teamId, name: t[0].teams && t[0].teams.name, plan: t[0].teams && t[0].teams.plan, me: t[0].display_name };
      }
      const [inq] = await rest("inquiries", { method: "POST", service: true, prefer: "return=representation", body: { user_id: uid, team_id: team ? team.id : null, email: auth.user.email || "", subject } });
      await rest("inquiry_messages", { method: "POST", service: true, body: { inquiry_id: inq.id, author: "user", body: text } });
      let warn = null;
      try {
        const ch = env("DISCORD_CONTACT_CHANNEL_ID");
        if (!ch) throw new Error("no channel");
        const msg = await discord("channels/" + ch + "/messages", { method: "POST", body: {
          allowed_mentions: noPing,
          content: "📩 新しいお問い合わせが届きました",
          embeds: [{ title: subject, description: text.slice(0, 3800), color: 0xF08A24,
            fields: [
              { name: "送信者", value: (team && team.me ? team.me + " / " : "") + (auth.user.email || "メール不明"), inline: false },
              { name: "チーム", value: team ? (team.name || "-") + "(" + ({ free: "無料", team: "チーム", org: "コーチ・組織" }[team.plan] || team.plan) + ")" : "なし", inline: true },
              { name: "番号", value: inq.id.slice(0, 8), inline: true }
            ],
            timestamp: new Date().toISOString() }] } });
        const th = await discord("channels/" + ch + "/messages/" + msg.id + "/threads", { method: "POST", body: { name: ("問い合わせ " + subject).slice(0, 90), auto_archive_duration: 10080 } });
        await discord("channels/" + th.id + "/messages", { method: "POST", body: { allowed_mentions: noPing, content: "このスレッドに書き込むと、相手のTacLogの画面に返信として届きます。対応が終わったら「!完了」と書き込んでください。" } });
        await rest("inquiries?id=eq." + inq.id, { method: "PATCH", service: true, body: { discord_thread_id: th.id, last_synced_id: th.id } });
      } catch (e) { warn = "discord"; }
      return send(res, 200, { inquiry: { id: inq.id }, warn });
    }

    if (body.action === "reply") {
      const text = clip(body.body, 4000);
      if (!text) return fail(res, 400, "内容を入れてください。");
      const rows = await rest("inquiries?select=*&id=eq." + encodeURIComponent(String(body.inquiryId || "")) + "&user_id=eq." + uid, { service: true });
      const inq = rows && rows[0]; if (!inq) return fail(res, 404, "お問い合わせが見つかりません。");
      await rest("inquiry_messages", { method: "POST", service: true, body: { inquiry_id: inq.id, author: "user", body: text } });
      if (inq.status === "closed") await rest("inquiries?id=eq." + inq.id, { method: "PATCH", service: true, body: { status: "open" } });
      if (inq.discord_thread_id) {
        try { await discord("channels/" + inq.discord_thread_id + "/messages", { method: "POST", body: { allowed_mentions: noPing, content: "💬 **利用者からの返信**\n" + text.slice(0, 1900) } }); } catch (e) {}
      }
      return send(res, 200, { ok: true });
    }

    // list (default)
    const inqs = await rest("inquiries?select=*&user_id=eq." + uid + "&order=created_at.desc&limit=30", { service: true }) || [];
    const recentCut = Date.now() - 60 * 864e5;
    for (const inq of inqs.filter((i) => i.discord_thread_id && new Date(i.created_at).getTime() > recentCut).slice(0, 8)) {
      try { await syncThread(inq); } catch (e) {}
    }
    const ids = inqs.map((i) => i.id);
    const msgs = ids.length ? await rest("inquiry_messages?select=inquiry_id,author,body,created_at&inquiry_id=in.(" + ids.join(",") + ")&order=created_at.asc", { service: true }) : [];
    const fresh = ids.length ? await rest("inquiries?select=id,status,last_staff_at&id=in.(" + ids.join(",") + ")", { service: true }) : [];
    const by = Object.fromEntries((fresh || []).map((f) => [f.id, f]));
    send(res, 200, { inquiries: inqs.map((i) => ({ id: i.id, subject: i.subject, created_at: i.created_at, status: (by[i.id] || i).status, last_staff_at: (by[i.id] || i).last_staff_at, messages: (msgs || []).filter((m) => m.inquiry_id === i.id) })) });
  } catch (e) {
    fail(res, e.status || 500, e.status ? e.message : "うまくいきませんでした。もう一度試してください。");
  }
};
