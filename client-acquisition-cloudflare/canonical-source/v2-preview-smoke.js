import worker from "./v2-preview-standalone.js";

const CANARY_PATH = "/__acq2_preview_smoke_7c9142e86b0d4f12a3f5c978e6d1b420";

function denied() {
  return new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

function allowed(request, env) {
  const expected = String(env.ACQ2_CANARY_TOKEN || "");
  const supplied = String(request.headers.get("x-acq2-canary-token") || "");
  const expires = Number(env.ACQ2_CANARY_EXPIRES_AT || 0);
  return Boolean(expected && supplied === expected && expires > Math.floor(Date.now() / 1000));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!allowed(request, env)) return denied();

    if (request.method === "GET" && url.pathname === "/client-acquisition-v2/health") {
      return worker.fetch(request, env, ctx);
    }

    if (request.method === "GET" && url.pathname === CANARY_PATH) {
      if (!env.RESEARCH_CONTROL_SECRET) {
        return new Response(JSON.stringify({ status: "ABORTED", error: "RESEARCH_CONTROL_SECRET_MISSING" }), {
          status: 500,
          headers: { "content-type": "application/json", "cache-control": "no-store" }
        });
      }
      const internal = new Request("https://canary.internal/client-acquisition-v2/run?write=1", {
        method: "POST",
        headers: { "x-run-token": String(env.RESEARCH_CONTROL_SECRET) }
      });
      return worker.fetch(internal, env, ctx);
    }

    return denied();
  }
};
