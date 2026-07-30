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

test('surface discovery records successful and failed assets without network access', async () => {
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    if (url === 'https://example.test/home') {
      return new Response('<script src="/ok.js"></script><script src="/bad.js"></script>');
    }
    if (url.endsWith('/ok.js')) {
      return new Response("'/tasks' '/api/projects/:projectId'");
    }
    return new Response('missing', { status: 404, statusText: 'Not Found' });
  }) as typeof fetch;
  const result = await discoverOnTrackSurface('https://example.test/home');
  assert.equal(result.assets.length, 2);
  assert.equal(result.assets[0].status, 'ok');
  assert.deepEqual(result.uiRoutes, ['/tasks']);
  assert.deepEqual(result.apiTemplates, ['/api/projects/:projectId']);
  assert.match(result.assets[1].detail || '', /404 Not Found/);
});

test('probing materializes known params and reports unresolved/error result states', async () => {
  const calls: string[] = [];
  const result = await probeDiscoveredApiTemplates({
    async listProjects() {
      return [{ id: 9, unit: { id: 4 }, tasks: [{ task_definition_id: 7 }] }];
    },
    async probeGet(_session, endpoint) {
      calls.push(endpoint);
      if (endpoint.includes('broken')) throw new Error('blocked');
      return { endpoint, status: 200, ok: true };
    },
  }, session, [
    '/api/projects/:projectId',
    '/units/:unitId/task_definitions/:taskDefId',
    '/api/:unknown',
    '/broken/:projectId',
  ]);
  assert.deepEqual(calls, ['/api/projects/9', '/units/4/task_definitions/7', '/broken/9']);
  assert.deepEqual(result.map((item) => item.status), ['ok', 'ok', 'skip', 'error']);
  assert.match(result[2].detail, /unknown/);
  assert.equal(result[3].detail, 'blocked');
});
