/**
 * TUI task model plus a fake fixture used by the headless smoke test.
 * The production data path maps Student Task Views onto this model in
 * src/tui/data.ts (`viewToTuiTask`).
 */
export type TaskStatus =
  | 'not_started'
  | 'working_on_it'
  | 'need_help'
  | 'ready_for_feedback'
  | 'assess_in_portfolio'
  | 'complete';

export interface TuiTask {
  id: string;
  /** Owning project/task-definition ids, needed by the write paths. */
  projectId: number;
  taskDefinitionId: number;
  unit: string;
  title: string;
  status: TaskStatus;
  /** The un-bucketed OnTrack workflow status, e.g. 'fix_and_resubmit'. */
  statusRaw?: string;
  due: string;
  /** Days until the effective due date; negative means overdue, null means no date. */
  dueInDays: number | null;
  dateSource: 'unit default' | 'personal override';
  description: string;
  prerequisites: string[];
}

/** Humanize a raw OnTrack status ('fix_and_resubmit' → 'Fix and resubmit'). */
export function humanizeStatus(raw: string): string {
  const spaced = raw.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Not Started',
  working_on_it: 'Working On It',
  need_help: 'Need Help',
  ready_for_feedback: 'Ready For Feedback',
  assess_in_portfolio: 'Assess In Portfolio',
  complete: 'Complete',
};

export const STATUS_ICON: Record<TaskStatus, string> = {
  not_started: '○',
  working_on_it: '◐',
  need_help: '✕',
  ready_for_feedback: '●',
  assess_in_portfolio: '◆',
  complete: '✓',
};

/** Compact labels for dense UI regions like the status bar. */
export const STATUS_SHORT_LABEL: Record<TaskStatus, string> = {
  not_started: 'not started',
  working_on_it: 'working',
  need_help: 'need help',
  ready_for_feedback: 'ready',
  assess_in_portfolio: 'portfolio',
  complete: 'complete',
};

export const FAKE_TASKS: TuiTask[] = [
  {
    id: '1',
    projectId: 101,
    taskDefinitionId: 1001,
    unit: 'FIT1045',
    title: 'P1: Algorithm design workbook',
    status: 'ready_for_feedback',
    due: 'Aug 14',
    dueInDays: 2,
    dateSource: 'unit default',
    description:
      'Design and document an algorithm for the P1 scenario. Submit the workbook PDF plus evidence of test runs.',
    prerequisites: [],
  },
  {
    id: '2',
    projectId: 101,
    taskDefinitionId: 1002,
    unit: 'FIT1045',
    title: 'H1: Code reading homework',
    status: 'working_on_it',
    due: 'Aug 16',
    dueInDays: 4,
    dateSource: 'personal override',
    description: 'Trace the provided Python modules and answer the comprehension questions on Moodle.',
    prerequisites: ['P1: Algorithm design workbook'],
  },
  {
    id: '3',
    projectId: 101,
    taskDefinitionId: 1003,
    unit: 'FIT1045',
    title: 'P2: Pair programming milestone',
    status: 'need_help',
    due: 'Aug 21',
    dueInDays: 9,
    dateSource: 'unit default',
    description:
      'Implement the core game loop with your assigned partner. Both partners must be recorded in the submission sheet.',
    prerequisites: ['H1: Code reading homework'],
  },
  {
    id: '4',
    projectId: 101,
    taskDefinitionId: 1004,
    unit: 'FIT1045',
    title: 'Quiz 3: Data structures',
    status: 'not_started',
    due: 'Aug 23',
    dueInDays: 11,
    dateSource: 'unit default',
    description: 'Online quiz covering lists, dictionaries, and complexity basics. Opens 48h before the deadline.',
    prerequisites: [],
  },
  {
    id: '5',
    projectId: 101,
    taskDefinitionId: 1005,
    unit: 'FIT1045',
    title: 'P3: Portfolio draft',
    status: 'not_started',
    due: 'Sep 04',
    dueInDays: 23,
    dateSource: 'unit default',
    description: 'Assemble a draft of your learning portfolio for the mid-semester check.',
    prerequisites: ['P2: Pair programming milestone'],
  },
  {
    id: '6',
    projectId: 101,
    taskDefinitionId: 1006,
    unit: 'FIT1045',
    title: 'Lab test 1',
    status: 'complete',
    due: 'Aug 02',
    dueInDays: -10,
    dateSource: 'unit default',
    description: 'In-lab practical test held during week 4 workshops.',
    prerequisites: [],
  },
  {
    id: '7',
    projectId: 101,
    taskDefinitionId: 1007,
    unit: 'FIT1045',
    title: 'Reflection: Week 5 studio',
    status: 'complete',
    due: 'Aug 05',
    dueInDays: -7,
    dateSource: 'personal override',
    description: 'Short written reflection on the week 5 studio activity.',
    prerequisites: [],
  },
];
