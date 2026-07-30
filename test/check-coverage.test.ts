import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'bun:test';
import {
  evaluateCoverage,
  parseCoverageThresholds,
  parseLcov,
} from '../scripts/check-coverage.ts';

const lcov = `TN:
SF:src/lib/example.ts
FN:1,coveredFunction
FN:10,uncoveredFunction
FNDA:3,coveredFunction
FNDA:0,uncoveredFunction
DA:1,2
DA:2,0
DA:3,1
end_of_record
`;

test('parseLcov calculates line and function coverage from LCOV records', () => {
  assert.deepEqual(parseLcov(lcov), {
    lines: { covered: 2, total: 3, percentage: 66.67 },
    functions: { covered: 1, total: 2, percentage: 50 },
  });
});

test('parseLcov prefers LCOV summary fields when a reporter omits FNDA records', () => {
  const summaryOnly = `TN:
SF:src/lib/example.ts
FNF:4
FNH:3
LF:10
LH:8
end_of_record
`;

  assert.deepEqual(parseLcov(summaryOnly), {
    lines: { covered: 8, total: 10, percentage: 80 },
    functions: { covered: 3, total: 4, percentage: 75 },
  });
});

test('evaluateCoverage accepts coverage at the configured lines and functions baseline', () => {
  const result = evaluateCoverage(
    {
      lines: { covered: 72, total: 100, percentage: 72 },
      functions: { covered: 76, total: 100, percentage: 76 },
    },
    { lines: 71.73, functions: 76 },
  );

  assert.deepEqual(result, { ok: true, failures: [] });
});

test('evaluateCoverage rejects regressions in either protected metric', () => {
  const result = evaluateCoverage(
    {
      lines: { covered: 71, total: 100, percentage: 71 },
      functions: { covered: 75, total: 100, percentage: 75 },
    },
    { lines: 71.73, functions: 76 },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    'lines coverage 71.00% is below the required 71.73%',
    'functions coverage 75.00% is below the required 76.00%',
  ]);
});

test('parseLcov excludes only explicitly configured browser Adapter records', () => {
  const withBrowserAdapter = `${lcov}TN:
SF:src/lib/auto-login.ts
FNF:10
FNH:1
LF:100
LH:10
end_of_record
`;
  assert.deepEqual(parseLcov(withBrowserAdapter, ['src/lib/auto-login.ts']), {
    lines: { covered: 2, total: 3, percentage: 66.67 },
    functions: { covered: 1, total: 2, percentage: 50 },
  });
});

test('coverage config validates an explicit exclusion allowlist', () => {
  assert.deepEqual(
    parseCoverageThresholds({
      lines: 80,
      functions: 80,
      exclude: ['src/lib/auto-login.ts'],
    }),
    {
      lines: 80,
      functions: 80,
      exclude: ['src/lib/auto-login.ts'],
    },
  );
  assert.throws(
    () =>
      parseCoverageThresholds({
        lines: 80,
        functions: 80,
        exclude: ['**/*.ts'],
      }),
    /exact repository-relative TypeScript path/,
  );
});

test('repository coverage gate has no source-file exclusions', async () => {
  const raw = JSON.parse(
    await readFile(new URL('../config/coverage-thresholds.json', import.meta.url), 'utf8'),
  ) as unknown;
  assert.deepEqual(parseCoverageThresholds(raw), {
    lines: 80,
    functions: 80,
    exclude: [],
  });
});
