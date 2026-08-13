/**
 * TUI status-write action: the production driver behind the detail pane's
 * status triggers. A thin composition of the auth broker (token freshness)
 * and `applyStudentStatusTrigger` — the same shared write path as
 * `ontrack task set-status --confirm` for an interactive human (no
 * idempotency claim; journal claims are an agent-protocol concern).
 *
 * Injectable into the App so headless smoke tests drive it with fixtures.
 */
import { createOnTrackAuthBroker } from '../lib/auth-broker';
import { DEFAULT_AUTH_MIN_TTL_SECONDS } from '../lib/auth-runtime';
import { createAuthenticatedApi } from '../lib/project-catalogue';
import {
  applyStudentStatusTrigger,
  type ApplyStatusTriggerOutcome,
} from '../lib/set-task-status';
import type { StudentStatusTrigger } from '../lib/types';
import { normalizeBaseUrl } from '../lib/utils';
import type { TuiTask } from './tasks';

export type { ApplyStatusTriggerOutcome } from '../lib/set-task-status';

/** The outcome union plus the TUI-only "session expired mid-write" case. */
export type SetStatusOutcome =
  | ApplyStatusTriggerOutcome
  | { kind: 'auth_required' };

export type SetStatusRunner = (input: {
  task: TuiTask;
  trigger: StudentStatusTrigger;
}) => Promise<SetStatusOutcome>;

/** Production runner: refresh-check the session, then apply the trigger. */
export const runSetStatus: SetStatusRunner = async ({ task, trigger }) => {
  const broker = createOnTrackAuthBroker({ baseUrl: normalizeBaseUrl() });
  const auth = await broker.ensure({
    minTtlSeconds: DEFAULT_AUTH_MIN_TTL_SECONDS,
    interaction: 'never',
  });
  if (auth.status !== 'ready') {
    return { kind: 'auth_required' };
  }
  const session = await broker.currentSession();
  if (!session) {
    return { kind: 'auth_required' };
  }
  const api = createAuthenticatedApi(session);
  return applyStudentStatusTrigger(api, session, {
    projectId: task.projectId,
    taskDefinitionId: task.taskDefinitionId,
    trigger,
    before: task.statusRaw ?? null,
  });
};
