import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface CoverageMetric {
  covered: number;
  total: number;
  percentage: number;
}

export interface CoverageSummary {
  lines: CoverageMetric;
  functions: CoverageMetric;
}

export interface CoverageThresholds {
  lines: number;
  functions: number;
  exclude?: string[];
}

export interface CoverageEvaluation {
  ok: boolean;
  failures: string[];
}

function toPercentage(covered: number, total: number): number {
  if (total === 0) {
    return 100;
  }
  return Number(((covered / total) * 100).toFixed(2));
}

function toMetric(hits: number[]): CoverageMetric {
  const covered = hits.filter((hit) => hit > 0).length;
  const total = hits.length;
  return { covered, total, percentage: toPercentage(covered, total) };
}

function toMetricFromCounts(covered: number, total: number): CoverageMetric {
  return { covered, total, percentage: toPercentage(covered, total) };
}

function parseLineHit(line: string): number | undefined {
  const [, value] = line.slice(3).split(',', 2);
  const hit = Number(value);
  return Number.isFinite(hit) && hit >= 0 ? hit : undefined;
}

export function parseLcov(
  lcov: string,
  excludedPaths: string[] = [],
): CoverageSummary {
  const exclusions = new Set(excludedPaths);
  let coveredLines = 0;
  let totalLines = 0;
  let coveredFunctions = 0;
  let totalFunctions = 0;
  let recordLineHits = new Map<string, number>();
  let recordFunctionHits = new Map<string, number>();
  let recordLineSummary: { covered?: number; total?: number } = {};
  let recordFunctionSummary: { covered?: number; total?: number } = {};
  let recordSource: string | undefined;

  const finishRecord = (): void => {
    const lines =
      recordLineSummary.covered !== undefined && recordLineSummary.total !== undefined
        ? toMetricFromCounts(recordLineSummary.covered, recordLineSummary.total)
        : toMetric([...recordLineHits.values()]);
    const functions =
      recordFunctionSummary.covered !== undefined && recordFunctionSummary.total !== undefined
        ? toMetricFromCounts(recordFunctionSummary.covered, recordFunctionSummary.total)
        : toMetric([...recordFunctionHits.values()]);
    if (!recordSource || !exclusions.has(recordSource)) {
      coveredLines += lines.covered;
      totalLines += lines.total;
      coveredFunctions += functions.covered;
      totalFunctions += functions.total;
    }
    recordLineHits = new Map();
    recordFunctionHits = new Map();
    recordLineSummary = {};
    recordFunctionSummary = {};
    recordSource = undefined;
  };

  for (const rawLine of lcov.split(/\r?\n/u)) {
    if (rawLine.startsWith('SF:')) {
      recordSource = rawLine.slice(3);
      continue;
    }
    if (rawLine === 'end_of_record') {
      finishRecord();
      continue;
    }

    if (rawLine.startsWith('DA:')) {
      const [lineNumber] = rawLine.slice(3).split(',', 1);
      const hit = parseLineHit(rawLine);
      if (lineNumber && hit !== undefined) {
        recordLineHits.set(lineNumber, hit);
      }
      continue;
    }

    if (rawLine.startsWith('FNDA:')) {
      const [hitValue, ...nameParts] = rawLine.slice(5).split(',');
      const hit = Number(hitValue);
      const name = nameParts.join(',');
      if (name && Number.isFinite(hit) && hit >= 0) {
        recordFunctionHits.set(name, hit);
      }
      continue;
    }

    if (rawLine.startsWith('LF:')) {
      const total = Number(rawLine.slice(3));
      if (Number.isInteger(total) && total >= 0) {
        recordLineSummary.total = total;
      }
      continue;
    }

    if (rawLine.startsWith('LH:')) {
      const covered = Number(rawLine.slice(3));
      if (Number.isInteger(covered) && covered >= 0) {
        recordLineSummary.covered = covered;
      }
      continue;
    }

    if (rawLine.startsWith('FNF:')) {
      const total = Number(rawLine.slice(4));
      if (Number.isInteger(total) && total >= 0) {
        recordFunctionSummary.total = total;
      }
      continue;
    }

    if (rawLine.startsWith('FNH:')) {
      const covered = Number(rawLine.slice(4));
      if (Number.isInteger(covered) && covered >= 0) {
        recordFunctionSummary.covered = covered;
      }
    }
  }

  if (
    recordLineHits.size > 0 ||
    recordFunctionHits.size > 0 ||
    recordLineSummary.total !== undefined ||
    recordFunctionSummary.total !== undefined
  ) {
    finishRecord();
  }

  return {
    lines: toMetricFromCounts(coveredLines, totalLines),
    functions: toMetricFromCounts(coveredFunctions, totalFunctions),
  };
}

function assertThreshold(value: unknown, name: keyof CoverageThresholds): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`coverage threshold ${name} must be a number between 0 and 100`);
  }
  return value;
}

export function parseCoverageThresholds(value: unknown): CoverageThresholds {
  if (!value || typeof value !== 'object') {
    throw new Error('coverage threshold configuration must be an object');
  }

  const thresholds = value as Record<string, unknown>;
  const rawExclude = thresholds.exclude ?? [];
  if (
    !Array.isArray(rawExclude) ||
    rawExclude.some(
      (entry) =>
        typeof entry !== 'string' ||
        entry.startsWith('/') ||
        entry.includes('..') ||
        entry.includes('*') ||
        !entry.endsWith('.ts'),
    )
  ) {
    throw new Error(
      'coverage exclude entries must be exact repository-relative TypeScript paths',
    );
  }
  return {
    lines: assertThreshold(thresholds.lines, 'lines'),
    functions: assertThreshold(thresholds.functions, 'functions'),
    exclude: [...rawExclude] as string[],
  };
}

export function evaluateCoverage(summary: CoverageSummary, thresholds: CoverageThresholds): CoverageEvaluation {
  const failures = (['lines', 'functions'] as const)
    .filter((metric) => summary[metric].percentage < thresholds[metric])
    .map(
      (metric) =>
        `${metric} coverage ${summary[metric].percentage.toFixed(2)}% is below the required ${thresholds[metric].toFixed(2)}%`,
    );

  return { ok: failures.length === 0, failures };
}

export async function checkCoverage(
  lcovPath: string,
  thresholdPath: string,
): Promise<{ summary: CoverageSummary; thresholds: CoverageThresholds; evaluation: CoverageEvaluation }> {
  const [lcov, rawThresholds] = await Promise.all([readFile(lcovPath, 'utf8'), readFile(thresholdPath, 'utf8')]);
  const thresholds = parseCoverageThresholds(JSON.parse(rawThresholds) as unknown);
  const summary = parseLcov(lcov, thresholds.exclude ?? []);
  return { summary, thresholds, evaluation: evaluateCoverage(summary, thresholds) };
}

function formatMetric(name: keyof CoverageSummary, metric: CoverageMetric, threshold: number): string {
  return `${name}: ${metric.percentage.toFixed(2)}% (${metric.covered}/${metric.total}), required ${threshold.toFixed(2)}%`;
}

async function main(args: string[]): Promise<void> {
  const [lcovPath = 'coverage/lcov.info', thresholdPath = 'config/coverage-thresholds.json'] = args;
  if (args.length > 2) {
    throw new Error('usage: bun scripts/check-coverage.ts [lcov path] [threshold config path]');
  }

  const result = await checkCoverage(resolve(lcovPath), resolve(thresholdPath));
  console.log(formatMetric('lines', result.summary.lines, result.thresholds.lines));
  console.log(formatMetric('functions', result.summary.functions, result.thresholds.functions));
  if (!result.evaluation.ok) {
    throw new Error(result.evaluation.failures.join('\n'));
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Coverage check failed');
    process.exitCode = 1;
  });
}
