// Send visitors of the old address (taclog.pages.dev) to the real domain, once CANONICAL_HOST (e.g. "taclog.app") is set in Cloudflare.
// Preview deployments (xxxx.taclog.pages.dev) and API calls are left alone.
export async function onRequest(context) {
  const { request, env, next } = context;
  const host = String((env && env.CANONICAL_HOST) || "").trim();
  if (host) {
    const url = new URL(request.url);
    if (url.hostname === "taclog.pages.dev" && !url.pathname.startsWith("/api/")) {
      url.hostname = host; url.port = "";
      return Response.redirect(url.toString(), 301);
    }
  }
  return next();
}
