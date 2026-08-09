#!/usr/bin/env bun

import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import { clearSession, loadSession, saveSession } from './lib/session.js';
import {
  contentDispositionFilename,
  InvalidDownloadFormatError,
  InvalidPdfDownloadError,
  InvalidJsonResponseError,
  MAX_DOWNLOAD_BYTES,
  OnTrackApiClient,
  OversizedBinaryResponseError,
  OversizedJsonResponseError,
  UnavailableDownloadError,
} from './lib/api.js';
import type { DownloadResult } from './lib/api.js';
import {
  createSessionFromAccessToken,
  OnTrackHttpError,
  OnTrackTransportError,
  sessionUsability,
} from './lib/auth.js';
import { toWhoAmIView } from './lib/whoami.js';
import {
  SsoFallbackError,
  classifySsoFallback,
  captureCredentialsFromStoredBrowserSession,
  clearAllBrowserSessionState,
  captureSsoCredentials,
  captureSsoCredentialsWithGuidedLogin,
  persistRefreshCookie,
} from "./lib/auto-login.js";
import type { MfaMethodOption } from "./lib/auto-login.js";
import type { LoginCredentials } from './lib/auto-login.js';
import {
  MAX_DISCOVERY_PROBE_REQUEST_BUDGET,
  discoverOnTrackSurface,
  probeDiscoveredApiTemplates,
} from "./lib/discovery.js";
import {
  ArtifactSafetyError,
  findExternalArtifactPaths,
  inspectUploadFile,
  readUploadArtifact,
  writeArtifactFile,
} from './lib/artifact-safety.js';
import {
  buildExternalArtifactAuthorizationArgs,
  getWelcomeMenuItems,
  parseWelcomeSelection,
} from "./lib/welcome.js";
import {
  buildStudentTaskRows,
  buildStudentTaskViews,
  resolveStudentTaskViews,
} from "./lib/student-task-view.js";
import type { StudentTaskRow } from './lib/student-task-view.js';
import {
  buildPlannerViews,
  buildResetTargetDatesMutation,
  buildTargetDateMutation,
} from "./lib/planner.js";
import type { RawTaskPrerequisite } from './lib/planner.js';
import { buildAgentPlanShowOutput } from './lib/agent-plan.js';
import { buildAgentProjectsListOutput } from './lib/agent-projects.js';
import { createAgentTasksList } from './lib/agent-tasks.js';
import { createAgentTutorialsStatus } from './lib/agent-tutorials.js';
import { createAgentUnitShow } from './lib/agent-units.js';
import {
  createAgentFeedbackWatch,
  createAgentFeedbackList,
  createAgentFeedbackTarget,
  projectAgentFeedbackItems,
  validateAgentFeedbackWatchFrame,
  type AgentFeedbackTarget,
} from "./lib/agent-feedback.js";
import {
  assertAgentStreamFrameLimit,
  diffAgentWatchStates,
  splitAgentWatchEventFrames,
  validateAgentWatchFrame,
} from "./lib/agent-watch.js";
import {
  agentWatchStateMap,
  buildWatchSnapshots,
  legacyWatchStates,
  type WatchSnapshot,
} from "./lib/watch-snapshots.js";
import { pollUntilInterrupted } from "./lib/watch-runtime.js";
import {
  AGENT_REMOTE_READ_CONCURRENCY,
  settleWithConcurrency,
} from "./lib/async-pool.js";
import {
  createSubmissionAttempt,
  InvalidSubmissionDetailsError,
  isSubmissionObserved,
  parseSubmissionDetails,
  parseStrictSubmissionDetails,
  prepareSubmission,
  transitionSubmissionAttempt,
  validateSubmissionMode,
} from "./lib/submission-lifecycle.js";
import type { SubmissionDetails } from './lib/submission-lifecycle.js';
import {
  buildPdfFilename,
  buildTaskResourceFilename,
  diffWatchStates,
  exceedsByteBudget,
  filterTasksByStatus,
  feedbackIdentity,
  formatDate,
  getFeedbackText,
  getFeedbackTimestamp,
  getFlagValue,
  getTaskAbbreviation,
  getTaskCompletionDate,
  getTaskDefinitionId,
  getTaskDueDate,
  getTaskName,
  getTaskStatus,
  hasFlag,
  isStaffLikeRole,
  normalizeBaseUrl,
  openExternal,
  parseIntegerFlagValue,
  parseSsoRedirectUrl,
  parseTaskBatchSelectorArgs,
  parseTaskSelectorArgs,
  parseUploadFileSpecs,
  printJson,
  printTable,
  prompt,
  promptHidden,
  resolveTaskSelector,
  resolveTaskBatchSelector,
  resolveLoginMode,
  safeTextForHumanDisplay,
  safeUrlForHumanDisplay,
  safeUrlForManualDisplay,
  sortFeedbackItems,
  toWatchStateMap,
  toRedactedError,
  writePdfFile,
} from "./lib/utils.js";
import type {
  FeedbackItem,
  CredentialSource,
  InboxTask,
  ProjectSummary,
  SessionData,
  SignInResponse,
  SubmissionTrigger,
  TaskDefinitionSummary,
  TaskSelector,
  TaskSummary,
  UnitSummary,
} from './lib/types.js';
import type { WelcomeMenuItem } from './lib/welcome.js';
import type { ResolvedTaskSelector } from "./lib/utils.js";
import {
  AgentProtocolError,
  agentErrorEnvelope,
  agentSuccessEnvelope,
  configureAgentOutputContext,
  exitCodeForAgentError,
  getAgentOutputContext,
} from './lib/agent-protocol.js';
import {
  buildCapabilities,
  getCommandSpec,
  resolveCommandPath,
} from './lib/command-spec.js';
import {
  mergeStructuredCommandInput,
  validateAgentCommandArguments,
} from './lib/command-input.js';
import { parseAgentCallInvocation } from './lib/agent-call-input.js';
import {
  createAgentExecutionEngine,
  exitCodeForAgentEnvelope,
  type AgentExecutionEngine,
} from './lib/agent-execution-engine.js';
import {
  type AgentPlanShowInput,
  type AgentPlanShowOutput,
  type AgentProjectsListOutput,
  type AgentUnitShowInput,
  type AgentUnitShowOutput,
  type AgentTutorialsStatusInput,
  type AgentTutorialsStatusOutput,
  type AgentTasksListInput,
  type AgentTasksListOutput,
  type AgentFeedbackListInput,
  type AgentFeedbackListOutput,
  type AgentFeedbackWatchInput,
  type AgentSubmissionStatusInput,
  type AgentSubmissionStatusOutput,
  agentSubmissionStatusOutputSchema,
  createNativeAgentCommands,
  type AgentTaskPrerequisitesInput,
  type AgentTaskPrerequisitesOutput,
  type AgentTaskShowInput,
  type AgentTaskShowOutput,
  type AgentTaskResourcesInput,
  type AgentTaskResourcesOutput,
  type AgentTaskPdfInput,
  type AgentTaskPdfOutput,
  type AgentSubmissionPdfInput,
  type AgentSubmissionPdfOutput,
} from './lib/agent-commands.js';
import { createOnTrackAuthBroker } from './lib/auth-broker.js';
import {
  DEFAULT_AUTH_MIN_TTL_SECONDS,
  type AuthInteractionMode,
} from './lib/auth-runtime.js';
import {
  claimExecution,
  updateExecution,
  validateIdempotencyKey,
} from "./lib/execution-journal.js";
import type { ExecutionClaim } from './lib/execution-journal.js';

/**
 * Main CLI entry module.
 *
 * This file hosts:
 * - command routing and argument validation
 * - interactive launcher UX
 * - high-level workflows (auth, reads, watch, pdf, upload)
 *
 * Lower-level HTTP/session/parsing logic lives in `src/lib/*`.
 */
type InboxRowTask = (InboxTask | StudentTaskRow) & { _unitId: number };

const MAX_AGENT_TASK_ITEMS = 200;
const MAX_AGENT_TASK_OUTPUT_BYTES = 512 * 1024;
const MAX_AGENT_SUBMISSION_STATUS_OUTPUT_BYTES = 16 * 1024;
const MAX_TASK_RESOURCE_BATCH_BYTES = MAX_DOWNLOAD_BYTES * 4;

/** Convert a credential captured from the verified access-token response into a session. */
function sessionFromAccessTokenCapture(
  baseUrl: string,
  captured: LoginCredentials,
  savedAt: string,
): SessionData {
  if (captured.contract !== 'access-token' || !captured.expiresAt) {
    throw new Error(
      'The observed access-token response is missing its required expiry.',
    );
  }
  return createSessionFromAccessToken(
    baseUrl,
    captured.username,
    {
      auth_token: captured.authToken,
      auth_token_expiry: captured.expiresAt,
      user: { username: captured.username },
    },
    savedAt,
  );
}

/**
 * Exchange a legacy captured credential through the observed `/auth` contract
 * and persist any refresh cookie the server issues for the persistent session.
 */
async function signInAndPersistRefreshCookie(
  api: OnTrackApiClient,
  payload: { auth_token: string; username: string; remember: boolean },
): Promise<SignInResponse> {
  const result = await api.signInWithCookieCapture(payload);
  if (result.refreshCookie) {
    try {
      persistRefreshCookie(result.refreshCookie, {
        targetOrigin: new URL(api.base).origin,
      });
    } catch {
      // Refresh-cookie persistence is best effort; the session itself is valid.
    }
  }
  return result.response;
}

/** Print command help and high-level behavioral notes. */
function help(): void {
  console.log(`ontrack

Usage:
  ontrack
  ontrack welcome
  ontrack auth-method [--base-url URL] [--json]
  ontrack auth status [--output agent-json]
  ontrack auth ensure [--min-ttl-seconds N] [--interaction never|if_required] [--output agent-json]
  ontrack agent list
  ontrack agent describe COMMAND
  ontrack agent call COMMAND [--input-json OBJECT | --input -]
  ontrack agent stream COMMAND [--input-json OBJECT | --input -]
  ontrack capabilities [--output agent-json]
  ontrack schema COMMAND [--output agent-json]
  ontrack login [--base-url URL] [--redirect-url URL]
  ontrack login [--base-url URL] --auth-token TOKEN --username USERNAME
  ontrack login [--base-url URL] --auto [--auto-timeout-sec N] [--show-browser|--hide-browser]
  ontrack login [--base-url URL] [--sso] [--sso-username USERNAME] [--sso-timeout-sec N] [--show-browser|--hide-browser]
  ontrack logout
  ontrack whoami [--json]
  ontrack projects [--json]
  ontrack project show --project-id ID [--json]
  ontrack units [--json]
  ontrack unit show --unit-id ID [--json]
  ontrack unit tasks --unit-id ID [--status STATUS] [--json]
  ontrack tasks [--project-id ID] [--status STATUS] [--json]
  ontrack doctor [--json]
  ontrack discover [--probe] [--project-id ID] [--unit-id ID] [--task-definition-id ID] [--limit N] [--json]
  ontrack inbox [--unit-id ID] [--status STATUS] [--json]
  ontrack task show --project-id ID [--all-tasks | --task-definition-id ID [--task-definition-id ID ...] | --abbr ABBR [--abbr ABBR ...]] [--json]
  ontrack task prerequisites --project-id ID (--task-definition-id ID | --abbr ABBR) [--json]
  ontrack task resources --project-id ID [--all-tasks | --task-definition-id ID [--task-definition-id ID ...] | --abbr ABBR [--abbr ABBR ...]] [--out-dir PATH] [--allow-external-dir] [--json]
  ontrack plan show --project-id ID [--include-beyond-target] [--json]
  ontrack plan set-dates --project-id ID (--task-definition-id ID | --abbr ABBR) --start YYYY-MM-DD --target YYYY-MM-DD [--confirm] [--idempotency-key KEY] [--json]
  ontrack plan reset --project-id ID [--confirm] [--idempotency-key KEY] [--json]
  ontrack feedback list --project-id ID [--all-tasks | --task-definition-id ID [--task-definition-id ID ...] | --abbr ABBR [--abbr ABBR ...]] [--json]
  ontrack feedback watch --project-id ID (--task-definition-id ID | --abbr ABBR) [--interval SEC] [--history N] [--json]
  ontrack pdf task --project-id ID [--all-tasks | --task-definition-id ID [--task-definition-id ID ...] | --abbr ABBR [--abbr ABBR ...]] [--out-dir PATH] [--allow-external-dir] [--json]
  ontrack pdf submission --project-id ID [--all-tasks | --task-definition-id ID [--task-definition-id ID ...] | --abbr ABBR [--abbr ABBR ...]] [--out-dir PATH] [--allow-external-dir] [--json]
  ontrack submission upload --project-id ID (--task-definition-id ID | --abbr ABBR) --file PATH [--file PATH|fileN=PATH ...] [--allow-external-file] [--trigger TRIGGER] [--comment TEXT] [--confirm] [--idempotency-key KEY] [--json]
  ontrack submission upload-new-files --project-id ID (--task-definition-id ID | --abbr ABBR) --file PATH [--file PATH|fileN=PATH ...] [--allow-external-file] [--trigger TRIGGER] [--comment TEXT] [--confirm] [--idempotency-key KEY] [--json]
  ontrack submission status --project-id ID (--task-definition-id ID | --abbr ABBR) [--json]
  ontrack watch [--unit-id ID] [--project-id ID] [--interval SEC] [--json]

Notes:
  - Running "ontrack" with no command opens the interactive launcher in TTY terminals.
  - Default base URL is https://ontrack.infotech.monash.edu/api
  - This site currently reports SAML SSO.
  - --task-definition-id is the unambiguous selector. Deprecated --task-id remains available for legacy definition/instance ids.
  - "ontrack login" defaults to guided SSO (username/password + Okta Verify) in hidden-browser (headless) mode on all environments.
  - Before prompting credentials, login reuses only its saved OnTrack browser state. Live system browser-profile reuse is disabled unless ONTRACK_ENABLE_SYSTEM_BROWSER_PROFILE=1.
  - Use "ontrack login --sso" to force guided SSO, or "ontrack login --auto" for browser-only capture mode.
  - Use --show-browser to force visible browser mode for debugging; --hide-browser keeps explicit headless mode.
  - If Chromium runtime is missing, install it manually through a reviewed dependency-management workflow.
  - Manual redirect URL paste is backup-only, used when guided SSO falls back or when --redirect-url is provided.
  - PDF and task-resource commands save files into ./downloads by default.
  - Download output directories are workspace-scoped and symlink-safe by default; use --allow-external-dir only for explicit external output.
  - Batch selectors support repeated flags and comma-separated values, e.g. --abbr P1 --abbr D4 or --abbr P1,D4.
  - Upload commands accept repeated --file values. You can also map explicit keys like --file file0=report.pdf.
  - Upload files are regular, non-symlink, non-hard-link files capped at 50 MiB each; use --allow-external-file only for explicit external input.
  - Planner and submission writes are dry-runs unless --confirm is supplied.
  - Confirmed Agent writes also require --idempotency-key; completed keys replay safely and unknown outcomes stay blocked.
  - Agent callers should use --output agent-json for the versioned ontrack.agent/v1 envelope.
  - Structured Agent input is accepted via --input-json OBJECT or --input -.
`);
}

const DIGITAL_LOGO_LINES = [
  ' █████╗ ██╗     ██╗    ██╗ █████╗ ██╗   ██╗███████╗',
  '██╔══██╗██║     ██║    ██║██╔══██╗╚██╗ ██╔╝██╔════╝',
  '███████║██║     ██║ █╗ ██║███████║ ╚████╔╝ ███████╗',
  '██╔══██║██║     ██║███╗██║██╔══██║  ╚██╔╝  ╚════██║',
  '██║  ██║███████╗╚███╔███╔╝██║  ██║   ██║   ███████║',
  '╚═╝  ╚═╝╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝',
  ' ██████╗ ███╗   ██╗████████╗██████╗  █████╗  ██████╗██╗  ██╗',
  '██╔═══██╗████╗  ██║╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██║ ██╔╝',
  '██║   ██║██╔██╗ ██║   ██║   ██████╔╝███████║██║     █████╔╝ ',
  '██║   ██║██║╚██╗██║   ██║   ██╔══██╗██╔══██║██║     ██╔═██╗ ',
  '╚██████╔╝██║ ╚████║   ██║   ██║  ██║██║  ██║╚██████╗██║  ██╗',
  ' ╚═════╝ ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝',
];

const LOGO_COLOR_CODES = [
  '38;2;0;25;110',
  '38;2;0;35;130',
  '38;2;0;47;167',
  '38;2;20;63;190',
  '38;2;35;82;212',
  '38;2;55;108;236',
  '38;2;55;108;236',
  '38;2;35;82;212',
  '38;2;20;63;190',
  '38;2;0;47;167',
  '38;2;0;35;130',
  '38;2;0;25;110',
];
const KLEIN_BLUE_TITLE = '1;38;2;55;108;236';
const KLEIN_BLUE_ACCENT = '1;38;2;0;47;167';
const KLEIN_BLUE_SOFT = '38;2;38;95;224';

/** Decide whether launcher/panel ANSI colors should be active. */
function launcherColorsEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }
  const forced = process.env.FORCE_COLOR;
  if (forced && forced !== '0') {
    return true;
  }
  return Boolean(process.stdout.isTTY);
}

/** Apply ANSI color only when terminal supports/enables color output. */
function launcherColor(text: string, code: string): string {
  if (!launcherColorsEnabled()) {
    return text;
  }
  return `\u001B[${code}m${text}\u001B[0m`;
}

/** Format one menu item as two launcher lines (title + command summary). */
function formatWelcomeMenuRow(item: WelcomeMenuItem): string[] {
  const id = String(item.id).padStart(2, '0');
  const badge = item.recommended ? ` ${launcherColor('RECOMMENDED', '1;30;46')}` : '';
  const primary = `${launcherColor(`[${id}]`, '1;30;106')} ${launcherColor(item.title, '1')}${badge}`;
  const secondary = `     ${launcherColor(item.command, KLEIN_BLUE_SOFT)}  ${launcherColor(item.summary, '1;37')}`;
  return [primary, secondary];
}

/** Render full welcome launcher screen with logo, legend, and numbered actions. */
function renderWelcomeScreen(items: WelcomeMenuItem[]): void {
  if (process.stdout.isTTY && process.env.TERM !== 'dumb') {
    console.clear();
  }

  console.log('');
  for (let index = 0; index < DIGITAL_LOGO_LINES.length; index += 1) {
    const color = LOGO_COLOR_CODES[index % LOGO_COLOR_CODES.length];
    console.log(launcherColor(DIGITAL_LOGO_LINES[index], color));
  }
  console.log(launcherColor('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', KLEIN_BLUE_ACCENT));
  console.log(launcherColor('ALWAYS ONTRACK COMMAND DECK', KLEIN_BLUE_TITLE));
  console.log(launcherColor('Type a number to run an action. Type 0 to exit.', KLEIN_BLUE_ACCENT));
  console.log(launcherColor('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', KLEIN_BLUE_ACCENT));
  console.log('');

  for (const item of items) {
    const [primary, secondary] = formatWelcomeMenuRow(item);
    console.log(primary);
    console.log(secondary);
  }
  console.log('');
}

type TerminalPanelTone = 'info' | 'success' | 'warn';
const PANEL_ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;]*m/g;

/** Visible text width helper for panel row padding. */
function panelVisibleLength(value: string): number {
  return value.replace(PANEL_ANSI_ESCAPE_PATTERN, '').length;
}

/** Resolve border/header tone color for boxed terminal panels. */
function panelToneCode(tone: TerminalPanelTone): string {
  if (tone === 'success') {
    return '1;32';
  }
  if (tone === 'warn') {
    return '1;33';
  }
  return KLEIN_BLUE_ACCENT;
}

/** Resolve body-text color tone for boxed terminal panels. */
function panelBodyCode(tone: TerminalPanelTone): string {
  if (tone === 'success') {
    return '32';
  }
  if (tone === 'warn') {
    return '33';
  }
  return KLEIN_BLUE_SOFT;
}

/** Render box-style panel used by guided flows and status banners. */
function renderTerminalPanel(title: string, lines: string[], tone: TerminalPanelTone = 'info'): void {
  if (!process.stdout.isTTY || process.env.TERM === 'dumb') {
    console.log(`[${title}]`);
    for (const line of lines) {
      console.log(`- ${line}`);
    }
    return;
  }

  const width = 70;
  const top = `┏${'━'.repeat(width - 2)}┓`;
  const divider = `┣${'━'.repeat(width - 2)}┫`;
  const bottom = `┗${'━'.repeat(width - 2)}┛`;
  const row = (text: string): string => {
    const padding = ' '.repeat(Math.max(0, width - 4 - panelVisibleLength(text)));
    return `┃ ${text}${padding} ┃`;
  };

  const accent = panelToneCode(tone);
  const body = panelBodyCode(tone);

  console.log('');
  console.log(launcherColor(top, accent));
  console.log(launcherColor(row(title), tone === 'info' ? KLEIN_BLUE_TITLE : accent));
  console.log(launcherColor(divider, accent));
  for (const line of lines) {
    console.log(launcherColor(row(line), body));
  }
  console.log(launcherColor(bottom, accent));
}

/** Render compact bullet-style events for step-by-step guided output. */
function renderTerminalEvent(message: string, tone: TerminalPanelTone = 'info'): void {
  if (!process.stdout.isTTY || process.env.TERM === 'dumb') {
    console.log(message);
    return;
  }

  const color = tone === 'success' ? '32' : tone === 'warn' ? '33' : KLEIN_BLUE_SOFT;
  console.log(launcherColor(`  • ${message}`, color));
}

/** Highlight MFA number challenge values inline for fast visual confirmation. */
function renderChallengeNumbersInline(numbers: string[]): string {
  return numbers
    .map((number) => launcherColor(` ${number} `, '1;30;103'))
    .join(launcherColor('  ', KLEIN_BLUE_SOFT));
}

/** Final login confirmation panel shown after successful session persistence. */
function renderLoginSuccessPanel(session: SessionData): void {
  const fullName = `${session.user.firstName || session.user.first_name || ''} ${
    session.user.lastName || session.user.last_name || ''
  }`.trim();
  const role = resolveUserRole(session) ?? '-';
  const displayName = fullName || session.username;

  if (!process.stdout.isTTY || process.env.TERM === 'dumb') {
    console.log(`Signed in as ${displayName}`);
    console.log(`Role: ${role}`);
    console.log(`Session saved to ${session.baseUrl}`);
    return;
  }

  const width = 70;
  const top = `┏${'━'.repeat(width - 2)}┓`;
  const bottom = `┗${'━'.repeat(width - 2)}┛`;
  const divider = `┣${'━'.repeat(width - 2)}┫`;
  const row = (text: string): string => {
    const plain = text.slice(0, width - 4);
    const padding = ' '.repeat(Math.max(0, width - 4 - plain.length));
    return `┃ ${plain}${padding} ┃`;
  };

  const quickActions = [
    '1) ontrack',
    '2) ontrack inbox',
    '3) ontrack tasks --status ready_for_feedback',
  ];

  console.log('');
  console.log(launcherColor(top, KLEIN_BLUE_ACCENT));
  console.log(launcherColor(row('ALWAYS ONTRACK | LOGIN SUCCESS'), KLEIN_BLUE_TITLE));
  console.log(launcherColor(row('Your session is active and ready.'), KLEIN_BLUE_SOFT));
  console.log(launcherColor(divider, KLEIN_BLUE_ACCENT));
  console.log(row(`Account : ${displayName}`));
  console.log(row(`Username: ${session.username}`));
  console.log(row(`Role    : ${role}`));
  console.log(row(`API     : ${session.baseUrl}`));
  console.log(launcherColor(divider, KLEIN_BLUE_ACCENT));
  console.log(launcherColor(row('Quick start:'), KLEIN_BLUE_SOFT));
  for (const action of quickActions) {
    console.log(launcherColor(row(`  ${action}`), KLEIN_BLUE_SOFT));
  }
  console.log(launcherColor(bottom, KLEIN_BLUE_ACCENT));
  console.log('');
}

/** Build optional `--flag value` argument pair only when value is non-empty. */
function optionalFlagArgs(flag: string, value?: string): string[] {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return [];
  }
  return [flag, trimmed];
}

/** Prompt until a non-empty value is entered (used in guided forms). */
async function promptRequired(label: string): Promise<string> {
  while (true) {
    const value = (await prompt(label)).trim();
    if (value) {
      return value;
    }
    console.log('[warn] This field is required.');
  }
}

/** Manual selector used as fallback when guided selection cannot resolve tasks. */
async function promptTaskSelectorFlags(): Promise<string[]> {
  const projectId = await promptRequired('Project ID: ');
  const abbr = (await prompt('Task abbreviation (preferred, e.g. P1/D4). Leave empty to use task definition id: ')).trim();
  if (abbr) {
    return ['--project-id', projectId, '--abbr', abbr];
  }

  const taskDefinitionId = await promptRequired('Task Definition ID: ');
  return ['--project-id', projectId, '--task-definition-id', taskDefinitionId];
}

type TaskSelectorToken =
  | { kind: 'abbr'; value: string }
  | { kind: 'taskDefinitionId'; value: number };

/** Parse comma-separated task selector tokens (`P1,D4,501`) into typed entries. */
function parseTaskSelectorTokens(raw: string): TaskSelectorToken[] {
  const values = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (values.length === 0) {
    throw new Error('Please enter at least one task selector.');
  }

  return values.map((value) => {
    if (/^\d+$/.test(value)) {
      return {
        kind: 'taskDefinitionId',
        value: Number.parseInt(value, 10),
      };
    }
    return {
      kind: 'abbr',
      value,
    };
  });
}

/** Build CLI args from parsed selector tokens. */
function buildTaskSelectorArgs(projectId: string, tokens: TaskSelectorToken[]): string[] {
  const args: string[] = ['--project-id', projectId];
  for (const token of tokens) {
    if (token.kind === 'taskDefinitionId') {
      args.push('--task-definition-id', String(token.value));
      continue;
    }
    args.push('--abbr', token.value);
  }
  return args;
}

/** Manual batch-capable fallback selector used when guided list loading fails. */
async function promptTaskBatchSelectorFlags(allowAllTasks: boolean = true): Promise<string[]> {
  const projectId = await promptRequired('Project ID: ');

  while (true) {
    const question = allowAllTasks
      ? 'Task selectors (comma-separated codes/ids, e.g. P1,D4,501) or "all": '
      : 'Task selectors (comma-separated codes/ids, e.g. P1,D4,501): ';
    const raw = (await prompt(question)).trim();
    if (!raw) {
      console.log('[warn] This field is required.');
      continue;
    }

    if (allowAllTasks && /^all$/i.test(raw)) {
      return ['--project-id', projectId, '--all-tasks'];
    }

    try {
      const tokens = parseTaskSelectorTokens(raw);
      return buildTaskSelectorArgs(projectId, tokens);
    } catch (error) {
      console.log(`[warn] ${toRedactedError(error).message}`);
    }
  }
}

/**
 * Guided selector:
 * 1) choose project by index
 * 2) choose task selectors (single/multiple/all) within that project
 * Supports `m` at either step for manual fallback.
 */
async function promptTaskSelectorFromTaskList(options: {
  allowBatch?: boolean;
  allowAllTasks?: boolean;
} = {}): Promise<string[] | null> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const projects = await loadProjectsWithTaskMetadata(api, session);

  if (projects.length === 0) {
    console.log('[warn] No projects found for this account. Switching to manual selector.');
    return null;
  }

  renderTerminalPanel(
    'SELECT PROJECT',
    [
      'Pick a project first, then choose a task inside it.',
      'Type m to switch to manual project/task input.',
    ],
    'info',
  );

  const projectRows = projects.map((project) => ({
    unit: project.unit?.code ?? '-',
    unitName: project.unit?.name ?? '-',
    projectId: project.id,
    targetGrade: project.targetGrade ?? project.target_grade ?? '-',
    tasks: Array.isArray(project.tasks) ? project.tasks.length : 0,
  }));
  printTable(projectRows);

  let selectedProject: ProjectSummary | undefined;
  while (true) {
    const raw = (await prompt('Select project index (or type m for manual): ')).trim();
    if (!raw) {
      continue;
    }
    if (/^m$/i.test(raw)) {
      return null;
    }

    const index = Number.parseInt(raw, 10);
    if (!Number.isFinite(index) || index < 0 || index >= projects.length) {
      console.log(`[warn] Invalid index "${raw}". Choose 0-${projects.length - 1}, or type m.`);
      continue;
    }
    selectedProject = projects[index];
    break;
  }

  if (!selectedProject) {
    return null;
  }

  let tasks = (selectedProject.tasks || []).filter((task) =>
    Boolean(getTaskAbbreviation(task) || getTaskDefinitionId(task)),
  );
  const unitCode = selectedProject.unit?.code ?? '-';
  const unitId = selectedProject.unit?.id ?? '-';

  if (tasks.length === 0) {
    console.log('[warn] No selectable tasks found in this project. Switching to manual selector.');
    return null;
  }

  const allowBatch = options.allowBatch ?? false;
  const allowAllTasks = options.allowAllTasks ?? false;
  renderTerminalPanel(
    'SELECT TASK',
    [
      `Project ${selectedProject.id} (${unitCode}) loaded.`,
      allowBatch
        ? 'Choose single, multiple, or all tasks.'
        : 'Pick a task by task code (e.g. P1, D4).',
      'If a row has no task code, enter its taskDefinitionId number.',
      'Type m to switch to manual selector.',
    ],
    'info',
  );

  const rows = tasks.map((task) => ({
    unit: unitCode,
    task: getTaskAbbreviation(task) || `#${getTaskDefinitionId(task) ?? 'unknown'}`,
    title: getTaskName(task) || `Task #${getTaskDefinitionId(task) ?? 'unknown'}`,
    status: getTaskStatus(task) || '-',
    due: formatDate(getTaskDueDate(task)),
    projectId: selectedProject.id,
    taskDefinitionId: getTaskDefinitionId(task) ?? '-',
    unitId,
  }));
  printTable(rows);

  const tasksByAbbr = new Map<string, TaskSummary[]>();
  const availableAbbrs: string[] = [];
  for (const task of tasks) {
    const abbr = getTaskAbbreviation(task)?.trim();
    if (!abbr) {
      continue;
    }
    const normalized = abbr.toLowerCase();
    const bucket = tasksByAbbr.get(normalized) ?? [];
    bucket.push(task);
    tasksByAbbr.set(normalized, bucket);
    availableAbbrs.push(abbr.toUpperCase());
  }
  const tasksById = new Map<number, TaskSummary>();
  for (const task of tasks) {
    const definitionId = getTaskDefinitionId(task);
    if (definitionId !== undefined) {
      tasksById.set(definitionId, task);
    }
  }

  const projectId = String(selectedProject.id);
  const resolveSingleTaskArgs = (raw: string): string[] | null => {
    const byAbbr = tasksByAbbr.get(raw.toLowerCase());
    if (byAbbr && byAbbr.length === 1) {
      const matched = byAbbr[0];
      const abbr = getTaskAbbreviation(matched);
      if (abbr) {
        return ['--project-id', projectId, '--abbr', abbr];
      }
    }

    if (byAbbr && byAbbr.length > 1) {
      console.log(
        `[warn] Task code "${raw}" is ambiguous in this project. Use manual mode (m) and provide --task-definition-id.`,
      );
      return null;
    }

    const maybeTaskId = Number.parseInt(raw, 10);
    if (Number.isFinite(maybeTaskId)) {
      const matched = tasksById.get(maybeTaskId);
      if (matched) {
        const abbr = getTaskAbbreviation(matched);
        if (abbr) {
          return ['--project-id', projectId, '--abbr', abbr];
        }

        const taskDefinitionId = getTaskDefinitionId(matched);
        if (taskDefinitionId !== undefined) {
          return [
            '--project-id',
            projectId,
            '--task-definition-id',
            String(taskDefinitionId),
          ];
        }
      }
    }

    const uniqueAbbrs = [...new Set(availableAbbrs)];
    if (uniqueAbbrs.length > 0) {
      const preview = uniqueAbbrs.slice(0, 12);
      const suffix =
        uniqueAbbrs.length > preview.length
          ? ` ... (+${uniqueAbbrs.length - preview.length} more)`
          : '';
      console.log(
        `[warn] Unknown task "${raw}". Try one of: ${preview.join(', ')}${suffix} (or type m for manual).`,
      );
      return null;
    }

    console.log('[warn] Unknown task selection. Enter taskDefinitionId number or type m for manual selector.');
    return null;
  };

  if (allowBatch) {
    while (true) {
      const modePrompt = allowAllTasks
        ? 'Task selection mode [1=single, 2=multiple, 3=all, default 1]: '
        : 'Task selection mode [1=single, 2=multiple, default 1]: ';
      const rawMode = (await prompt(modePrompt)).trim();
      if (/^m$/i.test(rawMode)) {
        return null;
      }
      const mode = rawMode || '1';
      if (!['1', '2', ...(allowAllTasks ? ['3'] : [])].includes(mode)) {
        console.log(
          `[warn] Invalid mode. Choose ${allowAllTasks ? '1, 2, or 3' : '1 or 2'}.`,
        );
        continue;
      }

      if (mode === '3') {
        return ['--project-id', projectId, '--all-tasks'];
      }

      if (mode === '2') {
        while (true) {
          const rawSelectors = (
            await prompt('Enter task selectors (comma-separated, e.g. P1,D4,501) or m for manual: ')
          ).trim();
          if (!rawSelectors) {
            continue;
          }
          if (/^m$/i.test(rawSelectors)) {
            return null;
          }

          let tokens: TaskSelectorToken[];
          try {
            tokens = parseTaskSelectorTokens(rawSelectors);
          } catch (error) {
            console.log(`[warn] ${toRedactedError(error).message}`);
            continue;
          }

          const canonicalTokens: TaskSelectorToken[] = [];
          let invalid = false;
          for (const token of tokens) {
            if (token.kind === 'abbr') {
              const matched = tasksByAbbr.get(token.value.toLowerCase());
              if (!matched || matched.length === 0) {
                console.log(`[warn] Task code "${token.value}" was not found in this project.`);
                invalid = true;
                break;
              }
              if (matched.length > 1) {
                console.log(`[warn] Task code "${token.value}" is ambiguous in this project.`);
                invalid = true;
                break;
              }
              const abbr = getTaskAbbreviation(matched[0]);
              if (!abbr) {
                console.log(`[warn] Task "${token.value}" has no abbreviation; use taskDefinitionId instead.`);
                invalid = true;
                break;
              }
              canonicalTokens.push({ kind: 'abbr', value: abbr });
              continue;
            }

            const matched = tasksById.get(token.value);
            if (!matched) {
              console.log(`[warn] Task definition id "${token.value}" was not found in this project.`);
              invalid = true;
              break;
            }
            const abbr = getTaskAbbreviation(matched);
            if (abbr) {
              canonicalTokens.push({ kind: 'abbr', value: abbr });
            } else {
              const taskDefinitionId = getTaskDefinitionId(matched);
              if (taskDefinitionId === undefined) {
                console.log(`[warn] Task definition id "${token.value}" could not be resolved.`);
                invalid = true;
                break;
              }
              canonicalTokens.push({
                kind: 'taskDefinitionId',
                value: taskDefinitionId,
              });
            }
          }

          if (invalid) {
            continue;
          }

          const deduped = new Map<string, TaskSelectorToken>();
          for (const token of canonicalTokens) {
            const key =
              token.kind === 'abbr'
                ? `abbr:${token.value.toLowerCase()}`
                : `taskDefinitionId:${token.value}`;
            if (!deduped.has(key)) {
              deduped.set(key, token);
            }
          }

          return buildTaskSelectorArgs(projectId, [...deduped.values()]);
        }
      }

      // mode === '1' falls through to single selector prompt below.
      break;
    }
  }

  while (true) {
    const raw = (await prompt('Select task (e.g. P1) or taskDefinitionId (or type m for manual): ')).trim();
    if (!raw) {
      continue;
    }
    if (/^m$/i.test(raw)) {
      return null;
    }

    const singleArgs = resolveSingleTaskArgs(raw);
    if (singleArgs) {
      return singleArgs;
    }
  }
}

/** Shared guided selector wrapper used by launcher actions 7-14. */
async function promptGuidedTaskSelector(
  modeTitle: string,
  modeSummary: string,
  options: {
    allowBatch?: boolean;
    allowAllTasks?: boolean;
  } = {},
): Promise<string[]> {
  renderTerminalPanel(
    modeTitle,
    [
      modeSummary,
      'We will load your projects first, then tasks in the selected project.',
      options.allowBatch
        ? 'Batch enabled: choose single, multiple (comma-separated), or all tasks.'
        : 'Single-task mode: pick one task code or task definition id.',
      'Type m in selector prompts to switch to manual project/task input.',
    ],
    'info',
  );

  try {
    const selected = await promptTaskSelectorFromTaskList(options);
    if (selected) {
      return selected;
    }
  } catch (error) {
    console.log(`[warn] Unable to load task list: ${toRedactedError(error).message}`);
  }

  if (options.allowBatch) {
    return promptTaskBatchSelectorFlags(options.allowAllTasks ?? false);
  }
  return promptTaskSelectorFlags();
}

/** Expand `~` path notation for cross-platform guided path input. */
function expandHomePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '~') {
    return homedir();
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

/** Prompt for optional output path and normalize home-directory shorthand. */
async function promptGuidedOutputDirectory(): Promise<string | undefined> {
  const defaultDir = resolve(process.cwd(), './downloads');
  renderTerminalPanel(
    'OUTPUT DIRECTORY',
    [
      `Press Enter to use default: ${defaultDir}`,
      'Custom path examples:',
      'macOS/Linux: ~/Downloads/ontrack',
      'Windows: C:\\Users\\<you>\\Downloads\\ontrack',
    ],
    'info',
  );

  const raw = await prompt('Output directory [default ./downloads]: ');
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return expandHomePath(trimmed);
}

/** Prompt one or more upload files for submission/new-file workflows. */
async function promptUploadFiles(): Promise<string[]> {
  const files: string[] = [];
  while (true) {
    const label = files.length === 0 ? 'File path: ' : 'Additional file path: ';
    files.push(expandHomePath(await promptRequired(label)));
    const more = (await prompt('Add another file? [y/N]: ')).trim();
    if (!/^(y|yes)$/i.test(more)) {
      break;
    }
  }
  return files;
}

/** Ask for explicit human approval before a guided flow crosses the workspace boundary. */
async function promptExternalArtifactAuthorization(
  paths: readonly string[],
  flag: '--allow-external-file' | '--allow-external-dir',
  artifactLabel: string,
): Promise<string[]> {
  const externalPaths = findExternalArtifactPaths(paths, process.cwd());
  if (externalPaths.length === 0) {
    return [];
  }

  renderTerminalPanel(
    'EXTERNAL PATH AUTHORIZATION',
    [
      `${externalPaths.length} ${artifactLabel} path(s) resolve outside the current workspace.`,
      ...externalPaths.map((path) => `- ${path}`),
      'External paths remain subject to regular-file, symlink, hard-link, and size checks.',
    ],
    'warn',
  );
  const approval = await prompt('Type ALLOW to authorize these external paths: ');
  return buildExternalArtifactAuthorizationArgs(externalPaths, approval, flag);
}

/** Execute a launcher action id by delegating to command handlers. */
async function runWelcomeAction(actionId: number): Promise<void> {
  // Keep menu ID -> action mapping explicit to preserve stable launcher UX.
  switch (actionId) {
    case 1:
      await handleLogin([]);
      return;
    case 2:
      await handleWhoAmI([]);
      return;
    case 3:
      await handleProjects([]);
      return;
    case 4:
      await handleUnits([]);
      return;
    case 5:
      await handleTasks([]);
      return;
    case 6:
      await handleInbox([]);
      return;
    case 7: {
      const selector = await promptGuidedTaskSelector(
        'TASK DETAILS',
        'Inspect one or many tasks by code/id in the selected project.',
        { allowBatch: true, allowAllTasks: true },
      );
      await handleTaskShow(selector);
      return;
    }
    case 8: {
      const selector = await promptGuidedTaskSelector(
        'FEEDBACK LIST',
        'Read feedback timeline for one, many, or all tasks in a project.',
        { allowBatch: true, allowAllTasks: true },
      );
      await handleFeedbackList(selector);
      return;
    }
    case 9: {
      const selector = await promptTaskSelectorFlags();
      const intervalSec = await prompt('Polling interval seconds (default 15): ');
      const historyCount = await prompt('History count on startup (default 20): ');
      const args = [
        ...selector,
        ...optionalFlagArgs('--interval', intervalSec),
        ...optionalFlagArgs('--history', historyCount),
      ];
      await handleFeedbackWatch(args);
      return;
    }
    case 10: {
      const unitId = await prompt('Unit ID filter (optional): ');
      const projectId = await prompt('Project ID filter (optional): ');
      const intervalSec = await prompt('Polling interval seconds (default 60): ');
      const args = [
        ...optionalFlagArgs('--unit-id', unitId),
        ...optionalFlagArgs('--project-id', projectId),
        ...optionalFlagArgs('--interval', intervalSec),
      ];
      await handleWatch(args);
      return;
    }
    case 11: {
      const selector = await promptGuidedTaskSelector(
        'DOWNLOAD TASK PDF',
        'Export task sheet PDFs for one, many, or all tasks.',
        { allowBatch: true, allowAllTasks: true },
      );
      const outDir = await promptGuidedOutputDirectory();
      const authorization = await promptExternalArtifactAuthorization(
        outDir ? [outDir] : [],
        '--allow-external-dir',
        'output directory',
      );
      await handlePdfDownload(
        [...selector, ...optionalFlagArgs('--out-dir', outDir), ...authorization],
        'task',
      );
      return;
    }
    case 12: {
      const selector = await promptGuidedTaskSelector(
        'DOWNLOAD SUBMISSION PDF',
        'Export submission PDFs for one, many, or all tasks.',
        { allowBatch: true, allowAllTasks: true },
      );
      const outDir = await promptGuidedOutputDirectory();
      const authorization = await promptExternalArtifactAuthorization(
        outDir ? [outDir] : [],
        '--allow-external-dir',
        'output directory',
      );
      await handlePdfDownload(
        [...selector, ...optionalFlagArgs('--out-dir', outDir), ...authorization],
        'submission',
      );
      return;
    }
    case 13: {
      const selector = await promptGuidedTaskSelector(
        'UPLOAD SUBMISSION',
        'Upload required submission files for the selected task.',
      );
      const files = await promptUploadFiles();
      const authorization = await promptExternalArtifactAuthorization(
        files,
        '--allow-external-file',
        'upload file',
      );
      const trigger = await prompt('Trigger (need_help/ready_for_feedback, optional): ');
      const comment = await prompt('Comment (optional): ');
      const confirmation = await prompt('Type CONFIRM to dispatch this upload (otherwise dry-run): ');
      const args = [
        ...selector,
        ...files.flatMap((file) => ['--file', file]),
        ...authorization,
        ...optionalFlagArgs('--trigger', trigger),
        ...optionalFlagArgs('--comment', comment),
        ...(confirmation.trim() === 'CONFIRM' ? ['--confirm'] : []),
      ];
      await handleSubmissionUpload(args, 'upload');
      return;
    }
    case 14: {
      const selector = await promptGuidedTaskSelector(
        'UPLOAD NEW FILES',
        'Attach extra files to an existing submission.',
      );
      const files = await promptUploadFiles();
      const authorization = await promptExternalArtifactAuthorization(
        files,
        '--allow-external-file',
        'upload file',
      );
      const trigger = await prompt('Trigger (need_help/ready_for_feedback, optional): ');
      const comment = await prompt('Comment (optional): ');
      const confirmation = await prompt(
        'Type CONFIRM to dispatch replacement files (otherwise dry-run): ',
      );
      const args = [
        ...selector,
        ...files.flatMap((file) => ['--file', file]),
        ...authorization,
        ...optionalFlagArgs('--trigger', trigger),
        ...optionalFlagArgs('--comment', comment),
        ...(confirmation.trim() === 'CONFIRM' ? ['--confirm'] : []),
      ];
      await handleSubmissionUpload(args, 'upload-new-files');
      return;
    }
    case 15:
      await handleLogout();
      return;
    case 16:
      help();
      return;
    default:
      throw new Error(`Unknown launcher action id: ${actionId}`);
  }
}

/** Interactive launcher loop used by `ontrack` (no command) and `ontrack welcome`. */
async function handleWelcome(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    help();
    return;
  }

  const items = getWelcomeMenuItems();
  const allowedIds = items.map((item) => item.id);

  while (true) {
    renderWelcomeScreen(items);

    const selectedRaw = await prompt('Select action number (0 to exit): ');
    const selection = parseWelcomeSelection(selectedRaw, allowedIds);
    if (selection === 0) {
      console.log('Exiting Always Ontrack launcher.');
      return;
    }

    if (selection === null) {
      console.log('[warn] Invalid selection. Enter a valid menu number.');
      await prompt('Press Enter to continue...');
      continue;
    }

    try {
      await runWelcomeAction(selection);
    } catch (error) {
      const redacted = toRedactedError(error);
      console.error(`Error: ${redacted.message}`);
    }

    const next = await prompt('Press Enter to return to launcher, or type q to quit: ');
    if (/^(q|quit|exit)$/i.test(next.trim())) {
      console.log('Exiting Always Ontrack launcher.');
      return;
    }
  }
}

/**
 * Ensure an authenticated command receives a usable credential. Legacy
 * sessions without expiry remain readable during the compatibility window;
 * lifecycle-aware sessions silently refresh before their expiry boundary.
 */
async function requireSession(): Promise<SessionData> {
  const existing = await loadSession();
  if (existing && sessionUsability(existing).state === 'unknown') {
    if (!getAgentOutputContext()) {
      console.error(
        '[warn] This saved credential has no verified expiry metadata; continuing with server-side validation.',
      );
    }
    return existing;
  }

  const baseUrl = existing?.baseUrl ?? normalizeBaseUrl();
  const broker = createOnTrackAuthBroker({ baseUrl });
  const result = await broker.ensure({
    minTtlSeconds: DEFAULT_AUTH_MIN_TTL_SECONDS,
    interaction: 'never',
  });
  if (result.status === 'ready') {
    const session = await broker.currentSession();
    if (session) {
      return session;
    }
    throw new AgentProtocolError({
      code: 'AUTH_REFRESH_FAILED',
      status: 'auth_required',
      summary: 'Authentication completed but no local session was available.',
      retryable: true,
    });
  }
  if (result.status === 'auth_required') {
    throw new AgentProtocolError({
      code: 'HUMAN_VERIFICATION_REQUIRED',
      status: 'auth_required',
      summary: 'Monash authentication requires human verification.',
      retryable: true,
      nextActions: [
        {
          action: 'auth.ensure',
          arguments: { interaction: 'if_required' },
        },
      ],
    });
  }
  throw new AgentProtocolError({
    code: 'AUTH_REFRESH_FAILED',
    status: 'auth_required',
    summary: 'The saved OnTrack credential could not be refreshed.',
    retryable: result.retryable,
    nextActions: [
      {
        action: 'auth.ensure',
        arguments: { interaction: 'if_required' },
      },
    ],
  });
}

/**
 * Build an API client that may refresh and replay one failed read. Mutations
 * are never replayed because the protocol layer restricts this callback to
 * GET/HEAD requests.
 */
function createAuthenticatedApi(session: SessionData): OnTrackApiClient {
  const broker = createOnTrackAuthBroker({ baseUrl: session.baseUrl });
  return new OnTrackApiClient(session.baseUrl, {
    refreshSession: async () => {
      const result = await broker.ensure({
        minTtlSeconds: 0,
        interaction: 'never',
        forceRefresh: true,
      });
      return result.status === 'ready' ? broker.currentSession() : null;
    },
  });
}

/** Flatten project task arrays while preserving project/unit context fields for display. */
function flattenTasks(projects: ProjectSummary[]): StudentTaskRow[] {
  return buildStudentTaskRows(projects);
}

/** Add explicit task identities plus the stable legacy JSON aliases. */
function taskIdentityJson(
  resolved: Pick<ResolvedTaskSelector, 'taskDefId' | 'taskInstanceId'>,
): {
  taskDefinitionId: number;
  taskInstanceId?: number;
  taskId: number;
  taskDefId: number;
} {
  return {
    taskDefinitionId: resolved.taskDefId,
    taskInstanceId: resolved.taskInstanceId,
    taskId: resolved.taskInstanceId ?? resolved.taskDefId,
    taskDefId: resolved.taskDefId,
  };
}

/** Parse optional integer flag; returns undefined when flag is not present. */
function parseOptionalInteger(args: string[], flag: string): number | undefined {
  if (!hasFlag(args, flag)) {
    return undefined;
  }

  return parseIntegerFlagValue(getFlagValue(args, flag), flag);
}

/** Parse optional non-empty string flag and validate missing/blank values. */
function parseOptionalString(args: string[], flag: string): string | undefined {
  if (!hasFlag(args, flag)) {
    return undefined;
  }

  const raw = getFlagValue(args, flag);
  if (!raw || raw.startsWith('--')) {
    throw new Error(`Missing value for ${flag}.`);
  }

  const value = raw.trim();
  if (!value) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

/** Extract project id field from inbox payload variants. */
function extractInboxProjectId(
  task: Pick<InboxTask, 'projectId' | 'project_id'>,
): number | undefined {
  if (typeof task.projectId === 'number') {
    return task.projectId;
  }

  if (typeof task.project_id === 'number') {
    return task.project_id;
  }

  return undefined;
}

/** Normalize the production project-to-unit relationship across payload variants. */
function projectUnitId(project: ProjectSummary): number | undefined {
  const nested = project.unit?.id;
  if (typeof nested === 'number' && Number.isInteger(nested)) {
    return nested;
  }

  const record = project as Record<string, unknown>;
  const candidates = [record.unitId, record.unit_id];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Emit staff-scoping hint for expensive commands when no unit/project filter is set. */
function roleScopeHint(session: SessionData, command: string, hasScopeFilter: boolean): void {
  const role = resolveUserRole(session);
  if (!isStaffLikeRole(role) || hasScopeFilter) {
    return;
  }

  const safeRole = (role ?? 'staff')
    .replace(/[\u0000-\u001f\u007f]/gu, '?')
    .slice(0, 64);

  console.error(
    `[hint] Role "${safeRole}" running ${command} without scope filters can be expensive. Consider --unit-id and/or --project-id.`,
  );
}

/** Resolve account role from user object with fallback to system_role field. */
function resolveUserRole(session: SessionData): string | undefined {
  const user = session.user as Record<string, unknown>;
  const role = user.role;
  if (typeof role === 'string' && role.trim()) {
    return role;
  }

  const systemRole = user.system_role;
  if (typeof systemRole === 'string' && systemRole.trim()) {
    return systemRole;
  }

  return undefined;
}

/** Normalize unit role field across payload variants. */
function getUnitRole(unit: UnitSummary): string | undefined {
  return unit.myRole || unit.my_role;
}

/** Detect 403-like failures based on normalized error message. */
function isForbiddenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b403\b/.test(message);
}

/** Derive a deduplicated unit list from project payloads when `/units` is forbidden. */
function deriveUnitsFromProjects(projects: ProjectSummary[]): UnitSummary[] {
  const map = new Map<number, UnitSummary>();
  for (const project of projects) {
    const unit = project.unit;
    if (!unit || typeof unit.id !== 'number' || map.has(unit.id)) {
      continue;
    }
    map.set(unit.id, {
      id: unit.id,
      code: unit.code,
      name: unit.name,
      myRole: getUnitRole(unit),
      active: unit.active,
    });
  }

  return [...map.values()];
}

/** Deduplicate inbox/fallback tasks by (project, unit, task) composite key. */
function dedupeInboxTasks(tasks: InboxRowTask[]): InboxRowTask[] {
  const map = new Map<string, InboxRowTask>();
  for (const task of tasks) {
    const key = `${extractInboxProjectId(task) ?? '-'}:${task._unitId}:${task.id}`;
    map.set(key, task);
  }
  return [...map.values()];
}

/** Extract task-definition list from unit payload supporting snake/camel case keys. */
function getUnitTaskDefinitions(unit: UnitSummary | undefined): TaskDefinitionSummary[] {
  if (!unit) {
    return [];
  }
  const defs = unit.taskDefinitions ?? unit.task_definitions;
  if (!Array.isArray(defs)) {
    return [];
  }
  return defs;
}

type UploadFileInput = {
  key?: string;
  path: string;
};

/** Infer default upload trigger from task status when not supplied explicitly. */
function deriveDefaultSubmissionTrigger(
  task: Partial<TaskSummary>,
): SubmissionTrigger | undefined {
  const status = (getTaskStatus(task) || '').trim().toLowerCase();
  if (status === 'working_on_it' || status === 'need_help') {
    return 'need_help';
  }
  return undefined;
}

/** Parse and validate submission trigger flag. */
function parseSubmissionTrigger(raw: string | undefined): SubmissionTrigger | undefined {
  if (!raw) {
    return undefined;
  }

  const value = raw.trim().toLowerCase();
  if (value === 'need_help' || value === 'ready_for_feedback') {
    return value;
  }

  throw new Error('--trigger must be one of: need_help, ready_for_feedback.');
}

/** Preserve actionable artifact policy failures without exposing local paths or raw I/O errors. */
function safeArtifactFailure(error: unknown): string {
  return error instanceof ArtifactSafetyError
    ? error.message
    : 'Artifact access could not be completed safely.';
}

/** Read upload file bytes and annotate with server-only key + filename metadata. */
async function readUploadFiles(
  assignments: Array<{ key: string; localPath: string }>,
  allowExternalFile: boolean,
): Promise<
  Array<{
    key: string;
    filename: string;
    content: Buffer;
  }>
> {
  return Promise.all(
    assignments.map(async (assignment, index) => {
      try {
        const artifact = await readUploadArtifact(assignment.localPath, {
          root: process.cwd(),
          allowExternal: allowExternalFile,
        });
        return {
          key: assignment.key,
          filename: artifact.filename,
          content: artifact.content,
        };
      } catch (error) {
        throw new Error(
          `Failed to read upload file ${index + 1}: ${safeArtifactFailure(error)}`,
        );
      }
    }),
  );
}

/** Apply optional project/unit scoping to project lists. */
function projectMatchesScope(
  project: ProjectSummary,
  scope: { projectId?: number; unitId?: number },
): boolean {
  if (scope.projectId !== undefined && project.id !== scope.projectId) {
    return false;
  }
  if (scope.unitId !== undefined && projectUnitId(project) !== scope.unitId) {
    return false;
  }
  return true;
}

function settleMetadataReads<T>(
  tasks: readonly (() => Promise<T>)[],
  agentTransport: boolean,
): Promise<PromiseSettledResult<T>[]> {
  return agentTransport
    ? settleWithConcurrency(tasks, AGENT_REMOTE_READ_CONCURRENCY)
    : Promise.allSettled(tasks.map((task) => task()));
}

/**
 * Load projects and progressively enrich with:
 * - project detail payloads (when accessible)
 * - unit definition metadata (for task names/abbr/upload requirements)
 */
async function loadProjectsWithTaskMetadata(
  api: OnTrackApiClient,
  session: SessionData,
  scope: { projectId?: number; unitId?: number } = {},
  options: {
    readonly strictMetadata?: boolean;
    /** Use the bounded, canonical Agent transport for every remote read. */
    readonly agentTransport?: boolean;
  } = {},
): Promise<ProjectSummary[]> {
  // Step 1: fetch project overview first (fast, broad visibility).
  const directAgentProject =
    options.agentTransport && scope.projectId !== undefined
      ? await api.getProjectForAgent(session, scope.projectId)
      : undefined;
  if (directAgentProject && directAgentProject.id !== scope.projectId) {
    throw new AgentProtocolError({
      code: "REMOTE_UNAVAILABLE",
      summary:
        "OnTrack returned an unexpected project identity for the Agent scope.",
    });
  }
  const overview = directAgentProject
    ? [directAgentProject]
    : await (options.agentTransport
        ? api.listProjectsForAgent(session)
        : api.listProjects(session));
  if (options.agentTransport && overview.length > 200) {
    throw new AgentProtocolError({
      code: "REMOTE_UNAVAILABLE",
      summary: "OnTrack returned more than 200 projects for the Agent watch.",
    });
  }
  const scopedOverview = overview.filter((project) =>
    projectMatchesScope(project, scope),
  );
  if (scopedOverview.length === 0) {
    return [];
  }

  // Step 2: enrich with project details when accessible (fallback to overview on failure).
  const detailedResults: PromiseSettledResult<ProjectSummary>[] =
    directAgentProject
      ? [{ status: "fulfilled", value: directAgentProject }]
      : await settleMetadataReads(
          scopedOverview.map((project) => () =>
            options.agentTransport
              ? api.getProjectForAgent(session, project.id)
              : api.getProject(session, project.id),
          ),
          options.agentTransport ?? false,
        );

  const projects: ProjectSummary[] = [];
  for (let index = 0; index < detailedResults.length; index += 1) {
    const result = detailedResults[index];
    if (result.status === "fulfilled") {
      projects.push(result.value);
      continue;
    }

    if (
      options.strictMetadata ||
      (result.reason instanceof OnTrackHttpError &&
        result.reason.authFailure !== "other")
    ) {
      throw result.reason;
    }

    // fallback to overview when project detail endpoint is unavailable
    projects.push(scopedOverview[index]);
  }

  // Step 3: enrich with unit task-definition metadata to recover missing task fields.
  const unitIds = [
    ...new Set(
      projects
        .map((project) => projectUnitId(project))
        .filter((id): id is number => typeof id === "number"),
    ),
  ];

  const unitResults = await settleMetadataReads(
    unitIds.map((unitId) => () =>
      options.agentTransport
        ? api.getUnitForAgent(session, unitId)
        : api.getUnit(session, unitId),
    ),
    options.agentTransport ?? false,
  );

  const unitMap = new Map<number, UnitSummary>();
  const unitDefinitionMap = new Map<
    number,
    Map<number, TaskDefinitionSummary>
  >();
  for (let index = 0; index < unitResults.length; index += 1) {
    const result = unitResults[index];
    if (result.status !== "fulfilled") {
      if (
        options.strictMetadata ||
        (result.reason instanceof OnTrackHttpError &&
          result.reason.authFailure !== "other")
      ) {
        throw result.reason;
      }
      continue;
    }

    const unit = result.value;
    unitMap.set(unit.id, unit);
    unitDefinitionMap.set(
      unit.id,
      new Map(
        getUnitTaskDefinitions(unit)
          .filter((definition) => typeof definition.id === "number")
          .map((definition) => [definition.id as number, definition]),
      ),
    );
  }

  return projects.map((project) => {
    const unitId = projectUnitId(project);
    const fullUnit = unitId !== undefined ? unitMap.get(unitId) : undefined;
    const taskDefinitions =
      unitId !== undefined ? unitDefinitionMap.get(unitId) : undefined;

    const projectUnit =
      project.unit ?? (unitId !== undefined ? { id: unitId } : undefined);
    const mergedUnit = fullUnit
      ? {
          ...projectUnit,
          ...fullUnit,
        }
      : projectUnit;

    const mergedTasks = (project.tasks || []).map((task) => {
      const taskDefId = getTaskDefinitionId(task);
      const taskDefinition =
        taskDefId !== undefined ? taskDefinitions?.get(taskDefId) : undefined;
      return {
        ...task,
        definition: {
          id: taskDefId,
          abbreviation:
            task.definition?.abbreviation ?? taskDefinition?.abbreviation,
          name: task.definition?.name ?? taskDefinition?.name,
          targetGrade:
            task.definition?.targetGrade ?? taskDefinition?.targetGrade,
          uploadRequirements:
            task.definition?.uploadRequirements ??
            task.definition?.upload_requirements ??
            taskDefinition?.uploadRequirements ??
            taskDefinition?.upload_requirements,
          upload_requirements:
            task.definition?.upload_requirements ??
            task.definition?.uploadRequirements ??
            taskDefinition?.upload_requirements ??
            taskDefinition?.uploadRequirements,
        },
      };
    });

    return {
      ...project,
      unit: mergedUnit,
      tasks: mergedTasks,
    };
  });
}

/** Build inbox fallback rows from project/task metadata when inbox endpoint is unavailable. */
async function buildInboxFallbackTasksFromProjectDetails(
  api: OnTrackApiClient,
  session: SessionData,
  candidateUnitIds: number[],
): Promise<InboxRowTask[]> {
  const unitFilter = new Set(candidateUnitIds);
  const projects = await loadProjectsWithTaskMetadata(api, session);
  const tasks = flattenTasks(projects)
    .filter((task) => task.unitId !== undefined && unitFilter.has(task.unitId))
    .map(
      (task): InboxRowTask => ({
        ...task,
        projectId: task.projectId,
        unitId: task.unitId,
        _unitId: task.unitId ?? -1,
      }),
    );

  return tasks;
}

/** Try `/units` first, then fallback to units derived from `/projects` on 403. */
async function listUnitsWithFallback(
  api: OnTrackApiClient,
  session: SessionData,
): Promise<{ units: UnitSummary[]; fallbackUsed: boolean }> {
  // Some accounts cannot access /units directly; fallback to units derived from /projects.
  try {
    return {
      units: await api.listUnits(session),
      fallbackUsed: false,
    };
  } catch (error) {
    if (!isForbiddenError(error)) {
      throw error;
    }

    const projects = await api.listProjects(session);
    const units = deriveUnitsFromProjects(projects);
    if (units.length === 0) {
      throw error;
    }

    return {
      units,
      fallbackUsed: true,
    };
  }
}

/** Show advertised auth method and SSO redirect endpoint metadata. */
async function handleAuthMethod(args: string[]): Promise<void> {
  const api = new OnTrackApiClient(normalizeBaseUrl(getFlagValue(args, '--base-url')));
  const method = await api.getAuthMethod();
  if (hasFlag(args, '--json')) {
    printJson(method);
    return;
  }

  console.log(`Base URL: ${api.base}`);
  console.log(`Method: ${safeTextForHumanDisplay(method.method, 'unknown')}`);
  if (method.redirect_to) {
    console.log(`SSO redirect: ${safeUrlForHumanDisplay(method.redirect_to)}`);
  }
}

/** Read package metadata without making capabilities depend on a network or session. */
async function readCliVersion(): Promise<string> {
  const raw = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version?: unknown };
  return typeof raw.version === 'string' ? raw.version : 'unknown';
}

/** Emit the offline Agent command and safety capability registry. */
async function handleCapabilities(): Promise<void> {
  printJson(buildCapabilities(await readCliVersion()));
}

/** Emit one offline command schema selected by stable Agent command path. */
function handleSchema(args: string[]): void {
  const positional = args.find((value, index) => {
    if (value.startsWith('--')) return false;
    return index === 0 || args[index - 1]?.startsWith('--') === false;
  });
  const requested = getFlagValue(args, '--command') ?? positional;
  if (!requested || requested === 'agent-json') {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: 'schema requires a stable command path, for example task.show.',
    });
  }
  printJson(getCommandSpec(requested));
}

/** Read credential lifecycle metadata without exposing identity or secrets. */
async function readAuthStatus(requestedBaseUrl?: string) {
  const existing = await loadSession();
  const baseUrl = requestedBaseUrl
    ? normalizeBaseUrl(requestedBaseUrl)
    : (existing?.baseUrl ?? normalizeBaseUrl());
  const broker = createOnTrackAuthBroker({ baseUrl });
  return broker.status();
}

/** Return credential lifecycle metadata without exposing identity or secrets. */
async function handleAuthStatus(args: string[]): Promise<void> {
  printJson(await readAuthStatus(getFlagValue(args, '--base-url')));
}

/** Ensure a usable credential, allowing a visible browser only by explicit policy. */
async function handleAuthEnsure(args: string[]): Promise<void> {
  const existing = await loadSession();
  const requestedBaseUrl = getFlagValue(args, '--base-url');
  const baseUrl = requestedBaseUrl
    ? normalizeBaseUrl(requestedBaseUrl)
    : (existing?.baseUrl ?? normalizeBaseUrl());
  const minTtlSeconds =
    parseOptionalInteger(args, '--min-ttl-seconds') ??
    DEFAULT_AUTH_MIN_TTL_SECONDS;
  const rawInteraction =
    parseOptionalString(args, '--interaction') ?? 'never';
  if (rawInteraction !== 'never' && rawInteraction !== 'if_required') {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: '--interaction must be never or if_required.',
    });
  }
  const interaction = rawInteraction as AuthInteractionMode;
  const broker = createOnTrackAuthBroker({ baseUrl });
  const result = await broker.ensure({ minTtlSeconds, interaction });
  if (result.status === 'ready') {
    printJson(result);
    return;
  }
  if (result.status === 'auth_required') {
    throw new AgentProtocolError({
      code: 'HUMAN_VERIFICATION_REQUIRED',
      status: 'auth_required',
      summary: 'Monash authentication requires human verification.',
      retryable: true,
      nextActions: [
        {
          action: 'auth.ensure',
          arguments: { interaction: 'if_required' },
        },
      ],
    });
  }
  throw new AgentProtocolError({
    code: 'AUTH_REFRESH_FAILED',
    status: 'auth_required',
    summary: 'The OnTrack credential could not be refreshed.',
    retryable: result.retryable,
  });
}

/**
 * Login entrypoint.
 *
 * Priority:
 * - direct token/login flags when provided
 * - guided SSO by default
 * - browser-assisted and manual redirect as fallback paths
 */
async function handleLogin(args: string[]): Promise<void> {
  const api = new OnTrackApiClient(normalizeBaseUrl(getFlagValue(args, '--base-url')));
  // Security policy: password must never be passed on command line (history/process list leak).
  if (hasFlag(args, '--password') || hasFlag(args, '--sso-password')) {
    throw new Error('Password must be entered interactively. Command-line password flags are not supported.');
  }
  // Parse mutually exclusive mode flags first.
  const auto = hasFlag(args, '--auto');
  const sso = hasFlag(args, '--sso');
  const showBrowserFlag = hasFlag(args, '--show-browser');
  const hideBrowserFlag = hasFlag(args, '--hide-browser');
  if (showBrowserFlag && hideBrowserFlag) {
    throw new Error('Use either --show-browser or --hide-browser, not both.');
  }
  // Product default: use hidden browser everywhere for consistent UX across local/server.
  // `--show-browser` remains available for debugging and diagnostics.
  const showBrowser = showBrowserFlag && !hideBrowserFlag;
  const autoTimeoutSec = hasFlag(args, '--auto-timeout-sec')
    ? parseIntegerFlagValue(getFlagValue(args, '--auto-timeout-sec'), '--auto-timeout-sec')
    : 300;
  if (autoTimeoutSec < 10) {
    throw new Error('--auto-timeout-sec must be >= 10 seconds.');
  }
  const ssoTimeoutSec = hasFlag(args, '--sso-timeout-sec')
    ? parseIntegerFlagValue(getFlagValue(args, '--sso-timeout-sec'), '--sso-timeout-sec')
    : 420;
  if (ssoTimeoutSec < 60) {
    throw new Error('--sso-timeout-sec must be >= 60 seconds.');
  }
  if (auto && sso) {
    throw new Error('Use either --auto or --sso, not both.');
  }

  // Direct credential flags are accepted for advanced/manual flows.
  let authToken = getFlagValue(args, '--auth-token');
  let username = getFlagValue(args, '--username');
  let credentialSource: CredentialSource = 'manual-sign-in';
  let credentialExpiresAt: string | undefined;
  let credentialContract: LoginCredentials['contract'];

  // Manual redirect URL can also directly provide auth token + username.
  const redirectUrl = getFlagValue(args, '--redirect-url');
  if (redirectUrl) {
    ({ authToken, username } = parseSsoRedirectUrl(redirectUrl));
  }

  // Only perform SSO flow when direct credentials were not supplied.
  if (!authToken || !username) {
    const method = await api.getAuthMethod();

    if (typeof method.redirect_to === 'string' && method.redirect_to.trim()) {
      const redirectTo = method.redirect_to;
      const manualRedirectTo = safeUrlForManualDisplay(redirectTo);
      console.log(
        `OnTrack uses ${safeTextForHumanDisplay(method.method, 'SSO')} for authentication.`,
      );
      console.log('Expected final redirect format: https://ontrack.infotech.monash.edu/sign_in?authToken=...&username=...');
      const loginMode = resolveLoginMode({
        auto,
        sso,
        hasAuthToken: Boolean(authToken),
        hasUsername: Boolean(username),
        hasRedirectUrl: Boolean(redirectUrl),
      });

      // Fast-path: if we already have a reusable browser session state, skip re-auth prompts.
      if (loginMode !== 'manual') {
        try {
          const reused = await captureCredentialsFromStoredBrowserSession({
            ssoUrl: redirectTo,
            apiBaseUrl: api.base,
            timeoutMs: 12_000,
            headless: !showBrowser,
          });

          if (reused) {
            try {
              const savedAt = new Date().toISOString();
              const reusedSession =
                reused.contract === 'access-token'
                  ? sessionFromAccessTokenCapture(api.base, reused, savedAt)
                  : await (async (): Promise<SessionData> => {
                      // Legacy URL/request captures still require the observed
                      // `/auth` exchange before they become an API session.
                      const response = await signInAndPersistRefreshCookie(api, {
                        auth_token: reused.authToken,
                        username: reused.username,
                        remember: true,
                      });
                      return {
                        baseUrl: api.base,
                        username: reused.username,
                        authToken: response.auth_token,
                        user: response.user,
                        savedAt,
                        expiresAt:
                          response.auth_token_expiry ??
                          (response.auth_token === reused.authToken
                            ? reused.expiresAt
                            : undefined),
                        source: 'browser-sso',
                        refreshedAt: savedAt,
                      };
                    })();
              await saveSession(reusedSession);
              renderTerminalEvent(
                `Reused existing browser session (${reused.source}). Skipping interactive sign-in.`,
                'success',
              );
              renderLoginSuccessPanel(reusedSession);
              return;
            } catch (reuseValidationError) {
              const detail = toRedactedError(reuseValidationError).message;
              console.log(`[warn] Reused browser session is stale or invalid: ${detail}`);
              console.log('[info] Continuing with guided SSO login.');
            }
          }
        } catch (reuseError) {
          const detail = toRedactedError(reuseError).message;
          console.log(`[warn] Browser session reuse probe failed: ${detail}`);
        }
      }

      // Last-resort fallback retained for edge MFA/captcha/selector issues.
      const manualRedirectCapture = async (): Promise<void> => {
        console.log('Complete login in your browser, then paste the final redirected URL from the address bar.');
        const printManualTarget = (): void => {
          if (manualRedirectTo) {
            console.log(`Open this URL manually:\n${manualRedirectTo}`);
            return;
          }
          console.log(
            'Open the OnTrack sign-in page in a trusted browser. The server-provided SSO URL could not be displayed safely.',
          );
        };
        if (!hasFlag(args, '--no-open')) {
          const opened = openExternal(redirectTo);
          if (!opened) {
            printManualTarget();
          }
        } else {
          printManualTarget();
        }
        const pasted = await prompt('Paste final redirect URL: ');
        ({ authToken, username } = parseSsoRedirectUrl(pasted));
      };

      if (loginMode === 'auto') {
        // Browser-assisted capture mode: user logs in in browser, CLI passively captures credentials.
        console.log('Starting auto SSO login in a controlled browser...');
        const captured = await captureSsoCredentials({
          ssoUrl: redirectTo,
          apiBaseUrl: api.base,
          timeoutMs: autoTimeoutSec * 1000,
          headless: !showBrowser,
        });
        authToken = captured.authToken;
        username = captured.username;
        credentialExpiresAt = captured.expiresAt;
        credentialContract = captured.contract;
        credentialSource =
          captured.contract === 'access-token' ? 'access-token' : 'browser-sso';
        console.log(`Auto login captured credentials from ${captured.source}.`);
      } else if (loginMode === 'sso_guided') {
        // Guided mode asks username/password in CLI, then automates SSO form filling.
        let guidedUsername = parseOptionalString(args, '--sso-username');
        if (!guidedUsername) {
          guidedUsername = await prompt('Monash username: ');
        }
        if (!guidedUsername.trim()) {
          throw new Error('Username cannot be empty.');
        }

        let password = await promptHidden('Password: ');
        if (!password) {
          throw new Error('Password cannot be empty.');
        }

        // Map low-level SSO step callbacks into human-readable terminal text.
        const stepLabels: Record<string, string> = {
          username: 'Submitting username...',
          password: 'Submitting password...',
          mfa_select: 'Multiple MFA options detected. Please choose one in CLI.',
          mfa_code: 'Selected MFA method requires a verification code from your authenticator app.',
          mfa_wait: 'Waiting for Okta Verify push/number approval on your phone...',
          completed: 'SSO flow completed.',
        };

        // Callback used by playwright flow when multiple MFA options are detected.
        const chooseMfaMethod = async (
          options: MfaMethodOption[],
        ): Promise<number> => {
          if (options.length === 0) {
            return 1;
          }

          const recommendedOption =
            options.find((option) => option.recommended) ?? options[0];

          const optionLines = options.map((option) => {
            const suffix = option.id === recommendedOption.id ? ' (Recommended)' : '';
            return `${option.id}. ${option.label}${suffix}`;
          });
          renderTerminalPanel(
            'MFA METHOD SELECTION',
            [
              'Pick one method in the prompt below.',
              ...optionLines,
              `Default: ${recommendedOption.id}`,
            ],
            'info',
          );
          console.log('');
          console.log('Select a security method:');
          for (const line of optionLines) {
            console.log(`  ${line}`);
          }

          const raw = await prompt(`Choose method [${recommendedOption.id}]: `);
          if (!raw.trim()) {
            return recommendedOption.id;
          }

          const selected = Number.parseInt(raw.trim(), 10);
          if (Number.isFinite(selected) && options.some((option) => option.id === selected)) {
            return selected;
          }

          console.log(
            `[warn] Invalid selection "${raw.trim()}". Using recommended method ${recommendedOption.id}.`,
          );
          return recommendedOption.id;
        };

        const requestMfaCode = async (methodLabel: string): Promise<string> => {
          renderTerminalPanel(
            'MFA CODE REQUIRED',
            [
              `Method: ${methodLabel}`,
              'Enter the current code shown in your authenticator app.',
            ],
            'info',
          );
          const code = (await prompt('Enter verification code: ')).trim();
          if (!code) {
            throw new Error('Verification code cannot be empty.');
          }
          return code;
        };

        try {
          // Primary guided SSO flow (username/password + MFA selection/approval wait).
          renderTerminalPanel(
            'GUIDED MONASH SSO',
            [
              'Automation started.',
              'Follow terminal prompts for MFA: choose method, enter code, or approve push.',
            ],
            'info',
          );
          const captured = await captureSsoCredentialsWithGuidedLogin(
            {
              ssoUrl: redirectTo,
              apiBaseUrl: api.base,
              username: guidedUsername,
              password,
              timeoutMs: ssoTimeoutSec * 1000,
              headless: !showBrowser,
              chooseMfaMethod,
              requestMfaCode,
              onMfaNumberChallenge: (numbers) => {
                if (numbers.length === 0) {
                  return;
                }
                renderTerminalPanel(
                  'OKTA VERIFY NUMBER CHALLENGE',
                  [
                    `Tap this number in Okta Verify: ${renderChallengeNumbersInline(numbers)}`,
                    'Use the same number shown in your app challenge list.',
                  ],
                  'success',
                );
                console.log(`[mfa] Number challenge on page: ${renderChallengeNumbersInline(numbers)}`);
                console.log('[mfa] Tap the matching number in Okta Verify.');
              },
            },
            (step) => {
              const message = stepLabels[step];
              if (message) {
                renderTerminalEvent(message, step === 'completed' ? 'success' : 'info');
              }
            },
          );
          authToken = captured.authToken;
          username = captured.username;
          credentialExpiresAt = captured.expiresAt;
          credentialContract = captured.contract;
          credentialSource =
            captured.contract === 'access-token' ? 'access-token' : 'browser-sso';
          renderTerminalEvent(`Guided SSO captured credentials from ${captured.source}.`, 'success');
        } catch (error) {
          // Guided flow failed: classify and show redacted reason before fallback.
          const reason = classifySsoFallback(error);
          const detail = toRedactedError(error).message;
          if (error instanceof SsoFallbackError) {
            console.log(
              `[warn] Guided SSO fallback (${error.reason}) at step ${error.step}: ${detail}`,
            );
          } else {
            console.log(`[warn] Guided SSO fallback (${reason}): ${detail}`);
          }

          try {
            // Fallback 1: browser-assisted capture still avoids manual URL copy in many cases.
            console.log(
              '[info] Switching to browser-assisted SSO mode. Complete login in the opened browser window; credentials will be captured automatically.',
            );
            const captured = await captureSsoCredentials({
              ssoUrl: redirectTo,
              apiBaseUrl: api.base,
              timeoutMs: ssoTimeoutSec * 1000,
              headless: !showBrowser,
            });
            authToken = captured.authToken;
            username = captured.username;
            credentialExpiresAt = captured.expiresAt;
            credentialContract = captured.contract;
            credentialSource =
              captured.contract === 'access-token' ? 'access-token' : 'browser-sso';
            console.log(`Browser-assisted SSO captured credentials from ${captured.source}.`);
          } catch (assistedError) {
            // Fallback 2: last-resort manual redirect URL paste.
            const assistedDetail = toRedactedError(assistedError).message;
            console.log(`[warn] Browser-assisted SSO failed: ${assistedDetail}`);
            console.log('[info] Falling back to manual redirect URL flow (last-resort).');
            await manualRedirectCapture();
          }
        } finally {
          // Best-effort sensitive-memory cleanup.
          password = '';
        }
      } else {
        // Explicit manual mode.
        await manualRedirectCapture();
      }
    } else {
      throw new Error('This server does not advertise SSO, and interactive username/password login is not implemented in this CLI yet.');
    }
  }

  if (!authToken || !username) {
    throw new Error('Unable to obtain login credentials. Retry login with --sso, --auto, or --redirect-url.');
  }

  const savedAt = new Date().toISOString();
  const session =
    credentialContract === 'access-token'
      ? sessionFromAccessTokenCapture(
          api.base,
          {
            authToken,
            username,
            expiresAt: credentialExpiresAt,
            source: 'auth_response',
            contract: credentialContract,
          },
          savedAt,
        )
      : await (async (): Promise<SessionData> => {
          // Manual/legacy captures use the older exchange contract. Browser
          // access-token responses are already API credentials and never come here.
          const response = await signInAndPersistRefreshCookie(api, {
            auth_token: authToken,
            username,
            remember: true,
          });
          return {
            baseUrl: api.base,
            username,
            authToken: response.auth_token,
            user: response.user,
            savedAt,
            expiresAt:
              response.auth_token_expiry ??
              (response.auth_token === authToken
                ? credentialExpiresAt
                : undefined),
            source: credentialSource,
            refreshedAt: savedAt,
          };
        })();

  // Persist session for subsequent CLI commands.
  await saveSession(session);
  renderLoginSuccessPanel(session);
}

/** Clear remote/local auth state (remote sign-out failure does not block local cleanup). */
async function handleLogout(args: string[] = []): Promise<void> {
  if (getAgentOutputContext() && !hasFlag(args, '--confirm')) {
    throw new AgentProtocolError({
      code: 'CONFIRMATION_REQUIRED',
      status: 'action_required',
      summary: 'Agent logout requires explicit confirmation.',
      nextActions: [
        {
          action: 'auth.logout',
          arguments: { confirm: true },
        },
      ],
    });
  }
  const session = await loadSession();
  if (!session) {
    await Promise.all([
      clearSession(),
      Promise.resolve().then(() => clearAllBrowserSessionState()),
    ]);
    if (hasFlag(args, '--json')) {
      printJson({ status: 'signed_out' });
    } else {
      console.log('Session cleared.');
    }
    return;
  }
  const api = createAuthenticatedApi(session);
  let remoteSignOutError: unknown;

  try {
    await api.signOut(session);
  } catch (error) {
    remoteSignOutError = error;
  }

  await Promise.all([
    clearSession(),
    Promise.resolve().then(() => clearAllBrowserSessionState()),
  ]);
  if (remoteSignOutError) {
    console.error('[warn] Local session was cleared, but remote sign-out failed. Re-authenticate if needed.');
  }
  if (hasFlag(args, '--json')) {
    printJson({ status: 'signed_out' });
  } else {
    console.log('Session cleared.');
  }
}

/** Show current cached identity and role info. */
async function handleWhoAmI(args: string[]): Promise<void> {
  const session = await requireSession();
  const whoAmI = toWhoAmIView(session);
  if (hasFlag(args, '--json')) {
    printJson(whoAmI);
    return;
  }

  printTable([
    {
      username: whoAmI.username,
      id: whoAmI.id ?? '-',
      role: whoAmI.role ?? '-',
      firstName: whoAmI.firstName ?? '-',
      lastName: whoAmI.lastName ?? '-',
      email: whoAmI.email ?? '-',
      savedAt: whoAmI.savedAt,
    },
  ]);
}

/** List projects with readable summary fields. */
async function handleProjects(args: string[]): Promise<void> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const agentOutput = getAgentOutputContext();
  const projects = agentOutput
    ? await api.listProjectsForAgent(session)
    : await api.listProjects(session);

  if (hasFlag(args, '--json')) {
    printJson(agentOutput ? buildAgentProjectsListOutput(projects) : projects);
    return;
  }

  printTable(
    projects.map((project) => ({
      id: project.id,
      unitCode: project.unit?.code ?? '-',
      unitName: project.unit?.name ?? '-',
      enrolled: project.enrolled ?? '-',
      targetGrade: project.targetGrade ?? '-',
      submittedGrade: project.submittedGrade ?? '-',
      tasks: Array.isArray(project.tasks) ? project.tasks.length : '-',
    })),
  );
}

async function readAgentProjectsList(
  session: SessionData,
): Promise<AgentProjectsListOutput> {
  const api = createAuthenticatedApi(session);
  return buildAgentProjectsListOutput(await api.listProjectsForAgent(session));
}

async function readAgentTasksList(
  input: AgentTasksListInput,
  session: SessionData,
): Promise<AgentTasksListOutput> {
  const api = createAuthenticatedApi(session);
  return createAgentTasksList({
    readProject: (projectId) => api.getProjectForAgent(session, projectId),
    readUnit: (unitId) => api.getUnitForAgent(session, unitId),
  })(input);
}

async function readAgentUnitShow(
  input: AgentUnitShowInput,
  session: SessionData,
): Promise<AgentUnitShowOutput> {
  const api = createAuthenticatedApi(session);
  return createAgentUnitShow({
    readProject: (projectId) => api.getProjectForAgent(session, projectId),
    readUnit: (unitId) => api.getUnitForAgent(session, unitId),
  })(input);
}

async function readAgentTutorialsStatus(
  input: AgentTutorialsStatusInput,
  session: SessionData,
): Promise<AgentTutorialsStatusOutput> {
  const api = createAuthenticatedApi(session);
  return createAgentTutorialsStatus({
    readProject: (projectId) => api.getProjectForAgent(session, projectId),
    readUnit: (unitId) => api.getUnitForAgent(session, unitId),
  })(input);
}

async function readAgentFeedbackList(
  input: AgentFeedbackListInput,
  session: SessionData,
): Promise<AgentFeedbackListOutput> {
  const api = createAuthenticatedApi(session);
  return createAgentFeedbackList({
    readProject: (projectId) => api.getProjectForAgent(session, projectId),
    readUnit: (unitId) => api.getUnitForAgent(session, unitId),
    readFeedback: (projectId, taskDefinitionId) =>
      api.listTaskCommentsForAgent(session, projectId, taskDefinitionId),
  })(input);
}

async function readAgentFeedbackTarget(
  input: AgentFeedbackListInput,
  session: SessionData,
): Promise<AgentFeedbackTarget> {
  const api = createAuthenticatedApi(session);
  return createAgentFeedbackTarget({
    readProject: (projectId) => api.getProjectForAgent(session, projectId),
    readUnit: (unitId) => api.getUnitForAgent(session, unitId),
  })(input);
}

function readAgentFeedbackWatch(
  input: AgentFeedbackWatchInput,
  session: SessionData,
  signal: AbortSignal,
) {
  const api = createAuthenticatedApi(session);
  return createAgentFeedbackWatch({
    readProject: (projectId, sourceSignal) =>
      api.getProjectForAgent(session, projectId, sourceSignal),
    readUnit: (unitId, sourceSignal) =>
      api.getUnitForAgent(session, unitId, sourceSignal),
    readFeedback: (projectId, taskDefinitionId, sourceSignal) =>
      api.listTaskCommentsForAgent(
        session,
        projectId,
        taskDefinitionId,
        sourceSignal,
      ),
  })(input, { signal });
}

function agentFeedbackListInputFromSelector(
  selector: ReturnType<typeof parseTaskSelectorArgs>,
): AgentFeedbackListInput {
  if (selector.taskDefinitionId !== undefined) {
    return {
      project_id: selector.projectId,
      task_definition_id: selector.taskDefinitionId,
      ...(selector.abbr ? { abbreviation: selector.abbr } : {}),
    };
  }
  if (selector.abbr === undefined) {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: 'feedback.list requires task_definition_id or abbreviation.',
    });
  }
  return { project_id: selector.projectId, abbreviation: selector.abbr };
}

function parseAgentFeedbackListSelector(
  args: string[],
): ReturnType<typeof parseTaskSelectorArgs> {
  try {
    return parseTaskSelectorArgs(args);
  } catch {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: 'feedback.list requires exactly one task_definition_id or abbreviation.',
    });
  }
}

/** Build compact `status:count` summary used by project detail output. */
function countTasksByStatus(tasks: StudentTaskRow[]): string {
  if (tasks.length === 0) {
    return '-';
  }

  const counts = new Map<string, number>();
  for (const task of tasks) {
    const status = getTaskStatus(task) || 'unknown';
    counts.set(status, (counts.get(status) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([status, count]) => `${status}:${count}`)
    .join(', ');
}

/** Show full project payload/summary for one project id. */
async function handleProjectShow(args: string[]): Promise<void> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const projectId = parseIntegerFlagValue(getFlagValue(args, '--project-id'), '--project-id');
  const projects = await loadProjectsWithTaskMetadata(api, session, { projectId });
  const project = projects[0];
  if (!project) {
    throw new Error(`Project ${projectId} not found.`);
  }

  if (hasFlag(args, '--json')) {
    printJson(project);
    return;
  }

  const tasks = flattenTasks([project]);
  printTable([
    {
      id: project.id,
      unitId: project.unit?.id ?? '-',
      unitCode: project.unit?.code ?? '-',
      unitName: project.unit?.name ?? '-',
      enrolled: project.enrolled ?? '-',
      targetGrade: project.targetGrade ?? '-',
      submittedGrade: project.submittedGrade ?? '-',
      tasks: tasks.length,
      taskInstances: Array.isArray(project.tasks) ? project.tasks.length : 0,
      byStatus: countTasksByStatus(tasks),
    },
  ]);
}

/** List units, with role-aware hints and /projects-based fallback when needed. */
async function handleUnits(args: string[]): Promise<void> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const { units, fallbackUsed } = await listUnitsWithFallback(api, session);

  if (hasFlag(args, '--json')) {
    printJson(units);
    return;
  }

  if (fallbackUsed) {
    console.error('[info] /units is not accessible for this account; showing units derived from /projects.');
  }

  printTable(
    units.map((unit) => ({
      id: unit.id,
      code: unit.code ?? '-',
      name: unit.name ?? '-',
      role: getUnitRole(unit) ?? '-',
      active: unit.active ?? '-',
    })),
  );
}

/** Return array length or 0-like sentinel for non-array payload values. */
function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** Show detailed unit payload for one unit id. */
async function handleUnitShow(args: string[]): Promise<void> {
  const session = await requireSession();
  if (getAgentOutputContext()) {
    const projectId = parseOptionalInteger(args, '--project-id');
    if (projectId === undefined) {
      throw new AgentProtocolError({
        code: 'INVALID_ARGUMENT',
        summary: 'unit.show requires --project-id.',
      });
    }
    const unitId = parseOptionalInteger(args, '--unit-id');
    printJson(
      await readAgentUnitShow(
        {
          project_id: projectId,
          ...(unitId === undefined ? {} : { unit_id: unitId }),
        },
        session,
      ),
    );
    return;
  }

  const api = createAuthenticatedApi(session);
  const unitId = parseIntegerFlagValue(getFlagValue(args, '--unit-id'), '--unit-id');
  const unit = await api.getUnit(session, unitId);

  if (hasFlag(args, '--json')) {
    printJson(unit);
    return;
  }

  const rawUnit = unit as Record<string, unknown>;
  printTable([
    {
      id: unit.id,
      code: unit.code ?? '-',
      name: unit.name ?? '-',
      role: getUnitRole(unit) ?? '-',
      active: unit.active ?? '-',
      teachingPeriodId: rawUnit.teaching_period_id ?? '-',
      startDate: rawUnit.start_date ?? '-',
      endDate: rawUnit.end_date ?? '-',
      taskDefinitions: getUnitTaskDefinitions(unit).length,
      tutorials: arrayLength(rawUnit.tutorials),
      tutorialStreams: arrayLength(rawUnit.tutorial_streams),
      ilos: arrayLength(rawUnit.ilos),
      groups: arrayLength(rawUnit.groups),
    },
  ]);
}

/** List tasks inside one unit, optionally filtered by status. */
async function handleUnitTasks(args: string[]): Promise<void> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const unitId = parseIntegerFlagValue(getFlagValue(args, '--unit-id'), '--unit-id');
  const status = getFlagValue(args, '--status');
  const projects = await loadProjectsWithTaskMetadata(api, session, { unitId });

  let tasks = flattenTasks(projects);
  if (status) {
    tasks = filterTasksByStatus(tasks, status);
  }

  if (hasFlag(args, '--json')) {
    printJson(tasks);
    return;
  }

  printTable(
    tasks.map((task) => ({
      unit: task.unitCode ?? '-',
      task: getTaskAbbreviation(task) ?? '-',
      title: getTaskName(task) ?? '-',
      status: getTaskStatus(task) ?? '-',
      due: formatDate(getTaskDueDate(task)),
      completed: formatDate(getTaskCompletionDate(task)),
      taskDefinitionId: getTaskDefinitionId(task) ?? '-',
      taskInstanceId: task.taskInstanceId ?? '-',
      projectId: task.projectId,
    })),
  );
}

/** List tasks across accessible projects, with optional project/status filters. */
async function handleTasks(args: string[]): Promise<void> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const agentOutput = getAgentOutputContext();
  const projectId = parseOptionalInteger(args, '--project-id');

  if (agentOutput) {
    if (projectId === undefined) {
      throw new AgentProtocolError({
        code: 'INVALID_ARGUMENT',
        summary: 'tasks.list requires --project-id.',
      });
    }
    const unitId = parseOptionalInteger(args, '--unit-id');
    const status = getFlagValue(args, '--status');
    printJson(
      await readAgentTasksList(
        {
          project_id: projectId,
          ...(unitId === undefined ? {} : { unit_id: unitId }),
          ...(status === undefined ? {} : { status }),
        },
        session,
      ),
    );
    return;
  }

  const projects = await loadProjectsWithTaskMetadata(api, session, { projectId });

  let tasks = flattenTasks(projects);
  const status = getFlagValue(args, '--status');

  if (status) {
    tasks = filterTasksByStatus(tasks, status);
  }

  if (hasFlag(args, '--json')) {
    printJson(tasks);
    return;
  }

  printTable(
    tasks.map((task) => ({
      unit: task.unitCode ?? '-',
      task: getTaskAbbreviation(task) ?? '-',
      title: getTaskName(task) ?? '-',
      status: getTaskStatus(task) ?? '-',
      grade: task.grade ?? '-',
      due: formatDate(getTaskDueDate(task)),
      completed: formatDate(getTaskCompletionDate(task)),
      taskDefinitionId: getTaskDefinitionId(task) ?? '-',
      taskInstanceId: task.taskInstanceId ?? '-',
      projectId: task.projectId,
    })),
  );
}

type DoctorCheck = {
  key: string;
  endpoint: string;
  status: 'ok' | 'error' | 'skip';
  detail: string;
};

/** Parse status code from free-form error text for doctor diagnostics output. */
function parseStatusCodeFromError(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\b(\d{3})\b/);
  if (!match) {
    return undefined;
  }
  const code = Number.parseInt(match[1], 10);
  return Number.isFinite(code) ? code : undefined;
}

/** Trim long error strings to keep doctor table readable. */
function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 140 ? `${message.slice(0, 137)}...` : message;
}

/** Run one doctor probe step and normalize it into tabular check output. */
async function runDoctorCheck(
  key: string,
  endpoint: string,
  fn: () => Promise<unknown>,
): Promise<DoctorCheck> {
  try {
    await fn();
    return {
      key,
      endpoint,
      status: 'ok',
      detail: 'ok',
    };
  } catch (error) {
    const code = parseStatusCodeFromError(error);
    return {
      key,
      endpoint,
      status: 'error',
      detail: code ? `${code} ${shortError(error)}` : shortError(error),
    };
  }
}

/** Run quick health checks for auth/session visibility across core endpoints. */
async function handleDoctor(args: string[]): Promise<void> {
  // Lightweight connectivity/auth diagnostics against high-value endpoints.
  const session = await requireSession();
  const api = createAuthenticatedApi(session);

  const checks: DoctorCheck[] = [];
  // Public auth metadata check (no session mutation).
  checks.push(
    await runDoctorCheck('auth_method', 'GET /auth/method', async () => {
      await api.getAuthMethod();
    }),
  );

  let projects: ProjectSummary[] = [];
  // Core visibility check: projects endpoint.
  const projectsCheck = await runDoctorCheck('projects', 'GET /projects', async () => {
    projects = await api.listProjects(session);
  });
  checks.push(projectsCheck);

  const firstProject = projects[0];
  if (!firstProject) {
    checks.push({
      key: 'project_detail',
      endpoint: 'GET /projects/:projectId',
      status: 'skip',
      detail: 'No project available for this account.',
    });
  } else {
    checks.push(
      await runDoctorCheck('project_detail', `GET /projects/${firstProject.id}`, async () => {
        const detailedProject = await api.getProject(session, firstProject.id);
        firstProject.tasks = detailedProject.tasks;
      }),
    );
  }

  let firstUnitId = firstProject?.unit?.id;
  // Units endpoint may be forbidden for some roles; still useful as a health signal.
  const unitsCheck = await runDoctorCheck('units', 'GET /units', async () => {
    const units = await api.listUnits(session);
    if (!firstUnitId) {
      firstUnitId = units[0]?.id;
    }
  });
  checks.push(unitsCheck);

  if (!firstUnitId) {
    checks.push({
      key: 'unit_detail',
      endpoint: 'GET /units/:unitId',
      status: 'skip',
      detail: 'No unit id available.',
    });
    checks.push({
      key: 'inbox',
      endpoint: 'GET /units/:unitId/tasks/inbox',
      status: 'skip',
      detail: 'No unit id available.',
    });
  } else {
    checks.push(
      await runDoctorCheck('unit_detail', `GET /units/${firstUnitId}`, async () => {
        await api.getUnit(session, firstUnitId as number);
      }),
    );
    checks.push(
      await runDoctorCheck('inbox', `GET /units/${firstUnitId}/tasks/inbox`, async () => {
        await api.listInboxTasks(session, firstUnitId as number);
      }),
    );
  }

  const firstTaskDefId = firstProject?.tasks?.[0]
    ? getTaskDefinitionId(firstProject.tasks[0])
    : undefined;
  const projectId = firstProject?.id;
  // Task-scoped probes run only when we can resolve both project and taskDef ids.
  if (!projectId || !firstTaskDefId) {
    checks.push({
      key: 'feedback',
      endpoint: 'GET /projects/:projectId/task_def_id/:taskDefId/comments',
      status: 'skip',
      detail: 'No project/task available.',
    });
    checks.push({
      key: 'task_pdf',
      endpoint: 'GET /units/:unitId/task_definitions/:taskDefId/task_pdf.json',
      status: 'skip',
      detail: 'No project/task available.',
    });
    checks.push({
      key: 'submission_pdf',
      endpoint: 'GET /projects/:projectId/task_def_id/:taskDefId/submission',
      status: 'skip',
      detail: 'No project/task available.',
    });
  } else {
    checks.push(
      await runDoctorCheck(
        'feedback',
        `GET /projects/${projectId}/task_def_id/${firstTaskDefId}/comments`,
        async () => {
          await api.listTaskComments(session, projectId, firstTaskDefId);
        },
      ),
    );
    if (firstUnitId) {
      checks.push(
        await runDoctorCheck(
          'task_pdf',
          `GET /units/${firstUnitId}/task_definitions/${firstTaskDefId}/task_pdf.json`,
          async () => {
            await api.downloadTaskPdf(session, firstUnitId as number, firstTaskDefId);
          },
        ),
      );
    } else {
      checks.push({
        key: 'task_pdf',
        endpoint: 'GET /units/:unitId/task_definitions/:taskDefId/task_pdf.json',
        status: 'skip',
        detail: 'No unit id available.',
      });
    }
    checks.push(
      await runDoctorCheck(
        'submission_pdf',
        `GET /projects/${projectId}/task_def_id/${firstTaskDefId}/submission`,
        async () => {
          await api.downloadSubmissionPdf(session, projectId, firstTaskDefId);
        },
      ),
    );
  }

  if (hasFlag(args, '--json')) {
    printJson(checks);
    return;
  }

  printTable(
    checks.map((check) => ({
      check: check.key,
      status: check.status,
      endpoint: check.endpoint,
      detail: check.detail,
    })),
  );
}

/** Optional truncation helper for discovery output lists. */
function applyLimit<T>(items: T[], limit?: number): T[] {
  if (limit === undefined) {
    return items;
  }
  return items.slice(0, limit);
}

/** Frontend route/API discovery helper with optional real-session probe mode. */
async function handleDiscover(args: string[]): Promise<void> {
  const probe = hasFlag(args, '--probe');
  const hasProbeSelector = [
    '--project-id',
    '--unit-id',
    '--task-definition-id',
  ].some((flag) => hasFlag(args, flag));
  const limit = hasFlag(args, '--limit')
    ? parseIntegerFlagValue(getFlagValue(args, '--limit'), '--limit')
    : undefined;

  if (!probe && hasProbeSelector) {
    throw new Error('Discovery selectors require --probe.');
  }
  if (limit !== undefined && limit < 1) {
    throw new Error('--limit must be at least 1.');
  }
  if (probe && limit !== undefined && limit > MAX_DISCOVERY_PROBE_REQUEST_BUDGET) {
    throw new Error(
      `--limit must be at most ${MAX_DISCOVERY_PROBE_REQUEST_BUDGET} when used with --probe.`,
    );
  }

  if (probe) {
    // Probe mode requires authenticated session and checks endpoint accessibility.
    const probeContext = {
      projectId: parseOptionalInteger(args, '--project-id'),
      unitId: parseOptionalInteger(args, '--unit-id'),
      taskDefinitionId: parseOptionalInteger(args, '--task-definition-id'),
    };
    const session = await requireSession();
    const api = createAuthenticatedApi(session);
    const discovery = await discoverOnTrackSurface();
    // In probe mode --limit is a request budget, not an output truncation.
    // Keep the reported candidates aligned with the templates being evaluated.
    const apiTemplates = discovery.apiTemplates;
    const probeItems = await probeDiscoveredApiTemplates(api, session, discovery.apiTemplates, probeContext, {
      requestBudget: limit,
    });

    if (hasFlag(args, '--json')) {
      printJson({
        ...discovery,
        apiTemplates,
        probe: probeItems,
      });
      return;
    }

    console.log(`Discovered ${discovery.uiRoutes.length} route(s) and ${discovery.apiTemplates.length} API template(s) from ${discovery.assets.length} JS asset(s).`);
    printTable(
      discovery.assets.map((asset) => ({
        asset: asset.url,
        status: asset.status,
        detail: asset.detail ?? '-',
      })),
    );
    printTable(discovery.uiRoutes.map((path) => ({ route: path })));
    printTable(apiTemplates.map((template) => ({ apiTemplate: template })));
    printTable(
      probeItems.map((item) => ({
        template: item.template,
        endpoint: item.endpoint ?? '-',
        status: item.status,
        detail: item.detail,
      })),
    );
    return;
  }

  // Non-probe mode is fully public/static: scrape route/api literals from web assets only.
  const discovery = await discoverOnTrackSurface();
  const uiRoutes = applyLimit(discovery.uiRoutes, limit);
  const apiTemplates = applyLimit(discovery.apiTemplates, limit);

  if (hasFlag(args, '--json')) {
    printJson({
      ...discovery,
      uiRoutes,
      apiTemplates,
    });
    return;
  }

  console.log(`Discovered ${discovery.uiRoutes.length} route(s) and ${discovery.apiTemplates.length} API template(s) from ${discovery.assets.length} JS asset(s).`);
  printTable(
    discovery.assets.map((asset) => ({
      asset: asset.url,
      status: asset.status,
      detail: asset.detail ?? '-',
    })),
  );
  printTable(uiRoutes.map((path) => ({ route: path })));
  printTable(apiTemplates.map((template) => ({ apiTemplate: template })));
}

/** Inbox loader with endpoint fallback for role-restricted accounts. */
async function handleInbox(args: string[]): Promise<void> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const status = getFlagValue(args, '--status');
  const unitId = parseOptionalInteger(args, '--unit-id');
  roleScopeHint(session, 'inbox', unitId !== undefined);

  const { units, fallbackUsed } = await listUnitsWithFallback(api, session);
  const unitMap = new Map(units.map((unit) => [unit.id, unit]));

  if (unitId !== undefined && !unitMap.has(unitId)) {
    throw new Error(`Unit ${unitId} was not found in your account.`);
  }

  if (fallbackUsed && !hasFlag(args, '--json')) {
    console.error('[info] /units is not accessible for this account; using units derived from /projects.');
  }

  const targetUnitIds = unitId !== undefined ? [unitId] : units.map((unit) => unit.id);
  // Query inbox per unit concurrently; collect failures for fallback.
  const settled = await Promise.allSettled(
    targetUnitIds.map(async (id): Promise<InboxRowTask[]> => {
      const inbox = await api.listInboxTasks(session, id);
      return inbox.map((task) => ({
        ...task,
        _unitId: id,
      }));
    }),
  );

  const allTasks: InboxRowTask[] = [];
  const failedUnitIds: number[] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    if (result.status === 'fulfilled') {
      allTasks.push(...result.value);
    } else {
      failedUnitIds.push(targetUnitIds[index]);
    }
  }

  // For units where inbox endpoint is unavailable, recover tasks via project-detail metadata.
  if (failedUnitIds.length > 0) {
    const fallbackTasks = await buildInboxFallbackTasksFromProjectDetails(
      api,
      session,
      failedUnitIds,
    );
    allTasks.push(...fallbackTasks);

    if (!hasFlag(args, '--json')) {
      console.error(
        `[info] Loaded ${fallbackTasks.length} fallback task(s) from /projects for ${failedUnitIds.length} unit(s) where inbox endpoint is unavailable.`,
      );
    }
  }

  // Remove duplicates caused by mixing inbox + fallback sources.
  const dedupedTasks = dedupeInboxTasks(allTasks);
  if (dedupedTasks.length === 0 && failedUnitIds.length > 0) {
    throw new Error(
      'Unable to load inbox tasks for selected units (permission denied or endpoint unavailable).',
    );
  }

  if (failedUnitIds.length > 0 && !hasFlag(args, '--json')) {
    console.error(
      `[info] Inbox endpoint unavailable for unit(s): ${failedUnitIds.join(', ')}. Showing fallback task list.`,
    );
  }

  const filtered = filterTasksByStatus(dedupedTasks, status);
  if (hasFlag(args, '--json')) {
    printJson(filtered);
    return;
  }

  printTable(
    filtered.map((task) => ({
      unit: unitMap.get(task._unitId)?.code ?? (task as { unitCode?: string }).unitCode ?? '-',
      task: getTaskAbbreviation(task) ?? '-',
      title: getTaskName(task) ?? '-',
      status: getTaskStatus(task) ?? '-',
      due: formatDate(getTaskDueDate(task)),
      taskDefinitionId: getTaskDefinitionId(task) ?? '-',
      taskInstanceId: task.id,
      projectId: extractInboxProjectId(task) ?? '-',
      unitId: task._unitId,
    })),
  );
}

/** Resolve and display one or many tasks in detail (single/batch selectors). */
async function handleTaskShow(args: string[]): Promise<void> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const selector = parseTaskBatchSelectorArgs(args);
  const projects = await loadProjectsWithTaskMetadata(api, session, {
    projectId: selector.projectId,
  });
  const resolvedItems = resolveTaskBatchSelector(projects, selector);
  const isSingleSelection =
    !selector.allTasks &&
    selector.taskDefinitionIds.length + selector.taskIds.length + selector.abbrs.length === 1;

  const payloads = resolvedItems.map((resolved) => ({
    projectId: resolved.project.id,
    unitId: resolved.unitId,
    unitCode: resolved.unitCode,
    ...taskIdentityJson(resolved),
    abbr: resolved.abbr,
    name: getTaskName(resolved.task),
    status: getTaskStatus(resolved.task),
    dueDate: getTaskDueDate(resolved.task),
    completionDate: getTaskCompletionDate(resolved.task),
    grade: resolved.task.grade,
    qualityPts: resolved.task.qualityPts,
    raw: resolved.task,
  }));

  if (hasFlag(args, '--json')) {
    if (isSingleSelection && payloads.length === 1) {
      printJson(payloads[0]);
      return;
    }

    printJson({
      projectId: selector.projectId,
      count: payloads.length,
      tasks: payloads,
    });
    return;
  }

  printTable(
    payloads.map((payload) => ({
      task: payload.abbr,
      title: payload.name ?? '-',
      status: payload.status ?? '-',
      due: formatDate(payload.dueDate),
      completed: formatDate(payload.completionDate),
      grade: payload.grade ?? '-',
      qualityPts: payload.qualityPts ?? '-',
      unit: payload.unitCode ?? '-',
      taskDefinitionId: payload.taskDefinitionId,
      taskInstanceId: payload.taskInstanceId ?? '-',
      projectId: payload.projectId,
      unitId: payload.unitId ?? '-',
    })),
  );
}

/** Resolve one definition-first StudentTaskView at the CLI selection Seam. */
function resolveSelectedStudentTask(
  projects: ProjectSummary[],
  projectId: number,
  taskDefinitionId: number,
) {
  const views = buildStudentTaskViews(projects, {
    includeBeyondTarget: true,
    includeTutorialMismatches: true,
  });
  return resolveStudentTaskViews(views, {
    projectId,
    taskDefinitionIds: [taskDefinitionId],
    abbreviations: [],
  })[0];
}

/** Show the observed prerequisite rows for one task definition. */
async function handleTaskPrerequisites(args: string[]): Promise<void> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const selector = parseTaskSelectorArgs(args);
  const projects = await loadProjectsWithTaskMetadata(api, session, {
    projectId: selector.projectId,
  });
  const resolved = resolveTaskSelector(projects, selector);
  if (resolved.unitId === undefined) {
    throw new Error('Unit id not found for task prerequisite lookup.');
  }

  const all = await api.listUnitTaskPrerequisites(session, resolved.unitId);
  const prerequisites = all.filter((raw) => {
    if (typeof raw !== 'object' || raw === null) {
      return false;
    }
    const row = raw as Record<string, unknown>;
    return (row.task_definition_id ?? row.taskDefinitionId) === resolved.taskDefId;
  });

  if (hasFlag(args, '--json')) {
    printJson(prerequisites);
    return;
  }
  printTable(
    prerequisites.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        taskDefinitionId: resolved.taskDefId,
        prerequisiteTaskDefinitionId:
          row.prerequisite_id ?? row.prerequisiteId ?? '-',
        requiredStatus: row.task_status ?? row.taskStatus ?? 'unknown',
      };
    }),
  );
}

/** Read all planner views for one project using explicit date-source semantics. */
async function loadPlannerContext(
  api: OnTrackApiClient,
  session: SessionData,
  projectId: number,
  includeBeyondTarget: boolean,
): Promise<{
  projects: ProjectSummary[];
  plans: ReturnType<typeof buildPlannerViews>;
}> {
  const projects = await loadProjectsWithTaskMetadata(api, session, { projectId });
  const project = projects[0];
  if (!project) {
    throw new Error(`Project ${projectId} not found.`);
  }
  if (project.unit?.id === undefined) {
    throw new Error(`Unit id not found for project ${projectId}.`);
  }

  const prerequisites = (await api.listUnitTaskPrerequisites(
    session,
    project.unit.id,
  )) as RawTaskPrerequisite[];
  const views = buildStudentTaskViews(projects, {
    includeBeyondTarget,
  });
  return {
    projects,
    plans: buildPlannerViews(views, prerequisites),
  };
}

/** Show effective personal/default plan dates and prerequisites. */
async function handlePlanShow(args: string[]): Promise<void> {
  const session = await requireSession();
  const projectId = parseIntegerFlagValue(
    getFlagValue(args, '--project-id'),
    '--project-id',
  );
  if (getAgentOutputContext()) {
    printJson(
      await readAgentPlanShow(
        {
          project_id: projectId,
          include_beyond_target: hasFlag(args, '--include-beyond-target'),
        },
        session,
      ),
    );
    return;
  }

  const api = createAuthenticatedApi(session);
  const { plans } = await loadPlannerContext(
    api,
    session,
    projectId,
    hasFlag(args, '--include-beyond-target'),
  );

  if (hasFlag(args, '--json')) {
    printJson(plans);
    return;
  }
  printTable(
    plans.map((plan) => ({
      task: plan.abbreviation ?? `#${plan.reference.taskDefinitionId}`,
      title: plan.name ?? '-',
      start: plan.start.value ?? '-',
      startSource: plan.start.source,
      target: plan.target.value ?? '-',
      targetSource: plan.target.source,
      feedbackDeadline: plan.feedbackDeadline.value ?? '-',
      prerequisites: plan.prerequisites.length,
      editable: plan.target.editable,
    })),
  );
}

/** Strict native plan reader shared by direct Agent calls and compatibility mode. */
async function readAgentPlanShow(
  input: AgentPlanShowInput,
  session: SessionData,
): Promise<AgentPlanShowOutput> {
  const api = createAuthenticatedApi(session);
  const projects = await loadProjectsWithTaskMetadata(
    api,
    session,
    { projectId: input.project_id },
    { strictMetadata: true },
  );
  const project = projects[0];
  if (!project) {
    throw new AgentProtocolError({
      code: 'NOT_FOUND',
      summary: `Project ${input.project_id} was not found.`,
    });
  }
  const unitId = projectUnitId(project);
  if (unitId === undefined || !Number.isSafeInteger(unitId) || unitId <= 0) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'OnTrack returned a project without a valid unit identity.',
    });
  }
  const prerequisites = await api.listUnitTaskPrerequisites(session, unitId);
  return buildAgentPlanShowOutput(projects, prerequisites, input);
}

/** Safe planner read-back projection; excludes raw server mutation responses. */
function plannerReadback(
  plans: ReturnType<typeof buildPlannerViews>,
): Array<{
  taskDefinitionId: number;
  start?: string;
  startSource: string;
  target?: string;
  targetSource: string;
}> {
  return plans.map((plan) => ({
    taskDefinitionId: plan.reference.taskDefinitionId,
    start: plan.start.value,
    startSource: plan.start.source,
    target: plan.target.value,
    targetSource: plan.target.source,
  }));
}

function requestedIdempotencyKey(args: string[]): string | undefined {
  const value = getFlagValue(args, '--idempotency-key')?.trim();
  return value ? validateIdempotencyKey(value) : undefined;
}

async function claimConfirmedWrite(
  args: string[],
  command: string,
  input: Readonly<Record<string, unknown>>,
): Promise<ExecutionClaim | undefined> {
  const key = requestedIdempotencyKey(args);
  if (!key) {
    if (getAgentOutputContext()) {
      throw new AgentProtocolError({
        code: 'CONFIRMATION_REQUIRED',
        status: 'action_required',
        summary: 'Confirmed Agent writes require --idempotency-key.',
        nextActions: [
          {
            action: command,
            arguments: {
              confirm: true,
              idempotency_key: 'choose-a-stable-operation-key',
            },
          },
        ],
      });
    }
    return undefined;
  }
  return claimExecution(key, command, input);
}

function replayedWriteOutput(claim: ExecutionClaim | undefined): boolean {
  if (!claim?.replayed) {
    return false;
  }
  const result =
    claim.result && typeof claim.result === 'object'
      ? {
          ...(claim.result as Record<string, unknown>),
          operationId: claim.operationId,
          idempotency: { replayed: true },
        }
      : {
          operationId: claim.operationId,
          idempotency: { replayed: true },
          result: claim.result ?? null,
        };
  printJson(result);
  return true;
}

async function recordUnknownWrite(
  claim: ExecutionClaim | undefined,
  command: string,
  input: Readonly<Record<string, unknown>>,
  summary: string,
  nextAction: string,
  nextArguments: Readonly<Record<string, unknown>>,
  cause?: unknown,
): Promise<never> {
  if (claim) {
    await updateExecution(claim, command, input, 'outcome_unknown');
  }
  throw new AgentProtocolError({
    code: 'IDEMPOTENCY_OUTCOME_UNKNOWN',
    status: 'action_required',
    summary,
    nextActions: [{ action: nextAction, arguments: nextArguments }],
    cause,
  });
}

function isDefinitiveWriteRejection(error: unknown): error is OnTrackHttpError {
  return (
    error instanceof OnTrackHttpError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 425
  );
}

/** Preview or apply one exact target-date mutation. */
async function handlePlanSetDates(args: string[]): Promise<void> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const selector = parseTaskSelectorArgs(args);
  const startDate = parseOptionalString(args, '--start');
  const targetDate = parseOptionalString(args, '--target');
  if (!startDate || !targetDate) {
    throw new Error('plan set-dates requires --start and --target in YYYY-MM-DD form.');
  }

  const { projects, plans } = await loadPlannerContext(
    api,
    session,
    selector.projectId,
    true,
  );
  const resolved = resolveTaskSelector(projects, selector);
  const plan = plans.find(
    (item) => item.reference.taskDefinitionId === resolved.taskDefId,
  );
  if (!plan) {
    throw new Error(`Task definition ${resolved.taskDefId} has no planner view.`);
  }
  const mutation = buildTargetDateMutation(plan, { startDate, targetDate });
  const confirmed = hasFlag(args, '--confirm');
  if (!confirmed) {
    const preview = {
      dryRun: true,
      mutation,
      idempotency: {
        required_for_agent_apply: true,
        key: requestedIdempotencyKey(args) ?? null,
      },
    };
    if (hasFlag(args, '--json')) {
      printJson(preview);
    } else {
      console.log('Dry run only. Re-run with --confirm to apply this target-date change.');
      printJson(preview);
    }
    return;
  }

  const command = 'plan.set_dates';
  const executionInput = {
    project_id: plan.reference.projectId,
    task_definition_id: plan.reference.taskDefinitionId,
    start: startDate,
    target: targetDate,
  };
  const claim = await claimConfirmedWrite(args, command, executionInput);
  if (replayedWriteOutput(claim)) {
    return;
  }
  const before = {
    start: plan.start.value,
    target: plan.target.value,
  };
  try {
    await api.updateTaskTargetDates(
      session,
      plan.reference.projectId,
      plan.reference.taskDefinitionId,
      startDate,
      targetDate,
    );
  } catch (error) {
    if (isDefinitiveWriteRejection(error)) {
      if (claim) {
        await updateExecution(claim, command, executionInput, 'rejected');
      }
      throw error;
    }
    await recordUnknownWrite(
      claim,
      command,
      executionInput,
      'The target-date request was dispatched, but its outcome is unknown.',
      'plan.show',
      { project_id: selector.projectId },
      error,
    );
  }
  const readback = await loadPlannerContext(
    api,
    session,
    selector.projectId,
    true,
  ).catch((error) =>
    recordUnknownWrite(
      claim,
      command,
      executionInput,
      'The target-date response was accepted, but read-back verification failed.',
      'plan.show',
      { project_id: selector.projectId },
      error,
    ),
  );
  const observed = readback.plans.find(
    (item) => item.reference.taskDefinitionId === plan.reference.taskDefinitionId,
  );
  if (
    !observed ||
    observed.start.value !== startDate ||
    observed.target.value !== targetDate
  ) {
    await recordUnknownWrite(
      claim,
      command,
      executionInput,
      'The target-date response was accepted, but read-back did not verify the requested dates.',
      'plan.show',
      { project_id: selector.projectId },
    );
    throw new Error('Unreachable after recording an unknown write outcome.');
  }
  const output = {
    ...(claim
      ? {
          operationId: claim.operationId,
          idempotency: { replayed: false },
        }
      : {}),
    confirmed: true,
    verified: true,
    mutation,
    before,
    after: {
      start: observed.start.value,
      target: observed.target.value,
    },
  };
  if (claim) {
    await updateExecution(claim, command, executionInput, 'succeeded', output);
  }
  if (hasFlag(args, '--json')) {
    printJson(output);
    return;
  }
  console.log(
    `Updated ${plan.abbreviation ?? `#${plan.reference.taskDefinitionId}`} target dates.`,
  );
}

/** Preview or apply the exact project-wide target-date reset contract. */
async function handlePlanReset(args: string[]): Promise<void> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const projectId = parseIntegerFlagValue(
    getFlagValue(args, '--project-id'),
    '--project-id',
  );
  const mutation = buildResetTargetDatesMutation(projectId);
  const confirmed = hasFlag(args, '--confirm');
  if (!confirmed) {
    const preview = {
      dryRun: true,
      mutation,
      idempotency: {
        required_for_agent_apply: true,
        key: requestedIdempotencyKey(args) ?? null,
      },
    };
    if (hasFlag(args, '--json')) {
      printJson(preview);
    } else {
      console.log('Dry run only. Re-run with --confirm to reset target dates.');
      printJson(preview);
    }
    return;
  }

  const command = 'plan.reset';
  const executionInput = { project_id: projectId };
  const claim = await claimConfirmedWrite(args, command, executionInput);
  if (replayedWriteOutput(claim)) {
    return;
  }
  const beforeContext = await loadPlannerContext(api, session, projectId, true);
  const before = plannerReadback(beforeContext.plans);
  try {
    await api.resetProjectTargetDates(session, projectId);
  } catch (error) {
    if (isDefinitiveWriteRejection(error)) {
      if (claim) {
        await updateExecution(claim, command, executionInput, 'rejected');
      }
      throw error;
    }
    await recordUnknownWrite(
      claim,
      command,
      executionInput,
      'The planner-reset request was dispatched, but its outcome is unknown.',
      'plan.show',
      { project_id: projectId },
      error,
    );
  }
  const afterContext = await loadPlannerContext(
    api,
    session,
    projectId,
    true,
  ).catch((error) =>
    recordUnknownWrite(
      claim,
      command,
      executionInput,
      'The planner-reset response was accepted, but read-back verification failed.',
      'plan.show',
      { project_id: projectId },
      error,
    ),
  );
  const after = plannerReadback(afterContext.plans);
  const beforeIds = before.map((item) => item.taskDefinitionId).sort((a, b) => a - b);
  const afterIds = after.map((item) => item.taskDefinitionId).sort((a, b) => a - b);
  const verified =
    JSON.stringify(beforeIds) === JSON.stringify(afterIds) &&
    after.every(
      (item) =>
        item.startSource !== 'personal' && item.targetSource !== 'personal',
    );
  if (!verified) {
    await recordUnknownWrite(
      claim,
      command,
      executionInput,
      'The planner-reset response was accepted, but read-back did not verify the reset.',
      'plan.show',
      { project_id: projectId },
    );
    throw new Error('Unreachable after recording an unknown write outcome.');
  }
  const output = {
    ...(claim
      ? {
          operationId: claim.operationId,
          idempotency: { replayed: false },
        }
      : {}),
    confirmed: true,
    verified: true,
    mutation,
    before,
    after,
  };
  if (claim) {
    await updateExecution(claim, command, executionInput, 'succeeded', output);
  }
  if (hasFlag(args, '--json')) {
    printJson(output);
    return;
  }
  console.log(`Reset target dates for project ${projectId}.`);
}

/** Route subcommands under `ontrack plan ...`. */
async function handlePlanCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (subcommand === 'show') {
    await handlePlanShow(rest);
    return;
  }
  if (subcommand === 'set-dates') {
    await handlePlanSetDates(rest);
    return;
  }
  if (subcommand === 'reset') {
    await handlePlanReset(rest);
    return;
  }
  throw new Error(`Unknown plan subcommand: ${subcommand || '(missing)'}`);
}

/** Route subcommands under `ontrack project ...`. */
async function handleProjectCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (subcommand === 'show') {
    await handleProjectShow(rest);
    return;
  }
  throw new Error(`Unknown project subcommand: ${subcommand || '(missing)'}`);
}

/** Route subcommands under `ontrack unit ...`. */
async function handleUnitCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (subcommand === 'show') {
    await handleUnitShow(rest);
    return;
  }
  if (subcommand === 'tasks') {
    await handleUnitTasks(rest);
    return;
  }
  throw new Error(`Unknown unit subcommand: ${subcommand || '(missing)'}`);
}

/** Render feedback author name with username fallback. */
function feedbackAuthor(comment: FeedbackItem): string {
  if (!comment.author) {
    return '-';
  }

  const first = comment.author.firstName || '';
  const last = comment.author.lastName || '';
  const full = `${first} ${last}`.trim();
  return full || comment.author.username || '-';
}

/** Format timestamp into compact UTC string used by feedback table. */
function formatDateTime(value?: string): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return date.toISOString().replace('T', ' ').slice(0, 16);
}

/** Return first non-empty string value among candidate keys in a record. */
function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/** Build readable feedback message from comment text or status-transition fields. */
function feedbackMessage(comment: FeedbackItem): string {
  const text = getFeedbackText(comment).trim();
  if (text) {
    return text;
  }

  const record = comment as Record<string, unknown>;
  const fromStatus = firstString(record, ['from_status', 'previous_status', 'old_status']);
  const toStatus = firstString(record, ['to_status', 'new_status', 'status']);
  if (fromStatus && toStatus) {
    return `Status: ${fromStatus} -> ${toStatus}`;
  }
  if (toStatus) {
    return `Status: ${toStatus}`;
  }

  if (typeof comment.type === 'string' && comment.type.trim()) {
    return `[${comment.type.trim()}]`;
  }

  return '-';
}

/** Classify feedback row into message/event subtype for display. */
function feedbackKind(comment: FeedbackItem): string {
  const type = typeof comment.type === 'string' ? comment.type.trim() : '';
  if (type) {
    return type;
  }
  return getFeedbackText(comment).trim() ? 'message' : 'event';
}

/** Build compact feedback table rows with bounded message previews. */
function presentFeedbackRows(comments: FeedbackItem[]): Array<Record<string, unknown>> {
  return comments.map((comment) => {
    const message = feedbackMessage(comment);
    const preview = message.length > 160 ? `${message.slice(0, 157)}...` : message;

    return {
      at: formatDateTime(getFeedbackTimestamp(comment)),
      author: feedbackAuthor(comment),
      kind: feedbackKind(comment),
      message: preview,
      commentId: comment.id ?? '-',
    };
  });
}

/** List feedback/comments for one or many selected tasks. */
async function handleFeedbackList(args: string[]): Promise<void> {
  if (getAgentOutputContext()) {
    const selector = parseAgentFeedbackListSelector(args);
    const input = agentFeedbackListInputFromSelector(selector);
    const session = await requireSession();
    const output = await readAgentFeedbackList(
      input,
      session,
    );
    printJson(output);
    return;
  }
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const selector = parseTaskBatchSelectorArgs(args);
  const projects = await loadProjectsWithTaskMetadata(api, session, {
    projectId: selector.projectId,
  });
  const resolvedItems = resolveTaskBatchSelector(projects, selector);
  const isSingleSelection =
    !selector.allTasks &&
    selector.taskDefinitionIds.length + selector.taskIds.length + selector.abbrs.length === 1;

  const results = await Promise.all(
    resolvedItems.map(async (resolved) => ({
      resolved,
      comments: sortFeedbackItems(
        await api.listTaskComments(session, resolved.project.id, resolved.taskDefId),
      ),
    })),
  );

  if (hasFlag(args, '--json')) {
    if (isSingleSelection && results.length === 1) {
      printJson(results[0].comments);
      return;
    }

    printJson({
      projectId: selector.projectId,
      count: results.length,
      tasks: results.map((item) => ({
        task: item.resolved.abbr,
        ...taskIdentityJson(item.resolved),
        unit: item.resolved.unitCode,
        comments: item.comments,
      })),
    });
    return;
  }

  if (isSingleSelection && results.length === 1) {
    const sortedComments = results[0].comments;
    printTable(
      presentFeedbackRows(sortedComments).map((row, index) => ({
        ...row,
        isNew: sortedComments[index]?.isNew ?? sortedComments[index]?.is_new ?? '-',
      })),
    );
    return;
  }

  const rows = results.flatMap((item) =>
    presentFeedbackRows(item.comments).map((row, index) => ({
      task: item.resolved.abbr,
      unit: item.resolved.unitCode ?? '-',
      ...row,
      isNew: item.comments[index]?.isNew ?? item.comments[index]?.is_new ?? '-',
      projectId: item.resolved.project.id,
      taskDefinitionId: item.resolved.taskDefId,
      taskInstanceId: item.resolved.taskInstanceId ?? '-',
    })),
  );
  printTable(rows);
}

/** Real-time feedback watcher for a single task conversation stream. */
async function handleFeedbackWatch(args: string[]): Promise<void> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const agentOutput = Boolean(getAgentOutputContext());
  const selector = parseTaskSelectorArgs(args);
  const interval = hasFlag(args, "--interval")
    ? parseIntegerFlagValue(getFlagValue(args, "--interval"), "--interval")
    : 15;
  const history = hasFlag(args, "--history")
    ? parseIntegerFlagValue(getFlagValue(args, "--history"), "--history")
    : 30;
  const asJson = hasFlag(args, "--json");

  if (interval < 1) {
    throw new Error("--interval must be at least 1 second.");
  }
  if (history < 0) {
    throw new Error("--history must be >= 0.");
  }

  let watchTarget: {
    readonly projectId: number;
    readonly taskDefinitionId: number;
    readonly abbreviation: string;
    readonly unitCode: string | null | undefined;
  };
  if (agentOutput) {
    const target = await readAgentFeedbackTarget(
      agentFeedbackListInputFromSelector(selector),
      session,
    );
    watchTarget = {
      projectId: target.project_id,
      taskDefinitionId: target.task_definition_id,
      abbreviation: target.abbreviation,
      unitCode: target.unit_code,
    };
  } else {
    const resolved = resolveTaskSelector(
      await loadProjectsWithTaskMetadata(api, session, {
        projectId: selector.projectId,
      }),
      selector,
    );
    watchTarget = {
      projectId: resolved.project.id,
      taskDefinitionId: resolved.taskDefId,
      abbreviation: resolved.abbr,
      unitCode: resolved.unitCode,
    };
  }
  const { projectId, taskDefinitionId, abbreviation, unitCode } = watchTarget;

  const readComments = (): Promise<FeedbackItem[]> =>
    agentOutput
      ? api.listTaskCommentsForAgent(session, projectId, taskDefinitionId)
      : api.listTaskComments(session, projectId, taskDefinitionId);
  const initialComments = sortFeedbackItems(await readComments());
  const initialAgentFeedback = agentOutput
    ? projectAgentFeedbackItems(initialComments)
    : undefined;
  const baselineComments = history === 0 ? [] : initialComments.slice(-history);
  // Track seen comment identities so each newly observed comment is emitted once.
  const seen = new Set(
    initialComments.map((comment) => feedbackIdentity(comment)),
  );
  const startedAt = new Date().toISOString();

  if (agentOutput) {
    printWatchJson(
      validateAgentFeedbackWatchFrame({
        type: "baseline",
        at: startedAt,
        project_id: projectId,
        task_definition_id: taskDefinitionId,
        abbreviation,
        interval_seconds: interval,
        total_feedback: initialComments.length,
        feedback:
          history === 0 ? [] : (initialAgentFeedback ?? []).slice(-history),
      }),
    );
  } else if (asJson) {
    printWatchJson({
      type: "baseline",
      at: startedAt,
      projectId,
      task: abbreviation,
      intervalSec: interval,
      totalComments: initialComments.length,
      comments: baselineComments,
    });
  } else {
    console.log(
      `Feedback watch started for ${unitCode ?? "-"} ${abbreviation} (project ${projectId}). Polling every ${interval}s. Press Ctrl+C to stop.`,
    );
    if (baselineComments.length === 0) {
      console.log("No baseline comments.");
    } else {
      printTable(presentFeedbackRows(baselineComments));
    }
  }

  try {
    await pollUntilInterrupted({
      intervalSeconds: interval,
      poll: async () => {
        let comments: FeedbackItem[];
        try {
          comments = sortFeedbackItems(await readComments());
        } catch (error) {
          rethrowWatchAuthFailure(error);
          if (agentOutput) {
            throw error;
          }
          const message = toRedactedError(error).message;
          if (asJson) {
            printWatchJson({
              type: "error",
              at: new Date().toISOString(),
              message,
            });
          } else {
            console.error(`[feedback-watch] ${message}`);
          }
          return;
        }

        // Diff against seen set to emit only incremental updates.
        const fresh = comments.filter((comment) => {
          const key = feedbackIdentity(comment);
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });

        if (fresh.length === 0) {
          return;
        }

        if (agentOutput) {
          printWatchJson(
            validateAgentFeedbackWatchFrame({
              type: "feedback",
              at: new Date().toISOString(),
              project_id: projectId,
              task_definition_id: taskDefinitionId,
              abbreviation,
              feedback: projectAgentFeedbackItems(fresh),
            }),
          );
        } else if (asJson) {
          printWatchJson({
            type: "comments",
            at: new Date().toISOString(),
            projectId,
            task: abbreviation,
            comments: fresh,
          });
        } else {
          printTable(presentFeedbackRows(fresh));
        }
      },
    });
  } finally {
    if (!asJson && !agentOutput) {
      console.log("Feedback watch stopped.");
    }
  }
}

/** Download task/submission PDF for one or many selected tasks. */
async function handlePdfDownload(args: string[], type: 'task' | 'submission'): Promise<void> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const selector = parseTaskBatchSelectorArgs(args);
  const projects = await loadProjectsWithTaskMetadata(api, session, {
    projectId: selector.projectId,
  });
  const resolvedItems = resolveTaskBatchSelector(projects, selector);
  const outDir = getFlagValue(args, '--out-dir');
  const allowExternalDir = hasFlag(args, '--allow-external-dir');
  const asJson = hasFlag(args, '--json');

  const downloads: Array<{
    task: string;
    unit: string;
    projectId: number;
    taskDefinitionId: number;
    taskInstanceId?: number;
    taskId: number;
    taskDefId: number;
    filePath: string;
  }> = [];

  for (const resolved of resolvedItems) {
    if (type === 'submission') {
      const details = parseSubmissionDetails(
        await api.getSubmissionDetails(
          session,
          resolved.project.id,
          resolved.taskDefId,
        ),
      );
      if (details.pdfState === 'processing') {
        throw new Error(
          `Submission PDF for ${resolved.abbr} is still processing. Retry after OnTrack finishes generating it.`,
        );
      }
      if (details.pdfState === 'unavailable') {
        throw new Error(`Submission PDF for ${resolved.abbr} is not available.`);
      }
    }

    // Call type-specific endpoint but normalize naming/output behavior downstream.
    const download =
      type === 'task'
        ? await api.downloadTaskPdfForCompatibility(
            session,
            resolved.unitId ??
              (() => {
                throw new Error('Unit id not found for task PDF download.');
              })(),
            resolved.taskDefId,
          )
        : await api.downloadSubmissionPdfForCompatibility(
            session,
            resolved.project.id,
            resolved.taskDefId,
          );

    // Persist with deterministic filename format for easy scripting and lookup.
    const filename = buildPdfFilename(resolved.unitCode, resolved.abbr, type);
    const filePath = await writePdfFile(
      download.buffer,
      filename,
      outDir,
      process.cwd(),
      { allowExternalDir },
    );
    downloads.push({
      task: resolved.abbr,
      unit: resolved.unitCode ?? '-',
      projectId: resolved.project.id,
      ...taskIdentityJson(resolved),
      filePath,
    });
  }

  if (asJson) {
    if (downloads.length === 1) {
      printJson(downloads[0]);
      return;
    }
    printJson({
      type,
      count: downloads.length,
      downloads,
    });
    return;
  }

  if (downloads.length === 1) {
    console.log(`Saved ${type} PDF to ${downloads[0].filePath}`);
    return;
  }

  console.log(`Saved ${downloads.length} ${type} PDF file(s).`);
  printTable(
    downloads.map((item) => ({
      unit: item.unit,
      task: item.task,
      projectId: item.projectId,
      taskDefinitionId: item.taskDefinitionId,
      taskInstanceId: item.taskInstanceId ?? '-',
      file: item.filePath,
    })),
  );
}

interface TaskResourceDownloadRecord {
  readonly project_id: number;
  readonly unit_id: number | null;
  readonly unit_code: string | null;
  readonly task_definition_id: number;
  readonly task_instance_id: number | null;
  readonly task_id: number;
  readonly task_def_id: number;
  readonly abbreviation: string;
  readonly instantiated: boolean;
  readonly artifact: {
    readonly filename: string;
    readonly path: string;
    readonly bytes: number;
    readonly content_type: string;
    readonly sha256: string;
  };
}

interface TaskResourceUnavailableRecord {
  readonly project_id: number;
  readonly unit_id: number | null;
  readonly unit_code: string | null;
  readonly task_definition_id: number;
  readonly task_instance_id: number | null;
  readonly task_id: number;
  readonly task_def_id: number;
  readonly abbreviation: string;
  readonly instantiated: boolean;
  readonly reason: 'not_available';
}

interface TaskResourceDownloadResult {
  readonly project_id: number;
  readonly selected_count: number;
  readonly downloaded_count: number;
  readonly unavailable_count: number;
  readonly downloads: readonly TaskResourceDownloadRecord[];
  readonly unavailable: readonly TaskResourceUnavailableRecord[];
}

function taskResourceIdentity(
  resolved: ResolvedTaskSelector,
): Omit<TaskResourceDownloadRecord, 'artifact'> {
  const identity = taskIdentityJson(resolved);
  const unitCode = resolved.unitCode
    ? safeTextForHumanDisplay(resolved.unitCode, 'unit')
    : null;
  return {
    project_id: resolved.project.id,
    unit_id: resolved.unitId ?? null,
    unit_code: unitCode,
    task_definition_id: identity.taskDefinitionId,
    task_instance_id: identity.taskInstanceId ?? null,
    task_id: identity.taskId,
    task_def_id: identity.taskDefId,
    abbreviation: safeTextForHumanDisplay(
      resolved.abbr,
      String(resolved.taskDefId),
    ),
    instantiated: resolved.task.isInstantiated === true,
  };
}

/** Download task resources through the shared artifact-safety writer. */
async function downloadTaskResourceArtifacts(
  session: SessionData,
  api: OnTrackApiClient,
  resolvedItems: readonly ResolvedTaskSelector[],
  options: { readonly outDir?: string; readonly allowExternalDir?: boolean },
): Promise<TaskResourceDownloadResult> {
  const downloads: TaskResourceDownloadRecord[] = [];
  const unavailable: TaskResourceUnavailableRecord[] = [];
  let totalBytes = 0;

  for (const resolved of resolvedItems) {
    const identity = taskResourceIdentity(resolved);
    try {
      if (resolved.unitId === undefined) {
        throw new Error('Unit id not found for task resource download.');
      }
      const download = await api.downloadTaskResources(
        session,
        resolved.unitId,
        resolved.taskDefId,
      );
      if (
        exceedsByteBudget(
          totalBytes,
          download.buffer.byteLength,
          MAX_TASK_RESOURCE_BATCH_BYTES,
        )
      ) {
        throw new AgentProtocolError({
          code: 'INVALID_ARGUMENT',
          summary: `Task resource batch exceeds ${MAX_TASK_RESOURCE_BATCH_BYTES} bytes; use a narrower selector.`,
        });
      }
      const filename = buildTaskResourceFilename(
        resolved.unitCode,
        resolved.abbr,
        extname(contentDispositionFilename(download.contentDisposition) ?? '') || '.zip',
      );
      const filePath = await writeArtifactFile(download.buffer, filename, {
        root: process.cwd(),
        outDir: options.outDir,
        allowExternal: options.allowExternalDir,
      });
      totalBytes += download.buffer.byteLength;
      downloads.push({
        ...identity,
        artifact: {
          filename,
          path: relative(process.cwd(), filePath) || filename,
          bytes: download.buffer.byteLength,
          content_type: safeTextForHumanDisplay(
            download.contentType,
            'application/zip',
          ),
          sha256: createHash('sha256').update(download.buffer).digest('hex'),
        },
      });
    } catch (error) {
      if (!(error instanceof UnavailableDownloadError)) {
        throw error;
      }
      unavailable.push({ ...identity, reason: 'not_available' });
    }
  }

  return {
    project_id: resolvedItems[0]?.project.id ?? 0,
    selected_count: resolvedItems.length,
    downloaded_count: downloads.length,
    unavailable_count: unavailable.length,
    downloads,
    unavailable,
  };
}

/** Human-facing task resource archive workflow. */
async function handleTaskResourceDownload(args: string[]): Promise<void> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const selector = parseTaskBatchSelectorArgs(args);
  const projects = await loadProjectsWithTaskMetadata(api, session, {
    projectId: selector.projectId,
  });
  const resolvedItems = resolveTaskBatchSelector(projects, selector);
  const result = await downloadTaskResourceArtifacts(session, api, resolvedItems, {
    outDir: getFlagValue(args, '--out-dir'),
    allowExternalDir: hasFlag(args, '--allow-external-dir'),
  });

  if (hasFlag(args, '--json')) {
    printJson(result);
    return;
  }

  if (result.downloaded_count > 0) {
    console.log(`Saved ${result.downloaded_count} task resource archive(s).`);
    printTable(
      result.downloads.map((item) => ({
        unit: item.unit_code ?? '-',
        task: item.abbreviation,
        projectId: item.project_id,
        taskDefinitionId: item.task_definition_id,
        taskInstanceId: item.task_instance_id ?? '-',
        file: item.artifact.path,
      })),
    );
  }
  if (result.unavailable_count > 0) {
    console.log(
      `Skipped ${result.unavailable_count} task resource archive(s) that are not available.`,
    );
    printTable(
      result.unavailable.map((item) => ({
        unit: item.unit_code ?? '-',
        task: item.abbreviation,
        projectId: item.project_id,
        taskDefinitionId: item.task_definition_id,
        taskInstanceId: item.task_instance_id ?? '-',
      })),
    );
  }
}

/** Preview or dispatch a submission with requirement-aware file key mapping. */
async function handleSubmissionUpload(
  args: string[],
  mode: 'upload' | 'upload-new-files',
): Promise<void> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const selector = parseTaskSelectorArgs(args);
  const projects = await loadProjectsWithTaskMetadata(api, session, {
    projectId: selector.projectId,
  });
  const resolved = resolveTaskSelector(projects, selector);
  const fileInputs = parseUploadFileSpecs(args) as UploadFileInput[];
  const allowExternalFile = hasFlag(args, '--allow-external-file');
  const explicitTrigger = parseSubmissionTrigger(parseOptionalString(args, '--trigger'));
  const trigger =
    explicitTrigger ??
    (mode === 'upload' ? deriveDefaultSubmissionTrigger(resolved.task) : undefined);
  const comment = parseOptionalString(args, '--comment');

  const view = resolveSelectedStudentTask(
    projects,
    resolved.project.id,
    resolved.taskDefId,
  );
  const inputDetails = await Promise.all(
    fileInputs.map(async (input, index) => {
      try {
        const artifact = await inspectUploadFile(input.path, {
          root: process.cwd(),
          allowExternal: allowExternalFile,
        });
        return {
          key: input.key,
          localPath: input.path,
          size: artifact.size,
        };
      } catch (error) {
        throw new Error(
          `Failed to inspect upload file ${index + 1}: ${safeArtifactFailure(error)}`,
        );
      }
    }),
  );
  const prepared = prepareSubmission(view, inputDetails);
  let attempt = createSubmissionAttempt(prepared, {
    operationId: crypto.randomUUID(),
    at: new Date().toISOString(),
  });

  if (mode === 'upload-new-files') {
    const existing = parseSubmissionDetails(
      await api.getSubmissionDetails(
        session,
        resolved.project.id,
        resolved.taskDefId,
      ),
    );
    validateSubmissionMode(mode, existing);
  }

  const safeFiles = prepared.files.map((file) => ({
    key: file.key,
    bytes: file.size,
  }));
  if (!hasFlag(args, '--confirm')) {
    const preview = {
      command: `submission ${mode}`,
      dryRun: true,
      confirmed: false,
      projectId: resolved.project.id,
      unitCode: resolved.unitCode,
      task: resolved.abbr,
      taskDefinitionId: resolved.taskDefId,
      operationId: attempt.operationId,
      state: attempt.state,
      trigger: trigger ?? null,
      files: safeFiles,
      comment: { status: comment ? 'requested' : 'not_requested' },
      idempotency: {
        required_for_agent_apply: true,
        key: requestedIdempotencyKey(args) ?? null,
      },
    };
    if (hasFlag(args, '--json')) {
      printJson(preview);
    } else {
      console.log('Dry run only. No submission request was sent.');
      printTable(safeFiles);
      console.log('Re-run with --confirm to dispatch exactly once.');
    }
    return;
  }

  const files = await readUploadFiles(prepared.files, allowExternalFile);
  const command =
    mode === 'upload'
      ? 'submission.upload'
      : 'submission.upload_new_files';
  const executionInput = {
    project_id: resolved.project.id,
    task_definition_id: resolved.taskDefId,
    mode,
    trigger: trigger ?? null,
    files: files.map((file) => ({
      key: file.key,
      bytes: file.content.byteLength,
      sha256: createHash('sha256').update(file.content).digest('hex'),
    })),
    comment_sha256: comment
      ? createHash('sha256').update(comment).digest('hex')
      : null,
  };
  const claim = await claimConfirmedWrite(args, command, executionInput);
  if (replayedWriteOutput(claim)) {
    return;
  }
  if (claim) {
    attempt = createSubmissionAttempt(prepared, {
      operationId: claim.operationId,
      at: new Date().toISOString(),
    });
  }
  attempt = transitionSubmissionAttempt(attempt, {
    type: 'upload_started',
    at: new Date().toISOString(),
  });

  try {
    // This non-idempotent request is dispatched exactly once.
    await api.uploadTaskSubmission(
      session,
      resolved.project.id,
      resolved.taskDefId,
      files,
      {
        trigger,
      },
    );
    attempt = transitionSubmissionAttempt(attempt, {
      type: 'upload_accepted',
      at: new Date().toISOString(),
    });
  } catch (error) {
    if (isDefinitiveWriteRejection(error)) {
      attempt = transitionSubmissionAttempt(attempt, {
        type: 'upload_rejected',
        at: new Date().toISOString(),
      });
      if (claim) {
        await updateExecution(claim, command, executionInput, 'rejected');
      }
      throw error;
    }
    attempt = transitionSubmissionAttempt(attempt, {
      type: 'upload_outcome_unknown',
      at: new Date().toISOString(),
    });
    await recordUnknownWrite(
      claim,
      command,
      executionInput,
      'Submission was dispatched once, but the transport outcome is unknown.',
      'submission.status',
      {
        project_id: resolved.project.id,
        task_definition_id: resolved.taskDefId,
      },
      error,
    );
  }

  let verification: 'observed' | 'not_observed' | 'unavailable' | 'credential_expired' =
    'not_observed';
  try {
    const details = parseSubmissionDetails(
      await api.getSubmissionDetails(
        session,
        resolved.project.id,
        resolved.taskDefId,
      ),
    );
    if (isSubmissionObserved(details)) {
      attempt = transitionSubmissionAttempt(attempt, {
        type: 'submission_observed',
        at: new Date().toISOString(),
      });
      verification = 'observed';
    }
  } catch (error) {
    verification =
      error instanceof OnTrackHttpError && error.authFailure !== 'other'
        ? 'credential_expired'
        : 'unavailable';
  }

  let commentResult: FeedbackItem | undefined;
  let commentFailed = false;
  if (comment && attempt.state === 'succeeded') {
    try {
      // Keep comment as a separate non-idempotent API call. A failure here must
      // never downgrade the already-confirmed upload into a retryable error.
      commentResult = await api.addTaskComment(
        session,
        resolved.project.id,
        resolved.taskDefId,
        comment,
      );
    } catch (error) {
      void error;
      commentFailed = true;
    }
  }

  const output = {
    command: `submission ${mode}`,
    projectId: resolved.project.id,
    unitCode: resolved.unitCode,
    task: resolved.abbr,
    taskDefinitionId: resolved.taskDefId,
    operationId: attempt.operationId,
    ...(claim ? { idempotency: { replayed: false } } : {}),
    state: attempt.state,
    dryRun: false,
    confirmed: true,
    verification,
    trigger: trigger ?? null,
    files: safeFiles,
    upload: { status: 'response_accepted' },
    comment: !comment
      ? { status: 'not_requested' }
      : commentResult
        ? { status: 'posted', id: commentResult.id }
        : commentFailed
          ? { status: 'failed' }
          : { status: 'skipped_until_submission_observed' },
  };
  if (claim) {
    await updateExecution(claim, command, executionInput, 'succeeded', output);
  }

  if (hasFlag(args, '--json')) {
    printJson(output);
    return;
  }

  console.log(
    `Submission response accepted for ${safeFiles.length} evidence slot(s) on ${resolved.unitCode ?? '-'} ${resolved.abbr} (project ${resolved.project.id}).`,
  );
  console.log(`Evidence slots: ${safeFiles.map((item) => item.key).join(', ')}`);
  console.log(`Observed state: ${attempt.state} (${verification})`);
  console.log(`Trigger: ${trigger ?? 'ready_for_feedback (server default)'}`);
  if (commentResult) {
    console.log(`Comment posted: ${commentResult.id ?? 'ok'}`);
  } else if (commentFailed) {
    console.error(
      '[warn] Submission was observed, but the optional comment was not posted.',
    );
  } else if (comment) {
    console.error(
      '[warn] Optional comment was not posted because the submission could not yet be observed.',
    );
  }
}

/** Read and normalize server submission status before lifecycle actions. */
async function handleSubmissionStatus(args: string[]): Promise<void> {
  const session = await requireSession();
  const selector = parseTaskSelectorArgs(args);
  if (getAgentOutputContext()) {
    printJson(
      await readAgentSubmissionStatus(
        agentSubmissionStatusInputFromSelector(selector),
        session,
      ),
    );
    return;
  }

  const api = createAuthenticatedApi(session);
  const projects = await loadProjectsWithTaskMetadata(api, session, {
    projectId: selector.projectId,
  });
  const resolved = resolveTaskSelector(projects, selector);
  const details = parseSubmissionDetails(
    await api.getSubmissionDetails(
      session,
      resolved.project.id,
      resolved.taskDefId,
    ),
  );
  const output = {
    projectId: resolved.project.id,
    taskDefinitionId: resolved.taskDefId,
    taskInstanceId: resolved.taskInstanceId,
    task: resolved.abbr,
    ...details,
  };
  if (hasFlag(args, '--json')) {
    printJson(output);
    return;
  }
  printTable([output]);
}

function agentSubmissionStatusInputFromSelector(
  selector: TaskSelector,
): AgentSubmissionStatusInput {
  if (selector.taskDefinitionId !== undefined) {
    return {
      project_id: selector.projectId,
      task_definition_id: selector.taskDefinitionId,
      ...(selector.abbr ? { abbreviation: selector.abbr } : {}),
    };
  }
  if (selector.abbr) {
    return {
      project_id: selector.projectId,
      abbreviation: selector.abbr,
    };
  }
  throw new AgentProtocolError({
    code: 'INVALID_ARGUMENT',
    summary: 'Agent submission.status requires --task-definition-id or --abbr.',
  });
}

/** Preserve centralized 401/419 handling even when an error occurs inside a poll loop. */
function rethrowWatchAuthFailure(error: unknown): void {
  if (error instanceof OnTrackHttpError && error.authFailure !== 'other') {
    throw error;
  }
}

async function readWatchComments(
  api: OnTrackApiClient,
  session: SessionData,
  projectId: number,
  taskDefinitionId: number,
  agentOutput: boolean,
): Promise<FeedbackItem[]> {
  try {
    return agentOutput
      ? await api.listTaskCommentsForAgent(session, projectId, taskDefinitionId)
      : await api.listTaskComments(session, projectId, taskDefinitionId);
  } catch (error) {
    rethrowWatchAuthFailure(error);
    if (agentOutput) {
      throw error;
    }
    return [];
  }
}

/** Build current snapshots through the appropriate Agent or legacy projection. */
async function buildWatchSnapshot(
  api: OnTrackApiClient,
  session: SessionData,
  projectId?: number,
  unitId?: number,
  agentOutput = false,
): Promise<WatchSnapshot[]> {
  return buildWatchSnapshots(
    {
      loadProjects: (options) =>
        loadProjectsWithTaskMetadata(
          api,
          session,
          { projectId: options.projectId, unitId: options.unitId },
          {
            strictMetadata: options.agentOutput,
            agentTransport: options.agentOutput,
          },
        ),
      readComments: (snapshotProjectId, taskDefinitionId, useAgentTransport) =>
        readWatchComments(
          api,
          session,
          snapshotProjectId,
          taskDefinitionId,
          useAgentTransport,
        ),
    },
    { projectId, unitId, agentOutput },
  );
}

/** Keep both legacy and Agent watch frames one JSON document per line. */
function printWatchJson(value: unknown): void {
  printJson(value, { streaming: true });
}

/** Render watch event into single-line human-readable terminal message. */
function describeWatchEvent(event: {
  type: string;
  at: string;
  unitCode?: string;
  abbr?: string;
  projectId: number;
  previous?: string | number | null;
  current?: string | number | null;
  deltaComments?: number;
}): string {
  const target = `${event.unitCode || '-'} ${event.abbr || '-'} (project ${event.projectId})`;
  if (event.type === 'status_changed') {
    return `[${event.at}] status_changed ${target}: ${event.previous || '-'} -> ${event.current || '-'}`;
  }
  if (event.type === 'due_changed') {
    return `[${event.at}] due_changed ${target}: ${formatDate(String(event.previous || ''))} -> ${formatDate(String(event.current || ''))}`;
  }
  return `[${event.at}] new_feedback ${target}: +${event.deltaComments ?? 0} comment(s), latest=${event.current || '-'}`;
}

/** Cross-task watcher for status/due-date/new-feedback deltas. */
async function handleWatch(args: string[]): Promise<void> {
  const session = await requireSession();
  const api = createAuthenticatedApi(session);
  const agentOutput = Boolean(getAgentOutputContext());
  const unitId = parseOptionalInteger(args, "--unit-id");
  const projectId = parseOptionalInteger(args, "--project-id");
  const interval = hasFlag(args, "--interval")
    ? parseIntegerFlagValue(getFlagValue(args, "--interval"), "--interval")
    : 60;
  const asJson = hasFlag(args, "--json");

  if (interval < 1) {
    throw new Error("--interval must be at least 1 second.");
  }

  roleScopeHint(
    session,
    "watch",
    unitId !== undefined || projectId !== undefined,
  );

  // Baseline snapshot printed once; subsequent loops emit deltas only.
  let baseline = await buildWatchSnapshot(
    api,
    session,
    projectId,
    unitId,
    agentOutput,
  );
  const startedAt = new Date().toISOString();

  if (agentOutput) {
    printWatchJson(
      validateAgentWatchFrame({
        type: "baseline",
        at: startedAt,
        interval_seconds: interval,
        tasks: [...agentWatchStateMap(baseline).values()],
      }),
    );
  } else if (asJson) {
    printWatchJson({
      type: "baseline",
      at: startedAt,
      intervalSec: interval,
      tasks: legacyWatchStates(baseline),
    });
  } else {
    console.log(
      `Watch started at ${startedAt}. Polling every ${interval}s. Press Ctrl+C to stop.`,
    );
    printTable(
      legacyWatchStates(baseline).map((task) => ({
        task: task.abbr ?? "-",
        status: task.status ?? "-",
        due: formatDate(task.dueDate),
        comments: task.commentCount,
        lastCommentAt: task.lastCommentAt
          ? formatDate(task.lastCommentAt)
          : "-",
        unit: task.unitCode ?? "-",
        projectId: task.projectId,
      })),
    );
  }

  let previous = toWatchStateMap(legacyWatchStates(baseline));
  let previousAgent = agentWatchStateMap(baseline);

  try {
    await pollUntilInterrupted({
      intervalSeconds: interval,
      poll: async () => {
        let currentSnapshot: WatchSnapshot[];
        try {
          currentSnapshot = await buildWatchSnapshot(
            api,
            session,
            projectId,
            unitId,
            agentOutput,
          );
        } catch (error) {
          rethrowWatchAuthFailure(error);
          if (agentOutput) {
            throw error;
          }
          const message = toRedactedError(error).message;
          if (asJson) {
            printWatchJson({
              type: "error",
              at: new Date().toISOString(),
              message,
            });
          } else {
            console.error(`[watch] ${message}`);
          }
          return;
        }

        const now = new Date().toISOString();
        const current = toWatchStateMap(legacyWatchStates(currentSnapshot));
        const currentAgent = agentWatchStateMap(currentSnapshot);
        if (agentOutput) {
          const events = diffAgentWatchStates(previousAgent, currentAgent, now);
          for (const frame of splitAgentWatchEventFrames(now, events)) {
            printWatchJson(frame);
          }
        } else {
          const events = diffWatchStates(previous, current, now);
          if (events.length === 0) {
            baseline = currentSnapshot;
            previous = current;
            previousAgent = currentAgent;
            return;
          }
          if (asJson) {
            printWatchJson({
              type: "events",
              at: now,
              events,
            });
          } else {
            for (const event of events) {
              console.log(describeWatchEvent(event));
            }
          }
        }

        baseline = currentSnapshot;
        previous = current;
        previousAgent = currentAgent;
      },
    });
  } finally {
    if (!asJson && !agentOutput) {
      console.log("Watch stopped.");
    }
  }
}

/** Route subcommands under `ontrack task ...`. */
async function handleTaskCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (subcommand === 'show') {
    await handleTaskShow(rest);
    return;
  }
  if (subcommand === 'prerequisites') {
    await handleTaskPrerequisites(rest);
    return;
  }
  if (subcommand === 'resources') {
    await handleTaskResourceDownload(rest);
    return;
  }
  throw new Error(`Unknown task subcommand: ${subcommand || '(missing)'}`);
}

/** Route subcommands under `ontrack feedback ...`. */
async function handleFeedbackCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (subcommand === 'list') {
    await handleFeedbackList(rest);
    return;
  }
  if (subcommand === 'watch') {
    await handleFeedbackWatch(rest);
    return;
  }
  throw new Error(`Unknown feedback subcommand: ${subcommand || '(missing)'}`);
}

/** Route subcommands under `ontrack pdf ...`. */
async function handlePdfCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (subcommand === 'task') {
    await handlePdfDownload(rest, 'task');
    return;
  }
  if (subcommand === 'submission') {
    await handlePdfDownload(rest, 'submission');
    return;
  }
  throw new Error(`Unknown pdf subcommand: ${subcommand || '(missing)'}`);
}

/** Route subcommands under `ontrack submission ...`. */
async function handleSubmissionCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (subcommand === 'upload') {
    await handleSubmissionUpload(rest, 'upload');
    return;
  }
  if (subcommand === 'upload-new-files') {
    await handleSubmissionUpload(rest, 'upload-new-files');
    return;
  }
  if (subcommand === 'status') {
    await handleSubmissionStatus(rest);
    return;
  }
  throw new Error(`Unknown submission subcommand: ${subcommand || '(missing)'}`);
}

async function readAgentTaskShow(
  input: AgentTaskShowInput,
  session: SessionData,
): Promise<AgentTaskShowOutput> {
  const api = createAuthenticatedApi(session);
  const projects = await loadProjectsWithTaskMetadata(
    api,
    session,
    { projectId: input.project_id },
    { strictMetadata: true },
  );
  const resolved = resolveTaskBatchSelector(projects, {
    projectId: input.project_id,
    taskDefinitionIds:
      !('task_definition_id' in input) || input.task_definition_id === undefined
        ? []
        : [input.task_definition_id],
    taskIds: [],
    abbrs: 'abbreviation' in input ? input.abbreviation ?? [] : [],
    allTasks: input.all_tasks,
  });
  if (resolved.length > MAX_AGENT_TASK_ITEMS) {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: `task.show returned more than ${MAX_AGENT_TASK_ITEMS} tasks; use a narrower selector.`,
      nextActions: [
        {
          action: 'agent.call',
          arguments: {
            command: 'task.show',
            hint: 'Use abbreviation or task_definition_id.',
          },
        },
      ],
    });
  }

  const output: AgentTaskShowOutput = {
    project_id: input.project_id,
    count: resolved.length,
    tasks: resolved.map((item) => ({
      project_id: item.project.id,
      unit_id: item.unitId ?? null,
      unit_code: item.unitCode ?? null,
      task_definition_id: item.taskDefId,
      task_instance_id: item.taskInstanceId ?? null,
      abbreviation: item.abbr,
      name: getTaskName(item.task) ?? null,
      status:
        getTaskStatus(item.task) ??
        (item.task.isInstantiated === false ? 'not_instantiated' : null),
      due_date: getTaskDueDate(item.task) ?? null,
      completion_date: getTaskCompletionDate(item.task) ?? null,
      grade: item.task.grade ?? null,
      quality_points: item.task.qualityPts ?? null,
      instantiated: item.task.isInstantiated === true,
      visibility: item.task.studentVisibility,
    })),
  };
  if (
    Buffer.byteLength(JSON.stringify(output), 'utf8') >
    MAX_AGENT_TASK_OUTPUT_BYTES
  ) {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: `task.show response exceeds ${MAX_AGENT_TASK_OUTPUT_BYTES} bytes; use a narrower selector.`,
    });
  }
  return output;
}

function positiveIntegerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function nonEmptyStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function hasOwnField(row: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, field);
}

/** Read paired prerequisite IDs without treating malformed aliases as absent. */
function prerequisiteIdField(
  row: Record<string, unknown>,
  snakeCase: string,
  camelCase: string,
): number | undefined {
  const fields = [snakeCase, camelCase].filter((field) => hasOwnField(row, field));
  if (fields.length === 0) {
    return undefined;
  }
  const values = fields.map((field) => positiveIntegerValue(row[field]));
  if (values.some((value) => value === undefined)) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'The task prerequisite endpoint returned an invalid relationship id.',
    });
  }
  const [first, ...rest] = values as number[];
  if (rest.some((value) => value !== first)) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'The task prerequisite endpoint returned conflicting relationship ids.',
    });
  }
  return first;
}

function prerequisiteStatusValue(row: Record<string, unknown>): string {
  const fields = ['task_status', 'taskStatus'].filter((field) => hasOwnField(row, field));
  if (fields.length === 0) {
    return 'unknown';
  }
  const values = fields.map((field) => nonEmptyStringValue(row[field]));
  if (values.some((value) => value === undefined) || values.some((value) => value!.length > 80)) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'The task prerequisite endpoint returned an invalid task status.',
    });
  }
  const [first, ...rest] = values as string[];
  if (rest.some((value) => value !== first)) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'The task prerequisite endpoint returned conflicting task statuses.',
    });
  }
  return first;
}

function prerequisiteRelationshipId(row: Record<string, unknown>): number | null {
  if (!hasOwnField(row, 'id')) {
    return null;
  }
  const id = positiveIntegerValue(row.id);
  if (id === undefined) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'The task prerequisite endpoint returned an invalid relationship record id.',
    });
  }
  return id;
}

/** Read and normalize the direct per-definition prerequisite contract. */
async function readAgentTaskPrerequisites(
  input: AgentTaskPrerequisitesInput,
  session: SessionData,
): Promise<AgentTaskPrerequisitesOutput> {
  const api = createAuthenticatedApi(session);
  const projects = await loadProjectsWithTaskMetadata(
    api,
    session,
    { projectId: input.project_id },
    { strictMetadata: true },
  );
  const resolved = resolveTaskSelector(projects, {
    projectId: input.project_id,
    taskDefinitionId:
      'task_definition_id' in input ? input.task_definition_id : undefined,
    abbr: 'abbreviation' in input ? input.abbreviation : undefined,
  });
  if (resolved.unitId === undefined) {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: 'The selected task has no unit identity for prerequisite lookup.',
    });
  }

  const rawRows = await api.listTaskPrerequisites(
    session,
    resolved.unitId,
    resolved.taskDefId,
  );
  if (!Array.isArray(rawRows)) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'The task prerequisite endpoint returned an unexpected response shape.',
    });
  }
  if (rawRows.length > MAX_AGENT_TASK_ITEMS) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: `OnTrack returned more than ${MAX_AGENT_TASK_ITEMS} prerequisite relationships for one task.`,
    });
  }

  const prerequisites = rawRows.flatMap((raw) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new AgentProtocolError({
        code: 'REMOTE_UNAVAILABLE',
        summary: 'The task prerequisite endpoint returned a malformed relationship row.',
      });
    }
    const row = raw as Record<string, unknown>;
    const dependentId = prerequisiteIdField(
      row,
      'task_definition_id',
      'taskDefinitionId',
    );
    const prerequisiteId = prerequisiteIdField(
      row,
      'prerequisite_id',
      'prerequisiteId',
    );
    if (dependentId !== undefined && dependentId !== resolved.taskDefId) {
      return [];
    }
    if (prerequisiteId === undefined) {
      throw new AgentProtocolError({
        code: 'REMOTE_UNAVAILABLE',
        summary: 'The task prerequisite endpoint returned a malformed relationship.',
      });
    }
    return [
      {
        id: prerequisiteRelationshipId(row),
        task_definition_id: resolved.taskDefId,
        prerequisite_task_definition_id: prerequisiteId,
        required_status: prerequisiteStatusValue(row),
      },
    ];
  });

  const output: AgentTaskPrerequisitesOutput = {
    project_id: input.project_id,
    unit_id: resolved.unitId,
    task_definition_id: resolved.taskDefId,
    count: prerequisites.length,
    prerequisites,
  };
  if (
    Buffer.byteLength(JSON.stringify(output), 'utf8') >
    MAX_AGENT_TASK_OUTPUT_BYTES
  ) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: `OnTrack returned prerequisite data exceeding ${MAX_AGENT_TASK_OUTPUT_BYTES} bytes.`,
    });
  }
  return output;
}

async function readAgentTaskResources(
  input: AgentTaskResourcesInput,
  session: SessionData,
): Promise<AgentTaskResourcesOutput> {
  const api = createAuthenticatedApi(session);
  const projects = await loadProjectsWithTaskMetadata(
    api,
    session,
    { projectId: input.project_id },
    { strictMetadata: true },
  );
  const resolved = resolveTaskBatchSelector(projects, {
    projectId: input.project_id,
    taskDefinitionIds:
      !('task_definition_id' in input) || input.task_definition_id === undefined
        ? []
        : [input.task_definition_id],
    taskIds: [],
    abbrs: 'abbreviation' in input ? input.abbreviation ?? [] : [],
    allTasks: input.all_tasks,
  });
  if (resolved.length > MAX_AGENT_TASK_ITEMS) {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: `task.resources selected more than ${MAX_AGENT_TASK_ITEMS} tasks; use a narrower selector.`,
    });
  }

  const result = await downloadTaskResourceArtifacts(session, api, resolved, {
    outDir: input.out_dir,
    allowExternalDir: input.allow_external_dir,
  });
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_AGENT_TASK_OUTPUT_BYTES) {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: `task.resources response exceeds ${MAX_AGENT_TASK_OUTPUT_BYTES} bytes; use a narrower selector.`,
    });
  }
  return {
    ...result,
    downloads: [...result.downloads],
    unavailable: [...result.unavailable],
  };
}

function buildAgentTaskPdfOutput(
  resolved: ResolvedTaskSelector,
  unitId: number,
  download: DownloadResult,
  filePath: string,
  filename: string,
): AgentTaskPdfOutput {
  return {
    project_id: resolved.project.id,
    unit_id: unitId,
    unit_code: resolved.unitCode
      ? safeTextForHumanDisplay(resolved.unitCode, 'unit')
      : null,
    task_definition_id: resolved.taskDefId,
    task_instance_id: resolved.taskInstanceId ?? null,
    abbreviation: safeTextForHumanDisplay(resolved.abbr, String(resolved.taskDefId)),
    instantiated: resolved.task.isInstantiated === true,
    artifact: {
      filename,
      path: relative(process.cwd(), filePath) || filename,
      bytes: download.buffer.byteLength,
      content_type: safeTextForHumanDisplay(download.contentType, 'application/pdf'),
      sha256: createHash('sha256').update(download.buffer).digest('hex'),
    },
  };
}

/** Download one Task Definition's task sheet through the strict native contract. */
async function readAgentTaskPdf(
  input: AgentTaskPdfInput,
  session: SessionData,
): Promise<AgentTaskPdfOutput> {
  const api = createAuthenticatedApi(session);
  const projects = await loadProjectsWithTaskMetadata(
    api,
    session,
    { projectId: input.project_id },
    { strictMetadata: true },
  );
  const resolved = resolveTaskSelector(projects, {
    projectId: input.project_id,
    taskDefinitionId:
      'task_definition_id' in input ? input.task_definition_id : undefined,
    abbr: 'abbreviation' in input ? input.abbreviation : undefined,
  });
  const unitId = resolved.unitId;
  if (unitId === undefined) {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: 'The selected task has no unit identity for task PDF download.',
    });
  }
  const download = await api.downloadTaskPdf(
    session,
    unitId,
    resolved.taskDefId,
  );
  const filename = buildPdfFilename(resolved.unitCode, resolved.abbr, 'task');
  const filePath = await writeArtifactFile(download.buffer, filename, {
    root: process.cwd(),
    outDir: input.out_dir,
    allowExternal: input.allow_external_dir,
  });
  return buildAgentTaskPdfOutput(resolved, unitId, download, filePath, filename);
}

function requireAgentSubmissionPdfReady(
  resolved: ResolvedTaskSelector,
  details: SubmissionDetails,
): void {
  if (details.pdfState === 'processing') {
    throw new AgentProtocolError({
      code: 'CONFLICT',
      summary: 'The submission PDF is still processing.',
      retryable: true,
      nextActions: [
        {
          action: 'submission.status',
          arguments: {
            project_id: resolved.project.id,
            task_definition_id: resolved.taskDefId,
          },
        },
      ],
    });
  }
  if (details.pdfState === 'unavailable') {
    throw new AgentProtocolError({
      code: 'NOT_FOUND',
      summary: 'The submission PDF is not available.',
    });
  }
}

function buildAgentSubmissionPdfOutput(
  resolved: ResolvedTaskSelector,
  download: DownloadResult,
  filePath: string,
  filename: string,
): AgentSubmissionPdfOutput {
  return {
    project_id: resolved.project.id,
    unit_id: resolved.unitId ?? null,
    unit_code: resolved.unitCode
      ? safeTextForHumanDisplay(resolved.unitCode, 'unit')
      : null,
    task_definition_id: resolved.taskDefId,
    task_instance_id: resolved.taskInstanceId ?? null,
    abbreviation: safeTextForHumanDisplay(resolved.abbr, String(resolved.taskDefId)),
    instantiated: resolved.task.isInstantiated === true,
    has_pdf: true,
    processing_pdf: false,
    pdf_state: 'ready',
    submission_observed: true,
    artifact: {
      filename,
      path: relative(process.cwd(), filePath) || filename,
      bytes: download.buffer.byteLength,
      content_type: safeTextForHumanDisplay(download.contentType, 'application/pdf'),
      sha256: createHash('sha256').update(download.buffer).digest('hex'),
    },
  };
}

/** Download one ready submission PDF through the strict native contract. */
async function readAgentSubmissionPdf(
  input: AgentSubmissionPdfInput,
  session: SessionData,
): Promise<AgentSubmissionPdfOutput> {
  const api = createAuthenticatedApi(session);
  const projects = await loadProjectsWithTaskMetadata(
    api,
    session,
    { projectId: input.project_id },
    { strictMetadata: true },
  );
  const resolved = resolveTaskSelector(projects, {
    projectId: input.project_id,
    taskDefinitionId:
      'task_definition_id' in input ? input.task_definition_id : undefined,
    abbr: 'abbreviation' in input ? input.abbreviation : undefined,
  });
  const details = parseStrictSubmissionDetails(
    await api.getSubmissionDetails(session, resolved.project.id, resolved.taskDefId),
  );
  requireAgentSubmissionPdfReady(resolved, details);
  const download = await api.downloadSubmissionPdf(
    session,
    resolved.project.id,
    resolved.taskDefId,
  );
  const filename = buildPdfFilename(resolved.unitCode, resolved.abbr, 'submission');
  const filePath = await writeArtifactFile(download.buffer, filename, {
    root: process.cwd(),
    outDir: input.out_dir,
    allowExternal: input.allow_external_dir,
  });
  return buildAgentSubmissionPdfOutput(resolved, download, filePath, filename);
}

async function readAgentSubmissionStatus(
  input: AgentSubmissionStatusInput,
  session: SessionData,
): Promise<AgentSubmissionStatusOutput> {
  const api = createAuthenticatedApi(session);
  const projects = await loadProjectsWithTaskMetadata(
    api,
    session,
    { projectId: input.project_id },
    { strictMetadata: true },
  );
  const resolved = resolveTaskSelector(projects, {
    projectId: input.project_id,
    taskDefinitionId:
      'task_definition_id' in input ? input.task_definition_id : undefined,
    abbr: 'abbreviation' in input ? input.abbreviation : undefined,
  });
  const details = parseStrictSubmissionDetails(
    await api.getSubmissionDetails(
      session,
      resolved.project.id,
      resolved.taskDefId,
    ),
  );
  return buildAgentSubmissionStatusOutput(resolved, details);
}

function buildAgentSubmissionStatusOutput(
  resolved: ResolvedTaskSelector,
  details: SubmissionDetails,
): AgentSubmissionStatusOutput {
  const output = {
    project_id: resolved.project.id,
    unit_id: resolved.unitId ?? null,
    unit_code: resolved.unitCode ?? null,
    task_definition_id: resolved.taskDefId,
    task_instance_id: resolved.taskInstanceId ?? null,
    abbreviation: resolved.abbr,
    instantiated: resolved.task.isInstantiated === true,
    has_pdf: details.hasPdf,
    processing_pdf: details.processingPdf,
    pdf_state: details.pdfState,
    submission_date: details.submissionDate ?? null,
    task_status: details.taskStatus ?? null,
    submission_observed: isSubmissionObserved(details),
  };
  const parsedOutput = agentSubmissionStatusOutputSchema.safeParse(output);
  if (!parsedOutput.success) {
    throw new AgentProtocolError({
      code: 'INTERNAL_ERROR',
      summary: 'The submission.status output failed contract validation.',
    });
  }
  if (
    Buffer.byteLength(JSON.stringify(parsedOutput.data), 'utf8') >
    MAX_AGENT_SUBMISSION_STATUS_OUTPUT_BYTES
  ) {
    throw new AgentProtocolError({
      code: 'INTERNAL_ERROR',
      summary: 'The submission.status output exceeded its safety limit.',
    });
  }
  return parsedOutput.data;
}

function createNativeAgentExecutionEngine() {
  let activeSession: SessionData | undefined;
  return createAgentExecutionEngine(
    createNativeAgentCommands({
      authStatus: () => readAuthStatus(),
      projectsList: () => {
        if (!activeSession) {
          throw new AgentProtocolError({
            code: 'INTERNAL_ERROR',
            summary: 'The Agent auth policy did not provide a session.',
          });
        }
        return readAgentProjectsList(activeSession);
      },
      unitShow: (input) => {
        if (!activeSession) {
          throw new AgentProtocolError({
            code: 'INTERNAL_ERROR',
            summary: 'The Agent auth policy did not provide a session.',
          });
        }
        return readAgentUnitShow(input, activeSession);
      },
      tutorialsStatus: (input) => {
        if (!activeSession) {
          throw new AgentProtocolError({
            code: 'INTERNAL_ERROR',
            summary: 'The Agent auth policy did not provide a session.',
          });
        }
        return readAgentTutorialsStatus(input, activeSession);
      },
      tasksList: (input) => {
        if (!activeSession) {
          throw new AgentProtocolError({
            code: 'INTERNAL_ERROR',
            summary: 'The Agent auth policy did not provide a session.',
          });
        }
        return readAgentTasksList(input, activeSession);
      },
      taskShow: (input) => {
        if (!activeSession) {
          throw new AgentProtocolError({
            code: 'INTERNAL_ERROR',
            summary: 'The Agent auth policy did not provide a session.',
          });
        }
        return readAgentTaskShow(input, activeSession);
      },
      taskPrerequisites: (input) => {
        if (!activeSession) {
          throw new AgentProtocolError({
            code: 'INTERNAL_ERROR',
            summary: 'The Agent auth policy did not provide a session.',
          });
        }
        return readAgentTaskPrerequisites(input, activeSession);
      },
      feedbackList: (input) => {
        if (!activeSession) {
          throw new AgentProtocolError({
            code: 'INTERNAL_ERROR',
            summary: 'The Agent auth policy did not provide a session.',
          });
        }
        return readAgentFeedbackList(input, activeSession);
      },
      feedbackWatch: (input, context) => {
        if (!activeSession) {
          throw new AgentProtocolError({
            code: 'INTERNAL_ERROR',
            summary: 'The Agent auth policy did not provide a session.',
          });
        }
        return readAgentFeedbackWatch(input, activeSession, context.signal);
      },
      taskResources: (input) => {
        if (!activeSession) {
          throw new AgentProtocolError({
            code: 'INTERNAL_ERROR',
            summary: 'The Agent auth policy did not provide a session.',
          });
        }
        return readAgentTaskResources(input, activeSession);
      },
      taskPdf: (input) => {
        if (!activeSession) {
          throw new AgentProtocolError({
            code: 'INTERNAL_ERROR',
            summary: 'The Agent auth policy did not provide a session.',
          });
        }
        return readAgentTaskPdf(input, activeSession);
      },
      submissionPdf: (input) => {
        if (!activeSession) {
          throw new AgentProtocolError({
            code: 'INTERNAL_ERROR',
            summary: 'The Agent auth policy did not provide a session.',
          });
        }
        return readAgentSubmissionPdf(input, activeSession);
      },
      planShow: (input) => {
        if (!activeSession) {
          throw new AgentProtocolError({
            code: 'INTERNAL_ERROR',
            summary: 'The Agent auth policy did not provide a session.',
          });
        }
        return readAgentPlanShow(input, activeSession);
      },
      submissionStatus: (input) => {
        if (!activeSession) {
          throw new AgentProtocolError({
            code: 'INTERNAL_ERROR',
            summary: 'The Agent auth policy did not provide a session.',
          });
        }
        return readAgentSubmissionStatus(input, activeSession);
      },
    }),
    {
      normalizeError: normalizeAgentCliError,
      policyRuntime: {
        ensureAuth: async () => {
          activeSession = await requireSession();
        },
      },
    },
  );
}

async function writeNativeAgentStream(
  engine: AgentExecutionEngine,
  command: string,
  input: Readonly<Record<string, unknown>>,
): Promise<void> {
  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  let exitCode = 0;
  process.once('SIGINT', onSigint);
  try {
    for await (const envelope of engine.stream(
      { command, input },
      { signal: controller.signal },
    )) {
      console.log(JSON.stringify(envelope));
      exitCode ||= exitCodeForAgentEnvelope(envelope);
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
  process.exitCode = exitCode;
}

/** Execute the caller-first Agent interface without translating JSON into argv. */
async function handleNativeAgentCommand(args: string[]): Promise<void> {
  const requestId = `req_${randomUUID()}`;
  const [subcommand, ...rest] = args;
  let command =
    subcommand === 'list'
      ? 'agent.list'
      : subcommand === 'describe'
        ? 'agent.describe'
      : subcommand === 'call'
          ? (rest[0] ?? 'agent.call')
          : subcommand === 'stream'
            ? (rest[0] ?? 'agent.stream')
          : 'agent';
  let envelope;

  try {
    const engine = createNativeAgentExecutionEngine();
    if (subcommand === 'list') {
      if (rest.length > 0) {
        throw new AgentProtocolError({
          code: 'INVALID_ARGUMENT',
          summary: 'agent list does not accept arguments.',
        });
      }
      command = 'agent.list';
      envelope = agentSuccessEnvelope({
        command,
        requestId,
        data: { commands: engine.capabilities() },
      });
    } else if (subcommand === 'describe') {
      const requested = rest[0];
      if (!requested || rest.length > 1) {
        throw new AgentProtocolError({
          code: 'INVALID_ARGUMENT',
          summary: 'agent describe requires exactly one command path.',
        });
      }
      command = 'agent.describe';
      envelope = agentSuccessEnvelope({
        command,
        requestId,
        data: engine.describe(requested),
      });
    } else if (subcommand === 'call') {
      const invocation = await parseAgentCallInvocation(rest);
      command = invocation.command;
      envelope = await engine.call({
        command: invocation.command,
        input: invocation.input,
      });
    } else if (subcommand === 'stream') {
      const invocation = await parseAgentCallInvocation(rest, {
        invocationLabel: 'agent stream',
      });
      command = invocation.command;
      await writeNativeAgentStream(engine, invocation.command, invocation.input);
      return;
    } else {
      throw new AgentProtocolError({
        code: 'INVALID_ARGUMENT',
        summary: `Unknown agent subcommand: ${subcommand || '(missing)'}.`,
      });
    }
  } catch (error) {
    envelope = agentErrorEnvelope({
      command,
      requestId,
      error: normalizeAgentCliError(error),
    });
  }

  console.log(JSON.stringify(envelope));
  process.exitCode = exitCodeForAgentEnvelope(envelope);
}

/** Top-level command dispatcher. */
async function main(): Promise<void> {
  let args = process.argv.slice(2);
  if (args[0] === 'agent') {
    await handleNativeAgentCommand(args.slice(1));
    return;
  }
  const requestedOutput = getFlagValue(args, '--output');
  const agentOutput = requestedOutput === 'agent-json' || hasFlag(args, '--agent');
  if (requestedOutput && requestedOutput !== 'agent-json') {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: '--output currently supports only agent-json.',
    });
  }

  const resolvedPath = resolveCommandPath(args);
  if (agentOutput) {
    const commandSpec = (() => {
      try {
        return getCommandSpec(resolvedPath);
      } catch {
        return undefined;
      }
    })();
    configureAgentOutputContext({
      command: resolvedPath,
      requestId: `req_${randomUUID()}`,
      streaming: commandSpec?.streaming ?? false,
    });
    if (!commandSpec) {
      throw new AgentProtocolError({
        code: 'INVALID_ARGUMENT',
        summary: `Command "${resolvedPath}" is not available in Agent mode.`,
      });
    }
    if (!hasFlag(args, '--json')) {
      args = [...args, '--json'];
    }
    if (hasFlag(args, '--input') || hasFlag(args, '--input-json')) {
      args = await mergeStructuredCommandInput(args, commandSpec);
    }
    if (commandSpec) {
      validateAgentCommandArguments(args, commandSpec);
    }
  } else if (hasFlag(args, '--input') || hasFlag(args, '--input-json')) {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: 'Structured JSON input requires --output agent-json.',
    });
  }

  const command = args[0];
  const rest = args.slice(1);

  if (!command) {
    await handleWelcome();
    return;
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    help();
    return;
  }

  switch (command) {
    case 'capabilities':
      await handleCapabilities();
      return;
    case 'schema':
      handleSchema(rest);
      return;
    case 'welcome':
      await handleWelcome();
      return;
    case 'auth-method':
      await handleAuthMethod(rest);
      return;
    case 'auth': {
      const [subcommand, ...authArgs] = rest;
      if (subcommand === 'method') {
        await handleAuthMethod(authArgs);
        return;
      }
      if (subcommand === 'login') {
        await handleLogin(authArgs);
        return;
      }
      if (subcommand === 'logout') {
        await handleLogout(authArgs);
        return;
      }
      if (subcommand === 'status') {
        await handleAuthStatus(authArgs);
        return;
      }
      if (subcommand === 'ensure') {
        await handleAuthEnsure(authArgs);
        return;
      }
      throw new AgentProtocolError({
        code: 'INVALID_ARGUMENT',
        summary: `Unknown auth subcommand: ${subcommand || '(missing)'}.`,
      });
    }
    case 'login':
      await handleLogin(rest);
      return;
    case 'logout':
      await handleLogout(rest);
      return;
    case 'whoami':
      await handleWhoAmI(rest);
      return;
    case 'projects':
      await handleProjects(rest);
      return;
    case 'project':
      await handleProjectCommand(rest);
      return;
    case 'units':
      await handleUnits(rest);
      return;
    case 'unit':
      await handleUnitCommand(rest);
      return;
    case 'tasks':
      await handleTasks(rest);
      return;
    case 'doctor':
      await handleDoctor(rest);
      return;
    case 'discover':
      await handleDiscover(rest);
      return;
    case 'inbox':
      await handleInbox(rest);
      return;
    case 'task':
      await handleTaskCommand(rest);
      return;
    case 'plan':
      await handlePlanCommand(rest);
      return;
    case 'feedback':
      await handleFeedbackCommand(rest);
      return;
    case 'pdf':
      await handlePdfCommand(rest);
      return;
    case 'submission':
      await handleSubmissionCommand(rest);
      return;
    case 'watch':
      await handleWatch(rest);
      return;
    default:
      throw new AgentProtocolError({
        code: 'INVALID_ARGUMENT',
        summary: `Unknown command: ${command}.`,
      });
  }
}

function normalizeAgentCliError(error: unknown): AgentProtocolError {
  if (error instanceof AgentProtocolError) {
    return error;
  }
  if (error instanceof InvalidDownloadFormatError) {
    return new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'OnTrack returned an invalid task resource archive.',
      cause: error,
    });
  }
  if (error instanceof InvalidPdfDownloadError) {
    return new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'OnTrack returned an invalid PDF download.',
      cause: error,
    });
  }
  if (error instanceof OversizedBinaryResponseError) {
    return new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'OnTrack returned a download that exceeded the safety limit.',
      cause: error,
    });
  }
  if (error instanceof UnavailableDownloadError) {
    return new AgentProtocolError({
      code: 'NOT_FOUND',
      summary: 'The requested download is not available.',
      cause: error,
    });
  }
  if (error instanceof OversizedJsonResponseError) {
    return new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'OnTrack returned a response that exceeded the safety limit.',
      cause: error,
    });
  }
  if (error instanceof InvalidJsonResponseError) {
    return new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'OnTrack returned an invalid JSON response.',
      cause: error,
    });
  }
  if (error instanceof InvalidSubmissionDetailsError) {
    return new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'OnTrack returned malformed submission details.',
      cause: error,
    });
  }
  if (error instanceof OnTrackHttpError) {
    if (error.authFailure !== 'other') {
      return new AgentProtocolError({
        code: 'AUTH_REQUIRED',
        status: 'auth_required',
        summary: 'The saved OnTrack credential was rejected.',
        retryable: true,
        nextActions: [
          {
            action: 'auth.ensure',
            arguments: { interaction: 'if_required' },
          },
        ],
        cause: error,
      });
    }
    if (error.status === 403) {
      return new AgentProtocolError({
        code: 'FORBIDDEN',
        summary: 'OnTrack denied this operation.',
        cause: error,
      });
    }
    if (error.status === 404) {
      return new AgentProtocolError({
        code: 'NOT_FOUND',
        summary: 'The requested OnTrack resource was not found.',
        cause: error,
      });
    }
    if (error.status === 409) {
      return new AgentProtocolError({
        code: 'CONFLICT',
        summary: 'OnTrack reported a conflicting state.',
        cause: error,
      });
    }
    if (error.status === 429) {
      return new AgentProtocolError({
        code: 'RATE_LIMITED',
        summary: 'OnTrack rate-limited the request.',
        retryable: true,
        cause: error,
      });
    }
    return new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'The OnTrack service could not complete the request.',
      retryable: error.status >= 500,
      cause: error,
    });
  }
  if (error instanceof OnTrackTransportError) {
    return new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'The OnTrack service could not be reached.',
      retryable: true,
      cause: error,
    });
  }

  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    /\bnot found\b|\bno matching\b|\bnot available\b|\bdoes not exist\b|\bhas no tasks\b/u.test(
      message,
    )
  ) {
    return new AgentProtocolError({
      code: 'NOT_FOUND',
      summary: 'The requested resource was not found.',
      cause: error,
    });
  }
  if (
    /\bambiguous\b|\bconflict\b|\brequires an existing\b|\bstill processing\b|\bcannot dispatch\b/u.test(
      message,
    )
  ) {
    return new AgentProtocolError({
      code: 'CONFLICT',
      summary: 'The requested operation conflicts with the current state.',
      cause: error,
    });
  }
  if (
    /\brequires?\b|\bmissing\b|\bmust\b|\binvalid\b|\bunknown\b|\bat least\b|\bcannot be\b|\bonly supports?\b|\bprovide\b|\bfailed to (?:read|inspect)\b/u.test(
      message,
    )
  ) {
    return new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: 'One or more command arguments are invalid.',
      cause: error,
    });
  }
  return new AgentProtocolError({
    code: 'INTERNAL_ERROR',
    summary: 'The command failed unexpectedly.',
    cause: error,
  });
}

main().catch((error) => {
  const agentContext = getAgentOutputContext();
  if (agentContext) {
    const normalized = normalizeAgentCliError(error);
    console.log(
      JSON.stringify(
        agentErrorEnvelope({
          command: agentContext.command,
          requestId: agentContext.requestId,
          error: normalized,
        }),
        null,
        agentContext.streaming ? undefined : 2,
      ),
    );
    process.exitCode = exitCodeForAgentError(normalized);
    return;
  }

  const redacted = toRedactedError(error);
  if (error instanceof OnTrackHttpError && error.authFailure !== 'other') {
    console.error(
      `Error: OnTrack rejected the saved credential (${error.authFailure}). Run \`ontrack auth ensure --interaction if_required\`.`,
    );
  } else {
    console.error(`Error: ${redacted.message}`);
  }
  process.exitCode = 1;
});
