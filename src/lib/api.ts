import type {
  AuthMethodResponse,
  ProjectSummary,
  SessionData,
  SignInResponse,
  UnitSummary,
} from './types.js';

type JsonBody = Record<string, unknown> | undefined;

async function requestJson<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    if (typeof body === 'string' && body.trim()) {
      message = `${message}: ${body.trim()}`;
    } else if (body && typeof body === 'object' && 'error' in body) {
      message = `${message}: ${String(body.error)}`;
    }
    throw new Error(message);
  }

  return body as T;
}

function withApiPath(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ''), `${baseUrl}/`).toString();
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

  listUnits(session: SessionData): Promise<UnitSummary[]> {
    return requestJson<UnitSummary[]>(withApiPath(this.baseUrl, 'units'), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders(session),
      },
    });
  }
}

