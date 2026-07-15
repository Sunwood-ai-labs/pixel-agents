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
  zones?: Array<{ id: string; minCol: number; maxCol: number; minRow: number; maxRow: number }>;
}

function load(name: string): Layout {
  return JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'public/assets', name), 'utf8'),
  ) as Layout;
}

function expectRowsDuplicated(source: Layout, expanded: Layout, values: keyof Layout): void {
  const sourceValues = source[values] as unknown[];
  const expandedValues = expanded[values] as unknown[];
  const connectorCells = new Set<string>();
  const rowStride = source.rows - 10;
  for (const rowCopy of [1, 2, 3]) {
    const lowerRowOffset = rowStride * rowCopy;
    for (const center of [5, 15]) {
      for (let row = lowerRowOffset + 8; row <= lowerRowOffset + 10; row++) {
        for (const col of [center - 1, center, center + 1]) connectorCells.add(`${row},${col}`);
      }
    }
    for (let col = 0; col < 20; col++) connectorCells.add(`${lowerRowOffset + 9},${col}`);
  }
  for (let row = 0; row < source.rows; row++) {
    for (let col = 0; col < source.cols; col++) {
      const expected = sourceValues[row * source.cols + col];
      const targetRows = row < 10 ? [row] : [0, 1, 2, 3].map((copy) => rowStride * copy + row);
      for (const targetRow of targetRows) {
        if (connectorCells.has(`${targetRow},${col}`)) continue;
        expect(expandedValues[targetRow * expanded.cols + col]).toEqual(expected);
      }
    }
  }
}

describe('bundled office section replication', () => {
  it('stacks the complete two-section layout into a two-by-four office', () => {
    const source = load('default-layout-1.json');
    const expanded = load('default-layout-2.json');

    expect(expanded.layoutRevision).toBe(4);
    expect(expanded.cols).toBe(source.cols);
    expect(expanded.rows).toBe(source.rows + (source.rows - 10) * 3);
    expect(expanded.tiles).toHaveLength(expanded.cols * expanded.rows);
    expectRowsDuplicated(source, expanded, 'tiles');
    if (source.tileColors) {
      expect(expanded.tileColors).toHaveLength(expanded.cols * expanded.rows);
      expectRowsDuplicated(source, expanded, 'tileColors');
    }

    expect(expanded.furniture).toHaveLength(source.furniture.length * 4);
    expect(new Set(expanded.furniture.map((item) => item.uid)).size).toBe(
      expanded.furniture.length,
    );
    for (const item of source.furniture) {
      expect(expanded.furniture).toContainEqual(item);
      expect(expanded.furniture).toContainEqual({
        ...item,
        uid: `${item.uid}--zone-copy-2`,
        row: item.row + source.rows - 10,
      });
      expect(expanded.furniture).toContainEqual({
        ...item,
        uid: `${item.uid}--zone-copy-3`,
        row: item.row + (source.rows - 10) * 2,
      });
      expect(expanded.furniture).toContainEqual({
        ...item,
        uid: `${item.uid}--zone-copy-4`,
        row: item.row + (source.rows - 10) * 3,
      });
    }

    const sourcePets = source.pets ?? [];
    expect(expanded.pets ?? []).toHaveLength(sourcePets.length * 4);
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
    expect(findPath(5, 14, 15, 14, tileMap, new Set())).not.toHaveLength(0);
    expect(findPath(5, 14, 15, 50, tileMap, new Set())).not.toHaveLength(0);

    const sectionCenters = [
      [5, 14],
      [15, 14],
      [5, 26],
      [15, 26],
      [5, 38],
      [15, 38],
      [5, 50],
      [15, 50],
    ] as const;
    for (const [col, row] of sectionCenters) {
      if (col === 5 && row === 14) continue;
      expect(findPath(5, 14, col, row, tileMap, new Set())).not.toHaveLength(0);
    }

    expect(expanded.zones).toHaveLength(8);
    expect(new Set(expanded.zones?.map((zone) => zone.id)).size).toBe(8);

    for (const lowerRowOffset of [12, 24, 36]) {
      for (const center of [5, 15]) {
        for (let row = lowerRowOffset + 8; row <= lowerRowOffset + 10; row++) {
          for (const col of [center - 1, center, center + 1]) {
            expect(tileMap[row][col]).not.toBe(0);
            expect(tileMap[row][col]).not.toBe(255);
          }
        }
      }
      const openings = new Set([4, 5, 6, 14, 15, 16]);
      for (let col = 0; col < 20; col++) {
        if (openings.has(col)) {
          expect(tileMap[lowerRowOffset + 9][col]).not.toBe(0);
          expect(tileMap[lowerRowOffset + 9][col]).not.toBe(255);
        } else {
          expect(tileMap[lowerRowOffset + 9][col]).toBe(0);
        }
      }
    }
  });
});
