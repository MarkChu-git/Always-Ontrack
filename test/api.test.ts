import { afterEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import { OnTrackApiClient } from '../src/lib/api.js';
import { OnTrackHttpError } from '../src/lib/auth.js';
import type { SessionData } from '../src/lib/types.js';

const originalFetch = globalThis.fetch;

const session: SessionData = {
  baseUrl: 'https://ontrack.infotech.monash.edu/api',
  username: 'student1',
  authToken: 'token-123',
  savedAt: '2026-03-11T00:00:00.000Z',
  user: {
    id: 1,
    username: 'student1',
    role: 'student',
  },
};

function mockFetch(fn: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = fn as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('listTaskComments calls comments endpoint and includes auth headers', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  let requestedUrl = '';
  mockFetch(async (input, init) => {
    requestedUrl = String(input);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Auth-Token'), 'token-123');
    assert.equal(headers.get('Username'), 'student1');
    return new Response(
      JSON.stringify([
        { id: 1, comment: 'Looks good', createdAt: '2026-03-11T10:00:00.000Z' },
      ]),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  });

  const comments = await client.listTaskComments(session, 101, 501);
  assert.ok(requestedUrl.endsWith('/projects/101/task_def_id/501/comments'));
  assert.equal(comments.length, 1);
  assert.equal(comments[0].id, 1);
});

test('listTaskComments surfaces 401 errors', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  mockFetch(async () => {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'content-type': 'application/json' },
    });
  });

  await assert.rejects(() => client.listTaskComments(session, 101, 501), /401 Unauthorized/);
});

test('listInboxTasks surfaces 419 errors', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  mockFetch(async () => {
    return new Response('Session expired', {
      status: 419,
      statusText: 'Authentication Timeout',
      headers: { 'content-type': 'text/plain' },
    });
  });

  await assert.rejects(
    () => client.listInboxTasks(session, 55),
    /419 Authentication Timeout/,
  );
});

test('a rejected read refreshes once and the client reuses the replacement token', async () => {
  let requests = 0;
  let refreshes = 0;
  const replacement: SessionData = {
    ...session,
    authToken: 'replacement-token',
  };
  const client = new OnTrackApiClient(session.baseUrl, {
    refreshSession: async (failed) => {
      refreshes += 1;
      assert.equal(failed.authToken, 'token-123');
      return replacement;
    },
  });
  mockFetch(async (_input, init) => {
    requests += 1;
    const token = new Headers(init?.headers).get('Auth-Token');
    if (requests === 1) {
      assert.equal(token, 'token-123');
      return new Response('', { status: 419, statusText: 'Authentication Timeout' });
    }
    assert.equal(token, 'replacement-token');
    return new Response(JSON.stringify([{ id: 101 }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  assert.deepEqual(await client.listProjects(session), [{ id: 101 }]);
  assert.deepEqual(await client.listProjects(session), [{ id: 101 }]);
  assert.equal(requests, 3);
  assert.equal(refreshes, 1);
});

test('a rejected mutation is never refreshed or replayed', async () => {
  let requests = 0;
  let refreshes = 0;
  const client = new OnTrackApiClient(session.baseUrl, {
    refreshSession: async () => {
      refreshes += 1;
      return { ...session, authToken: 'replacement-token' };
    },
  });
  mockFetch(async () => {
    requests += 1;
    return new Response('', { status: 419, statusText: 'Authentication Timeout' });
  });

  await assert.rejects(
    () =>
      client.updateTaskTargetDates(
        session,
        101,
        501,
        '2026-08-01',
        '2026-08-10',
      ),
    /419 Authentication Timeout/,
  );
  assert.equal(requests, 1);
  assert.equal(refreshes, 0);
});

test('typed auth errors classify 401/419 and redact credential-like response details', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  mockFetch(async () => new Response(JSON.stringify({ error: 'auth_token=do-not-expose' }), {
    status: 419,
    statusText: 'Authentication Timeout',
    headers: { 'content-type': 'application/json' },
  }));

  await assert.rejects(
    () => client.listInboxTasks(session, 55),
    (error: unknown) => {
      assert.ok(error instanceof OnTrackHttpError);
      assert.equal(error.authFailure, 'expired');
      assert.equal(error.message.includes('do-not-expose'), false);
      return true;
    },
  );
});

test('remote errors never expose raw server response bodies', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  const canaries = [
    'student@example.edu',
    '0400 000 000',
    'Basic dXNlcjpwYXNz',
    'api_key=production-api-key',
  ];
  mockFetch(async () => new Response(canaries.join(' '), {
    status: 500,
    statusText: 'Internal Server Error',
    headers: { 'content-type': 'text/plain' },
  }));

  await assert.rejects(
    () => client.listProjects(session),
    (error: unknown) => {
      assert.ok(error instanceof OnTrackHttpError);
      assert.equal(error.message, '500 Internal Server Error');
      for (const canary of canaries) {
        assert.equal(error.message.includes(canary), false);
      }
      return true;
    },
  );
});

test('downloadTaskPdf returns binary payload', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  let requestedUrl = '';
  mockFetch(async (input) => {
    requestedUrl = String(input);
    return new Response(Uint8Array.from([0x25, 0x50, 0x44, 0x46]), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
      },
    });
  });

  const result = await client.downloadTaskPdf(session, 55, 501);
  assert.ok(requestedUrl.endsWith('/units/55/task_definitions/501/task_pdf.json?as_attachment=true'));
  assert.equal(result.contentType, 'application/pdf');
  assert.deepEqual([...result.buffer], [0x25, 0x50, 0x44, 0x46]);
});

test('downloadSubmissionPdf surfaces non-200 responses', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  mockFetch(async () => {
    return new Response('not found', {
      status: 404,
      statusText: 'Not Found',
      headers: { 'content-type': 'text/plain' },
    });
  });

  await assert.rejects(
    () => client.downloadSubmissionPdf(session, 101, 501),
    /404 Not Found/,
  );
});

test('uploadTaskSubmission sends multipart form with file keys and trigger', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  mockFetch(async (_input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(init?.method, 'POST');
    assert.equal(headers.get('Auth-Token'), 'token-123');
    assert.equal(headers.get('Username'), 'student1');

    const body = init?.body;
    assert.ok(body instanceof FormData);
    assert.equal(body.get('trigger'), 'need_help');

    const uploaded = body.get('file0');
    assert.ok(uploaded instanceof File);
    assert.equal(uploaded.name, 'report.pdf');
    assert.equal(uploaded.size, 3);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const result = await client.uploadTaskSubmission(
    session,
    101,
    501,
    [
      {
        key: 'file0',
        filename: 'report.pdf',
        content: Buffer.from('abc'),
      },
    ],
    { trigger: 'need_help' },
  );

  assert.deepEqual(result, { ok: true });
});

test('addTaskComment posts json payload', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  mockFetch(async (_input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(init?.method, 'POST');
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(headers.get('Auth-Token'), 'token-123');

    const body = JSON.parse(String(init?.body));
    assert.equal(body.comment, 'Please review this update.');

    return new Response(
      JSON.stringify({ id: 44, comment: 'Please review this update.' }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  });

  const comment = await client.addTaskComment(session, 101, 501, 'Please review this update.');
  assert.equal(comment.id, 44);
});

test('getSubmissionDetails reads the production submission details endpoint', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  let requestedUrl = '';
  mockFetch(async (input, init) => {
    requestedUrl = String(input);
    assert.equal(init?.method, 'GET');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Auth-Token'), 'token-123');
    return new Response(JSON.stringify({ has_pdf: true, processing_pdf: false, task_status: 'submitted' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const details = await client.getSubmissionDetails(session, 101, 501);
  assert.ok(requestedUrl.endsWith('/projects/101/task_def_id/501/submission_details'));
  assert.deepEqual(details, { has_pdf: true, processing_pdf: false, task_status: 'submitted' });
});

test('list prerequisite Interfaces use their distinct production paths', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  const requestedUrls: string[] = [];
  mockFetch(async (input, init) => {
    requestedUrls.push(String(input));
    assert.equal(init?.method, 'GET');
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  await client.listUnitTaskPrerequisites(session, 55);
  await client.listTaskPrerequisites(session, 55, 501);
  assert.ok(requestedUrls[0].endsWith('/units/55/task_prerequisites'));
  assert.ok(requestedUrls[1].endsWith('/units/55/task_definitions/501/prerequisites'));
});

test('planner mutations use verified PUT paths and exact JSON bodies without retrying', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  mockFetch(async (input, init) => {
    calls.push({ url: String(input), method: init?.method, body: init?.body ? String(init.body) : undefined });
    return new Response(JSON.stringify({ error: 'temporarily unavailable' }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'content-type': 'application/json' },
    });
  });

  await assert.rejects(
    () => client.updateTaskTargetDates(session, 101, 501, '2026-08-01', '2026-08-10'),
    /503 Service Unavailable/,
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/projects/101/task_def_id/501/target_dates'));
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].body, JSON.stringify({ target_start_date: '2026-08-01', target_due_date: '2026-08-10' }));
});

test('reset and plan mutation Interfaces preserve exact bodies', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  mockFetch(async (input, init) => {
    calls.push({ url: String(input), method: init?.method, body: init?.body ? String(init.body) : undefined });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  await client.resetProjectTargetDates(session, 101);
  await client.updateTaskPlan(session, 101, 501, { time_extension_days: 3 });
  assert.ok(calls[0].url.endsWith('/projects/101/reset_target_dates'));
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].body, undefined);
  assert.ok(calls[1].url.endsWith('/projects/101/task_def_id/501/plan'));
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].body, JSON.stringify({ extensions: { time_extension_days: 3 } }));
});

test('signOut uses the observed remember=false query contract', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  mockFetch(async (input, init) => {
    assert.equal(
      String(input),
      'https://ontrack.infotech.monash.edu/api/auth?remember=false',
    );
    assert.equal(init?.method, 'DELETE');
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  await client.signOut(session);
});
