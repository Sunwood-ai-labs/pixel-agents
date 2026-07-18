import test from 'node:test';
import assert from 'node:assert/strict';
import { ReporterClient } from '../src/client.js';

test('publishes an authenticated V1 update', async () => {
  const calls = [];
  const client = new ReporterClient({
    serverUrl: 'http://hub:3100/',
    token: 'secret-token',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  await client.publish('pc-a', 'worker-1', {
    displayName: 'Worker',
    task: 'Test',
    status: 'active',
    heartbeatTtlSeconds: 90,
  });
  assert.equal(calls[0].url, 'http://hub:3100/api/remote/v1/hosts/pc-a/agents/worker-1');
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-token');
});

test('redacts the bearer token from API errors', async () => {
  const client = new ReporterClient({
    serverUrl: 'http://hub:3100',
    token: 'do-not-print',
    fetchImpl: async () => new Response('token=do-not-print', { status: 500 }),
  });
  await assert.rejects(client.list(), (error) => {
    assert.doesNotMatch(error.message, /do-not-print/);
    assert.match(error.message, /REDACTED/);
    return true;
  });
});
