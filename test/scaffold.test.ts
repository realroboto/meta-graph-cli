import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// Placeholder until the run seam lands (#5). Proves the toolchain — node:test,
// strict TypeScript, type-stripping — runs green on an otherwise empty tree.
test('toolchain runs', () => {
  assert.equal(1 + 1, 2);
});
