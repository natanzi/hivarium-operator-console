import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Ensure each test renders into a clean DOM.
afterEach(() => {
  cleanup();
});

// Provide the requestAnimationFrame polyfill needed by StatRow.
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (cb) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number;
  window.cancelAnimationFrame = (id) => clearTimeout(id as unknown as number);
}

// Radix UI primitives (e.g. Select, Tabs) rely on ResizeObserver to measure
// their content. jsdom does not implement it, so provide a minimal stub.
class ResizeObserverMock implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverMock;
}

// Radix Select calls hasPointerCapture/releasePointerCapture on pointer
// events; jsdom does not implement pointer capture, so stub the methods.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}

// Radix Select scrolls the highlighted option into view when the list opens;
// jsdom does not implement scrollIntoView, so stub it.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
