import type {
  AuthMethodResponse,
  FeedbackItem,
  InboxTask,
  ProjectSummary,
  SessionData,
  SubmissionTrigger,
  SignInResponse,
  UnitSummary,
} from './types.js';
import { OnTrackHttpError, OnTrackTransportError } from './auth.js';
import { MAX_DOWNLOAD_BYTES } from './artifact-safety.js';

export { MAX_DOWNLOAD_BYTES } from './artifact-safety.js';

/**
 * HTTP protocol layer for OnTrack API calls.
 *
 * Responsibilities:
 * - build URLs from base API origin
 * - attach auth headers from cached session
 * - retry idempotent requests on transient failures
 * - normalize JSON/binary response handling
 */
type JsonBody = Record<string, unknown> | undefined;

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const DEFAULT_RETRY_ATTEMPTS = 2;
const MAX_TASK_PREREQUISITES_RESPONSE_BYTES = 512 * 1024;
const MAX_SUBMISSION_DETAILS_RESPONSE_BYTES = 64 * 1024;

type AuthSessionRefresh = () => Promise<SessionData | null>;

/** Raised when a remote JSON response exceeds a caller-defined safety bound. */
export class OversizedJsonResponseError extends Error {
  constructor(maxBytes: number) {
    super(`JSON response exceeds maximum allowed size of ${maxBytes} bytes.`);
    this.name = 'OversizedJsonResponseError';
  }
}

/** Raised when a successful remote response is not valid JSON. */
export class InvalidJsonResponseError extends Error {
  constructor(cause?: unknown) {
    super('OnTrack returned invalid JSON.', { cause });
    this.name = 'InvalidJsonResponseError';
  }
}

function isReplaySafe(init: RequestInit): boolean {
  const method = methodOf(init);
  return method === 'GET' || method === 'HEAD';
}

function withRefreshedAuth(init: RequestInit, session: SessionData): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('Auth-Token', session.authToken);
  headers.set('Username', session.username);
  return { ...init, headers };
}

/** Normalize request method string for retry policy checks. */
function methodOf(init: RequestInit): string {
  return (init.method || 'GET').toUpperCase();
}

/** Retry only idempotent requests and only for retryable HTTP statuses. */
function shouldRetry(response: Response, init: RequestInit, attempt: number, maxRetries: number): boolean {
  if (attempt >= maxRetries) {
    return false;
  }

  const method = methodOf(init);
  if (method !== 'GET' && method !== 'HEAD') {
    return false;
  }

  return RETRYABLE_STATUSES.has(response.status);
}

/** Exponential backoff with jitter to reduce retry stampedes. */
function retryDelayMs(attempt: number): number {
  const base = 250;
  const backoff = base * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 120);
  return backoff + jitter;
}

/** Async delay primitive used by retry backoff logic. */
async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build a status-only error; arbitrary remote bodies are never terminal-safe. */
function buildErrorMessage(response: Response): string {
  return `${response.status} ${response.statusText}`.trim();
}

/** Convert runtime-specific fetch failures into one stable transport error. */
async function fetchOnTrack(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw new OnTrackTransportError(error);
  }
}

/** Perform JSON request/response handling with retry support. */
async function requestJson<T>(
  url: string,
  init: RequestInit,
  attempt: number = 0,
  maxRetries: number = DEFAULT_RETRY_ATTEMPTS,
  refreshAuth?: AuthSessionRefresh,
  authRetried: boolean = false,
  maxResponseBytes?: number,
): Promise<T> {
  const response = await fetchOnTrack(url, init);

  if (!response.ok && shouldRetry(response, init, attempt, maxRetries)) {
    await wait(retryDelayMs(attempt));
    return requestJson<T>(
      url,
      init,
      attempt + 1,
      maxRetries,
      refreshAuth,
      authRetried,
      maxResponseBytes,
    );
  }

  if (
    !response.ok &&
    !authRetried &&
    refreshAuth &&
    isReplaySafe(init) &&
    (response.status === 401 || response.status === 419)
  ) {
    const refreshed = await refreshAuth().catch(() => null);
    if (refreshed) {
      return requestJson<T>(
        url,
        withRefreshedAuth(init, refreshed),
        0,
        maxRetries,
        refreshAuth,
        true,
        maxResponseBytes,
      );
    }
  }

  if (!response.ok) {
    throw new OnTrackHttpError(response.status, buildErrorMessage(response));
  }

  const contentType = response.headers.get('content-type') || '';
  const body = maxResponseBytes !== undefined
    ? await readBoundedJsonResponse(response, maxResponseBytes)
    : contentType.includes('application/json')
      ? await readJsonResponse(response)
      : await response.text();
  return body as T;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch (error) {
    throw new InvalidJsonResponseError(error);
  }
}

/** Read a JSON response without buffering beyond the caller's explicit limit. */
async function readBoundedJsonResponse(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new OversizedJsonResponseError(maxBytes);
  }
  let buffer: Buffer;
  try {
    buffer = await readBoundedResponseBody(response.body, maxBytes);
  } catch (error) {
    if (error instanceof Error && /Binary response exceeds maximum allowed size/u.test(error.message)) {
      throw new OversizedJsonResponseError(maxBytes);
    }
    throw error;
  }
  try {
    return JSON.parse(buffer.toString('utf8')) as unknown;
  } catch (error) {
    throw new InvalidJsonResponseError(error);
  }
}

/** Binary download shape returned by PDF endpoints. */
export interface DownloadResult {
  buffer: Buffer;
  contentType: string;
  contentDisposition?: string;
}

/** Raised when OnTrack returns a successful response without the requested file. */
export class UnavailableDownloadError extends Error {
  constructor() {
    super('Requested download is not available.');
    this.name = 'UnavailableDownloadError';
  }
}

/** Raised when a successful task-resource response is not a ZIP archive. */
export class InvalidDownloadFormatError extends Error {
  constructor() {
    super('OnTrack returned a non-ZIP task resource payload.');
    this.name = 'InvalidDownloadFormatError';
  }
}

/** Probe response payload used by `discover --probe`. */
export interface ProbeResult {
  endpoint: string;
  status: number;
  ok: boolean;
}

/** One multipart upload file entry keyed by required server field name. */
export interface SubmissionUploadFile {
  key: string;
  filename: string;
  content: Uint8Array;
  contentType?: string;
}

/** Optional behavior switches for upload submission endpoint. */
export interface UploadSubmissionOptions {
  trigger?: SubmissionTrigger;
}

/** Perform binary request with retry and consistent error handling. */
async function requestBinary(
  url: string,
  init: RequestInit,
  attempt: number = 0,
  maxRetries: number = DEFAULT_RETRY_ATTEMPTS,
  refreshAuth?: AuthSessionRefresh,
  authRetried: boolean = false,
): Promise<DownloadResult> {
  const response = await fetchOnTrack(url, init);

  if (!response.ok && shouldRetry(response, init, attempt, maxRetries)) {
    await wait(retryDelayMs(attempt));
    return requestBinary(
      url,
      init,
      attempt + 1,
      maxRetries,
      refreshAuth,
      authRetried,
    );
  }

  if (
    !response.ok &&
    !authRetried &&
    refreshAuth &&
    isReplaySafe(init) &&
    (response.status === 401 || response.status === 419)
  ) {
    const refreshed = await refreshAuth().catch(() => null);
    if (refreshed) {
      return requestBinary(
        url,
        withRefreshedAuth(init, refreshed),
        0,
        maxRetries,
        refreshAuth,
        true,
      );
    }
  }

  if (!response.ok) {
    throw new OnTrackHttpError(response.status, buildErrorMessage(response));
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      `Binary response exceeds maximum allowed size of ${MAX_DOWNLOAD_BYTES} bytes.`,
    );
  }
  const buffer = await readBoundedResponseBody(response.body, MAX_DOWNLOAD_BYTES);
  return {
    buffer,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    contentDisposition: response.headers.get('content-disposition') || undefined,
  };
}

/** Reject OnTrack's HTTP-200 placeholder when a requested file has no backing data. */
function requireAvailableDownload(download: DownloadResult): DownloadResult {
  const disposition = download.contentDisposition ?? '';
  const missingFile =
    /(?:^|;)\s*filename\*?\s*=\s*(?:UTF-8'[^']*)?["']?FileNotFound\.(?:pdf|zip)["']?(?:\s*;|$)/i;
  if (missingFile.test(disposition)) {
    throw new UnavailableDownloadError();
  }
  return download;
}

/** Validate the archive signature before persisting a remote response as a ZIP. */
function requireZipDownload(download: DownloadResult): DownloadResult {
  const [first, second, third, fourth] = download.buffer;
  const isZip =
    first === 0x50 &&
    second === 0x4b &&
    ((third === 0x03 && fourth === 0x04) ||
      (third === 0x05 && fourth === 0x06) ||
      (third === 0x07 && fourth === 0x08));
  if (!isZip) {
    throw new InvalidDownloadFormatError();
  }
  return download;
}

/** Read a binary response incrementally and stop before an oversized body is buffered. */
export async function readBoundedResponseBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Buffer> {
  if (!body) {
    return Buffer.alloc(0);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(
          `Binary response exceeds maximum allowed size of ${maxBytes} bytes.`,
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

/** Join path with API base URL while avoiding duplicate slashes. */
function withApiPath(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ''), `${baseUrl}/`).toString();
}

/** Ensure probe paths always use leading slash for downstream join logic. */
function normalizeProbePath(path: string): string {
  if (!path.startsWith('/')) {
    return `/${path}`;
  }
  return path;
}

/** Normalize probe path then join against API base safely. */
function withFlexibleApiPath(baseUrl: string, path: string): string {
  const normalized = normalizeProbePath(path);
  if (normalized.startsWith('/api/')) {
    return withApiPath(baseUrl, normalized.replace(/^\/api\//, ''));
  }
  return withApiPath(baseUrl, normalized);
}

/** Auth header contract required by OnTrack API. */
function authHeaders(session: SessionData): HeadersInit {
  return {
    'Auth-Token': session.authToken,
    Username: session.username,
  };
}

export class OnTrackApiClient {
  private refreshedSession?: SessionData;

  constructor(
    private readonly baseUrl: string,
    private readonly options: {
      readonly refreshSession?: (failedSession: SessionData) => Promise<SessionData | null>;
    } = {},
  ) {}

  private activeSession(session: SessionData): SessionData {
    return this.refreshedSession ?? session;
  }

  private authRefresh(session: SessionData): AuthSessionRefresh | undefined {
    if (!this.options.refreshSession) {
      return undefined;
    }
    return async () => {
      const refreshed = await this.options.refreshSession?.(
        this.activeSession(session),
      );
      if (refreshed) {
        this.refreshedSession = { ...refreshed, user: { ...refreshed.user } };
      }
      return refreshed ?? null;
    };
  }

  get base(): string {
    return this.baseUrl;
  }

  /** Read server-advertised authentication mode (SSO/manual metadata). */
  getAuthMethod(): Promise<AuthMethodResponse> {
    return requestJson<AuthMethodResponse>(withApiPath(this.baseUrl, 'auth/method'), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });
  }

  /** Exchange captured login payload for API auth token + user profile. */
  signIn(payload: JsonBody): Promise<SignInResponse> {
    return requestJson<SignInResponse>(withApiPath(this.baseUrl, 'auth'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  /** Revoke remote auth session (best effort). */
  signOut(session: SessionData): Promise<unknown> {
    return requestJson(withApiPath(this.baseUrl, 'auth?remember=false'), {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        ...authHeaders(this.activeSession(session)),
      },
    });
  }

  /** List projects visible to the authenticated account. */
  listProjects(session: SessionData): Promise<ProjectSummary[]> {
    return requestJson<ProjectSummary[]>(
      withApiPath(this.baseUrl, 'projects'),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
    );
  }

  /** Fetch one project payload, usually including task instances. */
  getProject(session: SessionData, projectId: number): Promise<ProjectSummary> {
    return requestJson<ProjectSummary>(
      withApiPath(this.baseUrl, `projects/${projectId}`),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
    );
  }

  /** List units; some roles may receive 403 (handled by caller fallback). */
  listUnits(session: SessionData): Promise<UnitSummary[]> {
    return requestJson<UnitSummary[]>(
      withApiPath(this.baseUrl, 'units'),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
    );
  }

  /** Fetch a single unit, often used to resolve task definition metadata. */
  getUnit(session: SessionData, unitId: number): Promise<UnitSummary> {
    return requestJson<UnitSummary>(
      withApiPath(this.baseUrl, `units/${unitId}`),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
    );
  }

  /** Inbox endpoint for a specific unit. */
  listInboxTasks(session: SessionData, unitId: number): Promise<InboxTask[]> {
    return requestJson<InboxTask[]>(
      withApiPath(this.baseUrl, `units/${unitId}/tasks/inbox`),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
    );
  }

  /** Read all prerequisite relationships for a unit's task definitions. */
  listUnitTaskPrerequisites(session: SessionData, unitId: number): Promise<unknown[]> {
    return requestJson<unknown[]>(
      withApiPath(this.baseUrl, `units/${unitId}/task_prerequisites`),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
    );
  }

  /** Read prerequisites for one task definition within a unit. */
  listTaskPrerequisites(session: SessionData, unitId: number, taskDefId: number): Promise<unknown[]> {
    return requestJson<unknown[]>(
      withApiPath(this.baseUrl, `units/${unitId}/task_definitions/${taskDefId}/prerequisites`),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
      false,
      MAX_TASK_PREREQUISITES_RESPONSE_BYTES,
    );
  }

  /** Read comments/events for one task definition in a project. */
  listTaskComments(session: SessionData, projectId: number, taskDefId: number): Promise<FeedbackItem[]> {
    return requestJson<FeedbackItem[]>(
      withApiPath(this.baseUrl, `projects/${projectId}/task_def_id/${taskDefId}/comments`),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
    );
  }

  /** Post a text comment into task conversation stream. */
  addTaskComment(
    session: SessionData,
    projectId: number,
    taskDefId: number,
    comment: string,
  ): Promise<FeedbackItem> {
    return requestJson<FeedbackItem>(
      withApiPath(this.baseUrl, `projects/${projectId}/task_def_id/${taskDefId}/comments`),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
        body: JSON.stringify({ comment }),
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
    );
  }

  /** Upload submission/new-file payload using multipart form data. */
  uploadTaskSubmission(
    session: SessionData,
    projectId: number,
    taskDefId: number,
    files: SubmissionUploadFile[],
    options?: UploadSubmissionOptions,
  ): Promise<unknown> {
    if (files.length === 0) {
      throw new Error('At least one upload file is required.');
    }

    const form = new FormData();
    for (const file of files) {
      const bytes = new Uint8Array(file.content);
      const blob = new Blob([bytes], {
        type: file.contentType || 'application/octet-stream',
      });
      form.append(file.key, blob, file.filename);
    }

    if (options?.trigger) {
      form.append('trigger', options.trigger);
    }

    return requestJson(
      withApiPath(this.baseUrl, `projects/${projectId}/task_def_id/${taskDefId}/submission`),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
        body: form,
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
    );
  }

  /** Read submission state before a PDF download or lifecycle action. */
  getSubmissionDetails(session: SessionData, projectId: number, taskDefId: number): Promise<unknown> {
    return requestJson(
      withApiPath(this.baseUrl, `projects/${projectId}/task_def_id/${taskDefId}/submission_details`),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
      false,
      MAX_SUBMISSION_DETAILS_RESPONSE_BYTES,
    );
  }

  /** Set personal target dates using the production planner contract. */
  updateTaskTargetDates(
    session: SessionData,
    projectId: number,
    taskDefId: number,
    targetStartDate: string,
    targetDueDate: string,
  ): Promise<unknown> {
    return requestJson(
      withApiPath(this.baseUrl, `projects/${projectId}/task_def_id/${taskDefId}/target_dates`),
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
        body: JSON.stringify({
          target_start_date: targetStartDate,
          target_due_date: targetDueDate,
        }),
      },
    );
  }

  /** Reset all project target dates using the server's default plan. */
  resetProjectTargetDates(session: SessionData, projectId: number): Promise<unknown> {
    return requestJson(withApiPath(this.baseUrl, `projects/${projectId}/reset_target_dates`), {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        ...authHeaders(this.activeSession(session)),
      },
    });
  }

  /** Persist planner extension values without inferring their schema. */
  updateTaskPlan(
    session: SessionData,
    projectId: number,
    taskDefId: number,
    extensions: Record<string, unknown>,
  ): Promise<unknown> {
    return requestJson(
      withApiPath(this.baseUrl, `projects/${projectId}/task_def_id/${taskDefId}/plan`),
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
        body: JSON.stringify({ extensions }),
      },
    );
  }

  /** Download task sheet PDF. */
  downloadTaskPdf(session: SessionData, unitId: number, taskDefId: number): Promise<DownloadResult> {
    return requestBinary(
      withApiPath(
        this.baseUrl,
        `units/${unitId}/task_definitions/${taskDefId}/task_pdf.json?as_attachment=true`,
      ),
      {
        method: 'GET',
        headers: {
          Accept: 'application/pdf, application/octet-stream, */*',
          ...authHeaders(this.activeSession(session)),
        },
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
    );
  }

  /** Download the ZIP archive of resources attached to a task definition. */
  downloadTaskResources(
    session: SessionData,
    unitId: number,
    taskDefId: number,
  ): Promise<DownloadResult> {
    return requestBinary(
      withApiPath(
        this.baseUrl,
        `units/${unitId}/task_definitions/${taskDefId}/task_resources.json?as_attachment=true`,
      ),
      {
        method: 'GET',
        headers: {
          Accept: 'application/zip, application/octet-stream, */*',
          ...authHeaders(this.activeSession(session)),
        },
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
    )
      .then(requireAvailableDownload)
      .then(requireZipDownload);
  }

  /** Download submission snapshot PDF. */
  downloadSubmissionPdf(
    session: SessionData,
    projectId: number,
    taskDefId: number,
  ): Promise<DownloadResult> {
    return requestBinary(
      withApiPath(
        this.baseUrl,
        `projects/${projectId}/task_def_id/${taskDefId}/submission?as_attachment=true`,
      ),
      {
        method: 'GET',
        headers: {
          Accept: 'application/pdf, application/octet-stream, */*',
          ...authHeaders(this.activeSession(session)),
        },
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
    );
  }

  /** Lightweight GET probe used by discovery tooling to validate endpoint access. */
  async probeGet(session: SessionData, endpointPath: string): Promise<ProbeResult> {
    const endpoint = normalizeProbePath(endpointPath);
    const response = await fetchOnTrack(withFlexibleApiPath(this.baseUrl, endpoint), {
      method: 'GET',
      headers: {
        Accept: 'application/json, */*',
        ...authHeaders(this.activeSession(session)),
      },
    });

    return {
      endpoint,
      status: response.status,
      ok: response.ok,
    };
  }
}
