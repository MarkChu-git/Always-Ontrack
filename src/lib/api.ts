import type {
  AuthMethodResponse,
  FeedbackItem,
  InboxTask,
  ProjectSummary,
  RefreshCookieMaterial,
  SessionData,
  StudentStatusTrigger,
  SubmissionTrigger,
  SignInResponse,
  UnitSummary,
} from './types.js';
import { OnTrackHttpError, OnTrackTransportError } from './auth.js';
import { MAX_DOWNLOAD_BYTES } from './artifact-safety.js';
import { normalizeReadOnlyRoute } from './contracts.js';

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
const MAX_AGENT_PROJECTS_RESPONSE_BYTES = 512 * 1024;
const MAX_AGENT_PROJECT_RESPONSE_BYTES = 512 * 1024;
const MAX_AGENT_UNIT_RESPONSE_BYTES = 512 * 1024;
const MAX_AGENT_FEEDBACK_RESPONSE_BYTES = 512 * 1024;
const MAX_TASK_PREREQUISITES_RESPONSE_BYTES = 512 * 1024;
const MAX_SUBMISSION_DETAILS_RESPONSE_BYTES = 64 * 1024;

type AuthSessionRefresh = () => Promise<SessionData | null>;

/** Sign-in result together with any refresh cookie the server issued. */
export interface CapturedSignIn {
  response: SignInResponse;
  refreshCookie: RefreshCookieMaterial | null;
}

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
async function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException('The OnTrack request was aborted.', 'AbortError');
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    const abort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('The OnTrack request was aborted.', 'AbortError'));
    };
    function finish(): void {
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Build a status-only error; arbitrary remote bodies are never terminal-safe. */
function buildErrorMessage(response: Response): string {
  return `${response.status} ${response.statusText}`.trim();
}

/** Extract the OnTrack refresh-cookie pair from sign-in response headers. */
export function extractRefreshCookieFromHeaders(headers: Headers): RefreshCookieMaterial | null {
  let username: string | undefined;
  let refreshToken: string | undefined;
  let expiresAt: string | undefined;
  for (const entry of headers.getSetCookie()) {
    const [pair, ...attributes] = entry.split(';');
    const separator = pair.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = pair.slice(0, separator).trim().toLowerCase();
    const value = pair.slice(separator + 1).trim();
    if (name === 'username') {
      username = value;
    }
    if (name === 'refresh_token') {
      refreshToken = value;
      for (const attribute of attributes) {
        const [key, raw] = attribute.split('=');
        if (key.trim().toLowerCase() === 'expires' && raw) {
          const parsed = new Date(raw.trim());
          if (!Number.isNaN(parsed.getTime())) {
            expiresAt = parsed.toISOString();
          }
        }
      }
    }
  }
  if (!username || !refreshToken) {
    return null;
  }
  return { username, refreshToken, ...(expiresAt ? { expiresAt } : {}) };
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
    await wait(retryDelayMs(attempt), init.signal);
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
    if (error instanceof OversizedBinaryResponseError) {
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

/** Raised when a successful task-sheet response is not a PDF document. */
export class InvalidPdfDownloadError extends Error {
  constructor() {
    super('OnTrack returned a non-PDF task sheet payload.');
    this.name = 'InvalidPdfDownloadError';
  }
}

/** Raised when a successful task-resource response is not a ZIP archive. */
export class InvalidDownloadFormatError extends Error {
  constructor() {
    super('OnTrack returned a non-ZIP task resource payload.');
    this.name = 'InvalidDownloadFormatError';
  }
}

/** Raised when a remote binary response exceeds the download safety limit. */
export class OversizedBinaryResponseError extends Error {
  constructor(maxBytes: number) {
    super(`Binary response exceeds maximum allowed size of ${maxBytes} bytes.`);
    this.name = 'OversizedBinaryResponseError';
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

  // OnTrack's stream_file caps responses at 10 MB and answers large files with
  // 206 chunks; saving the first chunk alone would silently truncate the file.
  if (response.status === 206) {
    return readRangedDownload(url, init, response);
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new OversizedBinaryResponseError(MAX_DOWNLOAD_BYTES);
  }
  const buffer = await readBoundedResponseBody(response.body, MAX_DOWNLOAD_BYTES);
  return {
    buffer,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    contentDisposition: response.headers.get('content-disposition') || undefined,
  };
}

/** Parse a `Content-Range: bytes start-end/total` header from a 206 response. */
function parseContentRange(
  value: string | null,
): { start: number; end: number; total: number } | null {
  const match = value?.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
  if (!match) {
    return null;
  }
  return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
}

/** Reassemble a full download from OnTrack's 10 MB-capped 206 range responses. */
async function readRangedDownload(
  url: string,
  init: RequestInit,
  firstResponse: Response,
): Promise<DownloadResult> {
  const firstRange = parseContentRange(firstResponse.headers.get('content-range'));
  if (!firstRange || firstRange.start !== 0) {
    throw new Error('Remote returned a partial download without a valid Content-Range header.');
  }
  if (firstRange.total > MAX_DOWNLOAD_BYTES) {
    await firstResponse.body?.cancel().catch(() => undefined);
    throw new OversizedBinaryResponseError(MAX_DOWNLOAD_BYTES);
  }

  const chunks: Buffer[] = [await readBoundedResponseBody(firstResponse.body, MAX_DOWNLOAD_BYTES)];
  let received = firstRange.end + 1;
  while (received < firstRange.total) {
    const headers = new Headers(init.headers);
    headers.set('Range', `bytes=${received}-`);
    const next = await fetchOnTrack(url, { ...init, headers });
    if (!next.ok) {
      throw new OnTrackHttpError(next.status, buildErrorMessage(next));
    }
    const range = parseContentRange(next.headers.get('content-range'));
    if (
      !range ||
      range.start !== received ||
      range.total !== firstRange.total ||
      range.end < received
    ) {
      throw new Error('Remote returned an inconsistent range during a large download.');
    }
    chunks.push(await readBoundedResponseBody(next.body, firstRange.total - received));
    received = range.end + 1;
  }

  const buffer = Buffer.concat(chunks);
  if (buffer.length !== firstRange.total) {
    throw new Error('Remote returned fewer bytes than declared for a ranged download.');
  }
  return {
    buffer,
    contentType: firstResponse.headers.get('content-type') || 'application/octet-stream',
    contentDisposition: firstResponse.headers.get('content-disposition') || undefined,
  };
}

/** Extract the filename token from a Content-Disposition header (quoted or plain). */
export function contentDispositionFilename(disposition?: string): string | undefined {
  const match = disposition?.match(/(?:^|;)\s*filename\s*=\s*(?:"([^"]+)"|([^\s;]+))/i);
  return match?.[1] ?? match?.[2] ?? undefined;
}

/**
 * Reject OnTrack's HTTP-200 placeholders when the requested file is missing or
 * still processing. The server only ever serves FileNotFound.pdf or
 * AwaitingProcessing.pdf placeholders, even from the task_resources endpoint.
 */
function requireAvailableDownload(download: DownloadResult): DownloadResult {
  const disposition = download.contentDisposition ?? '';
  const placeholder =
    /(?:^|;)\s*filename\*?\s*=\s*(?:UTF-8'[^']*)?["']?(?:FileNotFound|AwaitingProcessing)\.pdf["']?(?:\s*;|$)/i;
  if (placeholder.test(disposition)) {
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

/**
 * Validate a task-resource payload against the type declared by the server
 * filename. Uploaded resources and extensionless payloads stay ZIP-validated;
 * linked content resources keep their original file type, so a declared PDF is
 * PDF-validated and other declared types pass through under their own names.
 */
function requireDeclaredResourceType(download: DownloadResult): DownloadResult {
  const filename = contentDispositionFilename(download.contentDisposition);
  const extension = filename?.match(/\.[A-Za-z0-9]{1,10}$/)?.[0]?.toLowerCase();
  if (extension === undefined || extension === '.zip') {
    return requireZipDownload(download);
  }
  if (extension === '.pdf') {
    return requirePdfDownload(download);
  }
  return download;
}

/** Validate the task-sheet PDF signature before persisting a remote response. */
function requirePdfDownload(download: DownloadResult): DownloadResult {
  const isPdf = download.buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (!isPdf) {
    throw new InvalidPdfDownloadError();
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
        throw new OversizedBinaryResponseError(maxBytes);
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
  /**
   * Exchange captured login payload for API credentials, retaining any refresh
   * cookie the server issues when the payload requested a persistent session.
   */
  async signInWithCookieCapture(payload: JsonBody): Promise<CapturedSignIn> {
    const response = await fetchOnTrack(withApiPath(this.baseUrl, 'auth'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new OnTrackHttpError(response.status, buildErrorMessage(response));
    }
    let body: SignInResponse;
    try {
      body = (await response.json()) as SignInResponse;
    } catch (error) {
      throw new InvalidJsonResponseError(error);
    }
    return {
      response: body,
      refreshCookie: extractRefreshCookieFromHeaders(response.headers),
    };
  }

  /** Exchange captured login payload for API auth token + user profile. */
  signIn(payload: JsonBody): Promise<SignInResponse> {
    return this.signInWithCookieCapture(payload).then((result) => result.response);
  }

  /**
   * Exchange a stored refresh cookie for a new access token. The server answers
   * 201 with an empty body when the cookie is missing or declined, so every
   * failure shape collapses to null for the caller.
   */
  async refreshAccessToken(cookie: {
    username: string;
    refreshToken: string;
  }): Promise<SignInResponse | null> {
    // Cookie values come from the local restricted store; strip anything that
    // could break header framing before they reach the Cookie header.
    const safeToken = cookie.refreshToken.replace(/[;\r\n]/g, '');
    const safeUsername = cookie.username.replace(/[;\r\n]/g, '');
    let response: Response;
    try {
      response = await fetchOnTrack(withApiPath(this.baseUrl, 'auth/access-token'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `refresh_token=${safeToken}; username=${safeUsername}`,
        },
      });
    } catch {
      return null;
    }
    if (!response.ok) {
      return null;
    }
    let body: unknown;
    try {
      const text = await response.text();
      if (!text.trim()) {
        return null;
      }
      body = JSON.parse(text);
    } catch {
      return null;
    }
    if (
      !body ||
      typeof body !== 'object' ||
      typeof (body as SignInResponse).auth_token !== 'string' ||
      !(body as SignInResponse).auth_token
    ) {
      return null;
    }
    return body as SignInResponse;
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

  private listProjectsWithLimit(
    session: SessionData,
    maxResponseBytes?: number,
  ): Promise<ProjectSummary[]> {
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
      false,
      maxResponseBytes,
    );
  }

  /** List projects visible to the authenticated account. */
  listProjects(session: SessionData): Promise<ProjectSummary[]> {
    return this.listProjectsWithLimit(session);
  }

  /** List projects through the bounded Agent discovery transport. */
  listProjectsForAgent(session: SessionData): Promise<ProjectSummary[]> {
    return this.listProjectsWithLimit(session, MAX_AGENT_PROJECTS_RESPONSE_BYTES);
  }

  private getProjectWithLimit(
    session: SessionData,
    projectId: number,
    maxResponseBytes?: number,
    signal?: AbortSignal,
  ): Promise<ProjectSummary> {
    return requestJson<ProjectSummary>(
      withApiPath(this.baseUrl, `projects/${projectId}`),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
        signal,
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
      false,
      maxResponseBytes,
    );
  }

  /** Fetch one project payload, usually including task instances. */
  getProject(session: SessionData, projectId: number): Promise<ProjectSummary> {
    return this.getProjectWithLimit(session, projectId);
  }

  /** Fetch one project through the bounded Student Task View transport. */
  getProjectForAgent(
    session: SessionData,
    projectId: number,
    signal?: AbortSignal,
  ): Promise<ProjectSummary> {
    return this.getProjectWithLimit(
      session,
      projectId,
      MAX_AGENT_PROJECT_RESPONSE_BYTES,
      signal,
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

  private getUnitWithLimit(
    session: SessionData,
    unitId: number,
    maxResponseBytes?: number,
    signal?: AbortSignal,
  ): Promise<UnitSummary> {
    return requestJson<UnitSummary>(
      withApiPath(this.baseUrl, `units/${unitId}`),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
        signal,
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
      false,
      maxResponseBytes,
    );
  }


  /** Fetch a single unit, often used to resolve task definition metadata. */
  getUnit(session: SessionData, unitId: number): Promise<UnitSummary> {
    return this.getUnitWithLimit(session, unitId);
  }

  /** Fetch one unit through the bounded Student Task View transport. */
  getUnitForAgent(
    session: SessionData,
    unitId: number,
    signal?: AbortSignal,
  ): Promise<UnitSummary> {
    return this.getUnitWithLimit(
      session,
      unitId,
      MAX_AGENT_UNIT_RESPONSE_BYTES,
      signal,
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
      false,
      MAX_TASK_PREREQUISITES_RESPONSE_BYTES,
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

  private listTaskCommentsWithLimit(
    session: SessionData,
    projectId: number,
    taskDefId: number,
    maxResponseBytes?: number,
    signal?: AbortSignal,
  ): Promise<FeedbackItem[]> {
    return requestJson<FeedbackItem[]>(
      withApiPath(this.baseUrl, `projects/${projectId}/task_def_id/${taskDefId}/comments`),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
        signal,
      },
      0,
      DEFAULT_RETRY_ATTEMPTS,
      this.authRefresh(session),
      false,
      maxResponseBytes,
    );
  }

  /** Read comments/events for one task definition in a project. */
  listTaskComments(session: SessionData, projectId: number, taskDefId: number): Promise<FeedbackItem[]> {
    return this.listTaskCommentsWithLimit(session, projectId, taskDefId);
  }

  /** Read comments through the bounded Agent feedback transport. */
  listTaskCommentsForAgent(
    session: SessionData,
    projectId: number,
    taskDefId: number,
    signal?: AbortSignal,
  ): Promise<FeedbackItem[]> {
    return this.listTaskCommentsWithLimit(
      session,
      projectId,
      taskDefId,
      MAX_AGENT_FEEDBACK_RESPONSE_BYTES,
      signal,
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

  /**
   * Trigger one task status transition. The server answers 200 with the task
   * entity even when it refuses the trigger, so callers must compare the
   * returned status against the requested one to detect a silent no-op.
   */
  updateTaskStatus(
    session: SessionData,
    projectId: number,
    taskDefId: number,
    trigger: StudentStatusTrigger,
  ): Promise<{ status?: string }> {
    return requestJson(
      withApiPath(this.baseUrl, `projects/${projectId}/task_def_id/${taskDefId}`),
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...authHeaders(this.activeSession(session)),
        },
        body: JSON.stringify({ trigger }),
      },
    );
  }

  /** Request a planner extension; the server contract is an integer week count. */
  updateTaskPlan(
    session: SessionData,
    projectId: number,
    taskDefId: number,
    extensionWeeks: number,
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
        body: JSON.stringify({ extensions: extensionWeeks }),
      },
    );
  }

  private requestTaskPdf(
    session: SessionData,
    unitId: number,
    taskDefId: number,
  ): Promise<DownloadResult> {
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

  /** Download and validate one Task Definition's task sheet PDF. */
  downloadTaskPdf(
    session: SessionData,
    unitId: number,
    taskDefId: number,
  ): Promise<DownloadResult> {
    return this.requestTaskPdf(session, unitId, taskDefId)
      .then(requireAvailableDownload)
      .then(requirePdfDownload);
  }

  /** Preserve the human CLI's established pass-through task-PDF download semantics. */
  downloadTaskPdfForCompatibility(
    session: SessionData,
    unitId: number,
    taskDefId: number,
  ): Promise<DownloadResult> {
    return this.requestTaskPdf(session, unitId, taskDefId);
  }

  /**
   * Download the resources attached to a task definition.
   * Uploaded resources arrive as a ZIP archive; linked content resources keep
   * their original file type. The endpoint always responds as an attachment,
   * so no as_attachment parameter exists for it.
   */
  downloadTaskResources(
    session: SessionData,
    unitId: number,
    taskDefId: number,
  ): Promise<DownloadResult> {
    return requestBinary(
      withApiPath(
        this.baseUrl,
        `units/${unitId}/task_definitions/${taskDefId}/task_resources.json`,
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
      .then(requireDeclaredResourceType);
  }

  private requestSubmissionPdf(
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

  /** Download and validate one submission snapshot PDF. */
  downloadSubmissionPdf(
    session: SessionData,
    projectId: number,
    taskDefId: number,
  ): Promise<DownloadResult> {
    return this.requestSubmissionPdf(session, projectId, taskDefId)
      .then(requireAvailableDownload)
      .then(requirePdfDownload);
  }

  /** Preserve the human CLI's established pass-through submission-PDF semantics. */
  downloadSubmissionPdfForCompatibility(
    session: SessionData,
    projectId: number,
    taskDefId: number,
  ): Promise<DownloadResult> {
    return this.requestSubmissionPdf(session, projectId, taskDefId);
  }

  /** Lightweight GET probe used by discovery tooling to validate endpoint access. */
  async probeGet(session: SessionData, endpointPath: string): Promise<ProbeResult> {
    const endpoint = normalizeReadOnlyRoute('GET', endpointPath).route;
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
