import '@testing-library/jest-dom/vitest';

// jsdom has no IntersectionObserver; framer-motion's whileInView needs one.
class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
