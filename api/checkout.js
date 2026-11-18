// POST /api/checkout {teamId, plan:"team"|"org"} -> {url}   (Stripe Checkout, monthly subscription)
//      /api/checkout {teamId, kind:"maps", packs:1-10}       (one-time payment: 10 extra maps per pack)
const { send, fail, readBody, getUser, membership, rest, stripe, env } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const auth = await getUser(req); if (!auth) return fail(res, 401, "ログインしてください。");
    const body = await readBody(req);
    const m = await membership(body.teamId, auth);
    if (!m || m.role !== "admin") return fail(res, 403, "プランの変更は、チームの管理者だけができます。");
    // extra maps: a one-time payment, 10 maps per pack (500 yen), kept until used
    const maps = body.kind === "maps";
    const packs = Math.max(1, Math.min(10, parseInt(body.packs, 10) || 1));
    const price = maps ? env("STRIPE_PRICE_EXTRA_MAPS") : body.plan === "org" ? env("STRIPE_PRICE_ORG") : env("STRIPE_PRICE_TEAM");
    if (!price) return fail(res, 503, "料金の設定がまだ入っていません。");
    let customer = m.teams && m.teams.stripe_customer_id;
    if (!customer) {
      const c = await stripe("customers", { email: auth.user.email, metadata: { team_id: body.teamId, user_id: auth.user.id } });
      customer = c.id;
      await rest("teams?id=eq." + body.teamId, { method: "PATCH", service: true, body: { stripe_customer_id: customer } });
    }
    const site = env("SITE_URL", "https://" + req.headers.host);
    if (maps) {
      if (!["team", "org", "solo"].includes(m.teams && m.teams.plan)) return fail(res, 400, "追加マップは有料プランで使えます。");
      const s = await stripe("checkout/sessions", {
        mode: "payment", customer, client_reference_id: body.teamId, locale: "ja",
        line_items: { 0: { price, quantity: packs } },
        metadata: { team_id: body.teamId, kind: "maps", maps: String(packs * 10) },
        payment_intent_data: { metadata: { team_id: body.teamId, kind: "maps", maps: String(packs * 10) } },
        success_url: site + "/app?maps=success#settings", cancel_url: site + "/app#settings"
      });
      return send(res, 200, { url: s.url });
    }
    // Already paying for title add-ons: add the plan to the same subscription instead of starting a second one.
    const subId = m.teams && m.teams.stripe_subscription_id;
    if (subId) {
      const sub = await stripe("subscriptions/" + subId, null, "GET");
      const planItem = (sub.items.data || []).find((it) => [env("STRIPE_PRICE_TEAM"), env("STRIPE_PRICE_ORG")].includes(it.price.id));
      if (planItem) await stripe("subscription_items/" + planItem.id, { price, proration_behavior: "create_prorations" });
      else await stripe("subscription_items", { subscription: subId, price, quantity: 1, proration_behavior: "create_prorations" });
      return send(res, 200, { url: site + "/app?billing=success#settings" });
    }
    const s = await stripe("checkout/sessions", {
      mode: "subscription", customer, client_reference_id: body.teamId, locale: "ja", allow_promotion_codes: "true",
      line_items: { 0: { price, quantity: 1 } },
      subscription_data: { metadata: { team_id: body.teamId } },
      metadata: { team_id: body.teamId },
      success_url: site + "/app?billing=success#settings", cancel_url: site + "/app#settings"
    });
    send(res, 200, { url: s.url });
  } catch (e) { fail(res, e.status || 500, e.status ? e.message : "決済画面を開けませんでした。"); }
};
