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
