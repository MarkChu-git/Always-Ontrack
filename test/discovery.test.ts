import test from 'node:test';
import assert from 'node:assert/strict';
import type { SessionData } from '../src/lib/types.js';
import {
  classifyDiscoveredPaths,
  extractDiscoveredPaths,
  extractJavascriptAssetPaths,
  probeDiscoveredApiTemplates,
} from '../src/lib/discovery.js';

const session: SessionData = {
  baseUrl: 'https://ontrack.infotech.monash.edu/api',
  username: 'student1',
  authToken: 'token',
  user: {
    id: 1,
    role: 'Student',
  },
  savedAt: '2026-03-11T00:00:00.000Z',
};

test('extractJavascriptAssetPaths extracts script and modulepreload assets', () => {
  const html = `
    <html>
      <head>
        <link rel="modulepreload" href="chunk-AAA.js">
      </head>
      <body>
        <script src="/polyfills-BBB.js"></script>
        <script src="main-CCC.js" type="module"></script>
      </body>
    </html>
  `;

  const assets = extractJavascriptAssetPaths(html).sort();
  assert.deepEqual(assets, ['/polyfills-BBB.js', 'chunk-AAA.js', 'main-CCC.js']);
});

test('extractDiscoveredPaths normalizes angular resource placeholders', () => {
  const source = `
    const a = "/projects/:projectId:/task_def_id/:taskDefId:/comments";
    const b = "/units/:id:/tasks/inbox";
    const c = "/home";
    const d = "/assets/icons/icon.svg";
  `;

  const paths = extractDiscoveredPaths(source).sort();
  assert.deepEqual(paths, [
    '/home',
    '/projects/:projectId/task_def_id/:taskDefId/comments',
    '/units/:id/tasks/inbox',
  ]);
});

test('classifyDiscoveredPaths splits ui routes and api templates', () => {
  const classified = classifyDiscoveredPaths([
    '/home',
    '/projects/:projectId',
    '/units/:id/tasks/inbox',
    '/projects/:projectId/task_def_id/:taskDefId/comments',
    '/api/admin/disk_space',
  ]);

  assert.deepEqual(classified.uiRoutes, ['/home', '/projects/:projectId']);
  assert.deepEqual(classified.apiTemplates, [
    '/api/admin/disk_space',
    '/projects/:projectId/task_def_id/:taskDefId/comments',
    '/units/:id/tasks/inbox',
  ]);
});

test('probeDiscoveredApiTemplates probes resolvable templates and skips unresolved ones', async () => {
  const calls: string[] = [];
  const api = {
    async listProjects() {
      return [
        {
          id: 87,
          unit: { id: 1 },
          tasks: [
            {
              id: 10,
              definition: { id: 412, abbreviation: 'D4' },
            },
          ],
        },
      ];
    },
    async probeGet(_: SessionData, endpointPath: string) {
      calls.push(endpointPath);
      return {
        endpoint: endpointPath,
        status: endpointPath.includes('inbox') ? 403 : 200,
        ok: !endpointPath.includes('inbox'),
      };
    },
  };

  const results = await probeDiscoveredApiTemplates(api, session, [
    '/projects/:projectId/task_def_id/:taskDefId/comments',
    '/units/:id/tasks/inbox',
    '/projects/:project_id/task_def_id/:task_definition_id/scorm-player/review/:test_attempt_id',
  ]);

  assert.deepEqual(calls, [
    '/projects/87/task_def_id/412/comments',
    '/units/1/tasks/inbox',
  ]);

  assert.equal(results[0].status, 'ok');
  assert.equal(results[1].status, 'error');
  assert.equal(results[2].status, 'skip');
  assert.match(results[2].detail, /test_attempt_id/);
});
