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
  for (const rowOffset of [0, rowStride]) {
    for (const row of [14, 15, 16, 17]) {
      for (const col of [19, 20, 21]) connectorCells.add(`${row + rowOffset},${col}`);
    }
  }
  for (const center of [5, 15, 26, 36]) {
    for (let row = 20; row <= 22; row++) {
      for (const col of [center - 1, center, center + 1]) connectorCells.add(`${row},${col}`);
    }
  }
  for (const col of [
    ...Array.from({ length: 20 }, (_, index) => index),
    ...Array.from({ length: 20 }, (_, index) => index + 21),
  ]) {
    connectorCells.add(`21,${col}`);
  }
  for (let row = 0; row < source.rows; row++) {
    for (let col = 0; col < source.cols; col++) {
      const expected = sourceValues[row * source.cols + col];
      const targetRows = row < 10 ? [row] : [row, rowStride + row];
      for (const targetRow of targetRows) {
        for (const targetCol of [col, source.cols + col]) {
          if (connectorCells.has(`${targetRow},${targetCol}`)) continue;
          expect(expandedValues[targetRow * expanded.cols + targetCol]).toEqual(expected);
        }
      }
    }
  }
}

describe('bundled office section replication', () => {
  it('duplicates the complete two-section layout horizontally', () => {
    const source = load('default-layout-1.json');
    const expanded = load('default-layout-2.json');

    expect(expanded.layoutRevision).toBe(3);
    expect(expanded.cols).toBe(source.cols * 2);
    expect(expanded.rows).toBe(source.rows + (source.rows - 10));
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
        col: item.col + source.cols,
      });
      expect(expanded.furniture).toContainEqual({
        ...item,
        uid: `${item.uid}--zone-copy-3`,
        row: item.row + source.rows - 10,
      });
      expect(expanded.furniture).toContainEqual({
        ...item,
        uid: `${item.uid}--zone-copy-4`,
        col: item.col + source.cols,
        row: item.row + source.rows - 10,
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
    expect(findPath(1, 14, 39, 14, tileMap, new Set())).not.toHaveLength(0);
    expect(findPath(1, 14, 39, 26, tileMap, new Set())).not.toHaveLength(0);

    const sectionCenters = [
      [5, 14],
      [15, 14],
      [26, 14],
      [36, 14],
      [5, 26],
      [15, 26],
      [26, 26],
      [36, 26],
    ] as const;
    for (const [col, row] of sectionCenters) {
      if (col === 5 && row === 14) continue;
      expect(findPath(5, 14, col, row, tileMap, new Set())).not.toHaveLength(0);
    }

    expect(expanded.zones).toHaveLength(8);
    expect(new Set(expanded.zones?.map((zone) => zone.id)).size).toBe(8);

    for (const row of [14, 15, 16, 17]) {
      expect(tileMap[row][19]).not.toBe(0);
      expect(tileMap[row][20]).not.toBe(255);
      expect(tileMap[row][21]).not.toBe(0);
    }
    for (const center of [5, 15, 26, 36]) {
      for (let row = 20; row <= 22; row++) {
        for (const col of [center - 1, center, center + 1]) {
          expect(tileMap[row][col]).not.toBe(0);
          expect(tileMap[row][col]).not.toBe(255);
        }
      }
    }
    const openings = new Set([4, 5, 6, 14, 15, 16, 25, 26, 27, 35, 36, 37]);
    for (const col of [
      ...Array.from({ length: 20 }, (_, index) => index),
      ...Array.from({ length: 20 }, (_, index) => index + 21),
    ]) {
      if (openings.has(col)) {
        expect(tileMap[21][col]).not.toBe(0);
        expect(tileMap[21][col]).not.toBe(255);
      } else {
        expect(tileMap[21][col]).toBe(0);
      }
    }
  });
});
