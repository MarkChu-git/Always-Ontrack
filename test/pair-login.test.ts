import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  capturedMaterialFromPairPayload,
  DEFAULT_RELAY_URL,
  decryptFromBrowser,
  deriveMailboxId,
  encryptForCli,
  formatDisplayCode,
  generatePairingCode,
  generatePairingSession,
  PairLoginTimeoutError,
  PairRelayUnavailableError,
  type RelayEnvelope,
  resolveRelayUrl,
  waitForPairedCredentials,
} from '../src/lib/pair-login.js';

const RELAY = 'https://pair.example.test';

function mockFetch(
  handler: (url: string) => Response | Promise<Response>,
): typeof fetch {
  return ((url: unknown) =>
    Promise.resolve(handler(String(url)))) as unknown as typeof fetch;
}

const noSleep = async (): Promise<void> => {};

test('generatePairingCode produces 16 base32 chars from the unambiguous alphabet', () => {
  const code = generatePairingCode();
  assert.equal(code.length, 16);
  assert.match(code, /^[a-z2-7]{16}$/);
});

test('generatePairingCode is deterministic with injected bytes', () => {
  const code = generatePairingCode((length) => new Uint8Array(length));
  assert.equal(code, 'aaaaaaaaaaaaaaaa');
});

test('deriveMailboxId is the SHA-256 hex of the raw code', () => {
  const code = 'abcdefghijklmnop';
  assert.equal(
    deriveMailboxId(code),
    createHash('sha256').update(code, 'utf8').digest('hex'),
  );
});

test('formatDisplayCode groups the code in four-char chunks', () => {
  assert.equal(formatDisplayCode('abcdefghijklmnop'), 'abcd-efgh-ijkl-mnop');
});

test('resolveRelayUrl prefers the flag, then env, then the default', () => {
  assert.equal(resolveRelayUrl(undefined, {}), DEFAULT_RELAY_URL);
  assert.equal(
    resolveRelayUrl(undefined, { ONTRACK_RELAY_URL: 'https://relay.env.test/' }),
    'https://relay.env.test',
  );
  assert.equal(
    resolveRelayUrl('https://relay.flag.test/', {
      ONTRACK_RELAY_URL: 'https://relay.env.test',
    }),
    'https://relay.flag.test',
  );
});

test('resolveRelayUrl treats an empty value as disabled', () => {
  assert.equal(resolveRelayUrl('', {}), null);
  assert.equal(
    resolveRelayUrl(undefined, { ONTRACK_RELAY_URL: '   ' }),
    null,
  );
});

test('resolveRelayUrl rejects non-https relays except loopback', () => {
  assert.throws(() => resolveRelayUrl('http://relay.example.test', {}), /https/);
  assert.equal(
    resolveRelayUrl('http://127.0.0.1:8787', {}),
    'http://127.0.0.1:8787',
  );
  assert.equal(
    resolveRelayUrl('http://localhost:8787', {}),
    'http://localhost:8787',
  );
  assert.throws(() => resolveRelayUrl('not a url', {}), /Invalid relay URL/);
});

test('generatePairingSession assembles code, mailbox, and pairing URL', async () => {
  const session = await generatePairingSession(RELAY);
  assert.match(session.code, /^[a-z2-7]{16}$/);
  assert.equal(session.mailboxId, deriveMailboxId(session.code));
  assert.equal(session.displayCode, formatDisplayCode(session.code));
  assert.equal(
    session.pairingUrl,
    `${RELAY}/#c=${session.code}&k=${session.publicKeyBase64Url}`,
  );
  assert.ok(session.privateKey);
});

test('ECIES round trip: encryptForCli -> decryptFromBrowser', async () => {
  const session = await generatePairingSession(RELAY);
  const envelope = await encryptForCli(session.publicKeyBase64Url, {
    authToken: 'token-123',
    username: 'student1',
    expiresAt: '2026-08-18T00:00:00.000Z',
  });
  assert.equal(envelope.v, 1);
  const payload = await decryptFromBrowser(session.privateKey, envelope);
  assert.deepEqual(payload, {
    authToken: 'token-123',
    username: 'student1',
    expiresAt: '2026-08-18T00:00:00.000Z',
  });
});

test('ECIES round trip without expiresAt omits the field', async () => {
  const session = await generatePairingSession(RELAY);
  const envelope = await encryptForCli(session.publicKeyBase64Url, {
    authToken: 'token-123',
    username: 'student1',
  });
  const payload = await decryptFromBrowser(session.privateKey, envelope);
  assert.deepEqual(payload, { authToken: 'token-123', username: 'student1' });
  assert.ok(!('expiresAt' in payload!));
});

test('decryptFromBrowser rejects envelopes encrypted to another key', async () => {
  const session = await generatePairingSession(RELAY);
  const other = await generatePairingSession(RELAY);
  const envelope = await encryptForCli(other.publicKeyBase64Url, {
    authToken: 'token-123',
    username: 'student1',
  });
  assert.equal(await decryptFromBrowser(session.privateKey, envelope), null);
});

test('decryptFromBrowser rejects malformed envelopes and payloads', async () => {
  const session = await generatePairingSession(RELAY);
  assert.equal(await decryptFromBrowser(session.privateKey, null), null);
  assert.equal(await decryptFromBrowser(session.privateKey, {}), null);
  assert.equal(
    await decryptFromBrowser(session.privateKey, {
      v: 2,
      eph: 'x',
      nonce: 'x',
      ct: 'x',
    }),
    null,
  );
  assert.equal(
    await decryptFromBrowser(session.privateKey, {
      v: 1,
      eph: '!!!not-base64!!!',
      nonce: 'x',
      ct: 'x',
    }),
    null,
  );
  // Valid envelope shape but garbage ciphertext fails the AES-GCM tag check.
  const good = await encryptForCli(session.publicKeyBase64Url, {
    authToken: 'token-123',
    username: 'student1',
  });
  const tampered: RelayEnvelope = { ...good, ct: good.ct.slice(0, -4) + 'AAAA' };
  assert.equal(await decryptFromBrowser(session.privateKey, tampered), null);
});

test('waitForPairedCredentials polls past 404s until a valid envelope arrives', async () => {
  const session = await generatePairingSession(RELAY);
  const envelope = await encryptForCli(session.publicKeyBase64Url, {
    authToken: 'token-123',
    username: 'student1',
  });
  const expectedUrl = `${RELAY}/m/${session.mailboxId}`;
  let calls = 0;
  const payload = await waitForPairedCredentials({
    session,
    fetchImpl: mockFetch((url) => {
      assert.equal(url, expectedUrl);
      calls += 1;
      return calls < 3
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(envelope), { status: 200 });
    }),
    sleepImpl: noSleep,
  });
  assert.equal(calls, 3);
  assert.deepEqual(payload, { authToken: 'token-123', username: 'student1' });
});

test('waitForPairedCredentials ignores undecryptable envelopes and keeps waiting', async () => {
  const session = await generatePairingSession(RELAY);
  const other = await generatePairingSession(RELAY);
  const garbage = await encryptForCli(other.publicKeyBase64Url, {
    authToken: 'wrong',
    username: 'wrong',
  });
  const valid = await encryptForCli(session.publicKeyBase64Url, {
    authToken: 'token-123',
    username: 'student1',
  });
  let calls = 0;
  const payload = await waitForPairedCredentials({
    session,
    fetchImpl: mockFetch(() => {
      calls += 1;
      return new Response(JSON.stringify(calls === 1 ? garbage : valid), {
        status: 200,
      });
    }),
    sleepImpl: noSleep,
  });
  assert.equal(calls, 2);
  assert.equal(payload.authToken, 'token-123');
});

test('waitForPairedCredentials times out when nothing valid arrives', async () => {
  const session = await generatePairingSession(RELAY);
  let tick = 0;
  await assert.rejects(
    waitForPairedCredentials({
      session,
      timeoutMs: 2_500,
      intervalMs: 1_000,
      fetchImpl: mockFetch(() => new Response(null, { status: 404 })),
      sleepImpl: noSleep,
      now: () => {
        tick += 500;
        return tick;
      },
    }),
    (error: unknown) => error instanceof PairLoginTimeoutError,
  );
});

test('waitForPairedCredentials aborts on relay 5xx and network failures', async () => {
  const session = await generatePairingSession(RELAY);
  await assert.rejects(
    waitForPairedCredentials({
      session,
      fetchImpl: mockFetch(
        () => new Response('boom', { status: 500 }),
      ),
      sleepImpl: noSleep,
    }),
    (error: unknown) =>
      error instanceof PairRelayUnavailableError &&
      /HTTP 500/.test(error.message),
  );
  await assert.rejects(
    waitForPairedCredentials({
      session,
      fetchImpl: (() =>
        Promise.reject(new Error('connection refused'))) as unknown as typeof fetch,
      sleepImpl: noSleep,
    }),
    (error: unknown) =>
      error instanceof PairRelayUnavailableError &&
      /connection refused/.test(error.message),
  );
});

test('waitForPairedCredentials aborts on a non-JSON 200 body', async () => {
  const session = await generatePairingSession(RELAY);
  await assert.rejects(
    waitForPairedCredentials({
      session,
      fetchImpl: mockFetch(() => new Response('<html>', { status: 200 })),
      sleepImpl: noSleep,
    }),
    PairRelayUnavailableError,
  );
});

test('capturedMaterialFromPairPayload maps to the finalize-login shape', () => {
  assert.deepEqual(
    capturedMaterialFromPairPayload({
      authToken: 'token-123',
      username: 'student1',
      expiresAt: '2026-08-18T00:00:00.000Z',
    }),
    {
      authToken: 'token-123',
      username: 'student1',
      expiresAt: '2026-08-18T00:00:00.000Z',
      source: 'pair-relay',
    },
  );
  assert.deepEqual(
    capturedMaterialFromPairPayload({
      authToken: 'token-123',
      username: 'student1',
    }),
    { authToken: 'token-123', username: 'student1', source: 'pair-relay' },
  );
  assert.deepEqual(
    capturedMaterialFromPairPayload({
      authToken: 'token-123',
      username: 'student1',
      contract: 'access-token',
    }),
    {
      authToken: 'token-123',
      username: 'student1',
      contract: 'access-token',
      source: 'pair-relay',
    },
  );
  assert.deepEqual(
    capturedMaterialFromPairPayload({
      authToken: 'token-123',
      username: 'student1',
      contract: 'access-token',
      exchangeToken: 'landing-url-token',
    }),
    {
      authToken: 'token-123',
      username: 'student1',
      contract: 'access-token',
      exchangeToken: 'landing-url-token',
      source: 'pair-relay',
    },
  );
});

test('decryptFromBrowser carries a forwarded login token and ignores a blank one', async () => {
  const session = await generatePairingSession(RELAY);
  const forwarded = await encryptForCli(session.publicKeyBase64Url, {
    authToken: 'token-123',
    username: 'student1',
    contract: 'access-token',
    exchangeToken: 'landing-url-token',
  });
  assert.equal(
    (await decryptFromBrowser(session.privateKey, forwarded))?.exchangeToken,
    'landing-url-token',
  );

  const blank = await encryptForCli(session.publicKeyBase64Url, {
    authToken: 'token-123',
    username: 'student1',
    exchangeToken: '   ',
  });
  const payload = await decryptFromBrowser(session.privateKey, blank);
  assert.deepEqual(payload, { authToken: 'token-123', username: 'student1' });
});

test('decryptFromBrowser keeps a known contract and drops an unknown one', async () => {
  const session = await generatePairingSession(RELAY);
  const declared = await encryptForCli(session.publicKeyBase64Url, {
    authToken: 'token-123',
    username: 'student1',
    contract: 'legacy-auth',
  });
  assert.equal(
    (await decryptFromBrowser(session.privateKey, declared))?.contract,
    'legacy-auth',
  );

  // A payload cannot talk the CLI into a contract it does not implement.
  const bogus = await encryptForCli(session.publicKeyBase64Url, {
    authToken: 'token-123',
    username: 'student1',
    contract: 'refresh-cookie' as never,
  });
  const payload = await decryptFromBrowser(session.privateKey, bogus);
  assert.deepEqual(payload, { authToken: 'token-123', username: 'student1' });
});
