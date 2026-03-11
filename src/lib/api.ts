import type {
  AuthMethodResponse,
  FeedbackItem,
  InboxTask,
  ProjectSummary,
  SessionData,
  SignInResponse,
  UnitSummary,
} from './types.js';

type JsonBody = Record<string, unknown> | undefined;

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const DEFAULT_RETRY_ATTEMPTS = 2;

function methodOf(init: RequestInit): string {
  return (init.method || 'GET').toUpperCase();
}

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

function retryDelayMs(attempt: number): number {
  const base = 250;
  const backoff = base * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 120);
  return backoff + jitter;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function buildErrorMessage(response: Response, body: unknown): string {
  let message = `${response.status} ${response.statusText}`;
  if (typeof body === 'string' && body.trim()) {
    message = `${message}: ${body.trim()}`;
  } else if (body && typeof body === 'object' && 'error' in body) {
    message = `${message}: ${String(body.error)}`;
  }
  return message;
}

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

export interface DownloadResult {
  buffer: Buffer;
  contentType: string;
  contentDisposition?: string;
}

export interface ProbeResult {
  endpoint: string;
  status: number;
  ok: boolean;
}

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

function withApiPath(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ''), `${baseUrl}/`).toString();
}

function normalizeProbePath(path: string): string {
  if (!path.startsWith('/')) {
    return `/${path}`;
  }
  return path;
}

function withFlexibleApiPath(baseUrl: string, path: string): string {
  const normalized = normalizeProbePath(path);
  if (normalized.startsWith('/api/')) {
    return withApiPath(baseUrl, normalized.replace(/^\/api\//, ''));
  }
  return withApiPath(baseUrl, normalized);
}

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

  getAuthMethod(): Promise<AuthMethodResponse> {
    return requestJson<AuthMethodResponse>(withApiPath(this.baseUrl, 'auth/method'), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });
  }

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

  signOut(session: SessionData): Promise<unknown> {
    return requestJson(withApiPath(this.baseUrl, 'auth'), {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        ...authHeaders(session),
      },
    });
  }

  listProjects(session: SessionData): Promise<ProjectSummary[]> {
    return requestJson<ProjectSummary[]>(withApiPath(this.baseUrl, 'projects'), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders(session),
      },
    });
  }

  getProject(session: SessionData, projectId: number): Promise<ProjectSummary> {
    return requestJson<ProjectSummary>(withApiPath(this.baseUrl, `projects/${projectId}`), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders(session),
      },
    });
  }

  listUnits(session: SessionData): Promise<UnitSummary[]> {
    return requestJson<UnitSummary[]>(withApiPath(this.baseUrl, 'units'), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders(session),
      },
    });
  }

  getUnit(session: SessionData, unitId: number): Promise<UnitSummary> {
    return requestJson<UnitSummary>(withApiPath(this.baseUrl, `units/${unitId}`), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders(session),
      },
    });
  }

  listInboxTasks(session: SessionData, unitId: number): Promise<InboxTask[]> {
    return requestJson<InboxTask[]>(withApiPath(this.baseUrl, `units/${unitId}/tasks/inbox`), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders(session),
      },
    });
  }

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
