interface OverlayVisibilityInput {
  alwaysShowOverlay: boolean;
  isSelected: boolean;
  isHovered: boolean;
  isActiveCodex: boolean;
  isDone: boolean;
}

/** Done agents stay quiet even after their temporary check bubble expires. */
export function shouldShowAgentOverlay({
  alwaysShowOverlay,
  isSelected,
  isHovered,
  isActiveCodex,
  isDone,
}: OverlayVisibilityInput): boolean {
  if (isSelected || isHovered) return true;
  if (isDone) return false;
  return alwaysShowOverlay || isActiveCodex;
}
