import test from 'node:test';
import assert from 'node:assert/strict';
import { OnTrackApiClient } from '../src/lib/api.js';
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

test.afterEach(() => {
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

  await assert.rejects(() => client.listTaskComments(session, 101, 501), /401 Unauthorized: Unauthorized/);
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
    /419 Authentication Timeout: Session expired/,
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
    /404 Not Found: not found/,
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
