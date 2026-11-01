// Shared server helpers for the API (runs on Cloudflare Pages Functions via functions/api/[[path]].js; also works on Node/Vercel).
// No Node-only modules: only fetch and Web Crypto, which both platforms have.

const env = (k, d) => process.env[k] || d;
const SB_URL = () => env("SUPABASE_URL");
const ANON = () => env("SUPABASE_ANON_KEY");
const SERVICE = () => env("SUPABASE_SERVICE_ROLE_KEY");

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(data));
}
function fail(res, status, error, code) { send(res, status, { error, code }); }

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.rawBody === "string") { try { return JSON.parse(req.rawBody || "{}"); } catch (e) { return {}; } }
  const raw = await readRaw(req);
  try { return JSON.parse(raw || "{}"); } catch (e) { return {}; }
}
function readRaw(req) {
  if (typeof req.rawBody === "string") return Promise.resolve(req.rawBody);
  return new Promise((resolve, reject) => {
    let data = ""; req.setEncoding("utf8");
    req.on("data", (c) => { data += c; if (data.length > 6e6) { reject(new Error("too large")); req.destroy(); } });
    req.on("end", () => resolve(data)); req.on("error", reject);
  });
}

async function getUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const r = await fetch(SB_URL() + "/auth/v1/user", { headers: { apikey: ANON(), authorization: "Bearer " + token } });
  if (!r.ok) return null;
  const user = await r.json();
  return { user, token };
}

// REST call to Supabase. Pass {token} to act as the user (row level security applies), or {service:true} for server-only work.
async function rest(path, { method = "GET", body, token, service, prefer } = {}) {
  const key = service ? SERVICE() : ANON();
  const headers = { apikey: key, "content-type": "application/json" };
  // Old-style keys are JWTs ("eyJ...") and also go in Authorization. New Supabase secret keys ("sb_secret_...") must only be sent as apikey.
  const bearer = service ? SERVICE() : token;
  if (bearer && (!service || String(bearer).startsWith("eyJ"))) headers.authorization = "Bearer " + bearer;
  if (prefer) headers.prefer = prefer;
  const r = await fetch(SB_URL() + "/rest/v1/" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!r.ok) { const err = new Error((data && data.message) || "database error"); err.status = r.status; throw err; }
  return data;
}

async function membership(teamId, auth) {
  if (!/^[0-9a-f-]{36}$/i.test(String(teamId || ""))) return null;
  const q = (cols) => rest("team_members?select=role,team_id,teams(" + cols + ")&team_id=eq." + teamId + "&user_id=eq." + auth.user.id, { token: auth.token });
  let rows;
  try { rows = await q("plan,name,games,extra_games,stripe_customer_id,stripe_subscription_id,comp_until"); }
  catch (e) { rows = await q("plan,name,games,extra_games,stripe_customer_id,stripe_subscription_id"); } // before 006_promo_codes.sql is run
  return rows && rows[0] ? rows[0] : null;
}

async function claude({ content, maxTokens = 4000, teamId = null, kind = "other", model = null }) {
  // a cheaper model can be asked for (e.g. AI questions); if it is not available, fall back to the default model once
  if (model && !model.startsWith("__use__") && model !== env("ANTHROPIC_MODEL", "claude-sonnet-5-5")) {
    try { return await claude({ content, maxTokens, teamId, kind, model: "__use__" + model }); }
    catch (e) { if (e.code === "rate_limited") throw e; return claude({ content, maxTokens, teamId, kind }); }
  }
  const useModel = model && model.startsWith("__use__") ? model.slice(7) : env("ANTHROPIC_MODEL", "claude-sonnet-5-5");
  const key = env("ANTHROPIC_API_KEY");
  if (!key) { const e = new Error("AIの設定(ANTHROPIC_API_KEY)がまだ入っていません。"); e.status = 503; throw e; }
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: useModel, max_tokens: maxTokens, messages: [{ role: "user", content }] })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error((data.error && data.error.message) || "AI error"); e.status = r.status === 429 ? 429 : 502; e.code = r.status === 429 ? "rate_limited" : "upstream_error"; throw e;
  }
  logUsage(teamId, kind, data.usage, useModel).catch(() => {});
  return (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
}
// Records token usage so the monthly report can show AI costs. Never blocks the user's request on failure.
async function logUsage(teamId, kind, u, model) {
  if (!u || !SERVICE()) return;
  const inT = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), outT = u.output_tokens || 0;
  const cheap = /haiku/i.test(String(model || ""));   // rough price per million tokens (set the env vars to your real prices)
  const cost = inT / 1e6 * Number(env(cheap ? "AI_HAIKU_INPUT_USD_PER_MTOK" : "AI_INPUT_USD_PER_MTOK", cheap ? "1" : "3")) + outT / 1e6 * Number(env(cheap ? "AI_HAIKU_OUTPUT_USD_PER_MTOK" : "AI_OUTPUT_USD_PER_MTOK", cheap ? "5" : "15"));
  await rest("ai_usage", { method: "POST", service: true, body: { team_id: teamId, kind: cheap ? kind + ":haiku" : kind, input_tokens: inT, output_tokens: outT, cost_usd: Number(cost.toFixed(6)) } });
}

// ---- Discord (bot over REST; no always-on connection needed) ----
async function discord(path, { method = "GET", body } = {}) {
  const token = env("DISCORD_BOT_TOKEN");
  if (!token) { const e = new Error("Discordの設定がまだ入っていません。"); e.status = 503; throw e; }
  const r = await fetch("https://discord.com/api/v10/" + path, { method, headers: { authorization: "Bot " + token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!r.ok) { const e = new Error("discord " + r.status + " " + ((data && data.message) || "")); e.status = 502; throw e; }
  return data;
}
const noPing = { parse: [] }; // never mention @everyone etc. from user-written text

function parseJSON(t) {
  t = String(t || "").trim();
  try { return JSON.parse(t); } catch (e) {}
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) { try { return JSON.parse(f[1]); } catch (e) {} }
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch (e) {} }
  return null;
}

// ---- Stripe (REST, form encoded) ----
function form(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + "[" + k + "]" : k;
    if (v == null) continue;
    if (typeof v === "object") form(v, key, out); else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  }
  return out.join("&");
}
async function stripe(path, params, method = "POST") {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) { const e = new Error("決済の設定がまだ入っていません。"); e.status = 503; throw e; }
  const r = await fetch("https://api.stripe.com/v1/" + path, { method, headers: { authorization: "Bearer " + key, "content-type": "application/x-www-form-urlencoded" }, body: method === "GET" ? undefined : form(params || {}) });
  const data = await r.json();
  if (!r.ok) { const e = new Error((data.error && data.error.message) || "stripe error"); e.status = 502; throw e; }
  return data;
}
async function verifyStripe(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = parts.t, sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(t + "." + raw)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
  return sigs.some((s) => same(s, expected));
}

// 試作期間中は全プラン無制限。Riotに申請するときに false に戻す(supabase/005_restore_limits.sql と assets/config.js の TRIAL_UNLIMITED も)
const TRIAL_UNLIMITED = true;
const PLAN_LIMITS = TRIAL_UNLIMITED
  ? { free: { questions: 100000, days: 36500 }, team: { questions: 100000, days: 36500 }, org: { questions: 100000, days: 36500 } }
  : { free: { questions: 20, days: 14 }, team: { questions: 150, days: 36500 }, org: { questions: 100000, days: 36500 } };

function serviceHeaders() { const k = SERVICE(); const h = { apikey: k }; if (String(k || "").startsWith("eyJ")) h.authorization = "Bearer " + k; return h; }

module.exports = { serviceHeaders, env, send, fail, readBody, readRaw, getUser, rest, membership, claude, parseJSON, stripe, verifyStripe, discord, noPing, PLAN_LIMITS };
