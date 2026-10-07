import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  window.__mobile = false;
});

// jsdom has no matchMedia. MUI's useMediaQuery uses it for the responsive
// panel; tests flip window.__mobile to simulate a phone-width viewport.
window.matchMedia = vi.fn().mockImplementation((query) => ({
  matches: Boolean(window.__mobile) && /max-width/.test(query),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
}));

Element.prototype.scrollIntoView = vi.fn();
