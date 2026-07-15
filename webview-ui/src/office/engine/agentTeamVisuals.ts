import { AGENT_TEAM_COLORS } from '../../constants.js';
import type { Character } from '../types.js';

export { AGENT_TEAM_COLORS } from '../../constants.js';

export interface AgentTeamVisual {
  key: string;
  label: string;
  color: string;
  rootId: number;
  memberCount: number;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function resolveRootId(character: Character, byId: Map<number, Character>): number {
  const visited = new Set<number>();
  let current = character;
  while (current.leadAgentId !== undefined) {
    if (visited.has(current.id)) return Math.min(...visited, current.id);
    visited.add(current.id);
    const parent = byId.get(current.leadAgentId);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

/** Build lineage groups. Separate roots stay distinct even when both are Codex. */
export function computeAgentTeamVisuals(characters: Character[]): Map<number, AgentTeamVisual> {
  const byId = new Map(characters.map((character) => [character.id, character]));
  const rootById = new Map<number, number>();
  const membersByRoot = new Map<number, Character[]>();

  for (const character of characters) {
    const rootId = resolveRootId(character, byId);
    rootById.set(character.id, rootId);
    if (character.isActive === false) continue;
    const members = membersByRoot.get(rootId) ?? [];
    members.push(character);
    membersByRoot.set(rootId, members);
  }

  // Keep the lead visible in the active desk island even when it is waiting
  // while one or more descendants are still working.
  for (const [rootId, members] of membersByRoot) {
    const root = byId.get(rootId);
    if (root && !members.some((member) => member.id === rootId)) members.unshift(root);
  }

  const groupedRoots = [...membersByRoot.entries()]
    .filter(([, members]) => members.length > 1)
    .sort(([a], [b]) => a - b);
  const result = new Map<number, AgentTeamVisual>();

  groupedRoots.forEach(([rootId, members], index) => {
    const root = byId.get(rootId) ?? members[0];
    const key = `${root.teamName ?? 'lineage'}:${rootId}`;
    const visual: AgentTeamVisual = {
      key,
      label: `T${index + 1}`,
      color: AGENT_TEAM_COLORS[hashString(key) % AGENT_TEAM_COLORS.length],
      rootId,
      memberCount: members.length,
    };
    for (const member of members) result.set(member.id, visual);
  });

  return result;
}
