import {
  COMPANY_NAME,
  TILE_SIZE,
  ZOOM_FIT_PADDING_RATIO,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../constants.js';
import { computeCompanySignLayout } from './engine/companySign.js';
import type { TileType as TileTypeVal } from './types.js';
import { TileType } from './types.js';

const COMPACT_BREAKPOINT = 640;
const COMPACT_HEIGHT_BREAKPOINT = 560;
const SAFE_GUTTER_CSS_PX = 8;
const COMPACT_TOOLBAR_RESERVE_CSS_PX = 74;

export interface OfficeView {
  panX: number;
  panY: number;
  zoom: number;
}

interface ContentBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

function computeContentBounds(
  tileMap: TileTypeVal[][],
  cols: number,
  companyName: string,
): ContentBounds | null {
  let minCol = cols;
  let maxCol = -1;
  let minRow = tileMap.length;
  let maxRow = -1;
  for (let row = 0; row < tileMap.length; row++) {
    for (let col = 0; col < Math.min(cols, tileMap[row].length); col++) {
      if (tileMap[row][col] === TileType.VOID) continue;
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
    }
  }
  if (maxCol < minCol || maxRow < minRow) return null;

  let top = minRow * TILE_SIZE;
  let left = minCol * TILE_SIZE;
  let right = (maxCol + 1) * TILE_SIZE;
  const sign = computeCompanySignLayout(tileMap, 0, 0, 1, cols, companyName);
  if (sign) {
    top = Math.min(top, sign.signY);
    left = Math.min(left, sign.signX);
    right = Math.max(right, sign.signX + sign.signWidth + 4);
  }
  return { bottom: (maxRow + 1) * TILE_SIZE, left, right, top };
}

/** Fit and center visible office content inside the stable UI safe area. */
export function computeOfficeView(
  canvasWidth: number,
  canvasHeight: number,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  tileMap: TileTypeVal[][],
  cols: number,
  rows: number,
  companyName: string = COMPANY_NAME,
): OfficeView {
  const bounds = computeContentBounds(tileMap, cols, companyName);
  if (!bounds || canvasWidth <= 0 || canvasHeight <= 0 || cols <= 0 || rows <= 0) {
    return { panX: 0, panY: 0, zoom: 1 };
  }

  const compact = cssWidth <= COMPACT_BREAKPOINT || cssHeight <= COMPACT_HEIGHT_BREAKPOINT;
  const gutter = SAFE_GUTTER_CSS_PX * dpr;
  const safeLeft = gutter;
  const safeTop = gutter;
  const safeRight = canvasWidth - gutter;
  const safeBottom = canvasHeight - (compact ? COMPACT_TOOLBAR_RESERVE_CSS_PX * dpr : gutter);
  const contentWidth = bounds.right - bounds.left;
  const contentHeight = bounds.bottom - bounds.top;
  // Compact layouts already have a hard safe gutter. Applying the desktop
  // padding ratio a second time left a conspicuous unused band on phones.
  const fitPadding = compact ? 1 : ZOOM_FIT_PADDING_RATIO;
  const horizontalFit = ((safeRight - safeLeft) * fitPadding) / contentWidth;
  const verticalFit = ((safeBottom - safeTop) * fitPadding) / contentHeight;
  // Keep pixel art crisp while allowing desktop viewers to use the available
  // screen. A 2x cap left a large unused frame around this office at 1336x768;
  // 3 CSS pixels per source pixel still fits and remains integer-scaled.
  const densityCap = 3 * dpr;
  const rawFit = Math.min(horizontalFit, verticalFit, densityCap);
  // Below 1x, an integer floor collapses every fit to the 0.5 minimum. Quantize
  // fractional fits to 0.05 on both desktop and compact viewers so tall offices
  // use their limiting axis without clipping. Compact mode remains capped at 1x.
  const quantizedFit = Math.floor(rawFit * 20) / 20;
  const fittedZoom =
    rawFit < 1 ? quantizedFit : compact ? Math.min(1, quantizedFit) : Math.floor(rawFit);
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fittedZoom));

  const mapWidth = cols * TILE_SIZE * zoom;
  const mapHeight = rows * TILE_SIZE * zoom;
  const baseOffsetX = (canvasWidth - mapWidth) / 2;
  const baseOffsetY = (canvasHeight - mapHeight) / 2;
  const contentCenterX = baseOffsetX + ((bounds.left + bounds.right) / 2) * zoom;
  const contentCenterY = baseOffsetY + ((bounds.top + bounds.bottom) / 2) * zoom;
  const safeCenterX = (safeLeft + safeRight) / 2;
  const safeCenterY = (safeTop + safeBottom) / 2;

  return {
    panX: Math.round(safeCenterX - contentCenterX),
    panY: Math.round(safeCenterY - contentCenterY),
    zoom,
  };
}
