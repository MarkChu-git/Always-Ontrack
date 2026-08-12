/**
 * Fake task data for the TUI skeleton.
 * Mirrors the domain's Student Task View shape loosely; will be replaced
 * by real projections from src/lib/student-task-view.ts once wired up.
 */
export type TaskStatus =
  | 'not_started'
  | 'working_on_it'
  | 'need_help'
  | 'ready_for_feedback'
  | 'assess_in_portfolio'
  | 'complete';

export interface FakeTask {
  id: string;
  unit: string;
  title: string;
  status: TaskStatus;
  due: string;
  /** Days until the effective due date; negative means overdue. */
  dueInDays: number;
  dateSource: 'unit default' | 'personal override';
  description: string;
  prerequisites: string[];
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

export const FAKE_USER = 'alice.zhang';
export const FAKE_UNIT = 'FIT1045';

export const FAKE_TASKS: FakeTask[] = [
  {
    id: '1',
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
