# Remote Agent API

Pixel Agents can act as a central office viewer. Other PCs send authenticated agent state to the server; the office renders the remote machine, task, activity, measurable progress, parent/child links, and heartbeat freshness.

This V1 API controls the **office representation**. It does not execute shell commands or prompts on another PC. Remote command dispatch needs a separate signed worker/queue design.

## Start the central server

Generate a long token once and keep it out of shell history and source control:

```bash
openssl rand -hex 32
```

Set it on the server and listen on the LAN interface:

```bash
export PIXEL_AGENTS_REMOTE_API_TOKEN='<64-hex-character token>'
npx pixel-agents --host 0.0.0.0 --port 3100
```

The normal Claude hook token and the Remote Agent API token are separate. The generated/local values are written to `~/.pixel-agents/server.json`, which is created with owner-only permissions.

Standalone viewers can subscribe to the office, but their unauthenticated WebSocket is always read-only, including on the server PC and behind a reverse proxy. The Remote Agent API always requires its bearer token.

Do not expose plain HTTP directly to the public Internet. Prefer Tailscale or an HTTPS reverse proxy with access control. Anyone who can reach the viewer URL can see the office state; anyone with the Remote API token can create, update, list, or delete remote office agents.

## Report an agent from another PC

```bash
export PIXEL_AGENTS_URL='http://192.168.11.5:3100'
export PIXEL_AGENTS_REMOTE_API_TOKEN='<same token>'

node examples/remote-agent-client.mjs \
  --host eclipse02 \
  --agent test-worker \
  --name 'Test Worker' \
  --task 'Run integration tests' \
  --status active \
  --activity 'Testing API routes' \
  --current 7 \
  --total 12 \
  --unit tests
```

Repeat the same command as progress changes. The `PUT` is idempotent for the same `host + agent` pair and also refreshes its heartbeat. Active agents default to a 90-second lease; use `--ttl 300` for slower reporters. When the lease expires, the agent becomes `OFFLINE` and is retained for 24 hours before removal.

V1 uses last-write-wins updates and one administrator token. Use a single reporter for each `host + agent` pair, and keep it on a trusted private network. Per-PC ownership tokens and revision/instance conflict protection are future multi-tenant hardening, not V1 guarantees.

To connect a child to a parent on the same PC, first report the parent and then add `--parent <parent-agent-id>` to the child command. A child reported first is linked automatically when its parent arrives.

Valid statuses are `active`, `waiting`, and `done`. Progress is optional and must have a real total greater than zero.

## Raw HTTP API

```text
PUT    /api/remote/v1/hosts/:hostId/agents/:agentId
GET    /api/remote/v1/agents
DELETE /api/remote/v1/hosts/:hostId/agents/:agentId
```

All routes require `Authorization: Bearer <PIXEL_AGENTS_REMOTE_API_TOKEN>`.

```json
{
  "displayName": "Test Worker",
  "task": "Run integration tests",
  "status": "active",
  "activity": "Testing API routes",
  "progress": { "current": 7, "total": 12, "unit": "tests" },
  "parent": { "hostId": "eclipse02", "agentId": "lead" },
  "heartbeatTtlSeconds": 90
}
```

Identifiers accept 1-64 ASCII letters, digits, dots, underscores, and hyphens. Display strings are length-limited and control characters are removed before rendering. Unknown fields and invalid progress are rejected.
