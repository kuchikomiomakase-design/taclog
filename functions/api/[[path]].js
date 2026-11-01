// Cloudflare Pages Functions entry: every /api/* request comes here and is handed to the matching file in /api
// (the same handlers that ran on Vercel). Environment variables set in Cloudflare are exposed as process.env.
import ask from "../../api/ask.js";
import vision from "../../api/vision.js";
import checkout from "../../api/checkout.js";
import portal from "../../api/portal.js";
import webhook from "../../api/webhook.js";
import games from "../../api/games.js";
import contact from "../../api/contact.js";
import cronMonthly from "../../api/cron-monthly.js";
import backup from "../../api/backup.js";
import diag from "../../api/diag.js";
import redeem from "../../api/redeem.js";
import addteam from "../../api/addteam.js";

const ROUTES = { ask, vision, checkout, portal, webhook, games, contact, "cron-monthly": cronMonthly, backup, diag, redeem, addteam };

export async function onRequest(context) {
  const { request, env, params } = context;
  const name = [].concat(params.path || []).join("/").replace(/\.js$/, "");
  const handler = ROUTES[name];
  if (!handler) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } });

  globalThis.process = globalThis.process || {};
  globalThis.process.env = globalThis.process.env || {};
  for (const [k, v] of Object.entries(env || {})) if (typeof v === "string") globalThis.process.env[k] = v;

  const url = new URL(request.url);
  const headers = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  headers.host = url.host;
  const rawBody = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
  const req = { method: request.method, url: url.pathname + url.search, headers, rawBody };

  let status = 200, body = "";
  const out = {};
  const res = {
    get statusCode() { return status; },
    set statusCode(v) { status = v; },
    setHeader(k, v) { out[String(k).toLowerCase()] = String(v); },
    end(s) { body = s == null ? "" : String(s); },
  };
  try {
    await handler(req, res);
  } catch (e) {
    status = 500; out["content-type"] = "application/json"; body = JSON.stringify({ error: "server error" });
  }
  return new Response(body, { status, headers: out });
}
