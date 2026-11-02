// POST /api/games {teamId, games:["valorant","cs2",...]} -> {ok} or {url} (Stripe Checkout when a new paid slot is needed)
// The first title is free. Each extra title is a monthly add-on (STRIPE_PRICE_GAME). The coach/org plan includes all titles.
const { send, fail, readBody, getUser, membership, rest, stripe, env } = require("./_lib");
const VALID = ["valorant", "ow2"];

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const auth = await getUser(req); if (!auth) return fail(res, 401, "ログインしてください。");
    const body = await readBody(req);
    const m = await membership(body.teamId, auth);
    if (!m || m.role !== "admin") return fail(res, 403, "タイトルの変更は、チームの管理者だけができます。");
    const games = [...new Set((Array.isArray(body.games) ? body.games : []).filter((g) => VALID.includes(g)))];
    if (!games.length) return fail(res, 400, "タイトルを1つ以上選んでください。");
    const t = m.teams || {};
    const plan = t.plan || "free", extra = t.extra_games || 0;
    const needExtra = plan === "org" ? 0 : Math.max(0, games.length - 1);
    const save = (patch) => rest("teams?id=eq." + body.teamId, { method: "PATCH", service: true, body: patch });

    // Within what is already paid for: just save.
    if (needExtra <= extra && !(needExtra < extra && t.stripe_subscription_id)) { await save({ games }); return send(res, 200, { ok: true }); }

    const price = env("STRIPE_PRICE_GAME");
    if (!price || !env("STRIPE_SECRET_KEY")) {
      if (needExtra <= extra) { await save({ games }); return send(res, 200, { ok: true }); }
      return fail(res, 503, "タイトルの追加は準備中です。");
    }
    const site = env("SITE_URL", "https://" + req.headers.host);

    if (t.stripe_subscription_id) {
      const sub = await stripe("subscriptions/" + t.stripe_subscription_id, null, "GET");
      const items = sub.items.data || [];
      const gameItem = items.find((it) => it.price.id === price);
      if (needExtra === 0) {
        if (gameItem && items.length === 1) await stripe("subscriptions/" + sub.id, {}, "DELETE");
        else if (gameItem) await stripe("subscription_items/" + gameItem.id, {}, "DELETE");
      } else if (gameItem) await stripe("subscription_items/" + gameItem.id, { quantity: needExtra, proration_behavior: "create_prorations" });
      else await stripe("subscription_items", { subscription: sub.id, price, quantity: needExtra, proration_behavior: "create_prorations" });
      await save({ games, extra_games: needExtra });
      return send(res, 200, { ok: true });
    }

    // No subscription yet: start one for the add-on only.
    let customer = t.stripe_customer_id;
    if (!customer) { const c = await stripe("customers", { email: auth.user.email, metadata: { team_id: body.teamId, user_id: auth.user.id } }); customer = c.id; await save({ stripe_customer_id: customer }); }
    const s = await stripe("checkout/sessions", {
      mode: "subscription", customer, client_reference_id: body.teamId, locale: "ja",
      line_items: { 0: { price, quantity: needExtra } },
      subscription_data: { metadata: { team_id: body.teamId, games: games.join(",") } },
      metadata: { team_id: body.teamId },
      success_url: site + "/app?billing=success#settings", cancel_url: site + "/app#settings"
    });
    send(res, 200, { url: s.url });
  } catch (e) { fail(res, e.status || 500, e.status ? e.message : "タイトルを変更できませんでした。"); }
};
