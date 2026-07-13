import { describe, expect, it } from 'vitest';

import { computeCompanySignLayout } from '../src/office/engine/companySign.js';
import type { TileType as TileTypeVal } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

function officeWithVoidHeadroom(): TileTypeVal[][] {
  return [
    ...Array.from({ length: 10 }, () => Array<TileTypeVal>(8).fill(TileType.VOID)),
    Array<TileTypeVal>(8).fill(TileType.WALL),
    Array<TileTypeVal>(8).fill(TileType.FLOOR_1),
  ];
}

describe('computeCompanySignLayout', () => {
  it('skips empty offices and empty company names', () => {
    expect(
      computeCompanySignLayout([Array<TileTypeVal>(8).fill(TileType.VOID)], 0, 0, 1, 8, 'ACME'),
    ).toBeNull();
    expect(computeCompanySignLayout(officeWithVoidHeadroom(), 0, 0, 1, 8, '')).toBeNull();
  });

  it('keeps the plaque and its pixel shadow above the row-nine wall-decoration band', () => {
    const layout = computeCompanySignLayout(
      officeWithVoidHeadroom(),
      0,
      0,
      1,
      8,
      'SUNWOOD AI LABS.',
    );
    expect(layout).not.toBeNull();
    expect(layout!.signY + layout!.signHeight + 4).toBeLessThanOrEqual(9 * 16);
  });

  it('tracks office offset and zoom', () => {
    const tiles = officeWithVoidHeadroom();
    const first = computeCompanySignLayout(tiles, 0, 0, 1, 8, 'SUNWOOD AI LABS.')!;
    const second = computeCompanySignLayout(tiles, 20, 30, 2, 8, 'SUNWOOD AI LABS.')!;

    expect(second.signWidth).toBe(first.signWidth * 2);
    expect(second.signHeight).toBe(first.signHeight * 2);
    expect(second.signX).toBe(first.signX * 2 + 20);
    expect(second.visibleTop).toBe(first.visibleTop * 2 + 30);
  });
});
