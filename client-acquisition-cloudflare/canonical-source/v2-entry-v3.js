import legacyWorker, { OpsTelemetry as LegacyOpsTelemetry } from "./worktree/outreach-x-signal-scout/src/index.js";

export { LegacyOpsTelemetry as OpsTelemetry };

const PROD_ID = "1fXHlnCqsw6KvKub4UtqHyb5MwUUPvqTZ9QvPp1IPG-E";
const SIGNAL_TAB = "22_SIGNAL_INBOX";
const LEADS_TAB = "01_LEADS_MASTER";
const CONTACTS_TAB = "02_CONTACTS";
const SUPPRESSION_TAB = "07_SUPPRESSION";
const MAX_BUSINESSES = 10;
const MAX_DEEP_SITES = 5;
const MAX_PAGE_READS = 15;

const PILOT = Object.freeze({
  vertical: "MED_SPA_AESTHETICS_WELLNESS",
  metro: "Austin",
  state: "TX",
  queries: [
    "medical spa Austin TX official website",
    "aesthetic wellness clinic Austin TX official website"
  ]
});

const SIGNAL_HEADERS = Object.freeze([
  "Candidate ID","Acquisition run ID","Packet hash","Idempotency key","Discovered at","Observed at","Source lane","Source URL","Trigger type","Trigger summary","Business name","Normalized name","Canonical domain","Canonical homepage","City","State","ZIP","Vertical","FIT","SIGNAL","PAIN","EVIDENCE","CONTACT","FRESHNESS","GPT admission gate","Finding type","Finding summary","Evidence URL","Evidence observed at","Evidence method","Truth class","Public email","Email provenance","Public phone","Phone provenance","Contact route","Contact confidence","Duplicate gate","Suppression gate","Machine state","Worker version","Machine updated at","GPT decision","GPT reason","Strongest hook","Offer segment","Proposed next action","Controller run ID","Controller decided at","Promoted Lead UID","Promotion state","Owner note"
]);
const SUPPRESSION_HEADERS = Object.freeze([
  "Suppression UID","Lead UID","Business name","Scope","Reason","Source status","Source recommendation","Effective date","Review required","Release condition","Fingerprint"
]);

const VERTICAL_TERMS = /\b(med(?:ical)?\s*spa|aesthetic(?:s| medicine)?|injectables?|botox|dermal filler|laser skin|body contour|wellness clinic)\b/i;
const BLOCKED_HOSTS = new Set([
  "google.com","maps.google.com","facebook.com","instagram.com","tiktok.com","x.com","twitter.com",
  "yelp.com","mapquest.com","yellowpages.com","healthgrades.com","realself.com","linkedin.com"
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function normalizeName(value) { return clean(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim(); }
function normalizeEmail(value) { return clean(value).toLowerCase(); }
function normalizePhone(value) {
  const digits = clean(value).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}
function normalizeHost(value) {
  try {
    const host = new URL(String(value).includes("://") ? value : `https://${value}`).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return clean(value).toLowerCase().replace(/^www\./, "").split("/")[0];
  }
}
function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|gclid|fbclid|mc_)/i.test(key)) url.searchParams.delete(key);
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch { return ""; }
}
function base64url(bytes) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function pemToBytes(pem) {
  const normalized = String(pem).replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const binary = atob(normalized);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function googleAccessToken(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("GOOGLE_AUTH_MISSING");
  let serviceAccount;
  try { serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON); } catch { throw new Error("GOOGLE_AUTH_INVALID_JSON"); }
  if (!serviceAccount.client_email || !serviceAccount.private_key) throw new Error("GOOGLE_AUTH_INCOMPLETE");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64url(new TextEncoder().encode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now - 15,
    exp: now + 3300
  })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToBytes(serviceAccount.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`GOOGLE_AUTH_FAILED_${response.status}`);
  return payload.access_token;
}
function colLetter(number) {
  let n = Number(number), out = "";
  while (n > 0) { n -= 1; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
  return out;
}

class SheetsClient {
  constructor(env) { this.env = env; this.spreadsheetId = env.LEAD_OUTREACH_SPREADSHEET_ID || PROD_ID; this.token = null; }
  async auth() { if (!this.token) this.token = await googleAccessToken(this.env); return this.token; }
  async request(path, init = {}) {
    const token = await this.auth();
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}${path}`, {
      ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) }
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 500) }; }
    if (!response.ok) throw new Error(`SHEETS_HTTP_${response.status}`);
    return payload;
  }
  rangePath(range, suffix = "") { return `/values/${encodeURIComponent(range)}${suffix ? `?${suffix}` : ""}`; }
  async values(range) {
    const payload = await this.request(this.rangePath(range, "majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE"));
    return payload.values || [];
  }
  async objects(tab, endColumn, maxRows) {
    const rows = await this.values(`${tab}!A1:${endColumn}${maxRows}`);
    if (!rows.length) return { headers: [], rows: [] };
    const headers = rows[0].map(clean);
    return {
      headers,
      rows: rows.slice(1).map((values, index) => ({ rowNumber: index + 2, raw: values, data: Object.fromEntries(headers.map((header, column) => [header, clean(values[column])])) }))
    };
  }
  async writeRow(tab, rowNumber, values) {
    const end = colLetter(values.length);
    const range = `${tab}!A${rowNumber}:${end}${rowNumber}`;
    await this.request(this.rangePath(range, "valueInputOption=RAW&includeValuesInResponse=false"), {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ range, majorDimension: "ROWS", values: [values] })
    });
    return range;
  }
}

function assertHeaders(actual, expected, label) {
  if (actual.length !== expected.length) throw new Error(`${label}_COLUMN_COUNT_${actual.length}`);
  for (let i = 0; i < expected.length; i += 1) if (clean(actual[i]) !== expected[i]) throw new Error(`${label}_HEADER_${i + 1}`);
}
function requireHeaders(headers, required, label) {
  for (const header of required) if (!headers.includes(header)) throw new Error(`${label}_MISSING_${header.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`);
}

function buildIdentityIndexes(leadState, contactState, suppressionState, inboxState) {
  const domains = new Set(), names = new Set(), emails = new Set(), phones = new Set(), fingerprints = new Set();
  const suppressedLeadUids = new Set(), suppressedDomains = new Set(), suppressedNames = new Set();
  const suppressedEmails = new Set(), suppressedPhones = new Set(), suppressedFingerprints = new Set();
  const candidateIds = new Set(), idemKeys = new Set(), packetHashes = new Set();
  const leadByUid = new Map(), contactsByLeadUid = new Map();

  for (const row of leadState.rows) {
    const d = row.data;
    const uid = clean(d["Lead UID"]);
    if (uid) leadByUid.set(uid, d);
    const domain = normalizeHost(d["Domain"] || d["Canonical homepage"] || "");
    const name = normalizeName(d["Normalized name"] || d["Business name"] || "");
    const email = normalizeEmail(d["Primary email"] || "");
    const phone = normalizePhone(d["Primary phone"] || "");
    const fingerprint = clean(d["Fingerprint"]);
    if (domain) domains.add(domain); if (name) names.add(name); if (email) emails.add(email); if (phone) phones.add(phone); if (fingerprint) fingerprints.add(fingerprint);
  }

  for (const row of contactState.rows) {
    const d = row.data, uid = clean(d["Lead UID"]), type = clean(d["Contact type"]).toLowerCase();
    const value = clean(d["Normalized value"] || d["Raw value"]);
    if (uid) { if (!contactsByLeadUid.has(uid)) contactsByLeadUid.set(uid, []); contactsByLeadUid.get(uid).push({ type, value }); }
    if (type === "email" || value.includes("@")) { const email = normalizeEmail(value); if (email) emails.add(email); }
    else if (type === "phone" || /\d{7}/.test(value)) { const phone = normalizePhone(value); if (phone) phones.add(phone); }
  }

  for (const row of suppressionState.rows) {
    const d = row.data;
    const suppressionUid = clean(d["Suppression UID"]), leadUid = clean(d["Lead UID"]), business = normalizeName(d["Business name"]), fingerprint = clean(d["Fingerprint"]);
    if (!(suppressionUid || leadUid || business || fingerprint)) continue;
    if (leadUid) suppressedLeadUids.add(leadUid);
    if (business) suppressedNames.add(business);
    if (fingerprint) suppressedFingerprints.add(fingerprint);

    const lead = leadByUid.get(leadUid);
    if (lead) {
      const domain = normalizeHost(lead["Domain"] || lead["Canonical homepage"] || "");
      const name = normalizeName(lead["Normalized name"] || lead["Business name"] || "");
      const email = normalizeEmail(lead["Primary email"] || "");
      const phone = normalizePhone(lead["Primary phone"] || "");
      const leadFingerprint = clean(lead["Fingerprint"]);
      if (domain) suppressedDomains.add(domain); if (name) suppressedNames.add(name); if (email) suppressedEmails.add(email); if (phone) suppressedPhones.add(phone); if (leadFingerprint) suppressedFingerprints.add(leadFingerprint);
    }
    for (const contact of contactsByLeadUid.get(leadUid) || []) {
      if (contact.type === "email" || contact.value.includes("@")) { const email = normalizeEmail(contact.value); if (email) suppressedEmails.add(email); }
      else { const phone = normalizePhone(contact.value); if (phone) suppressedPhones.add(phone); }
    }
  }

  for (const row of inboxState.rows) {
    if (row.raw[0]) candidateIds.add(clean(row.raw[0]));
    if (row.raw[2]) packetHashes.add(clean(row.raw[2]));
    if (row.raw[3]) idemKeys.add(clean(row.raw[3]));
    if (row.raw[12]) domains.add(normalizeHost(row.raw[12]));
    if (row.raw[11]) names.add(normalizeName(row.raw[11]));
    if (row.raw[31]) emails.add(normalizeEmail(row.raw[31]));
    if (row.raw[33]) phones.add(normalizePhone(row.raw[33]));
  }
  return { domains,names,emails,phones,fingerprints,suppressedLeadUids,suppressedDomains,suppressedNames,suppressedEmails,suppressedPhones,suppressedFingerprints,candidateIds,idemKeys,packetHashes };
}
function duplicateGate(identity, candidate) {
  return identity.domains.has(candidate.host) || identity.names.has(normalizeName(candidate.businessName)) ||
    Boolean(candidate.email && identity.emails.has(normalizeEmail(candidate.email))) || Boolean(candidate.phone && identity.phones.has(normalizePhone(candidate.phone)));
}
function suppressionGate(identity, candidate) {
  return Boolean(
    (candidate.leadUid && identity.suppressedLeadUids.has(candidate.leadUid)) ||
    (candidate.fingerprint && identity.suppressedFingerprints.has(candidate.fingerprint)) ||
    identity.suppressedDomains.has(candidate.host) || identity.suppressedNames.has(normalizeName(candidate.businessName)) ||
    (candidate.email && identity.suppressedEmails.has(normalizeEmail(candidate.email))) ||
    (candidate.phone && identity.suppressedPhones.has(normalizePhone(candidate.phone)))
  );
}

function suppressionContractSelfTest() {
  const leadHeaders = ["Lead UID","Business name","Normalized name","Domain","Canonical homepage","Primary email","Primary phone","Fingerprint"];
  const contactHeaders = ["Contact UID","Lead UID","Business name","Contact type","Raw value","Normalized value","Contact role/name","Email class","Domain match","Validation status","Public source","Channel status","Do not contact","Last contacted","Source","Notes"];
  const leadData = { "Lead UID":"LB-0032","Business name":"Miami Elegance Medspa","Normalized name":"miami elegance medspa","Domain":"miamielegance.com","Canonical homepage":"https://miamielegance.com/","Primary email":"info@miamielegance.com","Primary phone":"+13059927667","Fingerprint":"c68b52c505f020ff" };
  const leadState = { headers: leadHeaders, rows: [{ raw: leadHeaders.map(h => leadData[h] || ""), data: leadData }] };
  const contactData = { "Contact UID":"LB-0032-C-02","Lead UID":"LB-0032","Business name":"Miami Elegance Medspa","Contact type":"Email","Raw value":"annette@miamielegance.com","Normalized value":"annette@miamielegance.com" };
  const contactState = { headers: contactHeaders, rows: [{ raw: contactHeaders.map(h => contactData[h] || ""), data: contactData }] };
  const suppressionData = Object.fromEntries(SUPPRESSION_HEADERS.map(h => [h, ""]));
  Object.assign(suppressionData, { "Suppression UID":"SUP-LB-0032","Lead UID":"LB-0032","Business name":"Miami Elegance Medspa","Scope":"Lead + domain + known contacts","Fingerprint":"c68b52c505f020ff" });
  const suppressionState = { headers: [...SUPPRESSION_HEADERS], rows: [{ raw: SUPPRESSION_HEADERS.map(h => suppressionData[h] || ""), data: suppressionData }] };
  const inboxState = { headers: [...SIGNAL_HEADERS], rows: [] };
  const identity = buildIdentityIndexes(leadState, contactState, suppressionState, inboxState);
  const mustBlock = [
    { leadUid:"LB-0032", host:"new.example", businessName:"x" },
    { fingerprint:"c68b52c505f020ff", host:"new.example", businessName:"x" },
    { host:"miamielegance.com", businessName:"x" },
    { host:"new.example", businessName:"x", email:"info@miamielegance.com" },
    { host:"new.example", businessName:"x", email:"annette@miamielegance.com" },
    { host:"new.example", businessName:"x", phone:"+13059927667" }
  ];
  if (!mustBlock.every(candidate => suppressionGate(identity, candidate))) throw new Error("SUPPRESSION_SELF_TEST_FALSE_NEGATIVE");
  if (suppressionGate(identity, { host:"clean-example.com", businessName:"Clean Example", email:"hello@clean-example.com", phone:"+15125550000" })) throw new Error("SUPPRESSION_SELF_TEST_FALSE_POSITIVE");
  return "PASS";
}

async function loadIdentityState(sheets) {
  const [leads, contacts, suppression, inbox] = await Promise.all([
    sheets.objects(LEADS_TAB, "BD", 1500), sheets.objects(CONTACTS_TAB, "P", 2500), sheets.objects(SUPPRESSION_TAB, "K", 2500), sheets.objects(SIGNAL_TAB, "AZ", 1200)
  ]);
  if (leads.headers.length !== 56) throw new Error(`LEADS_SCHEMA_${leads.headers.length}`);
  requireHeaders(leads.headers, ["Lead UID","Business name","Normalized name","Domain","Canonical homepage","Primary email","Primary phone","Fingerprint"], "LEADS");
  if (contacts.headers.length !== 16) throw new Error(`CONTACTS_SCHEMA_${contacts.headers.length}`);
  requireHeaders(contacts.headers, ["Lead UID","Contact type","Raw value","Normalized value"], "CONTACTS");
  assertHeaders(suppression.headers, SUPPRESSION_HEADERS, "SUPPRESSION");
  assertHeaders(inbox.headers, SIGNAL_HEADERS, "SIGNAL_INBOX");
  const identity = buildIdentityIndexes(leads, contacts, suppression, inbox);
  return { leads, contacts, suppression, inbox, identity };
}

function dataLinesJson(text) {
  const candidates = [text, ...String(text).split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim())].filter(Boolean);
  for (let i = candidates.length - 1; i >= 0; i -= 1) { try { return JSON.parse(candidates[i]); } catch {} }
  return null;
}
class McpClient {
  constructor(url) { this.url = url; this.sessionId = ""; this.id = 0; this.tools = []; }
  async rpc(method, params, notification = false) {
    const request = { jsonrpc:"2.0", method }; if (!notification) request.id = ++this.id; if (params !== undefined) request.params = params;
    const headers = { "content-type":"application/json", accept:"application/json, text/event-stream" }; if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const response = await fetch(this.url, { method:"POST", headers, body:JSON.stringify(request) });
    if (response.headers.get("mcp-session-id")) this.sessionId = response.headers.get("mcp-session-id");
    const text = await response.text(); if (!response.ok) throw new Error(`MCP_HTTP_${response.status}`); if (notification && !text) return null;
    const payload = dataLinesJson(text); if (!payload) throw new Error("MCP_INVALID_RESPONSE"); if (payload.error) throw new Error(`MCP_RPC_${payload.error.code || "ERROR"}`); return payload.result ?? payload;
  }
  async connect() {
    await this.rpc("initialize", { protocolVersion:"2025-06-18", capabilities:{}, clientInfo:{ name:"client-acquisition-v2", version:"0.2.0" } });
    await this.rpc("notifications/initialized", undefined, true);
    let cursor; for (let page=0; page<4; page+=1) { const result = await this.rpc("tools/list", cursor ? { cursor } : {}); if (Array.isArray(result?.tools)) this.tools.push(...result.tools); cursor = result?.nextCursor; if (!cursor) break; }
    if (!this.tools.length) throw new Error("MCP_NO_TOOLS"); return this.tools;
  }
  pickSearchTool() {
    const scored = this.tools.map(tool => { const text=`${tool.name||""} ${tool.description||""}`.toLowerCase(); const props=tool?.inputSchema?.properties||{}; const has=["query","q","search_query","search","text","keywords","terms"].some(k=>props[k]); let score=has?20:-100; if (/search|discover|web|local|business|place|serp/.test(text)) score+=8; if (/twitter|x\.com|reddit|youtube|instagram|tiktok/.test(text)) score-=20; return {tool,score}; }).sort((a,b)=>b.score-a.score);
    if (!scored.length || scored[0].score < 20) throw new Error("MCP_BUSINESS_SEARCH_TOOL_MISSING"); return scored[0].tool;
  }
  argsForQuery(tool, query) {
    const props=tool?.inputSchema?.properties||{}, args={}; const key=["query","q","search_query","search","text","keywords","terms"].find(k=>props[k]); if (!key) throw new Error("MCP_QUERY_SCHEMA_MISSING"); args[key]=query;
    for (const k of ["limit","max_results","count","num_results"]) if (props[k] && /integer|number/.test(String(props[k].type))) args[k]=8; return args;
  }
  async call(tool,args){ return this.rpc("tools/call",{name:tool.name,arguments:args}); }
}
function flattenStrings(value,out=[],depth=0){ if(depth>7||out.length>500)return out; if(typeof value==="string"){out.push(value);return out;} if(Array.isArray(value)){for(const item of value)flattenStrings(item,out,depth+1);return out;} if(value&&typeof value==="object")for(const item of Object.values(value))flattenStrings(item,out,depth+1); return out; }
function extractUrls(value){ return [...new Set((flattenStrings(value).join("\n").match(/https?:\/\/[^\s"'<>\]\[)}]+/gi)||[]).map(url=>url.replace(/[.,;:!?]+$/, "")))]; }
function extractSearchCandidates(result){ const candidates=[]; for(const raw of extractUrls(result)){ const url=normalizeUrl(raw); if(!url)continue; const host=new URL(url).hostname.toLowerCase().replace(/^www\./,""); if(BLOCKED_HOSTS.has(host)||/\.(pdf|jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(url))continue; candidates.push({sourceUrl:url,homepage:`${new URL(url).origin}/`,host:normalizeHost(url)}); } const seen=new Set(); return candidates.filter(c=>c.host&&!seen.has(c.host)&&seen.add(c.host)).slice(0,MAX_BUSINESSES); }
function decodeEntities(value){ return String(value).replace(/&amp;/gi,"&").replace(/&#39;/gi,"'").replace(/&quot;/gi,'"').replace(/&lt;/gi,"<").replace(/&gt;/gi,">"); }
function stripHtml(html){ return decodeEntities(String(html).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ")); }
function metaContent(html,name){ const patterns=[new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,"i"),new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,"i")]; for(const p of patterns){const m=String(html).match(p);if(m)return decodeEntities(m[1]);} return ""; }
function pageTitle(html){ const m=String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m?clean(stripHtml(m[1])):""; }
function canonicalUrl(html,base){ const m=String(html).match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']/i)||String(html).match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["']/i); if(!m)return ""; try{return new URL(decodeEntities(m[1]),base).toString();}catch{return "";} }
function extractEmails(html){ const found=new Set(); for(const m of String(html).matchAll(/mailto:([^?"'<>\s]+)/gi))found.add(normalizeEmail(decodeURIComponent(m[1]))); for(const m of stripHtml(html).matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi))found.add(normalizeEmail(m[0])); return [...found].filter(email=>!/example\.(com|org)|sentry|cloudflare|wixpress|wordpress/i.test(email)); }
function extractPhones(html){ const found=new Set(); for(const m of stripHtml(html).matchAll(/(?:\+?1[\s().-]*)?(?:\d{3}|\(\d{3}\))[\s.-]*\d{3}[\s.-]*\d{4}/g)){const p=normalizePhone(m[0]);if(p.length>=12)found.add(p);} return [...found]; }
function highIntentLinks(html,base){ const links=[],re=/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi; for(const m of String(html).matchAll(re)){const label=clean(stripHtml(m[2]));if(!/(book|appointment|schedule|contact|consult|reserve|get started|request)/i.test(label))continue;try{const u=new URL(decodeEntities(m[1]),base);if(!/^https?:$/.test(u.protocol)||normalizeHost(u.toString())!==normalizeHost(base))continue;links.push({label:label.slice(0,120),url:normalizeUrl(u.toString())});}catch{}} const seen=new Set(); return links.filter(l=>l.url&&!seen.has(l.url)&&seen.add(l.url)).slice(0,2); }
async function fetchPage(url){ const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);try{const response=await fetch(url,{redirect:"follow",signal:controller.signal,headers:{"user-agent":"Mozilla/5.0 compatible; ClientAcquisitionV2/1.0"}});const type=response.headers.get("content-type")||"",html=type.includes("text/html")?await response.text():"";return{requestedUrl:url,finalUrl:response.url||url,status:response.status,html:html.slice(0,120000),ok:response.ok};}finally{clearTimeout(timer);} }
function inferBusinessName(page,host){ const og=metaContent(page.html,"og:site_name"),title=pageTitle(page.html).split(/[|–—-]/)[0]; return clean(og||title||host.split(".")[0].replace(/[-_]+/g," ")).slice(0,180); }
function concreteFinding(page,targetPage=null){ const text=stripHtml(page.html); if(/\blorem ipsum\b|\bplaceholder text\b|\byour business name here\b|\bsample text\b/i.test(text))return{type:"PUBLIC_PLACEHOLDER_CONTENT",summary:"Public commercial page exposes placeholder/sample content.",evidenceUrl:page.finalUrl}; const canonical=canonicalUrl(page.html,page.finalUrl); if(canonical&&normalizeHost(canonical)&&normalizeHost(canonical)!==normalizeHost(page.finalUrl))return{type:"CANONICAL_DOMAIN_CONFLICT",summary:`Public page canonical points to a different domain (${normalizeHost(canonical)}).`,evidenceUrl:page.finalUrl}; if(targetPage&&targetPage.status>=400&&targetPage.status<500)return{type:"BROKEN_HIGH_INTENT_INTERNAL_LINK",summary:`High-intent internal destination returns HTTP ${targetPage.status}.`,evidenceUrl:targetPage.requestedUrl}; return null; }

async function discoverCandidates(env){ if(!env.KEENABLE_MCP_URL)throw new Error("KEENABLE_MCP_URL_MISSING"); const mcp=new McpClient(env.KEENABLE_MCP_URL);await mcp.connect();const tool=mcp.pickSearchTool(),all=[];for(const query of PILOT.queries){all.push(...extractSearchCandidates(await mcp.call(tool,mcp.argsForQuery(tool,query))));if(all.length>=MAX_BUSINESSES)break;}const seen=new Set();return{tool:tool.name,candidates:all.filter(c=>!seen.has(c.host)&&seen.add(c.host)).slice(0,MAX_BUSINESSES)}; }
async function preflightCandidates(candidates,identity){ let pageReads=0,deepSites=0;const inspected=[];for(const seed of candidates.slice(0,MAX_BUSINESSES)){if(deepSites>=MAX_DEEP_SITES||pageReads>=MAX_PAGE_READS)break;if(identity.domains.has(seed.host)||identity.suppressedDomains.has(seed.host)){inspected.push({host:seed.host,outcome:"SKIP_KNOWN_OR_SUPPRESSED"});continue;}let homepage;try{homepage=await fetchPage(seed.homepage);pageReads+=1;}catch{inspected.push({host:seed.host,outcome:"FETCH_FAILED"});continue;}if(!homepage.ok||!homepage.html){inspected.push({host:seed.host,outcome:`HOMEPAGE_HTTP_${homepage.status}`});continue;}deepSites+=1;if(!VERTICAL_TERMS.test(stripHtml(homepage.html).slice(0,24000))){inspected.push({host:seed.host,outcome:"VERTICAL_MISMATCH"});continue;}const businessName=inferBusinessName(homepage,seed.host),emails=extractEmails(homepage.html),phones=extractPhones(homepage.html),links=highIntentLinks(homepage.html,homepage.finalUrl);const candidate={...seed,homepage:`${new URL(homepage.finalUrl).origin}/`,host:normalizeHost(homepage.finalUrl),businessName,email:emails.find(e=>normalizeHost(e.split("@")[1])===normalizeHost(homepage.finalUrl))||emails[0]||"",phone:phones[0]||"",contactRoute:links[0]?.url||""};if(duplicateGate(identity,candidate)){inspected.push({host:candidate.host,businessName,outcome:"DUPLICATE"});continue;}if(suppressionGate(identity,candidate)){inspected.push({host:candidate.host,businessName,outcome:"SUPPRESSED"});continue;}let finding=concreteFinding(homepage);if(!finding&&links.length&&pageReads<MAX_PAGE_READS){try{const target=await fetchPage(links[0].url);pageReads+=1;finding=concreteFinding(homepage,target);if(!candidate.email&&target.html)candidate.email=extractEmails(target.html)[0]||"";if(!candidate.phone&&target.html)candidate.phone=extractPhones(target.html)[0]||"";}catch{}}if(finding){inspected.push({host:candidate.host,businessName,outcome:"QUALIFIED",finding:finding.type});return{candidate,finding,inspected,pageReads,deepSites};}inspected.push({host:candidate.host,businessName,outcome:"NO_CONCRETE_FINDING"});}return{candidate:null,finding:null,inspected,pageReads,deepSites}; }
async function makePacket(runId,candidate,finding,env){ const observedAt=new Date().toISOString(),stable=`${candidate.host}|${finding.type}|${normalizeUrl(finding.evidenceUrl)}`,idHash=await sha256(stable),candidateId=`ACQ2-${idHash.slice(0,16)}`,idempotencyKey=`acq2|${idHash}`,contactScore=candidate.email?100:candidate.phone?80:candidate.contactRoute?60:0;const values=[candidateId,runId,"",idempotencyKey,observedAt,observedAt,"OPEN_WEB_BUSINESS_DISCOVERY",candidate.sourceUrl,"TARGETED_LOCAL_DISCOVERY",`${PILOT.vertical} · ${PILOT.metro}, ${PILOT.state}`,candidate.businessName,normalizeName(candidate.businessName),candidate.host,candidate.homepage,PILOT.metro,PILOT.state,"",PILOT.vertical,"100","100","100","100",String(contactScore),"100","PASS",finding.type,finding.summary,finding.evidenceUrl,observedAt,"DIRECT_HTTP_PUBLIC_PAGE","VERIFIED_PUBLIC_OBSERVATION",candidate.email||"",candidate.email?(normalizeHost(candidate.email.split("@")[1])===candidate.host?"PUBLIC_DOMAIN_MATCHED_EMAIL":"PUBLIC_EMAIL"):"",candidate.phone||"",candidate.phone?"PUBLIC_SITE_PHONE":"",candidate.contactRoute||"",candidate.email?"HIGH":candidate.phone?"MEDIUM":candidate.contactRoute?"LOW":"NONE","PASS","PASS","READY_FOR_GPT",env.CF_VERSION_METADATA?.id||"UNPROMOTED_BUILD",observedAt]; if(values.length!==42)throw new Error(`PACKET_MACHINE_COLUMNS_${values.length}`);const packetHash=await sha256(values.map((v,i)=>i===2?"":v).join("\u241f"));values[2]=packetHash;return{candidateId,idempotencyKey,packetHash,values}; }

async function runV2(env,{writeRequested=false}={}){
  suppressionContractSelfTest();
  const runId=`acq2-${Date.now()}-${crypto.randomUUID().slice(0,8)}`,sheets=new SheetsClient(env),state=await loadIdentityState(sheets),discovery=await discoverCandidates(env),preflight=await preflightCandidates(discovery.candidates,state.identity);
  const summary={status:"CANARY_NO_PROMOTION",runId,pilot:PILOT,discoveryTool:discovery.tool,businessesInspected:Math.min(discovery.candidates.length,MAX_BUSINESSES),deepPreflightSites:preflight.deepSites,candidateSitePageReads:preflight.pageReads,inspected:preflight.inspected,readyForGpt:0,written:0,replayDuplicateWrites:0,writeEnabled:String(env.CLIENT_ACQUISITION_V2_WRITE_ENABLED||"false").toLowerCase()==="true",schedulerRequired:false,suppressionContract:"PASS",suppressedLeadCount:state.identity.suppressedLeadUids.size};
  if(!preflight.candidate||!preflight.finding)return summary;const packet=await makePacket(runId,preflight.candidate,preflight.finding,env);if(state.identity.candidateIds.has(packet.candidateId)||state.identity.idemKeys.has(packet.idempotencyKey)||state.identity.packetHashes.has(packet.packetHash))return{...summary,status:"CANARY_IDEMPOTENT_EXISTING",candidateId:packet.candidateId};summary.readyForGpt=1;summary.candidateId=packet.candidateId;summary.findingType=preflight.finding.type;summary.business=preflight.candidate.businessName;if(!writeRequested||!summary.writeEnabled)return{...summary,status:"READY_FOR_GPT_DRY_RUN"};
  const fresh=await loadIdentityState(sheets);if(duplicateGate(fresh.identity,preflight.candidate))return{...summary,status:"CANARY_DUPLICATE_RACE"};if(suppressionGate(fresh.identity,preflight.candidate))return{...summary,status:"CANARY_SUPPRESSION_RACE"};if(fresh.identity.candidateIds.has(packet.candidateId)||fresh.identity.idemKeys.has(packet.idempotencyKey)||fresh.identity.packetHashes.has(packet.packetHash))return{...summary,status:"CANARY_IDEMPOTENT_RACE"};const rowNumber=fresh.inbox.rows.length+2,range=await sheets.writeRow(SIGNAL_TAB,rowNumber,packet.values),readback=await sheets.values(range),exact=readback.length===1&&packet.values.every((value,index)=>clean(readback[0][index])===clean(value));if(!exact)throw new Error("SIGNAL_INBOX_READBACK_MISMATCH");summary.written=1;summary.status="READY_FOR_GPT_WRITTEN";summary.writeRange=range;const replay=await loadIdentityState(sheets);if(!(replay.identity.candidateIds.has(packet.candidateId)&&replay.identity.idemKeys.has(packet.idempotencyKey)&&replay.identity.packetHashes.has(packet.packetHash)))throw new Error("IDEMPOTENCY_REPLAY_READBACK_FAILED");summary.replayDuplicateWrites=0;summary.idempotency="PASS";return summary;
}

function controlSecrets(env){ return [env.RESEARCH_CONTROL_SECRET,env.MANUAL_RUN_TOKEN].filter(Boolean).map(String); }
function suppliedSecrets(request){ const auth=request.headers.get("authorization")||"",bearer=/^Bearer\s+(.+)$/i.exec(auth)?.[1]||"";return [request.headers.get("x-run-token"),request.headers.get("x-research-control-secret"),request.headers.get("x-control-secret"),bearer].filter(Boolean).map(String); }
function authorized(request,env){ const expected=controlSecrets(env),supplied=suppliedSecrets(request);return expected.length>0&&supplied.some(value=>expected.includes(value)); }

const worker={
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==="/client-acquisition-v2/health"&&request.method==="GET"){
      let suppressionContract="PASS";try{suppressionContractSelfTest();}catch(error){suppressionContract=`FAIL:${clean(error?.message||error)}`;}
      return json({worker:"outreach-x-signal-scout",path:"CLIENT_ACQUISITION_V2",state:"SAFE_BUILD_HARDENED",pilot:PILOT,scheduler:"disabled_by_config",stagingWrite:String(env.CLIENT_ACQUISITION_V2_WRITE_ENABLED||"false").toLowerCase()==="true"?"armed_token_protected":"disabled",manualAuthConfigured:controlSecrets(env).length>0,suppressionContract,legacyRunPreserved:true,workerVersion:env.CF_VERSION_METADATA?.id||"unknown"});
    }
    if(url.pathname==="/client-acquisition-v2/run"&&request.method==="POST"){
      if(!authorized(request,env))return json({error:"not_found"},404);
      try{return json(await runV2(env,{writeRequested:url.searchParams.get("write")==="1"}),200);}catch(error){return json({status:"ABORTED",error:clean(error?.message||error).slice(0,240)},502);}
    }
    if(typeof legacyWorker?.fetch==="function")return legacyWorker.fetch(request,env,ctx);
    return json({error:"not_found"},404);
  },
  async scheduled(controller,env,ctx){ if(typeof legacyWorker?.scheduled==="function")return legacyWorker.scheduled(controller,env,ctx); }
};
export default worker;
