import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  createAgentExecutionEngine,
  defineAgentCommand,
  exitCodeForAgentEnvelope,
} from '../src/lib/agent-execution-engine.js';
import {
  agentPlanShowInputSchema,
  agentPlanShowOutputSchema,
  createNativeAgentCommands,
} from '../src/lib/agent-commands.js';
import { getCommandSpec } from '../src/lib/command-spec.js';

const readPolicy = {
  risk: 'read' as const,
  auth: 'none' as const,
  interaction: 'never' as const,
  confirmation: 'none' as const,
  idempotency: 'not_applicable' as const,
  streaming: false,
};

test('engine validates input before execution and exposes schema-derived metadata', async () => {
  let executions = 0;
  const engine = createAgentExecutionEngine([
    defineAgentCommand({
      path: 'fixture.echo',
      description: 'Echo a validated fixture value.',
      policy: readPolicy,
      input: z.object({ value: z.string().min(1) }).strict(),
      output: z.object({ echoed: z.string() }).strict(),
      execute: async (input) => {
        executions += 1;
        return { echoed: input.value };
      },
    }),
  ], { requestId: () => 'req_fixture' });

  const invalid = await engine.call({
    command: 'fixture.echo',
    input: { value: '' },
  });
  assert.equal(executions, 0);
  assert.equal(invalid.command, 'fixture.echo');
  assert.equal('error' in invalid ? invalid.error.code : 'success', 'INVALID_ARGUMENT');
  assert.equal(exitCodeForAgentEnvelope(invalid), 2);

  const success = await engine.call({
    command: 'fixture.echo',
    input: { value: 'agent-first' },
  });
  assert.equal(success.status, 'success');
  assert.deepEqual((success as { data: unknown }).data, { echoed: 'agent-first' });
  assert.equal(success.request_id, 'req_fixture');

  const description = engine.describe('fixture.echo');
  assert.equal(description.input_schema.type, 'object');
  assert.deepEqual(description.input_schema.required, ['value']);
  assert.equal(engine.capabilities().length, 1);
});

test('engine fails closed for unsafe input, unknown commands, and output drift', async () => {
  const engine = createAgentExecutionEngine([
    defineAgentCommand({
      path: 'fixture.bad-output',
      description: 'Return an invalid fixture output.',
      policy: readPolicy,
      input: z.object({}).strict(),
      output: z.object({ ok: z.literal(true) }).strict(),
      execute: async () => ({ ok: false }),
    }),
  ]);

  const unsafe = await engine.call({
    command: 'fixture.bad-output',
    input: { constructor: { leaked: 'secret' } },
  });
  assert.equal('error' in unsafe ? unsafe.error.code : 'success', 'INVALID_ARGUMENT');
  assert.equal(JSON.stringify(unsafe).includes('secret'), false);

  const unknown = await engine.call({ command: 'fixture.missing', input: {} });
  assert.equal('error' in unknown ? unknown.error.code : 'success', 'INVALID_ARGUMENT');

  const drift = await engine.call({ command: 'fixture.bad-output', input: {} });
  assert.equal('error' in drift ? drift.error.code : 'success', 'INTERNAL_ERROR');
  assert.equal(exitCodeForAgentEnvelope(drift), 10);
});

test('engine executes declared auth and confirmation policy gates before handlers', async () => {
  const events: string[] = [];
  const engine = createAgentExecutionEngine(
    [
      defineAgentCommand({
        path: 'fixture.write',
        description: 'A guarded fixture write.',
        policy: {
          risk: 'write',
          auth: 'ensure',
          interaction: 'never',
          confirmation: 'required',
          idempotency: 'client_guarded',
          streaming: false,
        },
        input: z.object({ value: z.string() }).strict(),
        output: z.object({ ok: z.literal(true) }).strict(),
        execute: async () => {
          events.push('execute');
          return { ok: true };
        },
      }),
    ],
    {
      policyRuntime: {
        ensureAuth: async () => events.push('auth'),
        confirm: async () => events.push('confirm'),
        checkIdempotency: async () => events.push('idempotency'),
      },
      requestId: () => 'req_policy',
    },
  );

  const result = await engine.call({
    command: 'fixture.write',
    input: { value: 'ok' },
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(events, ['auth', 'confirm', 'idempotency', 'execute']);
});

test('engine fails closed when a declared confirmation policy has no runtime', async () => {
  const engine = createAgentExecutionEngine(
    [
      defineAgentCommand({
        path: 'fixture.guarded',
        description: 'A guarded fixture command.',
        policy: {
          risk: 'write',
          auth: 'ensure',
          interaction: 'never',
          confirmation: 'required',
          idempotency: 'client_guarded',
          streaming: false,
        },
        input: z.object({}).strict(),
        output: z.object({ ok: z.literal(true) }).strict(),
        execute: async () => ({ ok: true }),
      }),
    ],
    { policyRuntime: { ensureAuth: async () => {} } },
  );

  const result = await engine.call({ command: 'fixture.guarded', input: {} });
  assert.equal('error' in result ? result.error.code : 'success', 'CONFIRMATION_REQUIRED');
  assert.equal(exitCodeForAgentEnvelope(result), 6);
});

test('engine rejects unsafe write policy combinations at registration', () => {
  const unsafe = defineAgentCommand({
    path: 'fixture.unsafe-write',
    description: 'An intentionally invalid fixture policy.',
    policy: {
      risk: 'write',
      auth: 'none',
      interaction: 'never',
      confirmation: 'none',
      idempotency: 'not_applicable',
      streaming: false,
    } as never,
    input: z.object({}).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
    execute: async () => ({ ok: true }),
  });

  assert.throws(
    () => createAgentExecutionEngine([unsafe]),
    /Unsafe write policy/,
  );
});

test('policy gates receive the same Zod-normalized input as execution', async () => {
  const observed: unknown[] = [];
  const engine = createAgentExecutionEngine(
    [
      defineAgentCommand({
        path: 'fixture.normalized-write',
        description: 'A normalized write fixture.',
        policy: {
          risk: 'write',
          auth: 'ensure',
          interaction: 'never',
          confirmation: 'required',
          idempotency: 'client_guarded',
          streaming: false,
        },
        input: z
          .object({
            value: z.string().trim(),
            mode: z.string().default('safe'),
          })
          .strict(),
        output: z.object({ ok: z.literal(true) }).strict(),
        execute: async (input) => {
          observed.push(input);
          return { ok: true };
        },
      }),
    ],
    {
      policyRuntime: {
        ensureAuth: async () => {},
        confirm: async (_command, input) => observed.push(input),
        checkIdempotency: async (_command, request) =>
          observed.push(request.input),
      },
    },
  );

  const result = await engine.call({
    command: 'fixture.normalized-write',
    input: { value: '  normalized  ' },
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(observed, [
    { value: 'normalized', mode: 'safe' },
    { value: 'normalized', mode: 'safe' },
    { value: 'normalized', mode: 'safe' },
  ]);
});

test('native definitions keep safety metadata aligned with the compatibility projection', () => {
  const commands = createNativeAgentCommands({
    authStatus: async () => ({ status: 'signed_out', baseUrl: 'https://example.test/api' }),
    taskShow: async () => ({ project_id: 1, count: 0, tasks: [] }),
    taskPrerequisites: async () => ({
      project_id: 1,
      unit_id: 2,
      task_definition_id: 3,
      count: 0,
      prerequisites: [],
    }),
    taskResources: async () => ({
      project_id: 1,
      selected_count: 0,
      downloaded_count: 0,
      unavailable_count: 0,
      downloads: [],
      unavailable: [],
    }),
    planShow: async () => ({
      project_id: 1,
      unit_id: 2,
      unit_code: 'FIT0001',
      include_beyond_target: false,
      count: 0,
      tasks: [],
    }),
    submissionStatus: async () => ({
      project_id: 1,
      unit_id: 2,
      unit_code: 'FIT0001',
      task_definition_id: 3,
      task_instance_id: null,
      abbreviation: 'P1',
      instantiated: false,
      has_pdf: true,
      processing_pdf: false,
      pdf_state: 'ready',
      submission_date: '2030-01-01T00:00:00.000Z',
      task_status: 'working',
      submission_observed: true,
    }),
  });

  assert.equal(commands.some((command) => command.path === 'plan.show'), true);
  assert.equal(commands.some((command) => command.path === 'submission.status'), true);

  for (const command of commands) {
    const legacy = getCommandSpec(command.path);
    assert.equal(command.description, legacy.description);
    assert.equal(command.policy.risk, legacy.risk);
    assert.equal(command.policy.auth === 'ensure', legacy.auth_required);
    assert.equal(command.policy.confirmation, legacy.confirmation);
    assert.equal(command.policy.idempotency, legacy.idempotency);
    assert.equal(command.policy.streaming, legacy.streaming);
    if (
      command.path === 'task.prerequisites' ||
      command.path === 'submission.status'
    ) {
      const nativeSchema = z.toJSONSchema(command.input) as {
        anyOf: Array<{ properties: Record<string, Record<string, unknown>> }>;
      };
      const compatibilityProperties = legacy.input_schema.properties as Record<
        string,
        Record<string, unknown>
      >;
      for (const variant of nativeSchema.anyOf) {
        assert.equal(
          variant.properties.project_id.maximum,
          compatibilityProperties.project_id.maximum,
        );
        assert.equal(
          variant.properties.project_id.exclusiveMinimum,
          Number(compatibilityProperties.project_id.minimum) - 1,
        );
        assert.equal(
          variant.properties.abbreviation?.pattern,
          compatibilityProperties.abbreviation.pattern,
        );
        assert.equal(
          variant.properties.abbreviation?.maxLength,
          compatibilityProperties.abbreviation.maxLength,
        );
        if (variant.properties.task_definition_id) {
          assert.equal(
            variant.properties.task_definition_id.maximum,
            compatibilityProperties.task_definition_id.maximum,
          );
          assert.equal(
            variant.properties.task_definition_id.exclusiveMinimum,
            Number(compatibilityProperties.task_definition_id.minimum) - 1,
          );
        }
      }
    }
  }

  const plan = commands.find((command) => command.path === 'plan.show');
  assert.ok(plan);
  assert.deepEqual(z.toJSONSchema(plan.input), z.toJSONSchema(agentPlanShowInputSchema));
  assert.deepEqual(z.toJSONSchema(plan.output), z.toJSONSchema(agentPlanShowOutputSchema));
  assert.deepEqual(plan.policy, {
    risk: 'read',
    auth: 'ensure',
    interaction: 'never',
    confirmation: 'none',
    idempotency: 'not_applicable',
    streaming: false,
  });
});
