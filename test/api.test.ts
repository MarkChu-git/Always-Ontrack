import { afterEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  contentDispositionFilename,
  InvalidPdfDownloadError,
  InvalidJsonResponseError,
  MAX_DOWNLOAD_BYTES,
  OnTrackApiClient,
  OversizedBinaryResponseError,
  OversizedJsonResponseError,
  UnavailableDownloadError,
  readBoundedResponseBody,
} from '../src/lib/api.js';
import { OnTrackHttpError, OnTrackTransportError } from '../src/lib/auth.js';
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

test('probeGet canonicalizes allowlisted paths and refuses uncatalogued paths before fetch', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  const requestedUrls: string[] = [];
  mockFetch(async (input, init) => {
    requestedUrls.push(String(input));
    assert.equal(init?.method, 'GET');
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const result = await client.probeGet(session, '/api/projects/101');
  assert.deepEqual(result, { endpoint: '/projects/101', status: 200, ok: true });
  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0] ?? '', /\/api\/projects\/101$/);

  await assert.rejects(
    () => client.probeGet(session, '/projects/101/reset_target_dates'),
    /not allowlisted/i,
  );
  assert.equal(requestedUrls.length, 1);
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

test('Agent feedback reads bound comment response bytes while legacy feedback reads remain available', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  const oversized = JSON.stringify([{ id: 1, comment: 'x'.repeat(512 * 1024) }]);

  mockFetch(async () =>
    new Response(oversized, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await assert.rejects(
    () => client.listTaskCommentsForAgent(session, 101, 501),
    (error: unknown) => error instanceof OversizedJsonResponseError,
  );

  mockFetch(async () =>
    new Response(oversized, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  assert.deepEqual(await client.listTaskComments(session, 101, 501), JSON.parse(oversized));
});

test('Agent feedback and catalogue reads forward a caller cancellation signal', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  const controller = new AbortController();
  const observedSignals: Array<AbortSignal | null | undefined> = [];
  mockFetch(async (_input, init) => {
    observedSignals.push(init?.signal);
    return new Response(JSON.stringify({ id: 101 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  await client.getProjectForAgent(session, 101, controller.signal);
  await client.getUnitForAgent(session, 55, controller.signal);
  await client.listTaskCommentsForAgent(session, 101, 501, controller.signal);

  assert.deepEqual(observedSignals, [controller.signal, controller.signal, controller.signal]);
});

test('Agent feedback reads abort a stalled transport through the caller signal', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  const controller = new AbortController();
  let observedSignal: AbortSignal | null | undefined;
  mockFetch(async (_input, init) => {
    observedSignal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true },
      );
    });
  });

  const pending = client.listTaskCommentsForAgent(
    session,
    101,
    501,
    controller.signal,
  );
  controller.abort();

  await assert.rejects(
    pending,
    (error: unknown) => error instanceof OnTrackTransportError,
  );
  assert.equal(observedSignal, controller.signal);
});

test('Agent project listing bounds declared and streamed JSON responses', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  const oversized = JSON.stringify([{ id: 1, value: 'x'.repeat(512 * 1024) }]);
  mockFetch(async () =>
    new Response(oversized, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(oversized)),
      },
    }),
  );
  await assert.rejects(
    () => client.listProjectsForAgent(session),
    (error: unknown) => error instanceof OversizedJsonResponseError,
  );

  mockFetch(async () =>
    new Response(oversized, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await assert.rejects(
    () => client.listProjectsForAgent(session),
    (error: unknown) => error instanceof OversizedJsonResponseError,
  );

  mockFetch(async () =>
    new Response(oversized, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  assert.deepEqual(await client.listProjects(session), JSON.parse(oversized));
});

test('Agent Student Task View detail reads are bounded while legacy detail reads remain available', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  const oversized = JSON.stringify({ id: 1, value: 'x'.repeat(512 * 1024) });

  for (const read of [
    () => client.getProjectForAgent(session, 101),
    () => client.getUnitForAgent(session, 55),
  ]) {
    mockFetch(async () =>
      new Response(oversized, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await assert.rejects(
      read,
      (error: unknown) => error instanceof OversizedJsonResponseError,
    );
  }

  mockFetch(async () =>
    new Response(oversized, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  assert.deepEqual(await client.getProject(session, 101), JSON.parse(oversized));

  mockFetch(async () =>
    new Response(oversized, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  assert.deepEqual(await client.getUnit(session, 55), JSON.parse(oversized));
});

test('read transport failures use a typed, body-free error', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  mockFetch(async () => {
    throw new Error('socket details must stay out of the protocol');
  });

  await assert.rejects(
    () => client.listProjects(session),
    (error: unknown) => {
      assert.ok(error instanceof OnTrackTransportError);
      assert.equal(error.message, 'The OnTrack transport request failed.');
      return true;
    },
  );
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
    return new Response(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
      },
    });
  });

  const result = await client.downloadTaskPdf(session, 55, 501);
  assert.ok(requestedUrl.endsWith('/units/55/task_definitions/501/task_pdf.json?as_attachment=true'));
  assert.equal(result.contentType, 'application/pdf');
  assert.deepEqual([...result.buffer], [0x25, 0x50, 0x44, 0x46, 0x2d]);
});

test('downloadTaskPdf rejects OnTrack FileNotFound.pdf placeholders', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  mockFetch(async () =>
    new Response(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': "attachment; filename*=UTF-8''FileNotFound.pdf",
      },
    }),
  );

  await assert.rejects(
    () => client.downloadTaskPdf(session, 55, 501),
    (error: unknown) => error instanceof UnavailableDownloadError,
  );
});

test('downloadTaskPdf rejects successful non-PDF payloads', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  mockFetch(async () =>
    new Response('<html>not a PDF</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  );

  await assert.rejects(
    () => client.downloadTaskPdf(session, 55, 501),
    (error: unknown) => error instanceof InvalidPdfDownloadError,
  );
});

test('downloadSubmissionPdf validates PDF responses while the compatibility adapter remains pass-through', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  const placeholder = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
  mockFetch(async () =>
    new Response(placeholder, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename=FileNotFound.pdf',
      },
    }),
  );
  await assert.rejects(
    () => client.downloadSubmissionPdf(session, 101, 501),
    (error: unknown) => error instanceof UnavailableDownloadError,
  );

  mockFetch(async () =>
    new Response('<html>not a PDF</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  );
  await assert.rejects(
    () => client.downloadSubmissionPdf(session, 101, 501),
    (error: unknown) => error instanceof InvalidPdfDownloadError,
  );

  mockFetch(async () =>
    new Response('<html>legacy payload</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  );
  const compatibility = await client.downloadSubmissionPdfForCompatibility(
    session,
    101,
    501,
  );
  assert.equal(compatibility.buffer.toString('utf8'), '<html>legacy payload</html>');
});

test('downloadTaskResources uses the production task-resource endpoint and returns ZIP bytes', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  let requestedUrl = '';
  mockFetch(async (input) => {
    requestedUrl = String(input);
    return new Response(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename=FIT0001-P1-TaskResources.zip',
      },
    });
  });

  const result = await client.downloadTaskResources(session, 55, 501);
  assert.ok(
    requestedUrl.endsWith(
      '/units/55/task_definitions/501/task_resources.json',
    ),
  );
  assert.equal(result.contentType, 'application/zip');
  assert.deepEqual([...result.buffer], [0x50, 0x4b, 0x03, 0x04]);
});

test('downloadTaskResources rejects a successful non-ZIP response', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  mockFetch(async () =>
    new Response('<html>not a ZIP</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  );

  await assert.rejects(
    () => client.downloadTaskResources(session, 55, 501),
    /non-ZIP task resource payload/,
  );
});

test('downloadTaskResources classifies OnTrack FileNotFound.pdf placeholders as unavailable', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  // The server serves the FileNotFound.pdf placeholder even from this endpoint.
  mockFetch(async () =>
    new Response(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': "attachment; filename*=UTF-8''FileNotFound.pdf",
      },
    }),
  );

  await assert.rejects(
    () => client.downloadTaskResources(session, 55, 501),
    (error: unknown) => {
      assert.ok(error instanceof UnavailableDownloadError);
      return true;
    },
  );
});

test('downloadTaskResources validates declared PDFs and passes other declared types through', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  mockFetch(async () =>
    new Response(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="week1-notes.pdf"',
      },
    }),
  );
  const pdf = await client.downloadTaskResources(session, 55, 501);
  assert.deepEqual([...pdf.buffer], [0x25, 0x50, 0x44, 0x46, 0x2d]);

  // A declared PDF whose bytes are not a PDF is still rejected.
  mockFetch(async () =>
    new Response('<html>not a PDF</html>', {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="week1-notes.pdf"',
      },
    }),
  );
  await assert.rejects(
    () => client.downloadTaskResources(session, 55, 501),
    (error: unknown) => error instanceof InvalidPdfDownloadError,
  );

  // Linked content resources keep their original type and pass through.
  mockFetch(async () =>
    new Response('{"cells": []}', {
      status: 200,
      headers: {
        'content-type': 'application/x-ipynb+json',
        'content-disposition': 'attachment; filename="lab 01.ipynb"',
      },
    }),
  );
  const notebook = await client.downloadTaskResources(session, 55, 501);
  assert.equal(notebook.buffer.toString('utf8'), '{"cells": []}');
});

test('downloadSubmissionPdf rejects the awaiting-processing placeholder', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  mockFetch(async () =>
    new Response(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename=AwaitingProcessing.pdf',
      },
    }),
  );

  await assert.rejects(
    () => client.downloadSubmissionPdf(session, 101, 501),
    (error: unknown) => error instanceof UnavailableDownloadError,
  );
});

test('binary downloads reassemble large files from 206 range chunks', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  const total = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, ...Array.from({ length: 25 }, (_, index) => index)]);
  const rangeRequests: string[] = [];
  mockFetch(async (input, init) => {
    void input;
    const rangeHeader = new Headers(init?.headers).get('range');
    if (!rangeHeader) {
      return new Response(total.slice(0, 10), {
        status: 206,
        headers: {
          'content-type': 'application/pdf',
          'content-range': 'bytes 0-9/30',
          'content-disposition': 'attachment; filename=big.pdf',
        },
      });
    }
    rangeRequests.push(rangeHeader);
    const start = Number(rangeHeader.replace('bytes=', '').split('-')[0]);
    const end = Math.min(start + 9, 29);
    return new Response(total.slice(start, end + 1), {
      status: 206,
      headers: {
        'content-type': 'application/pdf',
        'content-range': `bytes ${start}-${end}/30`,
      },
    });
  });

  const result = await client.downloadTaskPdf(session, 55, 501);
  assert.deepEqual([...result.buffer], [...total]);
  assert.deepEqual(rangeRequests, ['bytes=10-', 'bytes=20-']);
  assert.equal(result.contentDisposition, 'attachment; filename=big.pdf');
});

test('binary downloads reject inconsistent range continuations', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  let call = 0;
  mockFetch(async () => {
    call += 1;
    return new Response(Uint8Array.from([1, 2, 3]), {
      status: 206,
      headers: { 'content-range': 'bytes 0-2/10' },
    });
  });

  await assert.rejects(
    () => client.downloadTaskPdf(session, 55, 501),
    /inconsistent range/,
  );
  assert.ok(call > 1);
});

test('binary downloads reject partial responses without a content range', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  mockFetch(async () => new Response(Uint8Array.from([1, 2, 3]), { status: 206 }));

  await assert.rejects(
    () => client.downloadTaskPdf(session, 55, 501),
    /Content-Range/,
  );
});

test('contentDispositionFilename parses quoted and plain filename tokens', () => {
  assert.equal(
    contentDispositionFilename('attachment; filename="chapter 1.pdf"'),
    'chapter 1.pdf',
  );
  assert.equal(
    contentDispositionFilename('attachment; filename=P1-resources.zip'),
    'P1-resources.zip',
  );
  assert.equal(contentDispositionFilename('attachment'), undefined);
  assert.equal(contentDispositionFilename(undefined), undefined);
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

test('binary downloads reject an oversized declared response before buffering it', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  let cancelled = false;
  mockFetch(async () =>
    new Response(new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    }), {
      status: 200,
      headers: {
        'content-length': String(MAX_DOWNLOAD_BYTES + 1),
        'content-type': 'application/pdf',
      },
    }),
  );

  await assert.rejects(
    () => client.downloadTaskPdf(session, 55, 501),
    (error: unknown) => error instanceof OversizedBinaryResponseError,
  );
  assert.equal(cancelled, true);
});

test('binary response streams stop at the byte cap without buffering the full body', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from([1, 2]));
      controller.enqueue(Uint8Array.from([3, 4]));
      controller.close();
    },
  });

  await assert.rejects(
    () => readBoundedResponseBody(body, 3),
    /maximum allowed size/,
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

test('getSubmissionDetails rejects an oversized remote JSON response', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  const oversized = JSON.stringify({ value: 'x'.repeat(64 * 1024) });
  mockFetch(async () =>
    new Response(oversized, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(oversized)),
      },
    }),
  );

  await assert.rejects(
    () => client.getSubmissionDetails(session, 101, 501),
    (error: unknown) => error instanceof OversizedJsonResponseError,
  );
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

test('listUnitTaskPrerequisites bounds declared and streamed JSON responses', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  const oversized = JSON.stringify({ value: 'x'.repeat(512 * 1024) });
  mockFetch(async () =>
    new Response(oversized, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(oversized)),
      },
    }),
  );
  await assert.rejects(
    () => client.listUnitTaskPrerequisites(session, 55),
    (error: unknown) => error instanceof OversizedJsonResponseError,
  );

  mockFetch(async () =>
    new Response(oversized, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await assert.rejects(
    () => client.listUnitTaskPrerequisites(session, 55),
    (error: unknown) => error instanceof OversizedJsonResponseError,
  );
});

test('listTaskPrerequisites bounds declared and streamed JSON responses', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  const oversized = JSON.stringify({ value: 'x'.repeat(512 * 1024) });
  mockFetch(async () =>
    new Response(oversized, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(oversized)),
      },
    }),
  );
  await assert.rejects(
    () => client.listTaskPrerequisites(session, 55, 501),
    (error: unknown) => error instanceof OversizedJsonResponseError,
  );

  mockFetch(async () =>
    new Response(oversized, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await assert.rejects(
    () => client.listTaskPrerequisites(session, 55, 501),
    (error: unknown) => error instanceof OversizedJsonResponseError,
  );
});

test('successful invalid JSON is classified as a typed remote response failure', async () => {
  const client = new OnTrackApiClient(session.baseUrl);
  mockFetch(async () =>
    new Response('{"broken":', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await assert.rejects(
    () => client.listTaskPrerequisites(session, 55, 501),
    (error: unknown) => error instanceof InvalidJsonResponseError,
  );
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
  await client.updateTaskPlan(session, 101, 501, 3);
  assert.ok(calls[0].url.endsWith('/projects/101/reset_target_dates'));
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].body, undefined);
  assert.ok(calls[1].url.endsWith('/projects/101/task_def_id/501/plan'));
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].body, JSON.stringify({ extensions: 3 }));
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
