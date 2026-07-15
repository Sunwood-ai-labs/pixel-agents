import { describe, expect, it } from 'vitest';

import { computeOfficeView } from '../src/office/officeZoom.js';
import type { TileType as TileTypeVal } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

function defaultShape(): TileTypeVal[][] {
  return [
    ...Array.from({ length: 10 }, () => Array<TileTypeVal>(21).fill(TileType.VOID)),
    ...Array.from({ length: 11 }, () => [
      ...Array<TileTypeVal>(20).fill(TileType.FLOOR_1),
      TileType.VOID,
    ]),
    Array<TileTypeVal>(21).fill(TileType.VOID),
  ];
}

function replicatedShape(): TileTypeVal[][] {
  return defaultShape().map((row) => [...row, ...row]);
}

describe('computeOfficeView', () => {
  it('selects the largest crisp view that fits the desktop safe area', () => {
    const view = computeOfficeView(1336, 768, 1336, 768, 1, defaultShape(), 21, 22);
    expect(view.zoom).toBe(3);
    expect(view.panX).toBe(24);
    expect(view.panY).toBe(-144);
  });

  it('keeps portrait and landscape mobile content above the toolbar safe area', () => {
    const portrait = computeOfficeView(390, 844, 390, 844, 1, defaultShape(), 21, 22);
    const landscape = computeOfficeView(844, 390, 844, 390, 1, defaultShape(), 21, 22);
    expect(portrait.zoom).toBe(1);
    expect(portrait.panY).toBeLessThan(0);
    expect(landscape.zoom).toBe(1);
    expect(landscape.panY).toBeLessThan(0);
  });

  it('fits a horizontally replicated four-section office on a narrow viewer', () => {
    const view = computeOfficeView(390, 844, 390, 844, 1, replicatedShape(), 42, 22);
    expect(view.zoom).toBe(0.55);

    const officeWidth = 42 * 16 * view.zoom;
    const left = (390 - officeWidth) / 2 + view.panX;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + officeWidth).toBeLessThanOrEqual(390);
  });

  it('uses the phone width while fitting all eight sections without clipping', () => {
    const twoRows = [...replicatedShape().slice(0, 22), ...replicatedShape().slice(10)];
    const view = computeOfficeView(430, 932, 430, 932, 1, twoRows, 42, 34);
    expect(view.zoom).toBe(0.6);
    const officeWidth = 42 * 16 * view.zoom;
    const left = (430 - officeWidth) / 2 + view.panX;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + officeWidth).toBeLessThanOrEqual(430);
    expect(officeWidth / 430).toBeGreaterThan(0.9);
  });

  it('uses DPR to preserve the same visual density on Retina displays', () => {
    const view = computeOfficeView(2672, 1536, 1336, 768, 2, defaultShape(), 21, 22);
    expect(view.zoom).toBe(6);
    expect(view.panY).toBe(-288);
  });

  it('falls back safely for an empty layout', () => {
    expect(computeOfficeView(1336, 768, 1336, 768, 1, [], 21, 22)).toEqual({
      panX: 0,
      panY: 0,
      zoom: 1,
    });
  });
});
