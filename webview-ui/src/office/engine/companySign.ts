import type { TileType as TileTypeVal } from '../types.js';
import { TILE_SIZE, TileType } from '../types.js';

export interface CompanySignLayout {
  fontSize: number;
  signHeight: number;
  signWidth: number;
  signX: number;
  signY: number;
  visibleTop: number;
}

/** Pure world-space geometry for the office company plaque. */
export function computeCompanySignLayout(
  tileMap: TileTypeVal[][],
  offsetX: number,
  offsetY: number,
  zoom: number,
  cols: number,
  companyName: string,
): CompanySignLayout | null {
  if (!companyName || cols < 4 || tileMap.length === 0) return null;

  let topVisibleRow = tileMap.length;
  let minVisibleCol = cols;
  let maxVisibleCol = -1;
  for (let row = 0; row < tileMap.length; row++) {
    for (let col = 0; col < Math.min(cols, tileMap[row].length); col++) {
      if (tileMap[row][col] === TileType.VOID) continue;
      topVisibleRow = Math.min(topVisibleRow, row);
      minVisibleCol = Math.min(minVisibleCol, col);
      maxVisibleCol = Math.max(maxVisibleCol, col);
    }
  }
  const visibleCols = maxVisibleCol - minVisibleCol + 1;
  if (visibleCols < 4 || topVisibleRow === tileMap.length) return null;

  const tileSize = TILE_SIZE * zoom;
  const visibleWidth = visibleCols * tileSize;
  const fontSize = 10 * zoom;
  const signHeight = 24 * zoom;
  const estimatedTextWidth = companyName.length * fontSize * 0.72;
  const signWidth = Math.min(
    visibleWidth - tileSize * 2,
    Math.max(140 * zoom, estimatedTextWidth + 28 * zoom),
  );
  const visibleTop = offsetY + topVisibleRow * tileSize;
  const signY = topVisibleRow > 2 ? visibleTop - signHeight - 24 * zoom : visibleTop + 4 * zoom;
  const visibleCenter = offsetX + (minVisibleCol + visibleCols / 2) * tileSize;

  return {
    fontSize,
    signHeight,
    signWidth,
    signX: visibleCenter - signWidth / 2,
    signY,
    visibleTop,
  };
}
