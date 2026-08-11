var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/telemetry.js
var EVENT_SCHEMA_VERSION = 1;
var EVENT_RETENTION_LIMIT = 5e3;
var MAX_EVENT_RESPONSE = 200;
var MAX_RUN_EVENT_RESPONSE = 100;
var STREAM_PROTOCOL_VERSION = 1;
var STREAM_SUBPROTOCOL = "ops-v1";
var MAX_STREAM_REPLAY = 100;
var MAX_STREAM_SUBSCRIBERS = 100;
var MAX_STREAM_BUFFERED_BYTES = 262144;
var MAX_RUN_RESPONSE = 100;
var MAX_WORKER_EVENT_RESPONSE = 50;
var EVENT_TYPES = /* @__PURE__ */ new Set([
  "RUN_STARTED",
  "RUN_COMPLETED",
  "RUN_FAILED",
  "SOURCE_STARTED",
  "SOURCE_COMPLETED",
  "SOURCE_ERROR",
  "SOURCE_RATE_LIMITED",
  "SEARCH_STARTED",
  "SEARCH_COMPLETED",
  "RESULTS_FOUND",
  "CANDIDATE_REJECTED",
  "CANDIDATE_FETCHED",
  "DUPLICATE_SUPPRESSED",
  "EVIDENCE_CHECK_STARTED",
  "EVIDENCE_VERIFIED",
  "EVIDENCE_FAILED",
  "FINDING_ACCEPTED",
  "FINDING_WRITTEN",
  "WRITE_SKIPPED",
  "WORKER_HEALTH_CHECK",
  "DEPLOYMENT_VERSION"
]);
var SEVERITIES = /* @__PURE__ */ new Set(["info", "warning", "error"]);
var PHASES = /* @__PURE__ */ new Set([
  "discovery",
  "normalize",
  "dedup",
  "evidence",
  "write",
  "system"
]);
var FORBIDDEN_FIELD = /(?:secret|token|password|cookie|credential|authorization|private[_-]?key)/i;
var REGISTRY = [
  ["x", "X Signal Scout", "source", "3h"],
  ["reddit", "Reddit Growth Scout", "source", "3h"],
  ["youtube", "YouTube Knowledge Scout", "source", "6h"],
  ["builder", "Builder Community Scout", "source", "6h"],
  ["instagram", "Instagram Traffic Scout", "source", "24h"],
  ["tiktok", "TikTok Signal Scout", "source", "6h"],
  ["open_web", "Open Web Scout", "source", "12h"],
  ["normalizer", "Normalizer", "processor", "event-driven"],
  ["evidence_verifier", "Evidence Verifier", "processor", "event-driven"]
];
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
__name(json, "json");
function boundedLimit(value, fallback, maximum) {
  const parsed = Number.parseInt(value || String(fallback), 10);
  return Math.min(
    maximum,
    Math.max(1, Number.isFinite(parsed) ? parsed : fallback)
  );
}
__name(boundedLimit, "boundedLimit");
function hasForbiddenField(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasForbiddenField);
  return Object.entries(value).some(
    ([key, nested]) => FORBIDDEN_FIELD.test(key) || hasForbiddenField(nested)
  );
}
__name(hasForbiddenField, "hasForbiddenField");
function boundedObject(value, field) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field}_must_be_object`);
  }
  if (hasForbiddenField(value)) throw new Error("secret_field_rejected");
  const encoded = JSON.stringify(value);
  if (encoded.length > 16e3) throw new Error(`${field}_too_large`);
  return JSON.parse(encoded);
}
__name(boundedObject, "boundedObject");
function requiredText(value, field, max = 500) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`missing_${field}`);
  }
  if (value.length > max) throw new Error(`${field}_too_large`);
  return value;
}
__name(requiredText, "requiredText");
function validateTelemetryEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("event_must_be_object");
  }
  if (hasForbiddenField(input)) throw new Error("secret_field_rejected");
  if (input.schema_version !== EVENT_SCHEMA_VERSION) {
    throw new Error("unsupported_schema_version");
  }
  const event2 = {
    event_id: requiredText(input.event_id, "event_id", 100),
    schema_version: EVENT_SCHEMA_VERSION,
    timestamp: requiredText(input.timestamp, "timestamp", 40),
    run_id: requiredText(input.run_id, "run_id", 120),
    worker_id: requiredText(input.worker_id, "worker_id", 80),
    source: requiredText(input.source, "source", 80),
    event_type: requiredText(input.event_type, "event_type", 80),
    status: requiredText(input.status, "status", 80),
    severity: requiredText(input.severity, "severity", 20),
    phase: requiredText(input.phase, "phase", 40),
    summary: requiredText(input.summary, "summary", 500),
    metrics: boundedObject(input.metrics, "metrics"),
    metadata: boundedObject(input.metadata, "metadata")
  };
  if (!EVENT_TYPES.has(event2.event_type)) throw new Error("invalid_event_type");
  if (!SEVERITIES.has(event2.severity)) throw new Error("invalid_severity");
  if (!PHASES.has(event2.phase)) throw new Error("invalid_phase");
  if (!Number.isFinite(Date.parse(event2.timestamp))) {
    throw new Error("invalid_timestamp");
  }
  if (hasForbiddenField(event2)) throw new Error("secret_field_rejected");
  return event2;
}
__name(validateTelemetryEvent, "validateTelemetryEvent");
function event(base, input) {
  return validateTelemetryEvent({
    event_id: crypto.randomUUID(),
    schema_version: EVENT_SCHEMA_VERSION,
    // A run timestamp describes invocation lineage, not when this event was
    // observed. Equal natural timestamps retain event-id/sequence ordering.
    timestamp: input.timestamp ?? base.clock?.() ?? (/* @__PURE__ */ new Date()).toISOString(),
    run_id: base.run_id,
    worker_id: input.worker_id ?? "orchestrator",
    source: input.source ?? "system",
    event_type: input.event_type,
    status: input.status,
    severity: input.severity ?? "info",
    phase: input.phase,
    summary: input.summary,
    metrics: input.metrics ?? {},
    metadata: input.metadata ?? {}
  });
}
__name(event, "event");
function telemetryEventsFromRun(log, versionMetadata = {}) {
  const base = {
    clock: log.clock || (() => (/* @__PURE__ */ new Date()).toISOString()),
    run_id: log.run_id || crypto.randomUUID()
  };
  const events = [
    event(base, {
      event_type: "DEPLOYMENT_VERSION",
      status: "observed",
      phase: "system",
      summary: "Worker deployment version observed for run",
      metadata: {
        deployment_id: versionMetadata.id || "unknown",
        deployment_tag: versionMetadata.tag || null
      }
    }),
    event(base, {
      event_type: "RUN_STARTED",
      status: "running",
      phase: "system",
      summary: `Research run started (${log.execution || "unknown"})`,
      metrics: { due_sources: log.due_sources?.length || 0 },
      metadata: { execution: log.execution || "unknown" }
    })
  ];
  for (const sourceLog of log.source_runs || []) {
    const source = sourceLog.source;
    const sourceBase = { worker_id: source, source };
    events.push(
      event(base, {
        ...sourceBase,
        event_type: "SOURCE_STARTED",
        status: "running",
        phase: "discovery",
        summary: `${source} source run started`,
        metadata: { mode: sourceLog.mode || "unknown" }
      })
    );
    if ((sourceLog.searches || 0) > 0) {
      events.push(
        event(base, {
          ...sourceBase,
          event_type: "SEARCH_STARTED",
          status: "running",
          phase: "discovery",
          summary: `${source} discovery search started`,
          metadata: { g: sourceLog.g || null, t: sourceLog.t || null }
        }),
        event(base, {
          ...sourceBase,
          event_type: "SEARCH_COMPLETED",
          status: "completed",
          phase: "discovery",
          summary: `${source} discovery search completed`,
          metrics: { searches: sourceLog.searches || 0 }
        }),
        event(base, {
          ...sourceBase,
          event_type: "RESULTS_FOUND",
          status: "observed",
          phase: "discovery",
          summary: `${source} discovery results observed`,
          metrics: { candidates: sourceLog.candidates || 0 }
        })
      );
    }
    if ((sourceLog.fetches || 0) > 0) {
      events.push(
        event(base, {
          ...sourceBase,
          event_type: "CANDIDATE_FETCHED",
          status: "observed",
          phase: "discovery",
          summary: `${source} candidate pages fetched`,
          metrics: { fetches: sourceLog.fetches || 0 }
        })
      );
    }
    if ((sourceLog.duplicates || 0) > 0) {
      events.push(
        event(base, {
          ...sourceBase,
          event_type: "DUPLICATE_SUPPRESSED",
          status: "suppressed",
          phase: "dedup",
          summary: `${source} duplicates suppressed`,
          metrics: { duplicates: sourceLog.duplicates || 0 }
        })
      );
    }
    if ((sourceLog.rejected || 0) > 0) {
      events.push(
        event(base, {
          ...sourceBase,
          event_type: "CANDIDATE_REJECTED",
          status: "rejected",
          phase: "normalize",
          summary: `${source} candidates rejected`,
          metrics: { rejected: sourceLog.rejected || 0 }
        })
      );
    }
    if ((sourceLog.evidence_failures || 0) > 0) {
      events.push(
        event(base, {
          ...sourceBase,
          event_type: "EVIDENCE_FAILED",
          status: "failed",
          severity: "warning",
          phase: "evidence",
          summary: `${source} evidence checks failed`,
          metrics: { failures: sourceLog.evidence_failures || 0 }
        })
      );
    }
    if ((sourceLog.verified || 0) > 0) {
      events.push(
        event(base, {
          ...sourceBase,
          event_type: "EVIDENCE_VERIFIED",
          status: "verified",
          phase: "evidence",
          summary: `${source} evidence verified`,
          metrics: { verified: sourceLog.verified || 0 }
        })
      );
    }
    if ((sourceLog.writes || 0) > 0) {
      events.push(
        event(base, {
          ...sourceBase,
          event_type: "FINDING_ACCEPTED",
          status: "accepted",
          phase: "write",
          summary: `${source} findings accepted`,
          metrics: { writes: sourceLog.writes || 0 }
        }),
        event(base, {
          ...sourceBase,
          event_type: "FINDING_WRITTEN",
          status: "written",
          phase: "write",
          summary: `${source} findings written`,
          metrics: { writes: sourceLog.writes || 0 }
        })
      );
    } else {
      events.push(
        event(base, {
          ...sourceBase,
          event_type: "WRITE_SKIPPED",
          status: "skipped",
          phase: "write",
          summary: `${source} write skipped`
        })
      );
    }
    events.push(
      event(base, {
        ...sourceBase,
        event_type: sourceLog.errors ? "SOURCE_ERROR" : "SOURCE_COMPLETED",
        status: sourceLog.errors ? "failed" : "completed",
        severity: sourceLog.errors ? "error" : "info",
        phase: "system",
        summary: sourceLog.errors ? `${source} source run failed` : `${source} source run completed`,
        metrics: {
          searches: sourceLog.searches || 0,
          fetches: sourceLog.fetches || 0,
          writes: sourceLog.writes || 0
        }
      })
    );
  }
  events.push(
    event(base, {
      event_type: log.final_run_status === "error" ? "RUN_FAILED" : "RUN_COMPLETED",
      status: log.final_run_status === "error" ? "failed" : "completed",
      severity: log.final_run_status === "error" ? "error" : "info",
      phase: "system",
      summary: log.final_run_status === "error" ? "Research run failed" : "Research run completed",
      metrics: {
        source_runs: log.source_runs?.length || 0,
        total_writes: log.total_writes || 0
      }
    })
  );
  return events;
}
__name(telemetryEventsFromRun, "telemetryEventsFromRun");
class OpsTelemetry {
  state;
  env;
  events;
  runs;
  workers;
  streams;
  lastSeq;
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.events = [];
    this.runs = new Map();
    this.workers = new Map();
    this.streams = new Set();
    this.lastSeq = 0;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get("telemetry_snapshot");
      if (stored !&& typeof stored === "object") {
        this.events = Array.isArray(stored.events) ? stored.events : [];
        this.lastSeq = Number(stored.last_seq || 0);
        this.rebuildIndexes();
      }
    });
  }
  rebuildIndexes() {
    this.runs.clear();
    this.workers.clear();
    for (const event2 of this.events) {
      this.addToIndex(this.runs, event2.run_id, event2);
      this.addToIndex(this.workers, event2.worker_id, event2);
    }
  }
  addToIndex(index, key, event2) {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(event2);
  }
  async persist() {
    await this.state.storage.put(
      "telemetry_snapshot",
      {
        events: this.events,
        last_seq: this.lastSeq
      }
    );
  }
  async ingest(payload) {
    const input = Array.isArray(payload) ? payload : [fully_condensed_for_brevity_in_this_call];
    const accepted = [];
    for (const item of input) {
      const event2 = validateTelemetryEvent(item);
      this.lastSeq += 1;
      const stored = { ...event2, _seq: this.lastSeq };
      this.events.push(stored);
      this.addToIndex(this.runs, event2.run_id, stored);
      this.addToIndex(this.workers, event2.worker_id, stored);
      accepted.push(stored);
    }
    if (this.events.length > EVENT_RETENTION_LIMIT) {
      this.events = this.events.slice(-EVENT_RETENTION_LIMIT);
      this.rebuildIndexes();
    }
    await this.persist();
    for (const event2 of accepted) this.broadcast(event2);
    return accepted;
  }
  broadcast(event2) {
    const message = JSON.stringify(typeof event2._seq === "number" ? { type: "event", protocol_version: STREAM_PROTOCOL_VERSION, last_seq: event2._seq, event: event2 } : { type: "event", protocol_version: STREAM_PROTOCOL_VERSION, event: event2 });
    for (const ws of this.streams) {
      try {
        if (ws.readyState !== 1) {
          this.streams.delete(ws);
          continue;
        }
        if (ws.bufferedAmount > MAX_STREAM_BUFFERED_BYTES) {
          this.streams.delete(ws);
          ws.close(1008, "stream_backchand_pressure");
          continue;
        }
        ws.send(message);
      } catch {
        this.streams.delete(ws);
      }
    }
  }
  filterEvents(events, url) {
    const source = url.searchParams.get("source");
    const worker_id = url.searchParams.get("worker_id");
    const run_id = url.searchParams.get("run_id");
    const event_type = url.searchParams.get("event_type");
    const status = url.searchParams.get("status");
    const severity = url.searchParams.get("severity");
    const phase = url.searchParams.get("phase");
    const since = url.searchParams.get("since");
    const sinceEpoch = since ? Date.parse(since) : NaN;
    return events.filter((event2) => {
      if (source && event2.source !== source) return false;
      if (worker_id && event2.worker_id !== worker_id) return false;
      if (run_id && event2.run_id !== run_id) return false;
      if (event_type && event2.event_type !== event_type) return false;
      if (status && event2.status !== status) return false;
      if (severity && event2.severity !== severity) return false;
      if (phase && event2.phase !== phase) return false;
      if (Number.isFinite(sinceEpoch) && Date.parse(event2.timestamp) < sinceEpoch) return false;
      return true;
    });
  }
  listEvents(url) {
    const limit = boundedLimit(url.searchParams.get("limit"), 50, MAX_EVENT_RESPONSE);
    return this.filterEvents(this.events, url).slice(-limit);
  }
  listRunEvents(run_id, url) {
    const limit = boundedLimit(url.searchParams.get("limit"), 50, MAX_RUN_EVENT_RESPONSE);
    return this.filterEvents(this.runs.get(run_id) || [], url).slice(-limit);
  }
  listWorkerEvents(worker_id, url) {
    const limit = boundedLimit(url.searchParams.get("limit"), 20, MAX_WORKER_EVENT_RESPONSE);
    return this.filterEvents(this.workers.get(worker_id) || [], url).slice(-limit);
  }
  listRuns(url) {
    const limit = boundedLimit(url.searchParams.get("limit"), 25, MAX_RUN_RESPONSE);
    const source = url.searchParams.get("source");
    const status = url.searchParams.get("status");
    const phase = url.searchParams.get("phase");
    const runs = [];
    for (const [run_id, events] of this.runs) {
      if (source && !events.some((event2) => event2.source === source)) continue;
      const startClock = events.find((event2) => event2.event_type === "RUN_STARTED")(.timestamp;
      const endClock = [...events].reverse().find((event2) => ["RUN_COMPLETED", "RUN_FAILED"].includes(event2.event_type))?.timestamp;
      const finalEvent = [...events].reverse().find((event2) => ["RUN_COMPLETED", "RUN_FAILED"].includes(event2.event_type));
      const runStatus = finalEvent?.status === "failed" ? "failed" : finalEvent ? "completed" : "running";
      if (status && runStatus !== status) continue;
      if (phase && !events.some((event2) => event2.phase === phase)) continue;
      runs.push({
        run_id,
        status: runStatus,
        started_at: startClock || null,
        ended_at: endClock || null,
        sources: [...new Set(events.map((event2) => event2.source))].filter((source2) => source2 !== "system"),
        writes: events.filter((event2) => event2.event_type === "FINDING_WRITTEN").length,
        errors: events.filter((event2) => event2.event_type === "RUN_FAILED" || event2.event_type === "SOURCE_ERROR").length,
        last_seq: Math.max(...events.map((event2) => event2._seq || 0))
      });
    }
    return runs.sort((a, b) => Date.parse(b.started_at || 0) - Date.parse(a.started_at || 0)).slice(0, limit);
  }
  listWorkers() {
    return REGISTRY.map((([id, label, role, cadence]) => {
      const events = this.workers.get(id) || [];
      const lastEvent = events[events.length - 1] || null;
      const running = events.some((event2) => event2.event_type === "SOURCE_STARTED") && !events.some((event2) => ["SOURCE_COMPLETED", "SOURCE_ERROR"].includes(event2.event_type));
      return {
        id,
        label,
        role,
        cadence,
        status: running ? "running" : lastEvent ? lastEvent.status : "idle",
        last_event_at: lastEvent?.timestamp || null,
        last_event_type: lastEvent?.event_type || null
      };
    });
  }
  async handleStream(request) {
    const UPRGADE = request.headers.get("Upgrade");
    if (!UPRGADE || UPRGRADE.toLowerCase() !== "websocket") {
      return json( { error: "websocket_upgrade_required" }, 426);
    }
    if (this.streams.size >= MAX_STREAM_SUBSCRIBERS) {
      return json({ error: "stream_subscriber_limit" }, 429);
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.streams.add(server);
    server.addEventListener("close", () => this.streams.delete(server));
    server.addEventListener("error", () => this.streams.delete(server));
    const replay = this.listEvents(new URL(request.url)).slice(-MAX_STREAM_REPLAY);
    server.send(JSON.stringify({
      type: "snapshot",
      protocol_version: STREAM_PROTOCOL_VERSION,
      replay,
      last_seq: this.lastSeq
    }));
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": STREAM_SUBPROTOCOL }
    });
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        service: "ops-telemetry",
        schema_version: EVENT_SCHEMA_VERSION,
        stream_protocol_version: STREAM_PROTOCOL_VERSION,
        events: this.events.length,
        runs: this.runs.size,
        workers: REGISTRY.length,
        subscribers: this.streams.size
      });
    }
    if (request.method === "POST" && url.pathname === "/ingest") {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: "invalid_json" }, 400);
      }
      try {
        const accepted = await this.ingest(payload);
        return json({ accepted: accepted.length }, 202);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid_event" }, 400);
      }
    }
    if (request.method === "GET" && url.pathname === "/events") {
      return json({ events: this.listEvents(url) });
    }
    if (request.method === "GET" && url.pathname.startsWith("/runs/") && url.pathname.endsWith("/events")) {
      const run_id = decodeURIComponent(url.pathname.slice("/runs/".length, -"/events".length));
      return json({ run_id, events: this.listRunEvents(run_id, url) });
    }
    if (request.method === "GET" && url.pathname.startsWith("/workers/") && url.pathname.endsWith("/events")) {
      const worker_id = decodeURIComponent(url.pathname.slice("/workers/".length, -"/events".length));
      return json({ worker_id, events: this.listWorkerEvents(worker_id, url) });
    }
    if (request.method === "GET" && url.pathname === "/runs") {
      return json({ runs: this.listRuns(url) });
    }
    if (request.method === "GET" && url.pathname === "/workers") {
      return json({ workers: this.listWorkers() });
    }
    if (url.pathname === "/stream") {
      return this.handleStream(request);
    }
    return json({ error: "not_found" }, 404);
  }
}
__name(OpsTelemetry, "OpsTelemetry");

// src/index.js
var SOURCES_MODE_ALIAS_MAP = new Map([
  ["canary", "passive_canary"]
]);
var SOURCE_MODE_LIST = ["disabled", "manual_canary", "passive_canary", "awaiting_canary_candidate", "production", "coverage_insufficient"];
var VALID_SOURCE_MODES = new Set(SOURCE_MODE_LIST);
var EFFECTIVE_SOURCE_STATES = /* @__PURE__ */ new Set([
  "disabled",
  "manual_canary",
  "passive_canary",
  "awaiting_canary_candidate",
  "canary_hold",
  "ready_for_cutover",
  "production",
  "coverage_insufficient"
]);
var SCHEDULED_WRITE_ALLOWED_SOURCE_MODES = new Set(["production"]);
var PASSIVE_CANARY_SOURCE_MODES = new Set(["passive_canary", "awaiting_canary_candidate"]);
var VALID_SOURCES = /* @__PURE__ */ new Set(["x", "reddit", "youtube", "builder", "instagram", "tiktok", "open_web"]);
var SOURCE_ALIAS_MAP = new Map([
  ["tiktok", "tiktok"],
  ["tik tok", "tiktok"],
  ["you tube", "youtube"],
  ["chatgpt", "x"],
  ["twitter", "x"],
  ["traffic", "x"]
]);
var SOURCE_LABEL = {
  x: "X",
  reddit: "Reddit",
  youtube: "YouTube",
  builder: "Builder Community",
  instagram: "Instagram",
  tiktok: "TikTok",
  open_web: "Open Web"
};
var SOURCE_DEFINITIONS = {
  x: { seed: 0, cadenceHours: 3, classification: "search_grounded", promotionStyle: "auto" },
  reddit: { seed: 200, cadenceHours: 3, classification: "search_grounded", promotionStyle: "auto" },
  youtube: { seed: 400, cadenceHours: 6, classification: "search_grounded", promotionStyle: "auto" },
  builder: { seed: 600, cadenceHours: 6, classification: "search_grounded", promotionStyle: "auto" },
  instagram: { seed: 800, cadenceHours: 24, classification: "search_grounded", promotionStyle: "auto" },
  tiktok: { seed: 1000, cadenceHours: 6, classification: "search_grounded", promotionStyle: "auto" },
  open_web: { seed: 1200, cadenceHours: 12, classification: "search_grounded", promotionStyle: "auto" }
};
var CANONICAL_HEADERS = ["evidence_id", "source", "author_handle", "url", "title", "snippet", "issue", "solution", "extracted_at", "how_found", "score", "status", "source_coverage", "source_confidence", "source_identity", "source_entity_url", "external_identifier", "last_source_check_at", "source_freshness", "reserve_a", "reserve_b", "reserve_c", "reserve_d", "reserve_e", "reserve_f", "reserve_g"];
var AUTHOR_HEADERS = ["author_id", "name", "handle", "platform", "profile_url", "bio", "followers", "authority", "first_seen", "last_seen", "source_entity", "source_confidence", "reserve_a", "reserve_b"];
var REJECTED_HEADERS = ["source", "url", "reason", "extracted_at", "canonical_url", "handle", "score", "notes"];
var ENCODER = new TextEncoder();
var MAX_SHEETS_SUBREQUESTS_PER_PAS_CAP = 100;
var SOURCE_HEALTH_READ_MODES_APPROVED = new Set(["x", "reddit", "youtube", "builder", "instagram", "tiktok", "open_web"]);
var SOURCE_STATE_KEY_PREFIX = "source_state:v1:";
var SOURCE_CUTOVER_KEY_PREFIX = "source_cutover:v1:";
var SOURCE_CANARY_KEY_PREFIX = "source_canary:v1:";
var SOURCE_CANARY_HOLD_KEY_PREFIX = "source_canary_hold:v1:";
var SOURCE_STATE_SCOPES = new Set(["production", "canary_scan"]);
var CANARY_CANDIDATE_HOLD_MINUTES = 60;
var MASTER_DB_DETUNE_DOCUMENT = "https://docs.google.com/spreadsheets/d/16cQU2JO44JeO8<Y