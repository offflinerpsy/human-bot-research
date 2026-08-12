import worker, { OpsTelemetry } from "./v2-entry-v3.js";

export { OpsTelemetry };

const CANARY_PATH = "/__acq2_smoke_canary_9f5c2e7a1d4b6c8e3f0a5b7d2c9e4f61";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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
    return worker.fetch(request, env, ctx);
  }
};
