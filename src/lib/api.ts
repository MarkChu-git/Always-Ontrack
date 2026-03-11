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

/** Build concise, user-facing error details from HTTP response + body. */
function buildErrorMessage(response: Response, body: unknown): string {
  let message = `${response.status} ${response.statusText}`;
  if (typeof body === 'string' && body.trim()) {
    message = `${message}: ${body.trim()}`;
  } else if (body && typeof body === 'object' && 'error' in body) {
    message = `${message}: ${String(body.error)}`;
  }
  return message;
}

/** Perform JSON request/response handling with retry support. */
async function requestJson<T>(
  url: string,
  init: RequestInit,
  attempt: number = 0,
  maxRetries: number = DEFAULT_RETRY_ATTEMPTS,
): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok && shouldRetry(response, init, attempt, maxRetries)) {
    await wait(retryDelayMs(attempt));
    return requestJson<T>(url, init, attempt + 1, maxRetries);
  }

  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(buildErrorMessage(response, body));
  }

  return body as T;
}

/** Binary download shape returned by PDF endpoints. */
export interface DownloadResult {
  buffer: Buffer;
  contentType: string;
  contentDisposition?: string;
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
): Promise<DownloadResult> {
  const response = await fetch(url, init);

  if (!response.ok && shouldRetry(response, init, attempt, maxRetries)) {
    await wait(retryDelayMs(attempt));
    return requestBinary(url, init, attempt + 1, maxRetries);
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
    throw new Error(buildErrorMessage(response, body));
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    contentDisposition: response.headers.get('content-disposition') || undefined,
  };
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
  constructor(private readonly baseUrl: string) {}

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
    return requestJson(withApiPath(this.baseUrl, 'auth'), {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        ...authHeaders(session),
      },
    });
  }

  /** List projects visible to the authenticated account. */
  listProjects(session: SessionData): Promise<ProjectSummary[]> {
    return requestJson<ProjectSummary[]>(withApiPath(this.baseUrl, 'projects'), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders(session),
      },
    });
  }

  /** Fetch one project payload, usually including task instances. */
  getProject(session: SessionData, projectId: number): Promise<ProjectSummary> {
    return requestJson<ProjectSummary>(withApiPath(this.baseUrl, `projects/${projectId}`), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders(session),
      },
    });
  }

  /** List units; some roles may receive 403 (handled by caller fallback). */
  listUnits(session: SessionData): Promise<UnitSummary[]> {
    return requestJson<UnitSummary[]>(withApiPath(this.baseUrl, 'units'), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders(session),
      },
    });
  }

  /** Fetch a single unit, often used to resolve task definition metadata. */
  getUnit(session: SessionData, unitId: number): Promise<UnitSummary> {
    return requestJson<UnitSummary>(withApiPath(this.baseUrl, `units/${unitId}`), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders(session),
      },
    });
  }

  /** Inbox endpoint for a specific unit. */
  listInboxTasks(session: SessionData, unitId: number): Promise<InboxTask[]> {
    return requestJson<InboxTask[]>(withApiPath(this.baseUrl, `units/${unitId}/tasks/inbox`), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders(session),
      },
    });
  }

  /** Read comments/events for one task definition in a project. */
  listTaskComments(session: SessionData, projectId: number, taskDefId: number): Promise<FeedbackItem[]> {
    return requestJson<FeedbackItem[]>(
      withApiPath(this.baseUrl, `projects/${projectId}/task_def_id/${taskDefId}/comments`),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders(session),
        },
      },
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
          ...authHeaders(session),
        },
        body: JSON.stringify({ comment }),
      },
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
          ...authHeaders(session),
        },
        body: form,
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
          ...authHeaders(session),
        },
      },
    );
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
          ...authHeaders(session),
        },
      },
    );
  }

  /** Lightweight GET probe used by discovery tooling to validate endpoint access. */
  async probeGet(session: SessionData, endpointPath: string): Promise<ProbeResult> {
    const endpoint = normalizeProbePath(endpointPath);
    const response = await fetch(withFlexibleApiPath(this.baseUrl, endpoint), {
      method: 'GET',
      headers: {
        Accept: 'application/json, */*',
        ...authHeaders(session),
      },
    });

    return {
      endpoint,
      status: response.status,
      ok: response.ok,
    };
  }
}
