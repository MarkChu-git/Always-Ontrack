import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  agentProjectsListInputSchema,
  agentProjectsListOutputSchema,
  agentUnitShowInputSchema,
  agentUnitShowOutputSchema,
  agentTasksListInputSchema,
  agentTasksListOutputSchema,
  agentPlanShowInputSchema,
  agentPlanShowOutputSchema,
  agentSubmissionStatusOutputSchema,
} from '../src/lib/agent-commands.js';
import {
  AGENT_COMMAND_SPECS,
  buildCapabilities,
  getCommandSpec,
  resolveCommandPath,
} from '../src/lib/command-spec.js';

test('command registry has unique stable paths and explicit safety metadata', () => {
  const paths = AGENT_COMMAND_SPECS.map((spec) => spec.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.includes('auth.ensure'));
  assert.ok(paths.includes('projects.list'));
  assert.ok(paths.includes('task.resources'));
  assert.ok(paths.includes('submission.upload'));

  for (const spec of AGENT_COMMAND_SPECS) {
    assert.equal(typeof spec.auth_required, 'boolean');
    assert.ok(['read', 'write', 'auth', 'local'].includes(spec.risk));
    assert.equal(spec.input_schema.type, 'object');
    if (spec.risk === 'write') {
      assert.equal(spec.confirmation, 'required');
    }
  }
});

test('capabilities are offline projections and do not expose implementation secrets', () => {
  const capabilities = buildCapabilities('0.5.0');
  assert.equal(capabilities.protocol, 'ontrack.agent/v1');
  assert.equal(capabilities.cli_version, '0.5.0');
  assert.deepEqual(capabilities.exit_codes['3'], 'authentication or human verification required');
  assert.equal(JSON.stringify(capabilities).includes('authToken'), false);
  assert.equal(JSON.stringify(capabilities).includes('cookie'), false);
});

test('command path resolution handles grouped and top-level commands', () => {
  assert.equal(resolveCommandPath(['projects']), 'projects.list');
  assert.equal(resolveCommandPath(['project', 'show']), 'project.show');
  assert.equal(resolveCommandPath(['task', 'resources']), 'task.resources');
  assert.equal(resolveCommandPath(['task', 'show']), 'task.show');
  assert.equal(resolveCommandPath(['auth', 'ensure']), 'auth.ensure');
  assert.equal(resolveCommandPath(['not-a-command']), 'not-a-command');
  assert.equal(getCommandSpec('task.show').path, 'task.show');
  const resources = getCommandSpec('task.resources');
  assert.ok(Array.isArray(resources.input_schema.allOf));
  assert.ok(JSON.stringify(resources.input_schema).includes('task_definition_id'));
  const projects = getCommandSpec('projects.list');
  assert.deepEqual(projects.input_schema, z.toJSONSchema(agentProjectsListInputSchema));
  assert.deepEqual(projects.output_schema, z.toJSONSchema(agentProjectsListOutputSchema));
  assert.equal(projects.output_schema.additionalProperties, false);
  assert.equal(JSON.stringify(projects.output_schema).includes('user_id'), false);
  const tasks = getCommandSpec('tasks.list');
  assert.deepEqual(tasks.input_schema, z.toJSONSchema(agentTasksListInputSchema));
  assert.deepEqual(tasks.output_schema, z.toJSONSchema(agentTasksListOutputSchema));
  assert.equal(tasks.input_schema.additionalProperties, false);
  assert.equal(tasks.output_schema.additionalProperties, false);
  assert.deepEqual(tasks.input_schema.required, ['project_id']);
  assert.equal(JSON.stringify(tasks.output_schema).includes('task_id'), false);
  assert.equal(JSON.stringify(tasks.output_schema).includes('student'), false);
  const unit = getCommandSpec('unit.show');
  assert.deepEqual(unit.input_schema, z.toJSONSchema(agentUnitShowInputSchema));
  assert.deepEqual(unit.output_schema, z.toJSONSchema(agentUnitShowOutputSchema));
  assert.deepEqual(unit.input_schema.required, ['project_id']);
  assert.equal(unit.input_schema.additionalProperties, false);
  assert.equal(unit.output_schema.additionalProperties, false);
  assert.equal(JSON.stringify(unit.output_schema).includes('staff'), false);
  assert.equal(JSON.stringify(unit.output_schema).includes('task_definitions'), false);
  const prerequisites = getCommandSpec('task.prerequisites');
  assert.deepEqual(prerequisites.input_schema.anyOf, [
    { required: ['task_definition_id'] },
    { required: ['abbreviation'] },
  ]);
  const prerequisiteProperties = prerequisites.input_schema.properties as Record<
    string,
    Record<string, unknown>
  >;
  assert.equal(prerequisiteProperties.project_id.minimum, 1);
  assert.equal(prerequisiteProperties.project_id.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(prerequisiteProperties.task_definition_id.minimum, 1);
  assert.equal(
    prerequisiteProperties.task_definition_id.maximum,
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(prerequisiteProperties.abbreviation.pattern, "\\S");
  const submissionStatus = getCommandSpec('submission.status');
  assert.deepEqual(submissionStatus.input_schema.anyOf, [
    { required: ['task_definition_id'] },
    { required: ['abbreviation'] },
  ]);
  assert.deepEqual(
    submissionStatus.input_schema.properties,
    prerequisites.input_schema.properties,
  );
  const submissionOutput = submissionStatus.output_schema as Record<string, unknown>;
  const submissionOutputProperties = submissionOutput.properties as Record<
    string,
    Record<string, unknown>
  >;
  assert.equal(submissionOutput.type, 'object');
  assert.equal(submissionOutput.additionalProperties, false);
  assert.equal(submissionOutputProperties.pdf_state.enum.join(','), 'unavailable,processing,ready');
  assert.deepEqual(submissionOutput.required, [
    'project_id',
    'unit_id',
    'unit_code',
    'task_definition_id',
    'task_instance_id',
    'abbreviation',
    'instantiated',
    'has_pdf',
    'processing_pdf',
    'pdf_state',
    'submission_date',
    'task_status',
    'submission_observed',
  ]);
  assert.deepEqual(
    submissionStatus.output_schema,
    z.toJSONSchema(agentSubmissionStatusOutputSchema),
  );
  const planShow = getCommandSpec('plan.show');
  assert.deepEqual(planShow.input_schema, z.toJSONSchema(agentPlanShowInputSchema));
  assert.deepEqual(planShow.output_schema, z.toJSONSchema(agentPlanShowOutputSchema));
  assert.equal(
    (planShow.input_schema.properties as Record<string, Record<string, unknown>>)
      .project_id.maximum,
    Number.MAX_SAFE_INTEGER,
  );
  assert.throws(() => getCommandSpec('missing.command'), /Unknown Agent command/);
});
