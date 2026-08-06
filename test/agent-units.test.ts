import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAgentUnitShow } from '../src/lib/agent-units.js';
import { AgentProtocolError } from '../src/lib/agent-protocol.js';

test('project-scoped Agent unit summary projects observed unit detail without staff or raw definitions', async () => {
  const readUnitIds: number[] = [];
  const showUnit = createAgentUnitShow({
    readProject: async () => ({
      id: 1001,
      unit: { id: 2001, code: 'FIT0001', name: 'Foundations' },
      target_grade: 1,
      submitted_grade: 0,
      enrolled: true,
    }),
    readUnit: async (unitId) => {
      readUnitIds.push(unitId);
      return {
        id: 2001,
        code: 'FIT0001',
        name: 'Foundations',
        active: true,
        task_definitions: [{ id: 3001 }, { id: 3002 }],
        staff: [{ email: 'staff-private-marker@example.invalid' }],
        tutorials: [{ id: 4001, students: [{ id: 5001 }] }],
      };
    },
  });

  const output = await showUnit({ project_id: 1001 });

  assert.deepEqual(readUnitIds, [2001]);
  assert.deepEqual(output, {
    project_id: 1001,
    unit_id: 2001,
    unit_code: 'FIT0001',
    unit_name: 'Foundations',
    target_grade: 1,
    submitted_grade: 0,
    enrolled: true,
    active: true,
    task_definition_count: 2,
  });
  assert.equal(JSON.stringify(output).includes('staff-private-marker'), false);
  assert.equal(JSON.stringify(output).includes('tutorials'), false);
});

test('project-scoped Agent unit summary validates project identity before reading its unit', async () => {
  let unitReads = 0;
  const showUnit = createAgentUnitShow({
    readProject: async () => ({ id: 1002, unit_id: 2001 }),
    readUnit: async () => {
      unitReads += 1;
      return { id: 2001, task_definitions: [] };
    },
  });

  await assert.rejects(
    () => showUnit({ project_id: 1001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE' &&
      error.summary === 'OnTrack returned an unexpected project identity.',
  );
  assert.equal(unitReads, 0);
});

test('project-scoped Agent unit summary rejects a caller unit hint outside the project scope', async () => {
  let unitReads = 0;
  const showUnit = createAgentUnitShow({
    readProject: async () => ({ id: 1001, unit_id: 2001 }),
    readUnit: async () => {
      unitReads += 1;
      return { id: 2001, task_definitions: [] };
    },
  });

  await assert.rejects(
    () => showUnit({ project_id: 1001, unit_id: 2999 }),
    (error: unknown) =>
      error instanceof AgentProtocolError && error.code === 'INVALID_ARGUMENT',
  );
  assert.equal(unitReads, 0);
});

test('project-scoped Agent unit summary validates project capabilities before reading its unit', async () => {
  const malformedProjects = [
    { id: 1001, unit_id: 2001, target_grade: '1' },
    { id: 1001, unit_id: 2001, targetGrade: 1, target_grade: 2 },
    { id: 1001, unit_id: 2001, enrolled: 'true' },
  ];

  for (const project of malformedProjects) {
    let unitReads = 0;
    const showUnit = createAgentUnitShow({
      readProject: async () => project,
      readUnit: async () => {
        unitReads += 1;
        return { id: 2001, task_definitions: [] };
      },
    });

    await assert.rejects(
      () => showUnit({ project_id: 1001 }),
      (error: unknown) =>
        error instanceof AgentProtocolError && error.code === 'REMOTE_UNAVAILABLE',
    );
    assert.equal(unitReads, 0);
  }
});

test('project-scoped Agent unit summary fails closed on unit identity and catalogue contract drift', async () => {
  const invalidUnits = [
    { id: 2999, task_definitions: [] },
    { id: 2001, task_definitions: [{ id: 3001 }, { id: 3001 }] },
    { id: 2001, task_definitions: 'not-an-array' },
    {
      id: 2001,
      taskDefinitions: [{ id: 3001 }],
      task_definitions: [{ id: 3002 }],
    },
  ];

  for (const unit of invalidUnits) {
    const showUnit = createAgentUnitShow({
      readProject: async () => ({ id: 1001, unit_id: 2001 }),
      readUnit: async () => unit,
    });

    await assert.rejects(
      () => showUnit({ project_id: 1001 }),
      (error: unknown) =>
        error instanceof AgentProtocolError && error.code === 'REMOTE_UNAVAILABLE',
    );
  }
});

test('project-scoped Agent unit summary rejects unsafe aliases and conflicting project metadata', async () => {
  const unsafeUnitCodes = ['FIT\u0007', 'FIT\u202e0001'];
  for (const code of unsafeUnitCodes) {
    const showUnit = createAgentUnitShow({
      readProject: async () => ({ id: 1001, unit: { id: 2001 } }),
      readUnit: async () => ({ id: 2001, code, task_definitions: [] }),
    });
    await assert.rejects(
      () => showUnit({ project_id: 1001 }),
      (error: unknown) =>
        error instanceof AgentProtocolError && error.code === 'REMOTE_UNAVAILABLE',
    );
  }

  const showUnit = createAgentUnitShow({
    readProject: async () => ({
      id: 1001,
      unit: { id: 2001, code: 'FIT0001' },
    }),
    readUnit: async () => ({
      id: 2001,
      code: 'FIT0002',
      task_definitions: [],
    }),
  });
  await assert.rejects(
    () => showUnit({ project_id: 1001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE' &&
      error.summary === 'OnTrack returned conflicting unit code metadata.',
  );
});

test('project-scoped Agent unit summary accepts 200 compact definitions and rejects larger catalogues', async () => {
  const definitions = Array.from({ length: 200 }, (_, index) => ({ id: index + 1 }));
  const showUnit = createAgentUnitShow({
    readProject: async () => ({ id: 1001, unit_id: 2001 }),
    readUnit: async () => ({ id: 2001, task_definitions: definitions }),
  });

  const output = await showUnit({ project_id: 1001 });
  assert.equal(output.task_definition_count, 200);

  const oversized = createAgentUnitShow({
    readProject: async () => ({ id: 1001, unit_id: 2001 }),
    readUnit: async () => ({
      id: 2001,
      task_definitions: Array.from({ length: 201 }, (_, index) => ({ id: index + 1 })),
    }),
  });
  await assert.rejects(
    () => oversized({ project_id: 1001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError && error.code === 'REMOTE_UNAVAILABLE',
  );
});
