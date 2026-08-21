/**
 * Pairing-relay login for headless environments (VPS / SSH / CI).
 *
 * The CLI generates an ephemeral P-256 keypair and a one-time pairing code,
 * prints a pairing URL, and polls a blind relay mailbox. The user completes
 * the real OnTrack SSO in their own browser; a per-session bookmarklet (or
 * the pairing page's paste fallback) encrypts the captured credential to the
 * CLI's public key and drops it in the relay mailbox. The relay only ever
 * sees a mailbox hash and ciphertext.
 *
 * Protocol constants below are the CLI half of the contract shared with the
 * pairing page / bookmarklet in the ontrack-pair-relay repository:
 *   mailboxId = SHA-256 hex of the 16-char base32 pairing code
 *   ECIES     = ECDH P-256 -> HKDF-SHA256 (info HKDF_INFO) -> AES-256-GCM
 * Keep these in sync with public/index.html in ontrack-pair-relay.
 *
 * See docs/PAIRING_RELAY_LOGIN_PLAN.md for the full design.
 */
import { createHash, randomBytes } from 'node:crypto';

import type { CapturedLoginMaterial } from './login-finalize.js';
import type { CredentialContract } from './types.js';

/** Default public relay; overridable via --relay-url / ONTRACK_RELAY_URL. */
export const DEFAULT_RELAY_URL = 'https://pair.markchu.work';

/** HKDF domain-separation label; must match the pairing page implementation. */
const HKDF_INFO = 'ontrack-pair-v1';

const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'; // RFC 4648 base32, lowercase
const CODE_LENGTH = 16; // 80 bits of entropy
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_INTERVAL_MS = 2_000;

/** One generated pairing session: keys, code, mailbox, and the URL to print. */
export interface PairingSession {
  /** Human display form, grouped as XXXX-XXXX-XXXX-XXXX. */
  displayCode: string;
  /** Raw 16-char base32 code (goes into the pairing URL fragment). */
  code: string;
  /** SHA-256 hex of `code`; the only mailbox identifier the relay sees. */
  mailboxId: string;
  /** base64url(SPKI) of the CLI's ephemeral P-256 public key. */
  publicKeyBase64Url: string;
  /** CLI's ephemeral private key (non-exportable). */
  privateKey: CryptoKey;
  /** Relay base URL (no trailing slash). */
  relayUrl: string;
  /** Full pairing URL to show the user: `${relayUrl}/#c=<code>&k=<spki>`. */
  pairingUrl: string;
}

/** Credential payload sent by the browser side after encryption. */
export interface PairCredentialPayload {
  authToken: string;
  username: string;
  expiresAt?: string;
  /**
   * Which contract the browser side captured, when it knows. Bookmarklets that
   * predate this field say nothing, and the CLI then asks the server instead of
   * guessing (see finalizeCapturedLogin).
   */
  contract?: CredentialContract;
}

/** Relay envelope stored in the mailbox (all binary fields base64url). */
export interface RelayEnvelope {
  v: 1;
  /** base64url(SPKI) of the browser side's ephemeral P-256 public key. */
  eph: string;
  /** base64url(12-byte AES-GCM nonce). */
  nonce: string;
  /** base64url(AES-256-GCM ciphertext of JSON PairCredentialPayload). */
  ct: string;
}

/** Thrown when the pairing wait exceeds its deadline. */
export class PairLoginTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PairLoginTimeoutError';
  }
}

/** Thrown when the relay cannot be reached or answers unexpectedly. */
export class PairRelayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PairRelayUnavailableError';
  }
}

/** Thrown for invalid relay URL configuration (non-https, unparseable). */
export class RelayUrlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayUrlConfigError';
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/** Generate the 16-char base32 pairing code (80 bits, unambiguous alphabet). */
export function generatePairingCode(
  randomBytesImpl: (length: number) => Uint8Array = (length) =>
    new Uint8Array(randomBytes(length)),
): string {
  const bytes = randomBytesImpl(10); // 80 bits -> 16 base32 chars
  let bits = 0;
  let value = 0;
  let code = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      code += CODE_ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) {
    code += CODE_ALPHABET[(value << (5 - bits)) & 31];
  }
  return code.slice(0, CODE_LENGTH);
}

/** The only mailbox identifier the relay ever sees. */
export function deriveMailboxId(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** Group a raw code for display: XXXX-XXXX-XXXX-XXXX. */
export function formatDisplayCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

/** Resolve the relay base URL: flag > env > default; empty string disables. */
export function resolveRelayUrl(
  flagValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = flagValue ?? env.ONTRACK_RELAY_URL ?? DEFAULT_RELAY_URL;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new RelayUrlConfigError(`Invalid relay URL: ${trimmed}`);
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new RelayUrlConfigError(
      `Relay URL must use https (got ${url.protocol}).`,
    );
  }
  return url.origin + (url.pathname === '/' ? '' : url.pathname);
}

/** Generate the ephemeral keypair + code and assemble the pairing session. */
export async function generatePairingSession(
  relayUrl: string,
): Promise<PairingSession> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const code = generatePairingCode();
  const mailboxId = deriveMailboxId(code);
  const publicKeyBase64Url = base64UrlEncode(new Uint8Array(spki));
  const base = relayUrl.replace(/\/+$/, '');
  return {
    displayCode: formatDisplayCode(code),
    code,
    mailboxId,
    publicKeyBase64Url,
    privateKey: keyPair.privateKey,
    relayUrl: base,
    pairingUrl: `${base}/#c=${code}&k=${publicKeyBase64Url}`,
  };
}

/** Shared ECDH -> HKDF -> AES-256-GCM key derivation used by both directions. */
async function deriveSharedAesKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

async function importEcdhPublicKey(spki: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    spki as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
}

function validatePayload(payload: unknown): PairCredentialPayload | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (
    typeof record.authToken !== 'string' ||
    !record.authToken.trim() ||
    typeof record.username !== 'string' ||
    !record.username.trim()
  ) {
    return null;
  }
  return {
    authToken: record.authToken,
    username: record.username,
    ...(typeof record.expiresAt === 'string' && record.expiresAt.trim()
      ? { expiresAt: record.expiresAt }
      : {}),
    // An unrecognised contract is dropped rather than trusted, so a stale or
    // hostile payload cannot pick the exchange path on the CLI's behalf.
    ...(record.contract === 'access-token' || record.contract === 'legacy-auth'
      ? { contract: record.contract }
      : {}),
  };
}

/**
 * Browser-side reference implementation (pairing page / bookmarklet parity).
 * Exported so tests can run a full crypto round-trip without a real browser,
 * and so the ontrack-pair-relay page mirrors the exact same construction.
 */
export async function encryptForCli(
  cliPublicKeyBase64Url: string,
  payload: PairCredentialPayload,
): Promise<RelayEnvelope> {
  const cliPublicKey = await importEcdhPublicKey(
    base64UrlDecode(cliPublicKeyBase64Url),
  );
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const aesKey = await deriveSharedAesKey(ephemeral.privateKey, cliPublicKey, [
    'encrypt',
  ]);
  const nonce = new Uint8Array(randomBytes(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    aesKey,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const ephSpki = await crypto.subtle.exportKey('spki', ephemeral.publicKey);
  return {
    v: 1,
    eph: base64UrlEncode(new Uint8Array(ephSpki)),
    nonce: base64UrlEncode(nonce),
    ct: base64UrlEncode(new Uint8Array(ciphertext)),
  };
}

/** CLI-side decrypt; returns null for malformed or unauthentic envelopes. */
export async function decryptFromBrowser(
  privateKey: CryptoKey,
  envelope: unknown,
): Promise<PairCredentialPayload | null> {
  try {
    if (!envelope || typeof envelope !== 'object') {
      return null;
    }
    const record = envelope as Record<string, unknown>;
    if (
      record.v !== 1 ||
      typeof record.eph !== 'string' ||
      typeof record.nonce !== 'string' ||
      typeof record.ct !== 'string'
    ) {
      return null;
    }
    const peerPublicKey = await importEcdhPublicKey(base64UrlDecode(record.eph));
    const aesKey = await deriveSharedAesKey(privateKey, peerPublicKey, [
      'decrypt',
    ]);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlDecode(record.nonce) as BufferSource },
      aesKey,
      base64UrlDecode(record.ct) as BufferSource,
    );
    return validatePayload(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    // AES-GCM tag failure or malformed input: injected garbage, keep waiting.
    return null;
  }
}

export interface WaitForPairedCredentialsOptions {
  session: PairingSession;
  timeoutMs?: number;
  intervalMs?: number;
  /** Test seam: inject a mock fetch. */
  fetchImpl?: typeof fetch;
  /** Test seam: inject a mock sleep. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Progress callback with the remaining wait budget. */
  onProgress?: (remainingMs: number) => void;
  now?: () => number;
}

/**
 * Poll the relay mailbox until the browser side drops a valid envelope.
 * 404 means "not yet"; network/5xx failures abort with
 * PairRelayUnavailableError so the caller can fall back to manual capture;
 * undecryptable envelopes are ignored (garbage injection just keeps waiting).
 */
export async function waitForPairedCredentials(
  options: WaitForPairedCredentialsOptions,
): Promise<PairCredentialPayload> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl =
    options.sleepImpl ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;
  const mailboxUrl = `${options.session.relayUrl}/m/${options.session.mailboxId}`;
  const pause = (): Promise<void> =>
    sleepImpl(Math.min(intervalMs, Math.max(1, deadline - now())));

  for (;;) {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      throw new PairLoginTimeoutError(
        'Pairing timed out before the browser completed sign-in.',
      );
    }
    options.onProgress?.(remainingMs);

    let response: Response;
    try {
      // The relay base URL is trusted operator configuration (default constant,
      // --relay-url/ONTRACK_RELAY_URL override), restricted to https or loopback
      // in resolveRelayUrl; the mailbox id is a fixed-length hex hash.
      // codeql[js/request-forgery]
      response = await fetchImpl(mailboxUrl, { redirect: 'error' });
    } catch (error) {
      throw new PairRelayUnavailableError(
        `Relay request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (response.status === 404) {
      await pause();
      continue;
    }
    if (!response.ok) {
      throw new PairRelayUnavailableError(
        `Relay answered with HTTP ${response.status}.`,
      );
    }

    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      throw new PairRelayUnavailableError('Relay returned a non-JSON body.');
    }

    const payload = await decryptFromBrowser(
      options.session.privateKey,
      envelope,
    );
    if (payload) {
      return payload;
    }
    // Undecryptable garbage: someone posted to a guessed mailbox. Keep waiting.
    await pause();
  }
}

/** Convert a paired payload into the shared finalize-login material shape. */
export function capturedMaterialFromPairPayload(
  payload: PairCredentialPayload,
): CapturedLoginMaterial {
  return {
    authToken: payload.authToken,
    username: payload.username,
    ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
    ...(payload.contract ? { contract: payload.contract } : {}),
    source: 'pair-relay',
  };
}

export interface PairForCredentialsOptions {
  relayUrl: string;
  timeoutMs?: number;
  /** Called once the pairing session exists, so callers can show the link. */
  onPairingSession?: (session: PairingSession) => void;
  onProgress?: (remainingMs: number) => void;
  /** Test seams forwarded to waitForPairedCredentials. */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * Shared pairing orchestration used by both the CLI login command and the
 * TUI wizard: generate a session, surface it, wait for the browser side, and
 * return finalize-ready material.
 */
export async function pairForCredentials(
  options: PairForCredentialsOptions,
): Promise<CapturedLoginMaterial> {
  const session = await generatePairingSession(options.relayUrl);
  options.onPairingSession?.(session);
  const payload = await waitForPairedCredentials({
    session,
    timeoutMs: options.timeoutMs,
    onProgress: options.onProgress,
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
  });
  return capturedMaterialFromPairPayload(payload);
}
