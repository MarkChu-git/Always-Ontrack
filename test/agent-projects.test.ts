import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { buildAgentProjectsListOutput } from '../src/lib/agent-projects.js';
import { AgentProtocolError } from '../src/lib/agent-protocol.js';

test('project directory preserves an empty accessible project set', () => {
  assert.deepEqual(buildAgentProjectsListOutput([]), {
    count: 0,
    projects: [],
  });
});

test('project directory fails closed on nested and flat null identity conflicts', () => {
  assert.throws(
    () =>
      buildAgentProjectsListOutput([
        {
          id: 1001,
          unit: { id: 2001, code: 'FIT0001' },
          unit_id: null,
        },
      ]),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
});

test('project directory accepts a flat unit identity when the nested summary omits it', () => {
  assert.deepEqual(
    buildAgentProjectsListOutput([
      {
        id: 1001,
        unit_id: 2001,
        unit: { code: 'FIT0001', name: 'Foundations' },
      },
    ]),
    {
      count: 1,
      projects: [
        {
          project_id: 1001,
          unit_id: 2001,
          unit_code: 'FIT0001',
          unit_name: 'Foundations',
          target_grade: null,
          submitted_grade: null,
          enrolled: null,
          special_consideration_days: null,
          portfolio_available: null,
          escalation_attempts_remaining: null,
        },
      ],
    },
  );
});

test('project directory accepts exactly the maximum 200 projects', () => {
  const output = buildAgentProjectsListOutput(
    Array.from({ length: 200 }, (_, index) => ({
      id: index + 1,
      unit: { id: index + 1001 },
    })),
  );

  assert.equal(output.count, 200);
  assert.equal(output.projects.length, 200);
});

test('project directory normalizes equivalent aliases without projecting identity fields', () => {
  const input = [
    {
      id: 1001,
      unitId: 2001,
      unit_id: 2001,
      unit: { id: 2001, code: ' FIT0001 ', name: ' Foundations ' },
      targetGrade: 0,
      target_grade: 0,
      submittedGrade: 1,
      submitted_grade: 1,
      enrolled: true,
      specConDays: 2,
      spec_con_days: 2,
      portfolioAvailable: false,
      portfolio_available: false,
      escalationAttemptsRemaining: 3,
      escalation_attempts_remaining: 3,
      user_id: 9001,
      campus_id: 8001,
      student: { id: 7001 },
    },
  ];
  const original = structuredClone(input);

  const output = buildAgentProjectsListOutput(input);

  assert.deepEqual(output, {
    count: 1,
    projects: [
      {
        project_id: 1001,
        unit_id: 2001,
        unit_code: 'FIT0001',
        unit_name: 'Foundations',
        target_grade: 0,
        submitted_grade: 1,
        enrolled: true,
        special_consideration_days: 2,
        portfolio_available: false,
        escalation_attempts_remaining: 3,
      },
    ],
  });
  assert.deepEqual(input, original);
  assert.equal(JSON.stringify(output).includes('user_id'), false);
  assert.equal(JSON.stringify(output).includes('campus_id'), false);
  assert.equal(JSON.stringify(output).includes('student'), false);
});

test('project directory rejects malformed, ambiguous, duplicate, and oversized remote data', () => {
  const invalidPayloads: unknown[] = [
    { projects: [] },
    [{ id: 1001 }],
    [
      {
        id: 1001,
        unit: { id: 2001 },
        targetGrade: null,
        target_grade: 1,
      },
    ],
    [
      { id: 1001, unit: { id: 2001 } },
      { id: 1001, unit: { id: 2002 } },
    ],
    [{ id: 1001, unit: { id: 2001, code: 'FIT\u0007' } }],
    [{ id: 1001, unit: { id: 2001, code: 'FIT\u009b31m' } }],
    [{ id: 1001, unit: { id: 2001, name: 'Safe\u202edoc' } }],
    Array.from({ length: 201 }, (_, index) => ({
      id: index + 1,
      unit: { id: index + 1001 },
    })),
  ];

  for (const payload of invalidPayloads) {
    assert.throws(
      () => buildAgentProjectsListOutput(payload),
      (error: unknown) =>
        error instanceof AgentProtocolError &&
        error.code === 'REMOTE_UNAVAILABLE',
    );
  }
});

test('project directory bounds the complete pretty Agent envelope', () => {
  const payload = Array.from({ length: 200 }, (_, index) => ({
    id: index + 1,
    unit: {
      id: index + 1001,
      code: '\ud800'.repeat(80),
      name: '\ud800'.repeat(300),
    },
    targetGrade: Number.MAX_SAFE_INTEGER,
    submittedGrade: Number.MAX_SAFE_INTEGER,
    enrolled: true,
    specConDays: Number.MAX_SAFE_INTEGER,
    portfolioAvailable: true,
    escalationAttemptsRemaining: Number.MAX_SAFE_INTEGER,
  }));

  assert.throws(
    () => buildAgentProjectsListOutput(payload),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
});
