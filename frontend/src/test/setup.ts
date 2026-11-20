// Slice B (2026-11-09): shared vitest setup for offline component tests.
// Adds jest-dom's accessible matchers (toBeInTheDocument, etc.) and unmounts
// every rendered component after each test (jsdom document is shared).
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});
