/** Menu item model used by the interactive launcher (`ontrack` with no args). */
export interface WelcomeMenuItem {
  id: number;
  title: string;
  command: string;
  summary: string;
  recommended?: boolean;
}

/**
 * Stable launcher menu ordering.
 * IDs are intentionally fixed because users refer to them by number.
 */
const BASE_WELCOME_MENU: WelcomeMenuItem[] = [
  {
    id: 1,
    title: 'Sign In (Monash SSO)',
    command: 'ontrack login',
    summary: 'Primary login path with guided Okta Verify push/number.',
    recommended: true,
  },
  {
    id: 2,
    title: 'Who Am I',
    command: 'ontrack whoami',
    summary: 'Show your current cached account and role.',
  },
  {
    id: 3,
    title: 'List Projects',
    command: 'ontrack projects',
    summary: 'View all accessible projects.',
  },
  {
    id: 4,
    title: 'List Units',
    command: 'ontrack units',
    summary: 'View available units (with fallback when needed).',
  },
  {
    id: 5,
    title: 'List Tasks',
    command: 'ontrack tasks',
    summary: 'Show tasks across projects with readable status and due date.',
  },
  {
    id: 6,
    title: 'Inbox',
    command: 'ontrack inbox',
    summary: 'Check inbox tasks or fallback task feed.',
  },
  {
    id: 7,
    title: 'Task Details',
    command: 'ontrack task show',
    summary: 'Inspect one task by project and abbr/task id.',
  },
  {
    id: 8,
    title: 'Feedback List',
    command: 'ontrack feedback list',
    summary: 'Read task discussion and feedback timeline.',
  },
  {
    id: 9,
    title: 'Feedback Watch',
    command: 'ontrack feedback watch',
    summary: 'Live-track new comments for one task.',
  },
  {
    id: 10,
    title: 'Task Watch',
    command: 'ontrack watch',
    summary: 'Live-track status, due-date, and feedback changes.',
  },
  {
    id: 11,
    title: 'Download Task PDF',
    command: 'ontrack pdf task',
    summary: 'Export the task sheet to PDF.',
  },
  {
    id: 12,
    title: 'Download Submission PDF',
    command: 'ontrack pdf submission',
    summary: 'Export your submission copy to PDF.',
  },
  {
    id: 13,
    title: 'Upload Submission',
    command: 'ontrack submission upload',
    summary: 'Upload required files and move the workflow forward.',
  },
  {
    id: 14,
    title: 'Upload New Files',
    command: 'ontrack submission upload-new-files',
    summary: 'Attach extra files to an existing submission.',
  },
  {
    id: 15,
    title: 'Logout',
    command: 'ontrack logout',
    summary: 'Clear local session and switch accounts safely.',
  },
  {
    id: 16,
    title: 'Show Full Help',
    command: 'ontrack --help',
    summary: 'Display the complete command reference.',
  },
];

/** Return a copy so callers can safely mutate labels/order locally if needed. */
export function getWelcomeMenuItems(): WelcomeMenuItem[] {
  return BASE_WELCOME_MENU.map((item) => ({ ...item }));
}

/**
 * Parse and validate launcher input.
 * Returns:
 * - `0` for exit aliases
 * - a valid action id
 * - `null` for invalid input
 */
export function parseWelcomeSelection(raw: string, allowedIds: number[]): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === '0' || trimmed.toLowerCase() === 'q' || trimmed.toLowerCase() === 'quit') {
    return 0;
  }

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (!allowedIds.includes(parsed)) {
    return null;
  }

  return parsed;
}
