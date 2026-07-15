import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findPath } from '../src/office/layout/tileMap.js';
import type { TileType as TileTypeValue } from '../src/office/types.js';

interface PlacedItem {
  uid?: string;
  id?: string;
  col: number;
  row: number;
  [key: string]: unknown;
}

interface Layout {
  cols: number;
  rows: number;
  layoutRevision?: number;
  tiles: unknown[];
  tileColors?: unknown[];
  furniture: PlacedItem[];
  pets?: PlacedItem[];
}

function load(name: string): Layout {
  return JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'public/assets', name), 'utf8'),
  ) as Layout;
}

function expectRowsDuplicated(source: Layout, expanded: Layout, values: keyof Layout): void {
  const sourceValues = source[values] as unknown[];
  const expandedValues = expanded[values] as unknown[];
  const connectorCells = new Set(
    [14, 15, 16, 17].flatMap((row) => [19, 20, 21].map((col) => `${row},${col}`)),
  );
  for (let row = 0; row < source.rows; row++) {
    for (let col = 0; col < source.cols; col++) {
      const expected = sourceValues[row * source.cols + col];
      for (const targetCol of [col, source.cols + col]) {
        if (connectorCells.has(`${row},${targetCol}`)) continue;
        expect(expandedValues[row * expanded.cols + targetCol]).toEqual(expected);
      }
    }
  }
}

describe('bundled office section replication', () => {
  it('duplicates the complete two-section layout horizontally', () => {
    const source = load('default-layout-1.json');
    const expanded = load('default-layout-2.json');

    expect(expanded.layoutRevision).toBe(2);
    expect(expanded.cols).toBe(source.cols * 2);
    expect(expanded.rows).toBe(source.rows);
    expect(expanded.tiles).toHaveLength(expanded.cols * expanded.rows);
    expectRowsDuplicated(source, expanded, 'tiles');
    if (source.tileColors) {
      expect(expanded.tileColors).toHaveLength(expanded.cols * expanded.rows);
      expectRowsDuplicated(source, expanded, 'tileColors');
    }

    expect(expanded.furniture).toHaveLength(source.furniture.length * 2);
    expect(new Set(expanded.furniture.map((item) => item.uid)).size).toBe(
      expanded.furniture.length,
    );
    for (const item of source.furniture) {
      expect(expanded.furniture).toContainEqual(item);
      expect(expanded.furniture).toContainEqual({
        ...item,
        uid: `${item.uid}--zone-copy-2`,
        col: item.col + source.cols,
      });
    }

    const sourcePets = source.pets ?? [];
    expect(expanded.pets ?? []).toHaveLength(sourcePets.length * 2);
    for (const pet of sourcePets) {
      expect(expanded.pets).toContainEqual(pet);
      expect(expanded.pets).toContainEqual({
        ...pet,
        id: `${pet.id}--zone-copy-2`,
      });
    }

    const tileMap = Array.from({ length: expanded.rows }, (_, row) =>
      expanded.tiles.slice(row * expanded.cols, (row + 1) * expanded.cols),
    ) as TileTypeValue[][];
    expect(findPath(1, 14, 39, 14, tileMap, new Set())).not.toHaveLength(0);

    for (const row of [14, 15, 16, 17]) {
      expect(tileMap[row][19]).not.toBe(0);
      expect(tileMap[row][20]).not.toBe(255);
      expect(tileMap[row][21]).not.toBe(0);
    }
  });
});
