import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

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
  for (let row = 0; row < source.rows; row++) {
    const original = sourceValues.slice(row * source.cols, (row + 1) * source.cols);
    expect(expandedValues.slice(row * expanded.cols, row * expanded.cols + source.cols)).toEqual(
      original,
    );
    expect(
      expandedValues.slice(
        row * expanded.cols + source.cols,
        row * expanded.cols + source.cols * 2,
      ),
    ).toEqual(original);
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
  });
});
