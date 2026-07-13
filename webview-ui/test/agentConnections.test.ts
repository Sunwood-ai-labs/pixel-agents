import { describe, expect, it } from 'vitest';

import { computeAgentConnections } from '../src/office/engine/agentConnections.js';
import type { Character } from '../src/office/types.js';

function character(id: number, leadAgentId?: number): Character {
  return { id, leadAgentId } as Character;
}

describe('computeAgentConnections', () => {
  it('preserves direct parent-child and nested child-grandchild links', () => {
    const root = character(1);
    const child = character(2, 1);
    const grandchild = character(3, 2);

    expect(computeAgentConnections([root, child, grandchild])).toEqual([
      { parent: root, child },
      { parent: child, child: grandchild },
    ]);
  });

  it('ignores a relation when its parent is not visible', () => {
    expect(computeAgentConnections([character(3, 2)])).toEqual([]);
  });
});
