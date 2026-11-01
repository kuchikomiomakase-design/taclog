// GET /api/backup  (Authorization: Bearer CRON_SECRET)  ->  all TacLog tables as JSON.
// Called once a day by .github/workflows/daily.yml, which encrypts the result before keeping it (the repository is public).
const { send, fail, rest, env } = require("./_lib");

const TABLES = ["teams", "team_members", "invites", "matches", "notification_prefs", "usage", "inquiries", "inquiry_messages", "ai_usage"];

module.exports = async (req, res) => {
  const secret = env("CRON_SECRET");
  if (!secret || req.headers.authorization !== "Bearer " + secret) return fail(res, 401, "unauthorized");
  try {
    const out = { at: new Date().toISOString(), tables: {} };
    for (const t of TABLES) {
      const rows = [];
      for (let from = 0; from < 200000; from += 1000) {
        const part = await rest(t + "?select=*&limit=1000&offset=" + from, { service: true }) || [];
        rows.push(...part); if (part.length < 1000) break;
      }
      out.tables[t] = rows;
    }
    send(res, 200, out);
  } catch (e) {
    fail(res, 500, "backup failed: " + (e.message || ""));
  }
};
