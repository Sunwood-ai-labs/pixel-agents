#!/usr/bin/env node

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const server = args.get('--server') ?? process.env.PIXEL_AGENTS_URL;
const token = process.env.PIXEL_AGENTS_REMOTE_API_TOKEN;
const hostId = args.get('--host');
const agentId = args.get('--agent');
if (!server || !token || !hostId || !agentId) {
  console.error(
    'Usage: PIXEL_AGENTS_URL=http://server:3100 PIXEL_AGENTS_REMOTE_API_TOKEN=... node remote-agent-client.mjs --host pc-a --agent worker-1 --name Worker --task "Run tests" --status active',
  );
  process.exit(2);
}

const current = args.has('--current') ? Number(args.get('--current')) : undefined;
const total = args.has('--total') ? Number(args.get('--total')) : undefined;
const parentAgentId = args.get('--parent');
const body = {
  displayName: args.get('--name') ?? agentId,
  task: args.get('--task') ?? 'Remote task',
  status: args.get('--status') ?? 'active',
  activity: args.get('--activity'),
  heartbeatTtlSeconds: Number(args.get('--ttl') ?? 90),
  ...(current !== undefined && total !== undefined
    ? { progress: { current, total, unit: args.get('--unit') } }
    : {}),
  ...(parentAgentId ? { parent: { hostId, agentId: parentAgentId } } : {}),
};

const url = `${server.replace(/\/$/, '')}/api/remote/v1/hosts/${encodeURIComponent(hostId)}/agents/${encodeURIComponent(agentId)}`;
const response = await fetch(url, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});
if (!response.ok) {
  console.error(`Pixel Agents API ${response.status}: ${await response.text()}`);
  process.exit(1);
}
console.log(JSON.stringify(await response.json(), null, 2));
