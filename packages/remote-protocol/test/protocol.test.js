import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteAgentPath, validateRemoteAgentUpdate } from '../src/index.js';

test('builds the V1 agent path', () => {
  assert.equal(
    remoteAgentPath('eclipse02', 'worker-1'),
    '/api/remote/v1/hosts/eclipse02/agents/worker-1',
  );
});

test('accepts a complete update', () => {
  const update = {
    displayName: 'Worker',
    task: 'Run tests',
    status: 'active',
    activity: 'Testing',
    progress: { current: 2, total: 5, unit: 'tests' },
    parent: { hostId: 'eclipse02', agentId: 'lead' },
    heartbeatTtlSeconds: 90,
  };
  assert.equal(validateRemoteAgentUpdate(update), update);
});

test('rejects unknown fields and unsafe identifiers', () => {
  assert.throws(() => remoteAgentPath('../host', 'agent'), /hostId/);
  assert.throws(
    () =>
      validateRemoteAgentUpdate({ displayName: 'A', task: 'T', status: 'active', command: 'rm' }),
    /unknown agent update field/,
  );
});
