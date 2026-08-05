import { z } from 'zod';
import { agentSubmissionStatusOutputSchema } from './agent-commands.js';

export type AgentCommandRisk = 'read' | 'write' | 'auth' | 'local';
export type CommandInputType = 'string' | 'integer' | 'boolean' | 'string_array';

export interface CommandInputField {
  readonly flag: string;
  readonly type: CommandInputType;
  readonly required?: boolean;
  readonly enum?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: RegExp;
}

export interface AgentCommandSpec {
  readonly path: string;
  readonly description: string;
  readonly risk: AgentCommandRisk;
  readonly auth_required: boolean;
  readonly human_interaction: 'never' | 'if_required' | 'always';
  readonly confirmation: 'none' | 'required';
  readonly idempotency: 'not_applicable' | 'client_guarded' | 'unknown_outcome_guarded';
  readonly streaming: boolean;
  readonly input_fields: Readonly<Record<string, CommandInputField>>;
  readonly input_schema: Readonly<Record<string, unknown>>;
  readonly output_schema: Readonly<Record<string, unknown>>;
}

const stringField = (
  flag: string,
  required = false,
  constraints: Pick<CommandInputField, 'minLength' | 'maxLength' | 'pattern'> = {},
): CommandInputField => ({
  flag,
  type: 'string',
  ...(required ? { required: true } : {}),
  ...constraints,
});
const integerField = (
  flag: string,
  required = false,
  constraints: Pick<CommandInputField, 'minimum' | 'maximum'> = {},
): CommandInputField => ({
  flag,
  type: 'integer',
  ...(required ? { required: true } : {}),
  ...constraints,
});
const booleanField = (flag: string): CommandInputField => ({ flag, type: 'boolean' });
const stringArrayField = (flag: string, required = false): CommandInputField => ({
  flag,
  type: 'string_array',
  ...(required ? { required: true } : {}),
});

function jsonSchemaForFields(
  fields: Readonly<Record<string, CommandInputField>>,
): Readonly<Record<string, unknown>> {
  const properties = Object.fromEntries(
    Object.entries(fields).map(([name, field]) => {
      const schema =
        field.type === 'integer'
          ? {
              type: 'integer',
              ...(field.minimum !== undefined ? { minimum: field.minimum } : {}),
              ...(field.maximum !== undefined ? { maximum: field.maximum } : {}),
            }
          : field.type === 'boolean'
            ? { type: 'boolean' }
            : field.type === 'string_array'
              ? { type: 'array', items: { type: 'string' } }
              : {
                  type: 'string',
                  ...(field.minLength !== undefined ? { minLength: field.minLength } : {}),
                  ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
                  ...(field.pattern ? { pattern: field.pattern.source } : {}),
                };
      return [name, field.enum ? { ...schema, enum: [...field.enum] } : schema];
    }),
  );
  const required = Object.entries(fields)
    .filter(([, field]) => field.required)
    .map(([name]) => name);
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

function spec(options: {
  path: string;
  description: string;
  risk?: AgentCommandRisk;
  auth?: boolean;
  interaction?: AgentCommandSpec['human_interaction'];
  confirmation?: AgentCommandSpec['confirmation'];
  idempotency?: AgentCommandSpec['idempotency'];
  streaming?: boolean;
  fields?: Readonly<Record<string, CommandInputField>>;
  inputSchema?: Readonly<Record<string, unknown>>;
  outputSchema?: Readonly<Record<string, unknown>>;
}): AgentCommandSpec {
  const fields = options.fields ?? {};
  const risk = options.risk ?? 'read';
  return {
    path: options.path,
    description: options.description,
    risk,
    auth_required: options.auth ?? (risk === 'read' || risk === 'write'),
    human_interaction: options.interaction ?? 'never',
    confirmation: options.confirmation ?? (risk === 'write' ? 'required' : 'none'),
    idempotency:
      options.idempotency ??
      (risk === 'write' ? 'unknown_outcome_guarded' : 'not_applicable'),
    streaming: options.streaming ?? false,
    input_fields: fields,
    input_schema: options.inputSchema ?? jsonSchemaForFields(fields),
    output_schema: options.outputSchema ?? { type: ['object', 'array', 'null'] },
  };
}

const jsonTaskSelector = {
  project_id: integerField('--project-id', true),
  task_definition_id: integerField('--task-definition-id'),
  abbreviation: stringArrayField('--abbr'),
  all_tasks: booleanField('--all-tasks'),
};
const oneTaskSelector = {
  project_id: integerField('--project-id', true),
  task_definition_id: integerField('--task-definition-id'),
  abbreviation: stringField('--abbr'),
};

const singleTaskReadFields = {
  project_id: integerField('--project-id', true, {
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  }),
  task_definition_id: integerField('--task-definition-id', false, {
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  }),
  abbreviation: stringField('--abbr', false, {
    minLength: 1,
    maxLength: 64,
    pattern: /\S/u,
  }),
};

const singleTaskReadInputBaseSchema = jsonSchemaForFields(singleTaskReadFields);
const singleTaskReadInputSchema = {
  ...singleTaskReadInputBaseSchema,
  anyOf: [
    { required: ['task_definition_id'] },
    { required: ['abbreviation'] },
  ],
};

const taskResourceFields = {
  ...jsonTaskSelector,
  out_dir: stringField('--out-dir'),
  allow_external_dir: booleanField('--allow-external-dir'),
};
const taskResourceInputBaseSchema = jsonSchemaForFields(taskResourceFields);
const taskResourceInputSchema = {
  ...taskResourceInputBaseSchema,
  properties: {
    ...(taskResourceInputBaseSchema.properties as Readonly<Record<string, unknown>>),
    abbreviation: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 64 },
      minItems: 1,
      maxItems: 32,
    },
    out_dir: { type: 'string', minLength: 1, maxLength: 4096 },
  },
  allOf: [
    {
      anyOf: [
        { required: ['task_definition_id'] },
        { required: ['abbreviation'] },
        {
          required: ['all_tasks'],
          properties: { all_tasks: { const: true } },
        },
      ],
    },
    {
      not: {
        required: ['all_tasks'],
        properties: { all_tasks: { const: true } },
        anyOf: [
          { required: ['task_definition_id'] },
          { required: ['abbreviation'] },
        ],
      },
    },
  ],
};

export const AGENT_COMMAND_SPECS: readonly AgentCommandSpec[] = [
  spec({ path: 'capabilities', description: 'List stable Agent command capabilities.', risk: 'local', auth: false }),
  spec({ path: 'schema', description: 'Read the input and output schema for one command.', risk: 'local', auth: false, fields: { command: stringField('--command', true) } }),
  spec({ path: 'auth.method', description: 'Read the configured server authentication method.', auth: false }),
  spec({ path: 'auth.status', description: 'Inspect local authentication lifecycle metadata.', risk: 'auth', auth: false }),
  spec({
    path: 'auth.ensure',
    description: 'Ensure a usable OnTrack credential, refreshing silently when possible.',
    risk: 'auth',
    auth: false,
    interaction: 'if_required',
    fields: {
      min_ttl_seconds: integerField('--min-ttl-seconds'),
      interaction: {
        flag: '--interaction',
        type: 'string',
        enum: ['never', 'if_required'],
      },
    },
  }),
  spec({ path: 'auth.logout', description: 'Clear local session and browser refresh state with best-effort remote sign-out.', risk: 'auth', auth: false, confirmation: 'required', fields: { confirm: booleanField('--confirm') } }),
  spec({ path: 'identity.get', description: 'Return the safe current-user identity projection.' }),
  spec({ path: 'projects.list', description: 'List projects visible to the current identity.' }),
  spec({ path: 'project.show', description: 'Read one project.', fields: { project_id: integerField('--project-id', true) } }),
  spec({ path: 'units.list', description: 'List units visible to the current identity.' }),
  spec({ path: 'unit.show', description: 'Read one unit.', fields: { unit_id: integerField('--unit-id', true) } }),
  spec({ path: 'unit.tasks', description: 'List tasks for one unit.', fields: { unit_id: integerField('--unit-id', true), status: stringField('--status') } }),
  spec({ path: 'tasks.list', description: 'List student task views.', fields: { project_id: integerField('--project-id'), status: stringField('--status') } }),
  spec({ path: 'doctor', description: 'Run read-only environment and API diagnostics.' }),
  spec({ path: 'inbox.list', description: 'List inbox tasks.', fields: { unit_id: integerField('--unit-id'), status: stringField('--status') } }),
  spec({ path: 'task.show', description: 'Read definition-first student task views.', fields: jsonTaskSelector }),
  spec({ path: 'task.prerequisites', description: 'Read prerequisites for one task.', fields: singleTaskReadFields, inputSchema: singleTaskReadInputSchema }),
  spec({ path: 'task.resources', description: 'Download task resource archives with artifact metadata.', fields: taskResourceFields, inputSchema: taskResourceInputSchema }),
  spec({ path: 'plan.show', description: 'Read the student plan.', fields: { project_id: integerField('--project-id', true), include_beyond_target: booleanField('--include-beyond-target') } }),
  spec({ path: 'plan.set_dates', description: 'Prepare or apply personal task dates.', risk: 'write', idempotency: 'client_guarded', fields: { ...oneTaskSelector, start: stringField('--start', true), target: stringField('--target', true), confirm: booleanField('--confirm'), idempotency_key: stringField('--idempotency-key') } }),
  spec({ path: 'plan.reset', description: 'Prepare or reset personal project dates.', risk: 'write', idempotency: 'client_guarded', fields: { project_id: integerField('--project-id', true), confirm: booleanField('--confirm'), idempotency_key: stringField('--idempotency-key') } }),
  spec({ path: 'feedback.list', description: 'Read task feedback.', fields: jsonTaskSelector }),
  spec({ path: 'feedback.watch', description: 'Stream task feedback changes.', streaming: true, fields: { ...oneTaskSelector, interval_seconds: integerField('--interval'), history: integerField('--history') } }),
  spec({ path: 'pdf.task', description: 'Download task PDFs.', fields: { ...jsonTaskSelector, out_dir: stringField('--out-dir'), allow_external_dir: booleanField('--allow-external-dir') } }),
  spec({ path: 'pdf.submission', description: 'Download submission PDFs.', fields: { ...jsonTaskSelector, out_dir: stringField('--out-dir'), allow_external_dir: booleanField('--allow-external-dir') } }),
  spec({
    path: 'submission.status',
    description: 'Read submission lifecycle status.',
    fields: singleTaskReadFields,
    inputSchema: singleTaskReadInputSchema,
    outputSchema: z.toJSONSchema(agentSubmissionStatusOutputSchema) as Readonly<
      Record<string, unknown>
    >,
  }),
  spec({ path: 'submission.upload', description: 'Prepare or dispatch one submission.', risk: 'write', fields: { ...oneTaskSelector, files: stringArrayField('--file', true), allow_external_file: booleanField('--allow-external-file'), trigger: stringField('--trigger'), comment: stringField('--comment'), confirm: booleanField('--confirm'), idempotency_key: stringField('--idempotency-key') } }),
  spec({ path: 'submission.upload_new_files', description: 'Prepare or attach evidence to an existing submission.', risk: 'write', fields: { ...oneTaskSelector, files: stringArrayField('--file', true), allow_external_file: booleanField('--allow-external-file'), trigger: stringField('--trigger'), comment: stringField('--comment'), confirm: booleanField('--confirm'), idempotency_key: stringField('--idempotency-key') } }),
  spec({ path: 'watch', description: 'Stream cross-project task changes.', streaming: true, fields: { unit_id: integerField('--unit-id'), project_id: integerField('--project-id'), interval_seconds: integerField('--interval') } }),
];

const COMMAND_SPEC_MAP = new Map(AGENT_COMMAND_SPECS.map((item) => [item.path, item]));

export function getCommandSpec(path: string): AgentCommandSpec {
  const result = COMMAND_SPEC_MAP.get(path);
  if (!result) {
    throw new Error(`Unknown Agent command: ${path}`);
  }
  return result;
}

const GROUPED_PATHS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  auth: {
    ensure: 'auth.ensure',
    login: 'auth.login',
    logout: 'auth.logout',
    method: 'auth.method',
    status: 'auth.status',
  },
  project: { show: 'project.show' },
  unit: { show: 'unit.show', tasks: 'unit.tasks' },
  task: { show: 'task.show', prerequisites: 'task.prerequisites', resources: 'task.resources' },
  plan: { show: 'plan.show', 'set-dates': 'plan.set_dates', reset: 'plan.reset' },
  feedback: { list: 'feedback.list', watch: 'feedback.watch' },
  pdf: { task: 'pdf.task', submission: 'pdf.submission' },
  submission: {
    status: 'submission.status',
    upload: 'submission.upload',
    'upload-new-files': 'submission.upload_new_files',
  },
};

const TOP_LEVEL_PATHS: Readonly<Record<string, string>> = {
  'auth-method': 'auth.method',
  capabilities: 'capabilities',
  discover: 'discover',
  doctor: 'doctor',
  inbox: 'inbox.list',
  login: 'auth.login',
  logout: 'auth.logout',
  projects: 'projects.list',
  schema: 'schema',
  tasks: 'tasks.list',
  units: 'units.list',
  watch: 'watch',
  whoami: 'identity.get',
};

/** Resolve argv command tokens into the stable Agent protocol path. */
export function resolveCommandPath(args: readonly string[]): string {
  const top = args[0] ?? 'welcome';
  const grouped = GROUPED_PATHS[top];
  if (grouped) {
    return grouped[args[1] ?? ''] ?? top;
  }
  return TOP_LEVEL_PATHS[top] ?? top;
}

/** Offline, credential-free capability manifest. */
export function buildCapabilities(cliVersion: string): Readonly<Record<string, unknown>> {
  return {
    protocol: 'ontrack.agent/v1',
    cli_version: cliVersion,
    commands: AGENT_COMMAND_SPECS.map(({ input_fields: _fields, ...command }) => command),
    exit_codes: {
      '0': 'success',
      '2': 'invalid argument or usage',
      '3': 'authentication or human verification required',
      '4': 'forbidden',
      '5': 'not found',
      '6': 'conflict or confirmation required',
      '7': 'retryable remote failure',
      '8': 'unknown write outcome',
      '10': 'internal failure',
    },
  };
}
