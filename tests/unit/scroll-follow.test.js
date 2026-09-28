import { describe, expect, it } from "vitest";
import { isPinnedToBottom, SCROLL_FOLLOW_SLACK_PX } from "../../src/shared/utils/scrollFollow.js";

// The console log used to jump to the bottom on every append, dragging a
// reader away from the older line they were inspecting (#3838). Following is
// now a property of where the reader already is.

const el = (scrollTop, scrollHeight, clientHeight) => ({ scrollTop, scrollHeight, clientHeight });

describe("isPinnedToBottom", () => {
  it("is true when the element sits exactly at its bottom", () => {
    expect(isPinnedToBottom(el(400, 1000, 600))).toBe(true);
  });

  it("is true within the slack (sub-pixel residue from a fractional DPR)", () => {
    expect(isPinnedToBottom(el(397.6, 1000, 600))).toBe(true);
  });

  it("is false when the reader scrolled up past the slack", () => {
    expect(isPinnedToBottom(el(300, 1000, 600))).toBe(false);
    expect(isPinnedToBottom(el(1000 - 600 - SCROLL_FOLLOW_SLACK_PX - 1, 1000, 600))).toBe(false);
  });

  it("treats the slack boundary itself as pinned", () => {
    expect(isPinnedToBottom(el(1000 - 600 - SCROLL_FOLLOW_SLACK_PX, 1000, 600))).toBe(true);
  });

  it("honours an explicit slack override", () => {
    expect(isPinnedToBottom(el(390, 1000, 600), 10)).toBe(true);
    expect(isPinnedToBottom(el(390, 1000, 600), 0)).toBe(false);
  });

  it("is true for a missing element (nothing painted yet)", () => {
    expect(isPinnedToBottom(null)).toBe(true);
    expect(isPinnedToBottom(undefined)).toBe(true);
  });

  it("is true when the node reports unmeasured values", () => {
    expect(isPinnedToBottom(el(0, undefined, 600))).toBe(true);
    expect(isPinnedToBottom(el(NaN, 1000, 600))).toBe(true);
  });

  it("is true when the content is shorter than the viewport", () => {
    expect(isPinnedToBottom(el(0, 200, 600))).toBe(true);
  });
});
