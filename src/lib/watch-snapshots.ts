import { buildAgentPlanShowOutput } from './agent-plan.js';
import type { AgentPlanShowOutput } from './agent-commands.js';
import { AgentProtocolError } from './agent-protocol.js';
import {
  AGENT_REMOTE_READ_CONCURRENCY,
  mapWithConcurrency,
} from './async-pool.js';
import { projectAgentWatchState, type AgentWatchState } from './agent-watch.js';
import { buildStudentTaskViews } from './student-task-view.js';
import type { FeedbackItem, ProjectSummary } from './types.js';
import {
  getLatestFeedbackTimestamp,
  getTaskAbbreviation,
  makeWatchTaskKey,
  type WatchTaskState,
} from './utils.js';

const MAX_AGENT_WATCH_TASKS = 200;

export interface WatchSnapshot {
  readonly legacy?: WatchTaskState;
  readonly agent?: AgentWatchState;
}

export interface WatchSnapshotOptions {
  readonly projectId?: number;
  readonly unitId?: number;
  readonly agentOutput: boolean;
}

/** Ports keep snapshot projection independent from CLI authentication and transport. */
export interface WatchSnapshotSource {
  loadProjects(options: WatchSnapshotOptions): Promise<ProjectSummary[]>;
  readComments(
    projectId: number,
    taskDefinitionId: number,
    agentOutput: boolean,
  ): Promise<FeedbackItem[]>;
}

export function agentWatchStateMap(
  snapshots: readonly WatchSnapshot[],
): Map<string, AgentWatchState> {
  return new Map(
    snapshots.flatMap((snapshot) =>
      snapshot.agent
        ? [[snapshot.agent.task_key, snapshot.agent] as const]
        : [],
    ),
  );
}

export function legacyWatchStates(
  snapshots: readonly WatchSnapshot[],
): WatchTaskState[] {
  return snapshots.flatMap((snapshot) =>
    snapshot.legacy ? [snapshot.legacy] : [],
  );
}

function filterProjectsForWatch(
  projects: readonly ProjectSummary[],
  options: WatchSnapshotOptions,
): ProjectSummary[] {
  return projects.filter(
    (project) =>
      (options.projectId === undefined || project.id === options.projectId) &&
      (options.unitId === undefined || project.unit?.id === options.unitId),
  );
}

function agentWatchStateForPlanTask(
  plan: AgentPlanShowOutput,
  task: AgentPlanShowOutput['tasks'][number],
  comments: FeedbackItem[],
): AgentWatchState {
  return projectAgentWatchState({
    task_key: makeWatchTaskKey(plan.project_id, task.task_definition_id),
    project_id: plan.project_id,
    unit_id: plan.unit_id,
    unit_code: plan.unit_code,
    task_definition_id: task.task_definition_id,
    task_instance_id: task.task_instance_id,
    abbreviation: task.abbreviation,
    status: task.status,
    start: task.start,
    target: task.target,
    feedback_deadline: task.feedback_deadline,
    feedback: {
      comment_count: comments.length,
      last_comment_at: getLatestFeedbackTimestamp(comments) ?? null,
    },
  });
}

async function buildLegacyWatchSnapshots(
  source: WatchSnapshotSource,
  projects: readonly ProjectSummary[],
): Promise<WatchSnapshot[]> {
  const views = buildStudentTaskViews([...projects]);
  return Promise.all(
    views.map(async (view): Promise<WatchSnapshot> => {
      const projectId = view.reference.projectId;
      const taskDefinitionId = view.reference.taskDefinitionId;
      const comments = await source.readComments(
        projectId,
        taskDefinitionId,
        false,
      );
      return {
        legacy: {
          taskKey: makeWatchTaskKey(projectId, taskDefinitionId),
          projectId,
          taskDefinitionId,
          unitCode: view.unitCode,
          abbr:
            getTaskAbbreviation(view.instance ?? view.definition) ??
            String(taskDefinitionId),
          status: view.status,
          dueDate: view.dates.effectiveDue,
          commentCount: comments.length,
          lastCommentAt: getLatestFeedbackTimestamp(comments),
        },
      };
    }),
  );
}

async function buildAgentWatchSnapshots(
  source: WatchSnapshotSource,
  projects: readonly ProjectSummary[],
): Promise<WatchSnapshot[]> {
  const entries = projects.flatMap((project) => {
    const plan = buildAgentPlanShowOutput([project], [], {
      project_id: project.id,
      include_beyond_target: true,
    });
    return plan.tasks.map((task) => ({ plan, task }));
  });
  if (entries.length > MAX_AGENT_WATCH_TASKS) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: `OnTrack returned more than ${MAX_AGENT_WATCH_TASKS} visible tasks for the Agent watch.`,
    });
  }
  return mapWithConcurrency(
    entries,
    AGENT_REMOTE_READ_CONCURRENCY,
    async ({ plan, task }): Promise<WatchSnapshot> => {
      const comments = await source.readComments(
        plan.project_id,
        task.task_definition_id,
        true,
      );
      return { agent: agentWatchStateForPlanTask(plan, task, comments) };
    },
  );
}

/** Build current snapshots through either legacy or strict definition-first projection. */
export async function buildWatchSnapshots(
  source: WatchSnapshotSource,
  options: WatchSnapshotOptions,
): Promise<WatchSnapshot[]> {
  const projects = filterProjectsForWatch(
    await source.loadProjects(options),
    options,
  );
  return options.agentOutput
    ? buildAgentWatchSnapshots(source, projects)
    : buildLegacyWatchSnapshots(source, projects);
}
