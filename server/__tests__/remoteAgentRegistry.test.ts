import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { RemoteAgentRegistry } from '../src/remoteAgentRegistry.js';

const registries: RemoteAgentRegistry[] = [];

afterEach(() => {
  for (const registry of registries.splice(0)) registry.dispose();
  vi.restoreAllMocks();
});

function registry(): { store: AgentStateStore; registry: RemoteAgentRegistry } {
  const store = new AgentStateStore();
  const value = new RemoteAgentRegistry(store, 60_000);
  registries.push(value);
  return { store, registry: value };
}

describe('RemoteAgentRegistry', () => {
  it('idempotently upserts remote progress and safe display metadata', () => {
    const { store, registry: remote } = registry();
    const first = remote.upsert('pc-a', 'worker-1', {
      displayName: 'Worker\nOne',
      task: 'Run tests',
      status: 'active',
      activity: 'Testing',
      progress: { current: 7, total: 10, unit: 'tests' },
    });
    const second = remote.upsert('pc-a', 'worker-1', {
      displayName: 'Worker One',
      task: 'Run tests',
      status: 'active',
      activity: 'Testing',
      progress: { current: 8, total: 10, unit: 'tests' },
    });

    expect(second.localAgentId).toBe(first.localAgentId);
    expect(store.size).toBe(1);
    expect(store.get(first.localAgentId)).toMatchObject({
      providerId: 'remote',
      folderName: 'REMOTE · Worker One',
      remoteProgress: { current: 8, total: 10, unit: 'tests' },
    });
  });

  it('resolves a child that arrives before its parent', () => {
    const { store, registry: remote } = registry();
    const child = remote.upsert('pc-a', 'child', {
      displayName: 'Child',
      task: 'Review',
      status: 'active',
      parent: { hostId: 'pc-a', agentId: 'lead' },
    });
    const lead = remote.upsert('pc-a', 'lead', {
      displayName: 'Lead',
      task: 'Coordinate',
      status: 'active',
    });

    expect(store.get(child.localAgentId)?.leadAgentId).toBe(lead.localAgentId);
  });

  it('marks an expired live agent offline before removing it after retention', () => {
    const { store, registry: remote } = registry();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const agent = remote.upsert('pc-a', 'worker', {
      displayName: 'Worker',
      task: 'Build',
      status: 'active',
      heartbeatTtlSeconds: 15,
    });

    remote.sweep(now + 16_000);
    expect(store.get(agent.localAgentId)).toMatchObject({
      remoteConnectionState: 'offline',
      isWaiting: true,
    });

    remote.sweep(now + 24 * 60 * 60 * 1000 + 17_000);
    expect(store.has(agent.localAgentId)).toBe(false);
  });
});
