/**
 * Real data path for the TUI: composes the public src/lib primitives
 * (auth broker, project catalogue loader, Student Task View projection)
 * into one loader. Contains no business rules of its own — date precedence
 * and visibility stay in src/lib/student-task-view.ts.
 */
import { OnTrackHttpError } from '../lib/auth';
import { createOnTrackAuthBroker } from '../lib/auth-broker';
import { DEFAULT_AUTH_MIN_TTL_SECONDS } from '../lib/auth-runtime';
import {
  createAuthenticatedApi,
  loadProjectsWithTaskMetadata,
} from '../lib/project-catalogue';
import { buildStudentTaskViews, type StudentTaskView } from '../lib/student-task-view';
import { redactSensitiveText, normalizeBaseUrl } from '../lib/utils';
import { toWhoAmIView } from '../lib/whoami';
import type { TaskStatus, TuiTask } from './tasks';

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; username: string; tasks: TuiTask[] }
  | { kind: 'auth_required' }
  | { kind: 'error'; message: string };

export type TaskLoader = () => Promise<LoadState>;

/** Bucket the full OnTrack workflow status set into the TUI's six display states. */
export function bucketStatus(raw: string | undefined): TaskStatus {
  switch (raw) {
    case 'working_on_it':
      return 'working_on_it';
    case 'need_help':
    case 'fix_and_resubmit':
    case 'redo':
    case 'fail':
    case 'time_exceeded':
      return 'need_help';
    case 'ready_for_feedback':
    case 'feedback_exceeded':
      return 'ready_for_feedback';
    case 'assess_in_portfolio':
    // Accepted by staff, awaiting tutor discussion/demonstration — in the
    // assessment flow, not yet complete.
    case 'discuss':
    case 'demonstrate':
      return 'assess_in_portfolio';
    case 'complete':
      return 'complete';
    // Unknown/future statuses fall back to the neutral bucket; the raw status
    // stays visible via TuiTask.statusRaw so nothing renders misleadingly.
    case 'not_started':
    case 'not_instantiated':
    default:
      return 'not_started';
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`;
}

function daysUntil(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((dueStart.getTime() - todayStart.getTime()) / 86_400_000);
}

/** Project one Student Task View into the TUI row model. */
export function viewToTuiTask(view: StudentTaskView): TuiTask {
  const abbreviation = view.definition.abbreviation;
  const name = view.definition.name ?? 'Untitled task';
  const effectiveDue = view.dates.effectiveDue;
  const description = view.definition.description;
  return {
    id: `${view.reference.projectId}:${view.reference.taskDefinitionId}`,
    unit: view.unitCode ?? String(view.reference.unitId),
    title: abbreviation ? `${abbreviation}: ${name}` : name,
    status: bucketStatus(view.status),
    statusRaw: view.status,
    due: effectiveDue ? formatDue(effectiveDue) : '—',
    dueInDays: effectiveDue ? daysUntil(effectiveDue) : null,
    dateSource: view.dates.instanceDue ? 'personal override' : 'unit default',
    description: typeof description === 'string' ? description : '',
    prerequisites: [],
  };
}

export const loadOnTrackTasks: TaskLoader = async () => {
  try {
    const broker = createOnTrackAuthBroker({ baseUrl: normalizeBaseUrl() });
    const auth = await broker.ensure({
      minTtlSeconds: DEFAULT_AUTH_MIN_TTL_SECONDS,
      interaction: 'never',
    });
    if (auth.status === 'auth_required') return { kind: 'auth_required' };
    if (auth.status !== 'ready') {
      return {
        kind: 'error',
        message: `Credential refresh failed (${auth.code}). Run \`ontrack login\`.`,
      };
    }
    const session = await broker.currentSession();
    if (!session) return { kind: 'auth_required' };

    // Same catalogue pipeline the CLI task commands use: per-project/unit
    // read failures degrade to overview data instead of blanking the TUI.
    const api = createAuthenticatedApi(session);
    const projects = await loadProjectsWithTaskMetadata(api, session);
    const tasks = buildStudentTaskViews(projects).map(viewToTuiTask);
    return { kind: 'ready', username: toWhoAmIView(session).username, tasks };
  } catch (err) {
    if (err instanceof OnTrackHttpError && err.authFailure !== 'other') {
      return { kind: 'auth_required' };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message: redactSensitiveText(message) };
  }
};
