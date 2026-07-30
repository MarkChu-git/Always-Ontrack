import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  diffContractShapes,
  loadContractFixture,
  normalizeProductionPayload,
  normalizeReadOnlyRoute,
  sanitizeProductionPayload,
  validateContractFixture,
} from '../src/lib/contracts.js';

const fixturesRoot = new URL('./fixtures/contracts/', import.meta.url);

test('sanitizer removes credentials, PII, filenames, and token-like values without mutating input', () => {
  const input = {
    auth_token: 'very-secret-token',
    authorization: 'Basic production-credential',
    apiKey: ['synthetic', 'api', 'canary'].join('-'),
    csrf: 'production-csrf-token',
    username: 'student@example.edu',
    user: {
      email: 'student@example.edu',
      contactEmail: 'student@example.edu',
      id: 42,
      student_number: '12345678',
      profile: {
        id: 43,
        phone: '0400 000 000',
        homeAddress: '1 Example Street',
      },
      role: 'Student',
    },
    students: [{ id: 84, role: 'Student' }],
    task_definition: { id: 3001, abbreviation: 'T1' },
    evidence: {
      filename: 'alice-assignment.pdf',
      originalFileName: 'alice-assignment.pdf',
      checksum: 'safe-shape-field',
    },
    note: 'Authorization: Bearer very-secret-token',
  };

  const sanitized = sanitizeProductionPayload(input);

  assert.deepEqual(sanitized, {
    user: { profile: {}, role: 'Student' },
    students: [{ role: 'Student' }],
    task_definition: { id: 3001, abbreviation: 'T1' },
    evidence: { checksum: 'safe-shape-field' },
    note: '[redacted]',
  });
  assert.equal(input.auth_token, 'very-secret-token');
  assert.equal(input.evidence.filename, 'alice-assignment.pdf');
});

test('read-only route normalizer accepts only allowlisted GET/HEAD routes', () => {
  assert.deepEqual(
    normalizeReadOnlyRoute('get', 'https://ontrack.infotech.monash.edu/api//projects/42/?unused=value'),
    {
      method: 'GET',
      route: '/projects/42',
      template: '/projects/:projectId',
    },
  );
  assert.deepEqual(normalizeReadOnlyRoute('HEAD', '/units/7/task_prerequisites'), {
    method: 'HEAD',
    route: '/units/7/task_prerequisites',
    template: '/units/:unitId/task_prerequisites',
  });
  assert.deepEqual(
    normalizeReadOnlyRoute(
      'GET',
      '/projects/42/task_def_id/9/submission_details',
    ),
    {
      method: 'GET',
      route: '/projects/42/task_def_id/9/submission_details',
      template:
        '/projects/:projectId/task_def_id/:taskDefId/submission_details',
    },
  );
  assert.deepEqual(
    normalizeReadOnlyRoute(
      'GET',
      '/units/7/task_definitions/9/prerequisites',
    ),
    {
      method: 'GET',
      route: '/units/7/task_definitions/9/prerequisites',
      template:
        '/units/:unitId/task_definitions/:taskDefId/prerequisites',
    },
  );
  assert.throws(() => normalizeReadOnlyRoute('POST', '/projects/42'), /GET and HEAD/);
  assert.throws(() => normalizeReadOnlyRoute('GET', '/auth'), /not allowlisted/);
});

test('shape normalizer retains field types and safe enums while drift detects missing and changed fields', () => {
  const expected = normalizeProductionPayload({
    status: 'working',
    processing_pdf: false,
    task: { id: 4 },
  });
  const observed = normalizeProductionPayload({
    status: 3,
    task: {},
  });

  assert.deepEqual(expected, {
    type: 'object',
    fields: {
      processing_pdf: { type: 'boolean' },
      status: { type: 'string', enum: ['working'] },
      task: {
        type: 'object',
        fields: { id: { type: 'number' } },
      },
    },
  });
  assert.deepEqual(diffContractShapes(expected, observed), [
    { kind: 'type_changed', path: '$.status', expected: 'string', observed: 'number' },
    { kind: 'field_missing', path: '$.processing_pdf', expected: 'boolean' },
    { kind: 'field_missing', path: '$.task.id', expected: 'number' },
  ]);
});

test('array contract shape is order and cardinality independent for repeated item schemas', () => {
  const one = normalizeProductionPayload({
    tasks: [{ id: 1, status: 'working' }],
  });
  const many = normalizeProductionPayload({
    tasks: [
      { id: 2, status: 'working' },
      { id: 3, status: 'working' },
      { id: 4, status: 'working' },
    ],
  });

  assert.deepEqual(diffContractShapes(one, many), []);
  assert.deepEqual(diffContractShapes(many, one), []);
});

test('fixture loader validates provenance and returns the mandatory empty-project-task catalog', async () => {
  const fixture = await loadContractFixture(fixturesRoot, 'project-empty-tasks-with-unit-definitions');

  assert.equal(fixture.metadata.provenance.trust, 'student-verified');
  assert.equal(fixture.metadata.provenance.risk, 'read-only');
  assert.deepEqual(fixture.payload, {
    project: { id: 1001, tasks: [], unit_id: 2001 },
    unit: {
      id: 2001,
      task_definitions: [
        { abbreviation: 'T1', id: 3001, name: 'Task 1' },
        { abbreviation: 'T2', id: 3002, name: 'Task 2' },
      ],
    },
  });
  assert.equal(validateContractFixture(fixture).valid, true);
});

test('the remaining fixture catalog is synthetic, valid, and records contract-specific evidence', async () => {
  const fixtures = await Promise.all([
    loadContractFixture(fixturesRoot, 'access-token-shape'),
    loadContractFixture(fixturesRoot, 'submission-details-shape'),
    loadContractFixture(fixturesRoot, 'planner-prerequisites-shape'),
  ]);

  assert.deepEqual(
    fixtures.map((fixture) => [fixture.metadata.id, fixture.metadata.provenance.risk]),
    [
      ['access-token-shape', 'identity-sensitive'],
      ['submission-details-shape', 'read-only'],
      ['planner-prerequisites-shape', 'read-only'],
    ],
  );
  assert.equal(fixtures[0].shape?.type, 'object');
  assert.equal(
    fixtures[1].metadata.route,
    '/projects/:projectId/task_def_id/:taskDefId/submission_details',
  );
  assert.equal(
    fixtures[2].metadata.route,
    '/units/:unitId/task_prerequisites',
  );
  assert.deepEqual(fixtures[1].payload, {
    has_pdf: true,
    processing_pdf: false,
    submission_date: '2030-01-01T00:00:00.000Z',
    task_status: 'working',
  });
  assert.deepEqual(fixtures[2].payload, [
    {
      id: 1,
      prerequisite_id: 3000,
      task_definition_id: 3001,
      task_status: 'complete',
    },
  ]);
});

test('fixture validator refuses leaked PII and contract metadata without provenance', () => {
  const invalid = {
    metadata: {
      id: 'unsafe',
      schemaVersion: 1,
      method: 'GET',
      route: '/projects',
    },
    payload: { email: 'student@example.edu' },
  };

  const result = validateContractFixture(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /provenance|sensitive/i);
});

test('fixture validator refuses stable person identifiers and common credential fields', () => {
  const invalid = {
    metadata: {
      id: 'unsafe-identity',
      schemaVersion: 1,
      method: 'GET',
      route: '/projects',
      provenance: {
        observedAt: '2026-07-31',
        role: 'Student',
        risk: 'identity-sensitive',
        trust: 'http-observed',
      },
    },
    payload: {
      user: { id: 42, role: 'Student' },
      apiKey: ['synthetic', 'api', 'canary'].join('-'),
      session_id: 'production-session',
    },
  };

  const result = validateContractFixture(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /user\.id|apiKey|session_id/);
});

test('fixture validator scans metadata, provenance, and shape enums for sensitive values', () => {
  const fixture = {
    metadata: {
      id: 'unsafe-metadata',
      schemaVersion: 1,
      method: 'GET',
      route: '/projects',
      provenance: {
        observedAt: '2026-07-31',
        role: 'student@example.edu',
        risk: 'read-only',
        trust: 'http-observed',
      },
      supportPhone: '0400 000 000',
    },
    payload: { status: 'working' },
    shape: {
      type: 'object',
      fields: {
        status: {
          type: 'string',
          enum: ['student@example.edu'],
        },
      },
    },
  };

  const result = validateContractFixture(fixture);
  assert.equal(result.valid, false);
  assert.match(
    result.errors.join('\n'),
    /metadata\.supportPhone|provenance\.role|shape.*enum/i,
  );
});

test('fixture validator rejects hidden top-level data and nested person identity', () => {
  const invalid = {
    metadata: {
      id: 'unsafe-extra-data',
      schemaVersion: 1,
      method: 'GET',
      route: '/projects',
      provenance: {
        observedAt: '2026-07-31',
        role: 'Student',
        risk: 'read-only',
        trust: 'http-observed',
      },
    },
    payload: {
      user: {
        profile: {
          id: 42,
          postal_address: '1 Example Street',
        },
      },
    },
    rawResponse: {
      api_key: ['must', 'not', 'be', 'ignored'].join('-'),
    },
  };

  const result = validateContractFixture(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /profile\.id|postal_address|rawResponse/i);
});

test('fixture validator requires declared shape to match payload except explicit redacted fields', () => {
  const invalid = {
    metadata: {
      id: 'shape-mismatch',
      schemaVersion: 1,
      method: 'GET',
      route: '/projects',
      provenance: {
        observedAt: '2026-07-31',
        role: 'Student',
        risk: 'read-only',
        trust: 'http-observed',
      },
    },
    payload: { status: 'working' },
    shape: {
      type: 'object',
      fields: {
        status: { type: 'number' },
      },
    },
  };

  const result = validateContractFixture(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /shape.*payload/i);
});
