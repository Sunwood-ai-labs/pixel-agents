import { describe, expect, it } from 'vitest';

import type { TeamProvider } from '../../core/src/teamProvider.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { scanTeamConfigsForRemovals, setTeamProvider } from '../src/fileWatcher.js';
import type { AgentState } from '../src/types.js';

const claudeTeamProvider: TeamProvider = {
  providerId: 'claude',
  teammateSpawnTools: new Set(),
  withinTurnSubagentTools: new Set(),
  isTeammateSpawnCall: () => false,
  extractTeammateNameFromEvent: () => undefined,
  discoverTeammates: () => [],
  getTeamMetadataForSession: () => null,
  extractTeamMetadataFromRecord: () => null,
  getTeamMembers: () => null,
};

function hierarchyAgent(id: number, providerId: string): AgentState {
  return {
    id,
    providerId,
    leadAgentId: 1,
    teamName: providerId === 'codex' ? 'Codex' : 'Claude team',
    agentName: 'worker',
  } as AgentState;
}

describe('file watcher provider ownership', () => {
  it('does not remove Codex hierarchy using Claude team membership state', () => {
    setTeamProvider(claudeTeamProvider);
    const store = new AgentStateStore();
    store.set(2, hierarchyAgent(2, 'codex'));
    store.set(3, hierarchyAgent(3, 'claude'));

    expect(scanTeamConfigsForRemovals(store)).toEqual([3]);
  });
});
