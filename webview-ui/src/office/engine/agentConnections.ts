import type { Character } from '../types.js';

/** Resolve only direct parent-child links; grandchildren connect through their parent. */
export function computeAgentConnections(
  characters: Character[],
): Array<{ parent: Character; child: Character }> {
  const byId = new Map(characters.map((character) => [character.id, character]));
  const connections: Array<{ parent: Character; child: Character }> = [];
  for (const child of characters) {
    if (child.leadAgentId === undefined) continue;
    const parent = byId.get(child.leadAgentId);
    if (parent) connections.push({ parent, child });
  }
  return connections;
}
