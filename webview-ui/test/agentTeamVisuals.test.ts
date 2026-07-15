import { describe, expect, it } from 'vitest';

import {
  AGENT_TEAM_COLORS,
  computeAgentTeamVisuals,
} from '../src/office/engine/agentTeamVisuals.js';
import type { Character } from '../src/office/types.js';

function character(id: number, leadAgentId?: number, teamName = 'Codex'): Character {
  return { id, leadAgentId, teamName } as Character;
}

describe('computeAgentTeamVisuals', () => {
  it('groups nested descendants under the same root color and label', () => {
    const visuals = computeAgentTeamVisuals([character(1), character(2, 1), character(3, 2)]);
    expect(visuals.get(1)).toEqual(visuals.get(2));
    expect(visuals.get(2)).toEqual(visuals.get(3));
    expect(visuals.get(1)?.label).toBe('T1');
  });

  it('groups native subagents linked only by parentAgentId into the same frame', () => {
    const root = character(1);
    const child = character(2);
    child.parentAgentId = 1;
    child.isSubagent = true;
    const grandchild = character(3);
    grandchild.parentAgentId = 2;
    grandchild.isSubagent = true;
    const visuals = computeAgentTeamVisuals([root, child, grandchild]);
    expect(visuals.get(1)).toEqual(visuals.get(2));
    expect(visuals.get(2)).toEqual(visuals.get(3));
    expect(visuals.get(1)?.memberCount).toBe(3);
  });

  it('keeps separate roots distinct even when both belong to Codex', () => {
    const visuals = computeAgentTeamVisuals([
      character(1),
      character(2, 1),
      character(10),
      character(11, 10),
    ]);
    expect(visuals.get(1)?.key).not.toBe(visuals.get(10)?.key);
    expect(visuals.get(1)?.label).toBe('T1');
    expect(visuals.get(10)?.label).toBe('T2');
  });

  it('does not frame unrelated solo agents and terminates cyclic lineage', () => {
    const solo = character(5);
    expect(computeAgentTeamVisuals([solo])).toHaveLength(0);
    const cyclic = computeAgentTeamVisuals([character(1, 2), character(2, 1)]);
    expect(cyclic.get(1)?.color).toBe(cyclic.get(2)?.color);
    expect(AGENT_TEAM_COLORS).toContain(cyclic.get(1)?.color as (typeof AGENT_TEAM_COLORS)[number]);
  });

  it('omits completed descendants from an active desk island', () => {
    const root = character(1);
    root.isActive = true;
    const activeChild = character(2, 1);
    activeChild.isActive = true;
    const doneChild = character(3, 1);
    doneChild.isActive = false;
    const visuals = computeAgentTeamVisuals([root, activeChild, doneChild]);
    expect(visuals.has(root.id)).toBe(true);
    expect(visuals.has(activeChild.id)).toBe(true);
    expect(visuals.has(doneChild.id)).toBe(false);
  });
});
