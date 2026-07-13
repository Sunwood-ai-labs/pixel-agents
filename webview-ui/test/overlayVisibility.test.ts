import { describe, expect, it } from 'vitest';

import { shouldShowAgentOverlay } from '../src/office/components/overlayVisibility.js';

describe('shouldShowAgentOverlay', () => {
  it('keeps a completed agent hidden after its temporary bubble expires', () => {
    expect(
      shouldShowAgentOverlay({
        alwaysShowOverlay: true,
        isSelected: false,
        isHovered: false,
        isActiveCodex: false,
        isDone: true,
      }),
    ).toBe(false);
  });

  it('shows a completed agent only when explicitly inspected', () => {
    expect(
      shouldShowAgentOverlay({
        alwaysShowOverlay: false,
        isSelected: false,
        isHovered: true,
        isActiveCodex: false,
        isDone: true,
      }),
    ).toBe(true);
  });

  it('keeps an offline remote panel quiet until inspected', () => {
    expect(
      shouldShowAgentOverlay({
        alwaysShowOverlay: true,
        isSelected: false,
        isHovered: false,
        isActiveCodex: false,
        isDone: true,
      }),
    ).toBe(false);
  });
});
