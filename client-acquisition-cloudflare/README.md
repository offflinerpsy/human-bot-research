# Client Acquisition V2 — Cloudflare deployment source

This directory is the durable Git source for the CLIENT ACQUISITION V2 Cloudflare Worker migration.

Target Worker: `outreach-x-signal-scout`
Cloudflare account: `9ca406897e026df2856883641fec0732`

Architecture boundary:

`ChatGPT Web controller/intelligence -> GitHub -> Cloudflare Workers Builds -> Cloudflare Worker -> Google Sheets -> ChatGPT Web`

Personal/external Codex or Hermes is not a standing runtime dependency. A one-time authenticated bootstrap may export the exact currently deployed Worker source/config into this directory. After Git/Workers Builds cutover, code changes are made through GitHub and deployed by Cloudflare Workers Builds.

Safety:
- Never commit secret values.
- Preserve existing runtime secrets in Cloudflare.
- Preserve the `OUTREACH_STATE` binding and existing production bindings.
- Keep autonomous acquisition/research schedules disabled until an explicit canary PASS.
- Existing production senders remain disabled during migration.
