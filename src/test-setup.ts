import "@testing-library/jest-dom/vitest";

// jsdom intentionally leaves media playback unimplemented. Keep component
// effects realistic without flooding otherwise successful test runs with
// "Not implemented" diagnostics.
if (typeof HTMLMediaElement !== "undefined")
  Object.defineProperties(HTMLMediaElement.prototype, {
    load: {
      configurable: true,
      value: () => {},
    },
    play: {
      configurable: true,
      value: () => Promise.resolve(),
    },
    pause: {
      configurable: true,
      value: () => {},
    },
  });
