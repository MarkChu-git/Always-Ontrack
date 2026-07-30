import type { StudentTaskReference, StudentTaskView } from './student-task-view.js';

export type PlanDateSource = 'personal' | 'grade_default' | 'unit_default' | 'missing';
export type PlanDateKind = 'start' | 'target' | 'feedback_deadline';

export interface PlanDateValue {
  kind: PlanDateKind;
  value?: string;
  source: PlanDateSource;
  editable: boolean;
  /** YYYY-MM-DD is interpreted as a calendar date in the unit's locale, never host midnight. */
  interpretation: 'unit_local_calendar_date';
}

export interface PlannerPrerequisite {
  taskDefinitionId: number;
  requiredStatus: string;
}

export interface PlannerView {
  reference: StudentTaskReference;
  abbreviation?: string;
  name?: string;
  flexibleDates: boolean;
  start: PlanDateValue;
  target: PlanDateValue;
  feedbackDeadline: PlanDateValue;
  prerequisites: PlannerPrerequisite[];
}

export interface RawTaskPrerequisite {
  id?: number;
  task_definition_id?: number;
  taskDefinitionId?: number;
  prerequisite_id?: number;
  prerequisiteId?: number;
  task_status?: string;
  taskStatus?: string;
}

export interface PlanDateChange {
  startDate: string;
  targetDate: string;
}

export interface PlannerMutation {
  method: 'PUT';
  endpoint: string;
  body?: {
    target_start_date: string;
    target_due_date: string;
  };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function integerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function dateFrom(
  kind: PlanDateKind,
  value: string | undefined,
  source: PlanDateSource,
  editable: boolean,
): PlanDateValue {
  return {
    kind,
    value,
    source: value ? source : 'missing',
    editable,
    interpretation: 'unit_local_calendar_date',
  };
}

function gradeDateRow(view: StudentTaskView): Record<string, unknown> | undefined {
  const rows = view.definition.gradeDueDates ?? view.definition.grade_due_dates;
  if (!Array.isArray(rows) || view.projectTargetGrade === undefined) {
    return undefined;
  }

  return rows
    .map(recordValue)
    .filter((row): row is Record<string, unknown> => row !== undefined)
    .find(
      (row) =>
        (integerValue(row.targetGrade) ?? integerValue(row.target_grade)) ===
        view.projectTargetGrade,
    );
}

function personalDate(
  view: StudentTaskView,
  camelKey: string,
  snakeKey: string,
): string | undefined {
  const instance = recordValue(view.instance);
  return stringValue(instance?.[camelKey]) ?? stringValue(instance?.[snakeKey]);
}

function defaultDate(
  view: StudentTaskView,
  gradeCamelKey: string,
  gradeSnakeKey: string,
  definitionCamelKey: string,
  definitionSnakeKey: string,
): { value?: string; source: 'grade_default' | 'unit_default' } {
  const gradeRow = gradeDateRow(view);
  const gradeValue =
    stringValue(gradeRow?.[gradeCamelKey]) ??
    stringValue(gradeRow?.[gradeSnakeKey]);
  if (gradeValue) {
    return { value: gradeValue, source: 'grade_default' };
  }

  const definition = view.definition as Record<string, unknown>;
  return {
    value:
      stringValue(definition[definitionCamelKey]) ??
      stringValue(definition[definitionSnakeKey]),
    source: 'unit_default',
  };
}

function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`"${value}" is not a valid YYYY-MM-DD date.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`"${value}" is not a valid YYYY-MM-DD date.`);
  }
  return date;
}

function prerequisiteForTask(
  raw: RawTaskPrerequisite,
  taskDefinitionId: number,
): PlannerPrerequisite | undefined {
  const dependentId =
    integerValue(raw.taskDefinitionId) ?? integerValue(raw.task_definition_id);
  if (dependentId !== taskDefinitionId) {
    return undefined;
  }

  const prerequisiteId =
    integerValue(raw.prerequisiteId) ?? integerValue(raw.prerequisite_id);
  if (prerequisiteId === undefined) {
    return undefined;
  }

  return {
    taskDefinitionId: prerequisiteId,
    requiredStatus:
      stringValue(raw.taskStatus) ??
      stringValue(raw.task_status) ??
      'unknown',
  };
}

export function buildPlannerViews(
  studentTasks: StudentTaskView[],
  prerequisites: RawTaskPrerequisite[],
): PlannerView[] {
  return studentTasks.map((view) => {
    const startDefault = defaultDate(
      view,
      'startDate',
      'start_date',
      'startDate',
      'start_date',
    );
    const targetDefault = defaultDate(
      view,
      'targetDueDate',
      'target_due_date',
      'targetDate',
      'target_date',
    );
    const personalStart = personalDate(view, 'targetStartDate', 'target_start_date');
    const personalTarget = personalDate(view, 'targetDueDate', 'target_due_date');
    return {
      reference: { ...view.reference },
      abbreviation: stringValue(view.definition.abbreviation),
      name: stringValue(view.definition.name),
      flexibleDates: view.flexibleDates,
      start: dateFrom(
        'start',
        personalStart ?? startDefault.value,
        personalStart ? 'personal' : startDefault.source,
        view.flexibleDates,
      ),
      target: dateFrom(
        'target',
        personalTarget ?? targetDefault.value,
        personalTarget ? 'personal' : targetDefault.source,
        view.flexibleDates,
      ),
      feedbackDeadline: dateFrom(
        'feedback_deadline',
        view.dates.unitDue,
        'unit_default',
        false,
      ),
      prerequisites: prerequisites
        .map((raw) =>
          prerequisiteForTask(raw, view.reference.taskDefinitionId),
        )
        .filter(
          (item): item is PlannerPrerequisite => item !== undefined,
        ),
    };
  });
}

export function validatePlanDateChange(change: PlanDateChange): PlanDateChange {
  const start = parseDateOnly(change.startDate);
  const target = parseDateOnly(change.targetDate);
  if (start.getTime() > target.getTime()) {
    throw new Error('Plan start date must not be after target date.');
  }
  return { ...change };
}

export function buildTargetDateMutation(
  view: PlannerView,
  change: PlanDateChange,
): PlannerMutation {
  if (!view.flexibleDates) {
    throw new Error('This unit does not allow flexible dates.');
  }
  const validated = validatePlanDateChange(change);
  return {
    method: 'PUT',
    endpoint: `/projects/${view.reference.projectId}/task_def_id/${view.reference.taskDefinitionId}/target_dates`,
    body: {
      target_start_date: validated.startDate,
      target_due_date: validated.targetDate,
    },
  };
}

export function buildResetTargetDatesMutation(projectId: number): PlannerMutation {
  if (!Number.isInteger(projectId) || projectId < 1) {
    throw new Error('Project id must be a positive integer.');
  }
  return {
    method: 'PUT',
    endpoint: `/projects/${projectId}/reset_target_dates`,
  };
}
