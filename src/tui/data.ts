/**
 * Real data path for the TUI: composes the public src/lib primitives
 * (auth broker, API client, Student Task View projection) into one loader.
 * Contains no business rules of its own — date precedence and visibility
 * stay in src/lib/student-task-view.ts.
 */
import { OnTrackHttpError } from '../lib/auth';
import { OnTrackApiClient } from '../lib/api';
import { createOnTrackAuthBroker } from '../lib/auth-broker';
import { DEFAULT_AUTH_MIN_TTL_SECONDS } from '../lib/auth-runtime';
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
      return 'assess_in_portfolio';
    case 'discuss':
    case 'demonstrate':
    case 'complete':
      return 'complete';
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
    due: effectiveDue ? formatDue(effectiveDue) : '—',
    dueInDays: effectiveDue ? daysUntil(effectiveDue) : null,
    dateSource: view.dates.instanceDue ? 'personal override' : 'unit default',
    description: typeof description === 'string' ? description : '',
    prerequisites: [],
  };
}

/** The refresh wiring mirrors cli.ts's createAuthenticatedApi (src/cli.ts:1363). */
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

    const api = new OnTrackApiClient(session.baseUrl, {
      refreshSession: async () => {
        const refreshed = await broker.ensure({
          minTtlSeconds: 0,
          interaction: 'never',
          forceRefresh: true,
        });
        return refreshed.status === 'ready' ? broker.currentSession() : null;
      },
    });

    const overview = await api.listProjects(session);
    const detailed = await Promise.all(overview.map((p) => api.getProject(session, p.id)));
    const unitIds = [
      ...new Set(
        detailed
          .map((p) => p.unit?.id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    const units = new Map(
      await Promise.all(unitIds.map(async (id) => [id, await api.getUnit(session, id)] as const)),
    );
    const enriched = detailed.map((p) =>
      p.unit?.id !== undefined && units.has(p.unit.id)
        ? { ...p, unit: { ...p.unit, ...units.get(p.unit.id) } }
        : p,
    );

    const tasks = buildStudentTaskViews(enriched).map(viewToTuiTask);
    return { kind: 'ready', username: toWhoAmIView(session).username, tasks };
  } catch (err) {
    if (err instanceof OnTrackHttpError && err.authFailure !== 'other') {
      return { kind: 'auth_required' };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message: redactSensitiveText(message) };
  }
};
