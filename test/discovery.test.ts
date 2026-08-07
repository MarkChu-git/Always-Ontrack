import { afterEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  classifyDiscoveredPaths,
  discoverOnTrackSurface,
  extractDiscoveredPaths,
  extractJavascriptAssetPaths,
  probeDiscoveredApiTemplates,
} from '../src/lib/discovery.js';
import type { SessionData } from '../src/lib/types.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const session: SessionData = {
  baseUrl: 'https://example.test/api', username: 'mark', authToken: 'token', savedAt: '2026-01-01T00:00:00.000Z',
};

test('discovery extraction normalizes paths and separates UI from API templates', () => {
  assert.deepEqual(extractJavascriptAssetPaths('<script src="/a.js"></script><link href="/b.js"><script src="/a.js"></script>'), ['/a.js', '/b.js']);
  const paths = extractDiscoveredPaths("'/home' '/api/projects/:projectId/' '/assets/app.js' '/g/flags' '/x//y' '/.'");
  assert.deepEqual(paths, ['/home', '/api/projects/:projectId', '/g/flags']);
  assert.deepEqual(classifyDiscoveredPaths(paths), {
    uiRoutes: ['/g/flags', '/home'], apiTemplates: ['/api/projects/:projectId'],
  });
});

test('discovery extraction reconstructs safe template and concatenated API paths', () => {
  const paths = extractDiscoveredPaths([
    'const project = `/api/projects/${projectId}/task_def_id/${taskDefId}/submission_details`;',
    "const prerequisites = '/api/units/' + unit.id + '/task_definitions/' + taskDefinitionId + '/prerequisites';",
    "const external = 'https://attacker.example/api/projects/' + projectId;",
    "const malformed = '/api/projects/' + () => 'not-a-route';",
  ].join('\n'));

  assert.deepEqual(paths, [
    '/api/projects/:projectId/task_def_id/:taskDefId/submission_details',
    '/api/units/:unit_id/task_definitions/:taskDefinitionId/prerequisites',
  ]);
});

test('discovery extraction omits query and fragment-bearing paths', () => {
  const paths = extractDiscoveredPaths([
    "'/api/projects?auth_token=secret'",
    "'/tasks#submission-42'",
    "'/api/projects/:projectId'",
  ].join(' '));

  assert.deepEqual(paths, ['/api/projects/:projectId']);
});

test('discovery extraction refuses dynamic concatenation expressions that could be truncated into routes', async () => {
  const paths = extractDiscoveredPaths([
    "const invoked = '/api/projects/' + projectId();",
    "const indexed = '/api/projects/' + projectId[0];",
    "const optional = '/api/projects/' + projectId?.value;",
    'const nested = `/api/projects/${projectId({ unsafe: true })}`;',
  ].join('\n'));
  const calls: string[] = [];

  const result = await probeDiscoveredApiTemplates({
    async probeGet(_session, endpoint) {
      calls.push(endpoint);
      return { endpoint, status: 200, ok: true };
    },
  }, session, paths, { projectId: 9 });

  assert.deepEqual(paths, []);
  assert.deepEqual(result, []);
  assert.deepEqual(calls, []);
});

test('surface discovery records successful and failed assets without network access', async () => {
  const fetchedUrls: string[] = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    fetchedUrls.push(url);
    assert.equal(init?.redirect, 'error');
    if (url === 'https://ontrack.infotech.monash.edu/home') {
      return new Response(
        [
          '<script src="/ok.js"></script>',
          '<script src="/bad.js"></script>',
          '<script src="https://attacker.example/evil.js"></script>',
          '<script src="//attacker.example/protocol-relative.js"></script>',
          '<script src="http://ontrack.infotech.monash.edu/insecure.js"></script>',
          '<script src="https://user:pass@ontrack.infotech.monash.edu/credentialed.js"></script>',
        ].join(''),
      );
    }
    if (url.endsWith('/ok.js')) {
      return new Response("'/tasks' '/api/projects/:projectId'");
    }
    return new Response('missing', { status: 404, statusText: 'Not Found' });
  }) as typeof fetch;
  const result = await discoverOnTrackSurface();
  assert.equal(result.assets.length, 6);
  assert.equal(result.assets[0].status, 'ok');
  assert.deepEqual(result.uiRoutes, ['/tasks']);
  assert.deepEqual(result.apiTemplates, ['/api/projects/:projectId']);
  assert.match(result.assets[1].detail || '', /404 Not Found/);
  assert.equal(result.assets[2].status, 'error');
  assert.match(result.assets[2].detail || '', /Cross-origin/);
  assert.equal(result.assets[3].status, 'error');
  assert.equal(result.assets[4].status, 'error');
  assert.equal(result.assets[5].status, 'error');
  assert.deepEqual(fetchedUrls, [
    'https://ontrack.infotech.monash.edu/home',
    'https://ontrack.infotech.monash.edu/ok.js',
    'https://ontrack.infotech.monash.edu/bad.js',
  ]);
  assert.equal(result.siteUrl, 'https://ontrack.infotech.monash.edu/home');
});

test('probing requires explicit selectors and never infers a project or task', async () => {
  const calls: string[] = [];
  const result = await probeDiscoveredApiTemplates({
    async probeGet(_session, endpoint) {
      calls.push(endpoint);
      return { endpoint, status: 200, ok: true };
    },
  }, session, [
    '/api/projects/:projectId',
    '/units/:unitId/task_definitions/:taskDefId/prerequisites',
  ]);
  assert.deepEqual(calls, []);
  assert.deepEqual(result.map((item) => item.status), ['skip', 'skip']);
  assert.match(result[0]?.detail ?? '', /projectId/);
  assert.match(result[1]?.detail ?? '', /unitId.*taskDefId/);
});

test('probing uses only allowlisted GET paths after explicit selector materialization', async () => {
  const calls: string[] = [];
  const result = await probeDiscoveredApiTemplates({
    async probeGet(_session, endpoint) {
      calls.push(endpoint);
      return { endpoint, status: 200, ok: true };
    },
  }, session, [
    '/api/projects/:projectId',
    '/units/:unitId/task_definitions/:taskDefId/prerequisites',
    '/api/projects/:projectId/reset_target_dates',
  ], {
    projectId: 9,
    unitId: 4,
    taskDefinitionId: 7,
  });

  assert.deepEqual(calls, [
    '/projects/9',
    '/units/4/task_definitions/7/prerequisites',
  ]);
  assert.deepEqual(result.map((item) => item.status), ['ok', 'ok', 'skip']);
  assert.match(result[2]?.detail ?? '', /not allowlisted/i);
});

test('probing resolves generic ids only from their allowlisted route position', async () => {
  const calls: string[] = [];
  const result = await probeDiscoveredApiTemplates({
    async probeGet(_session, endpoint) {
      calls.push(endpoint);
      return { endpoint, status: 200, ok: true };
    },
  }, session, [
    '/api/projects/:id',
    '/api/units/:id',
    '/api/comments/:id',
  ], {
    unitId: 4,
  });

  assert.deepEqual(calls, ['/units/4']);
  assert.deepEqual(result.map((item) => item.status), ['skip', 'ok', 'skip']);
  assert.match(result[0]?.detail ?? '', /id/);
});

test('probing reports skipped candidates once its request budget is exhausted', async () => {
  const calls: string[] = [];
  const result = await probeDiscoveredApiTemplates({
    async probeGet(_session, endpoint) {
      calls.push(endpoint);
      return { endpoint, status: 200, ok: true };
    },
  }, session, [
    '/api/projects/:projectId',
    '/units/:unitId',
    '/units/:unitId/task_prerequisites',
  ], {
    projectId: 9,
    unitId: 4,
  }, {
    requestBudget: 2,
  });

  assert.deepEqual(calls, ['/projects/9', '/units/4']);
  assert.deepEqual(result.map((item) => item.status), ['ok', 'ok', 'skip']);
  assert.match(result[2]?.detail ?? '', /budget exhausted/i);
});

test('probing skips unknown candidates without consuming the request budget', async () => {
  const calls: string[] = [];
  const result = await probeDiscoveredApiTemplates({
    async probeGet(_session, endpoint) {
      calls.push(endpoint);
      return { endpoint, status: 200, ok: true };
    },
  }, session, [
    '/api/projects/:projectId/reset_target_dates',
    '/api/projects/:projectId',
  ], {
    projectId: 9,
  }, {
    requestBudget: 1,
  });

  assert.deepEqual(calls, ['/projects/9']);
  assert.deepEqual(result.map((item) => item.status), ['skip', 'ok']);
});
