import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { Frame, Locator, Page } from 'playwright-core';

/**
 * Browser automation flow for Monash SSO / Okta handoff.
 *
 * Responsibilities:
 * - drive guided username/password entry when requested
 * - detect MFA method selection and number challenge states
 * - capture final OnTrack credentials from URL/auth payload/cookies/storage
 * - classify failures into explicit fallback reasons
 */
export interface LoginCredentials {
  authToken: string;
  username: string;
  source: 'url' | 'auth_request' | 'auth_response' | 'local_storage' | 'cookie';
}

/** Guided SSO options for username/password + MFA interaction mode. */
export interface SsoLoginOptions {
  ssoUrl: string;
  apiBaseUrl: string;
  username: string;
  password: string;
  timeoutMs?: number;
  headless?: boolean;
  chooseMfaMethod?: (options: MfaMethodOption[]) => Promise<number | null | undefined>;
  onMfaNumberChallenge?: (numbers: string[]) => void;
}

/** One CLI-presented MFA option extracted from page controls. */
export interface MfaMethodOption {
  id: number;
  label: string;
  recommended?: boolean;
}

/** High-level guided login lifecycle steps used by terminal callbacks. */
export type SsoStep = 'username' | 'password' | 'mfa_select' | 'mfa_wait' | 'completed' | 'fallback';

/** Categorized fallback reasons surfaced to callers and users. */
export type SsoFallbackReason =
  | 'captcha'
  | 'unsupported_mfa'
  | 'selector_missing'
  | 'timeout'
  | 'browser_unavailable'
  | 'automation_error';

/** Typed fallback error carrying reason + stage for better UX messaging. */
export class SsoFallbackError extends Error {
  constructor(
    readonly reason: SsoFallbackReason,
    readonly step: SsoStep,
    message: string,
  ) {
    super(message);
    this.name = 'SsoFallbackError';
  }
}

/** Browser launch strategy selected at runtime. */
export interface BrowserLaunchPlan {
  source: 'env' | 'system' | 'bundled';
  executablePath?: string;
}

/** Type guard for non-empty string-like values. */
function hasValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Extract authToken/username directly from redirect URL query params. */
export function extractCredentialsFromUrl(urlValue: string): LoginCredentials | null {
  try {
    const url = new URL(urlValue);
    const authToken = url.searchParams.get('authToken');
    const username = url.searchParams.get('username');
    if (!hasValue(authToken) || !hasValue(username)) {
      return null;
    }
    return {
      authToken,
      username,
      source: 'url',
    };
  } catch {
    return null;
  }
}

/** Parse `/api/auth` request/response payload variants into common credential shape. */
export function extractCredentialsFromAuthPayload(payload: unknown): LoginCredentials | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const authToken = hasValue(record.auth_token)
    ? record.auth_token
    : hasValue(record.authToken)
      ? record.authToken
      : null;
  const username = hasValue(record.username) ? record.username : null;

  if (!authToken || !username) {
    return null;
  }

  return {
    authToken,
    username,
    source: 'auth_request',
  };
}

/** Extract credentials from cookies for cases where URL/network interception misses. */
export function extractCredentialsFromCookieJar(
  cookies: Array<{ name: string; value: string }>,
): LoginCredentials | null {
  const find = (names: string[]): string | undefined => {
    for (const name of names) {
      const hit = cookies.find((cookie) => cookie.name === name);
      if (hit?.value) {
        return hit.value;
      }
    }
    return undefined;
  };

  const authToken = find(['authToken', 'auth_token', 'Auth-Token']);
  const username = find(['username', 'Username']);
  if (!authToken || !username) {
    return null;
  }

  return {
    authToken,
    username,
    source: 'cookie',
  };
}

/** Candidate local browser locations by platform (used before bundled Chromium). */
function candidateBrowserPaths(): string[] {
  const paths: string[] = [];
  if (process.env.ONTRACK_BROWSER_PATH) {
    paths.push(process.env.ONTRACK_BROWSER_PATH);
  }

  if (process.platform === 'darwin') {
    paths.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    );
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    const programFiles = process.env.PROGRAMFILES;
    const programFilesX86 = process.env['PROGRAMFILES(X86)'];
    const windowsCandidates = [
      local ? join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
      programFiles ? join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
      programFilesX86
        ? join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
      programFiles
        ? join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        : undefined,
      programFilesX86
        ? join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        : undefined,
    ].filter((item): item is string => Boolean(item));
    paths.push(...windowsCandidates);
  } else {
    paths.push(
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/opt/google/chrome/chrome',
      '/opt/microsoft/msedge/msedge',
    );
  }

  return paths;
}

/** Select browser launch strategy: explicit env path > system browser > bundled. */
export function resolveBrowserLaunchPlan(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
): BrowserLaunchPlan {
  const explicitBrowser = env.ONTRACK_BROWSER_PATH?.trim();
  if (explicitBrowser) {
    if (!fileExists(explicitBrowser)) {
      throw new SsoFallbackError(
        'browser_unavailable',
        'fallback',
        `ONTRACK_BROWSER_PATH points to a missing executable: ${explicitBrowser}`,
      );
    }
    return {
      source: 'env',
      executablePath: explicitBrowser,
    };
  }

  for (const path of candidateBrowserPaths()) {
    if (fileExists(path)) {
      return {
        source: 'system',
        executablePath: path,
      };
    }
  }

  return {
    source: 'bundled',
  };
}

/** Human-readable remediation when no launchable browser is found. */
function browserInstallHint(): string {
  return (
    'No browser executable found. Install Chrome/Chromium/Edge, or run "npx playwright install chromium", ' +
    'or set ONTRACK_BROWSER_PATH.'
  );
}

/** Detect launch failures caused by missing X/Wayland display servers. */
function isMissingDisplayServerError(message: string): boolean {
  return /missing x server|\$display|headed browser without having a xserver|ozone_platform_x11|platform failed to initialize/i.test(
    message,
  );
}

/** Detect launch failures caused by missing shared system libraries. */
function isMissingSharedLibraryError(message: string): boolean {
  return /error while loading shared libraries|cannot open shared object file/i.test(message);
}

/** Detect errors indicating that Playwright Chromium binary is not installed yet. */
function isMissingBrowserBinaryError(message: string): boolean {
  return /executable doesn't exist|please run .*playwright install|browser executable.+not found/i.test(
    message,
  );
}

/** Run one shell command and capture compact output for diagnostics. */
async function runCommand(command: string, args: string[], timeoutMs: number): Promise<{
  ok: boolean;
  output: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: process.env,
    });

    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', (error) => {
      output += `${error instanceof Error ? error.message : String(error)}\n`;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          ok: false,
          output: `${output}\nCommand timed out after ${timeoutMs}ms.`,
        });
        return;
      }
      resolve({
        ok: code === 0,
        output,
      });
    });
  });
}

/** Best-effort automatic installer for Playwright Chromium browser binaries. */
async function autoInstallChromiumBrowser(): Promise<{
  ok: boolean;
  detail: string;
}> {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const attempts: Array<{ command: string; args: string[]; note: string }> = [
    {
      command: npx,
      args: ['--yes', 'playwright', 'install', 'chromium'],
      note: 'npx playwright install chromium',
    },
    {
      command: npx,
      args: ['--yes', 'playwright', 'install', '--with-deps', 'chromium'],
      note: 'npx playwright install --with-deps chromium',
    },
  ];

  let lastDetail = '';
  for (const attempt of attempts) {
    const result = await runCommand(attempt.command, attempt.args, 10 * 60 * 1000);
    const compactOutput = result.output.trim().slice(-2000);
    if (result.ok) {
      return {
        ok: true,
        detail: `${attempt.note} succeeded.`,
      };
    }
    lastDetail = `${attempt.note} failed.\n${compactOutput}`;
  }

  return {
    ok: false,
    detail: lastDetail || 'Automatic install failed.',
  };
}

/** Map unknown automation failures to high-level fallback reasons for CLI messaging. */
export function classifySsoFallback(error: unknown): SsoFallbackReason {
  if (error instanceof SsoFallbackError) {
    return error.reason;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('captcha')) {
    return 'captcha';
  }
  if (message.includes('unsupported mfa') || message.includes('webauthn') || message.includes('email')) {
    return 'unsupported_mfa';
  }
  if (message.includes('selector') || message.includes('username field') || message.includes('password field')) {
    return 'selector_missing';
  }
  if (message.includes('timeout')) {
    return 'timeout';
  }
  if (message.includes('browser')) {
    return 'browser_unavailable';
  }
  return 'automation_error';
}

/** Safe JSON parsing helper for intercepted request/response payloads. */
function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Attempt to recover credentials from OnTrack localStorage session payload. */
async function extractCredentialsFromLocalStorage(page: {
  evaluate: (fn: () => unknown) => Promise<unknown>;
}): Promise<LoginCredentials | null> {
  try {
    const data = await page.evaluate(() => {
      try {
        return localStorage.getItem('doubtfire_user');
      } catch {
        return null;
      }
    });

    if (!hasValue(data)) {
      return null;
    }

    const parsed = tryParseJson(data);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const authToken = hasValue(record.authenticationToken)
      ? record.authenticationToken
      : hasValue(record.auth_token)
        ? record.auth_token
        : null;
    const username = hasValue(record.username) ? record.username : null;
    if (!authToken || !username) {
      return null;
    }

    return {
      authToken,
      username,
      source: 'local_storage',
    };
  } catch {
    return null;
  }
}

/** Browser-assisted capture options used by non-guided SSO mode. */
export interface AutoLoginOptions {
  ssoUrl: string;
  apiBaseUrl: string;
  timeoutMs?: number;
  headless?: boolean;
}

// Username selector list spans Okta + Microsoft + generic IdP form variants.
const USERNAME_SELECTORS = [
  'input#okta-signin-username',
  'input#username',
  'input#userNameInput',
  'input#i0116',
  'input[name="identifier"]',
  'input[name="loginfmt"]',
  'input[name="username"]',
  'input[name="user"]',
  'input[autocomplete="username"]',
  'input[type="email"]',
];

// Password selector list spans Okta + Microsoft + generic password input variants.
const PASSWORD_SELECTORS = [
  'input#okta-signin-password',
  'input#password',
  'input#passwordInput',
  'input#i0118',
  'input[name="password"]',
  'input[name="passwd"]',
  'input[autocomplete="current-password"]',
  'input[type="password"]',
];

// Submit controls used after filling credentials.
const PRIMARY_SUBMIT_SELECTORS = [
  'input#okta-signin-submit',
  '#idSIButton9',
  'button[type="submit"]',
  'input[type="submit"]',
  'button[name="action"]',
  'button[data-type="save"]',
];

// SSO entry controls used on landing pages that require an extra click into IdP.
const SSO_ENTRY_SELECTORS = [
  'a[href*="sso"]',
  'a[href*="monashuni.okta.com"]',
  'a[href*="saml"]',
  'button[id*="sso"]',
  'button[class*="sso"]',
  'button[data-sso]',
];

// Label-based fallback for SSO entry when selectors are unstable.
const SSO_ENTRY_LABELS = [
  'monash',
  'single sign',
  'sso',
  'continue',
  'sign in',
  'log in',
  'next',
];

const USERNAME_CONTINUE_LABELS = ['next', 'continue', 'sign in', 'log in', 'verify'];
const PASSWORD_SUBMIT_LABELS = ['sign in', 'log in', 'verify', 'continue', 'next'];
const MFA_SELECT_BUTTON_LABEL = /select/i;
const MFA_OPTION_LABEL_CLEANUP = /\bselect\b/gi;
const KNOWN_MFA_METHODS: Array<{ pattern: RegExp; label: string; recommended?: boolean }> = [
  {
    pattern: /get a push notification/i,
    label: 'Get a push notification (Okta Verify)',
    recommended: true,
  },
  {
    pattern: /enter a code/i,
    label: 'Enter a code (Okta Verify)',
  },
  {
    pattern: /google authenticator/i,
    label: 'Google Authenticator',
  },
];

const BLOCKED_LINK_HOSTS = new Set([
  'okta.com',
  'www.okta.com',
]);

/** Convert unknown thrown values into printable message text. */
function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Snapshot page locations for timeout diagnostics and fallback hints. */
function summarizePageLocations(pages: Page[]): string {
  const locations: string[] = [];
  for (const page of pages) {
    try {
      const url = new URL(page.url());
      locations.push(`${url.origin}${url.pathname}`);
    } catch {
      // skip invalid/intermediate URL
    }
  }

  if (locations.length === 0) {
    return '(no stable page URL)';
  }

  return [...new Set(locations)].join(', ');
}

type InteractionScope = Page | Frame;

interface ScopeRef {
  page: Page;
  scope: InteractionScope;
}

interface DetectedMfaOption {
  scopeRef: ScopeRef;
  control: Locator;
  label: string;
  recommended: boolean;
}

interface GuidedSsoRuntimeState {
  usernameSubmitted: boolean;
  passwordSubmitted: boolean;
  sawUsernameField: boolean;
  sawPasswordField: boolean;
  ssoEntryClicked: boolean;
  mfaWaitNotified: boolean;
  sawOktaVerifyChallenge: boolean;
  mfaSelectionDone: boolean;
  mfaSelectionPrompted: boolean;
  lastMfaChallengeNumbersKey?: string;
}

// Candidate nodes that often contain Okta number-challenge UI digits.
const MFA_CHALLENGE_NUMBER_SELECTORS = [
  '[data-se*="number-challenge"]',
  '[data-se*="numberChallenge"]',
  '[data-se*="challenge-number"]',
  '[data-se*="factor-number"]',
  '[data-se*="okta-verify-number"]',
  '[class*="number-challenge"]',
  '[id*="number-challenge"]',
  '[class*="challenge-number"]',
  '[id*="challenge-number"]',
].join(', ');

// Text signal used to decide whether nearby numbers are MFA challenge values.
const MFA_CHALLENGE_TEXT_SIGNAL =
  /number challenge|following number|enter the number|tap the number|okta verify|approve sign in|push notification/i;
const MFA_CHALLENGE_NUMBER_TOKEN = /\b\d{1,3}\b/g;

/** Collect main page plus all child frames for resilient selector scanning. */
function collectScopes(page: Page): ScopeRef[] {
  const refs: ScopeRef[] = [{ page, scope: page }];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) {
      continue;
    }
    refs.push({ page, scope: frame });
  }
  return refs;
}

/** True when selector exists and is visibly interactable in a given scope. */
async function canUseSelector(scope: InteractionScope, selector: string): Promise<boolean> {
  const locator = scope.locator(selector).first();
  try {
    const count = await locator.count();
    if (count === 0) {
      return false;
    }
    return await locator.isVisible({ timeout: 500 });
  } catch {
    return false;
  }
}

/** Fill the first visible field among selector candidates. */
async function fillFirstVisible(
  scopes: ScopeRef[],
  selectors: string[],
  value: string,
): Promise<boolean> {
  for (const selector of selectors) {
    for (const scopeRef of scopes) {
      if (!(await canUseSelector(scopeRef.scope, selector))) {
        continue;
      }
      await scopeRef.scope.locator(selector).first().fill(value);
      return true;
    }
  }
  return false;
}

/** Click button/link controls by likely action labels (next/continue/sign in). */
async function clickLikelyActionControl(scopes: ScopeRef[], labels: string[]): Promise<boolean> {
  for (const label of labels) {
    const matcher = new RegExp(label, 'i');
    for (const scopeRef of scopes) {
      for (const role of ['button', 'link'] as const) {
        const controls = scopeRef.scope.getByRole(role, { name: matcher });
        const count = await controls.count();
        for (let index = 0; index < count; index += 1) {
          const control = controls.nth(index);
          try {
            if (!(await control.isVisible({ timeout: 300 }))) {
              continue;
            }

            if (role === 'link') {
              const href = await control.getAttribute('href');
              const currentUrl = scopeRef.page.url();
              if (!isSafeActionLink(currentUrl, href)) {
                continue;
              }
            }

            await control.click();
            return true;
          } catch {
            // continue scanning
          }
        }
      }
    }
  }
  return false;
}

/** Guard link clicks to avoid navigation into unrelated marketing/support pages. */
function isSafeActionLink(currentUrl: string, href: string | null): boolean {
  if (!href) {
    return false;
  }

  try {
    const current = new URL(currentUrl);
    const target = new URL(href, current);
    const host = target.hostname.toLowerCase();

    if (BLOCKED_LINK_HOSTS.has(host)) {
      return false;
    }

    if (host === current.hostname.toLowerCase()) {
      return true;
    }

    if (host.endsWith('.okta.com')) {
      return true;
    }

    if (host.endsWith('.microsoftonline.com')) {
      return true;
    }

    if (host.includes('monash')) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/** Click first visible selector match across all scopes. */
async function clickFirstVisible(scopes: ScopeRef[], selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    for (const scopeRef of scopes) {
      if (!(await canUseSelector(scopeRef.scope, selector))) {
        continue;
      }

      const control = scopeRef.scope.locator(selector).first();
      if (selector.startsWith('a[')) {
        try {
          const href = await control.getAttribute('href');
          if (!isSafeActionLink(scopeRef.page.url(), href)) {
            continue;
          }
        } catch {
          continue;
        }
      }

      await control.click();
      return true;
    }
  }
  return false;
}

/** Detect text signals (captcha, mfa prompts, etc.) across page/frame scopes. */
async function hasTextSignal(scopes: ScopeRef[], pattern: RegExp): Promise<boolean> {
  for (const scopeRef of scopes) {
    try {
      const node = scopeRef.scope.getByText(pattern).first();
      if (await node.isVisible({ timeout: 150 })) {
        return true;
      }
    } catch {
      // continue
    }
  }
  return false;
}

/** Detect captcha interstitials that require immediate fallback to manual flow. */
async function detectSsoCaptcha(scopes: ScopeRef[]): Promise<boolean> {
  return (
    (await hasTextSignal(scopes, /captcha|prove you are human|i am human|recaptcha/i)) ||
    (await canUseSelectorInScopes(scopes, 'iframe[src*="recaptcha"], div.g-recaptcha'))
  );
}

/** Detect MFA methods intentionally unsupported in v1 guided automation. */
async function detectUnsupportedMfa(scopes: ScopeRef[]): Promise<boolean> {
  if (await hasTextSignal(scopes, /security key|webauthn|passkey/i)) {
    return true;
  }
  if (
    await canUseSelectorInScopes(
      scopes,
      [
        '[data-se*="webauthn"]',
        '[data-se*="security_key"]',
        '[data-se*="sms"]',
        '[data-se*="email"]',
      ].join(', '),
    )
  ) {
    return true;
  }
  if (await hasTextSignal(scopes, /use a security key|verify with sms|verification code via sms/i)) {
    return true;
  }
  return false;
}

/** Detect Okta Verify push/number challenge surfaces. */
async function detectOktaVerifyChallenge(scopes: ScopeRef[]): Promise<boolean> {
  return (
    (await hasTextSignal(scopes, /okta verify|check your okta verify app|number challenge/i)) ||
    (await canUseSelectorInScopes(
      scopes,
      '[data-se*="okta_verify"], [data-se*="factor-push"], [data-se*="factor-number"]',
    ))
  );
}

/** Deduplicate values while preserving first-seen ordering. */
function uniqueInOrder(values: string[]): string[] {
  const unique = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (unique.has(value)) {
      continue;
    }
    unique.add(value);
    out.push(value);
  }
  return out;
}

/** Extract candidate short numeric tokens from free-form challenge text. */
function extractNumberTokens(text: string): string[] {
  const matches = text.match(MFA_CHALLENGE_NUMBER_TOKEN);
  if (!matches) {
    return [];
  }
  return matches;
}

/** Detect whether a text fragment looks like MFA number-challenge instructions. */
function hasMfaChallengeSignal(text: string): boolean {
  return MFA_CHALLENGE_TEXT_SIGNAL.test(text);
}

/** Parse 1-3 challenge numbers from mixed MFA text blocks. */
export function extractMfaNumberChallengeFromText(text: string): string[] {
  if (!text.trim()) {
    return [];
  }

  const normalized = text.replace(/\r/g, '\n');
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const found: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (hasMfaChallengeSignal(line)) {
      found.push(...extractNumberTokens(line));
      for (let offset = 1; offset <= 3; offset += 1) {
        const nextLine = lines[index + offset];
        if (!nextLine) {
          break;
        }
        const nextLineTokens = extractNumberTokens(nextLine);
        if (/^\d{1,3}$/.test(nextLine) || nextLineTokens.length >= 2) {
          found.push(...nextLineTokens);
        }
      }
      continue;
    }

    if (!/^\d{1,3}$/.test(line)) {
      continue;
    }

    const previous = lines[index - 1] ?? '';
    const next = lines[index + 1] ?? '';
    if (hasMfaChallengeSignal(previous) || hasMfaChallengeSignal(next)) {
      found.push(line);
    }
  }

  if (found.length === 0 && hasMfaChallengeSignal(normalized)) {
    found.push(...extractNumberTokens(normalized));
  }

  return uniqueInOrder(found).slice(0, 3);
}

/** Aggregate challenge numbers from body text plus likely challenge DOM nodes. */
async function extractMfaNumberChallenge(scopes: ScopeRef[]): Promise<string[]> {
  const textCandidates: string[] = [];

  for (const scopeRef of scopes) {
    try {
      const body = scopeRef.scope.locator('body').first();
      if ((await body.count()) > 0) {
        const bodyText = await body.innerText({ timeout: 150 });
        if (bodyText.trim()) {
          textCandidates.push(bodyText);
        }
      }
    } catch {
      // ignore inaccessible body content
    }

    try {
      const challengeNodes = scopeRef.scope.locator(MFA_CHALLENGE_NUMBER_SELECTORS);
      const count = Math.min(await challengeNodes.count(), 12);
      for (let index = 0; index < count; index += 1) {
        const node = challengeNodes.nth(index);
        try {
          if (!(await node.isVisible({ timeout: 75 }))) {
            continue;
          }
          const text = (await node.innerText({ timeout: 75 })).trim();
          if (text) {
            textCandidates.push(text);
          }
        } catch {
          // skip individual inaccessible node
        }
      }
    } catch {
      // ignore selector errors
    }
  }

  const collected: string[] = [];
  for (const text of textCandidates) {
    collected.push(...extractMfaNumberChallengeFromText(text));
  }

  return uniqueInOrder(collected).slice(0, 3);
}

/** Scope-aware selector existence check. */
async function canUseSelectorInScopes(scopes: ScopeRef[], selector: string): Promise<boolean> {
  for (const scopeRef of scopes) {
    if (await canUseSelector(scopeRef.scope, selector)) {
      return true;
    }
  }
  return false;
}

/** True when any selector in a set can be used in any active scope. */
async function hasAnySelectorInScopes(scopes: ScopeRef[], selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    if (await canUseSelectorInScopes(scopes, selector)) {
      return true;
    }
  }
  return false;
}

/** Normalize noisy MFA labels into stable user-facing option text. */
function normalizeMfaLabel(raw: string): string {
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '';
  }

  const pushMatch = compact.match(/get a push notification/i);
  if (pushMatch) {
    return 'Get a push notification (Okta Verify)';
  }

  const codeMatch = compact.match(/enter a code/i);
  if (codeMatch) {
    return 'Enter a code (Okta Verify)';
  }

  const gaMatch = compact.match(/google authenticator/i);
  if (gaMatch) {
    return 'Google Authenticator';
  }

  return compact
    .replace(MFA_OPTION_LABEL_CLEANUP, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escape user-facing strings for dynamic RegExp construction. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract best-effort MFA option label from control and nearby container text. */
async function extractMfaOptionLabel(control: Locator): Promise<string> {
  try {
    const label = await control.evaluate((element) => {
      const pickByPattern = (text: string): string => {
        const patterns = [
          /get a push notification(?:\s+okta verify)?/i,
          /enter a code(?:\s+okta verify)?/i,
          /google authenticator/i,
        ];
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match?.[0]) {
            return match[0];
          }
        }
        return '';
      };

      let node: HTMLElement | null = element as HTMLElement;
      let best = '';
      let depth = 0;
      while (node && depth < 8) {
        const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
        const patterned = pickByPattern(text);
        if (patterned) {
          return patterned;
        }
        if (text.length > best.length && text.length <= 400) {
          best = text;
        }
        node = node.parentElement;
        depth += 1;
      }
      return best;
    });
    return normalizeMfaLabel(label);
  } catch {
    return '';
  }
}

/** Collect controls that appear to perform MFA method selection ("Select"). */
async function collectSelectControls(scopeRef: ScopeRef): Promise<Locator[]> {
  const controls: Locator[] = [];

  const roleButtons = scopeRef.scope.getByRole('button', { name: MFA_SELECT_BUTTON_LABEL });
  const roleButtonCount = await roleButtons.count();
  for (let index = 0; index < roleButtonCount; index += 1) {
    controls.push(roleButtons.nth(index));
  }

  const roleLinks = scopeRef.scope.getByRole('link', { name: MFA_SELECT_BUTTON_LABEL });
  const roleLinkCount = await roleLinks.count();
  for (let index = 0; index < roleLinkCount; index += 1) {
    controls.push(roleLinks.nth(index));
  }

  const inputControls = scopeRef.scope.locator('input[type="submit"], input[type="button"]');
  const inputCount = await inputControls.count();
  for (let index = 0; index < inputCount; index += 1) {
    const control = inputControls.nth(index);
    try {
      const value =
        (await control.inputValue().catch(() => '')) ||
        (await control.getAttribute('value')) ||
        '';
      if (!MFA_SELECT_BUTTON_LABEL.test(value)) {
        continue;
      }
      controls.push(control);
    } catch {
      // ignore inaccessible controls
    }
  }

  return controls;
}

/** Find first enabled/visible action control in an MFA option container row. */
async function findVisibleActionControl(container: Locator): Promise<Locator | null> {
  const candidates = [
    container.getByRole('button'),
    container.getByRole('link'),
    container.locator('button, a[role="button"], input[type="submit"], input[type="button"]'),
  ];

  for (const group of candidates) {
    const count = Math.min(await group.count(), 10);
    for (let index = 0; index < count; index += 1) {
      const control = group.nth(index);
      try {
        if (!(await control.isVisible({ timeout: 100 }))) {
          continue;
        }
        if ((await control.getAttribute('disabled')) !== null) {
          continue;
        }
        return control;
      } catch {
        // skip inaccessible controls
      }
    }
  }

  return null;
}

/** Count how many known MFA method labels appear in a text block. */
function countKnownMfaMethodMentions(text: string): number {
  let count = 0;
  for (const method of KNOWN_MFA_METHODS) {
    if (method.pattern.test(text)) {
      count += 1;
    }
  }
  return count;
}

/** Discover MFA options by scanning known method labels and adjacent controls. */
async function collectKnownMfaMethodOptions(scopes: ScopeRef[]): Promise<DetectedMfaOption[]> {
  const options: DetectedMfaOption[] = [];

  for (const scopeRef of scopes) {
    for (const method of KNOWN_MFA_METHODS) {
      const matches = scopeRef.scope.getByText(method.pattern);
      const count = Math.min(await matches.count(), 8);
      for (let index = 0; index < count; index += 1) {
        const matchedNode = matches.nth(index);
        try {
          if (!(await matchedNode.isVisible({ timeout: 100 }))) {
            continue;
          }
        } catch {
          continue;
        }

        const row = matchedNode.locator(
          'xpath=ancestor-or-self::*[self::div or self::li or self::tr or self::section or self::form][1]',
        );

        let rowText = '';
        try {
          rowText = (await row.innerText({ timeout: 100 })).replace(/\s+/g, ' ').trim();
        } catch {
          // use matched node if row text is unavailable
        }

        if (rowText && countKnownMfaMethodMentions(rowText) > 1) {
          continue;
        }

        const control = await findVisibleActionControl(row);
        if (!control) {
          continue;
        }

        options.push({
          scopeRef,
          control,
          label: method.label,
          recommended: Boolean(method.recommended),
        });
      }
    }
  }

  return options;
}

/** Discover selectable MFA options via generic "Select" controls + known-label fallback. */
async function collectMfaSelectionOptions(scopes: ScopeRef[]): Promise<DetectedMfaOption[]> {
  const options: DetectedMfaOption[] = [];
  for (const scopeRef of scopes) {
    const controls = await collectSelectControls(scopeRef);
    for (const control of controls) {
      try {
        if (!(await control.isVisible({ timeout: 150 }))) {
          continue;
        }
      } catch {
        continue;
      }

      const label = await extractMfaOptionLabel(control);
      if (!label) {
        continue;
      }

      options.push({
        scopeRef,
        control,
        label,
        recommended: /push notification|okta verify push|push/i.test(label),
      });
    }
  }

  options.push(...(await collectKnownMfaMethodOptions(scopes)));

  const unique = new Map<string, DetectedMfaOption>();
  for (const option of options) {
    const key = option.label.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, option);
    }
  }
  return [...unique.values()];
}

/** Click a detected MFA option with layered fallback click strategies. */
async function clickDetectedMfaOption(option: DetectedMfaOption): Promise<boolean> {
  try {
    if (await option.control.isVisible({ timeout: 300 })) {
      await option.control.click({ timeout: 1500, force: true });
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    await option.control.evaluate((element) => {
      (element as HTMLElement).click();
    });
    return true;
  } catch {
    // fallback below
  }

  const coreLabel = option.label.replace(/\s*\(.*?\)\s*$/, '').trim();
  const labelPattern = new RegExp(escapeRegex(coreLabel), 'i');
  const row = option.scopeRef.scope.locator('div, li, tr, section, form').filter({ hasText: labelPattern }).first();

  try {
    const rowButtons = row.getByRole('button', { name: MFA_SELECT_BUTTON_LABEL });
    if ((await rowButtons.count()) > 0) {
      await rowButtons.first().click({ timeout: 1500, force: true });
      return true;
    }
  } catch {
    // continue fallback
  }

  try {
    const rowInputs = row.locator('input[type="submit"], input[type="button"]');
    if ((await rowInputs.count()) > 0) {
      await rowInputs.first().click({ timeout: 1500, force: true });
      return true;
    }
  } catch {
    // continue fallback
  }

  return false;
}

/** Detect MFA choices, ask CLI callback for selection, then click chosen option. */
async function maybeHandleMfaMethodSelection(
  scopes: ScopeRef[],
  state: GuidedSsoRuntimeState,
  chooseMfaMethod: ((options: MfaMethodOption[]) => Promise<number | null | undefined>) | undefined,
  onStep?: (step: SsoStep) => void,
): Promise<boolean> {
  if (state.mfaSelectionDone) {
    return false;
  }

  const detectedOptions = await collectMfaSelectionOptions(scopes);
  if (detectedOptions.length === 0) {
    return false;
  }

  onStep?.('mfa_select');

  const presentedOptions: MfaMethodOption[] = detectedOptions.map((option, index) => ({
    id: index + 1,
    label: option.label,
    recommended: option.recommended,
  }));

  const defaultOption =
    presentedOptions.find((item) => item.recommended) ??
    presentedOptions[0];
  if (!defaultOption) {
    return false;
  }
  let selectedId = defaultOption.id;

  if (chooseMfaMethod && !state.mfaSelectionPrompted) {
    state.mfaSelectionPrompted = true;
    try {
      const chosen = await chooseMfaMethod(presentedOptions);
      if (typeof chosen === 'number' && presentedOptions.some((item) => item.id === chosen)) {
        selectedId = chosen;
      }
    } catch {
      // keep default recommended path
    }
  }

  const selectedOption = detectedOptions[selectedId - 1];
  if (!selectedOption) {
    return false;
  }
  const clicked = await clickDetectedMfaOption(selectedOption);
  if (clicked) {
    state.mfaSelectionDone = true;
    return true;
  }

  return false;
}

/** Submit current auth step via selector, label-driven click, or Enter fallback. */
async function submitAfterFieldFill(scopes: ScopeRef[], labels: string[]): Promise<boolean> {
  const submittedBySelector = await clickFirstVisible(scopes, PRIMARY_SUBMIT_SELECTORS);
  if (submittedBySelector) {
    return true;
  }

  const submittedByLabel = await clickLikelyActionControl(scopes, labels);
  if (submittedByLabel) {
    return true;
  }

  const enterTargets = [...PASSWORD_SELECTORS, ...USERNAME_SELECTORS];
  for (const selector of enterTargets) {
    for (const scopeRef of scopes) {
      if (!(await canUseSelector(scopeRef.scope, selector))) {
        continue;
      }
      try {
        await scopeRef.scope.locator(selector).first().press('Enter');
        return true;
      } catch {
        // continue
      }
    }
  }

  return false;
}

/**
 * Execute one guided-SSO progression tick:
 * - enter username/password when fields are visible
 * - handle MFA method selection UI
 * - detect and emit number-challenge updates
 */
async function advanceGuidedSsoOnPage(
  page: Page,
  username: string,
  password: string,
  state: GuidedSsoRuntimeState,
  chooseMfaMethod: ((options: MfaMethodOption[]) => Promise<number | null | undefined>) | undefined,
  onMfaNumberChallenge: ((numbers: string[]) => void) | undefined,
  onStep?: (step: SsoStep) => void,
): Promise<void> {
  const scopes = collectScopes(page);

  if (!state.ssoEntryClicked) {
    const clickedEntry =
      (await clickFirstVisible(scopes, SSO_ENTRY_SELECTORS)) ||
      (await clickLikelyActionControl(scopes, SSO_ENTRY_LABELS));
    if (clickedEntry) {
      state.ssoEntryClicked = true;
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 4000 });
      } catch {
        // continue with current state
      }
      return;
    }
  }

  if (!state.usernameSubmitted) {
    const hasUsernameField = await hasAnySelectorInScopes(scopes, USERNAME_SELECTORS);
    if (hasUsernameField) {
      state.sawUsernameField = true;
    }

    const usernameFilled = await fillFirstVisible(scopes, USERNAME_SELECTORS, username);
    if (usernameFilled) {
      onStep?.('username');
      state.usernameSubmitted = await submitAfterFieldFill(scopes, USERNAME_CONTINUE_LABELS);
      if (!state.usernameSubmitted) {
        state.usernameSubmitted = true;
      }
    }
  }

  if (!state.passwordSubmitted) {
    const hasPasswordField = await hasAnySelectorInScopes(scopes, PASSWORD_SELECTORS);
    if (hasPasswordField) {
      state.sawPasswordField = true;
    }

    const passwordFilled = await fillFirstVisible(scopes, PASSWORD_SELECTORS, password);
    if (passwordFilled) {
      onStep?.('password');
      state.passwordSubmitted = await submitAfterFieldFill(scopes, PASSWORD_SUBMIT_LABELS);
      if (!state.passwordSubmitted) {
        state.passwordSubmitted = true;
      }
    }
  }

  if (!state.mfaWaitNotified) {
    const handledSelection = await maybeHandleMfaMethodSelection(
      scopes,
      state,
      chooseMfaMethod,
      onStep,
    );
    if (handledSelection) {
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 2000 });
      } catch {
        // keep polling
      }
      return;
    }
  }

  const sawChallenge = await detectOktaVerifyChallenge(scopes);
  if (sawChallenge) {
    state.sawOktaVerifyChallenge = true;
  }

  if (state.sawOktaVerifyChallenge) {
    const numbers = await extractMfaNumberChallenge(scopes);
    if (numbers.length > 0) {
      const key = numbers.join('|');
      if (key !== state.lastMfaChallengeNumbersKey) {
        state.lastMfaChallengeNumbersKey = key;
        onMfaNumberChallenge?.(numbers);
      }
    }

    if (!state.mfaWaitNotified) {
      state.mfaWaitNotified = true;
      onStep?.('mfa_wait');
      return;
    }
  }

  if (state.usernameSubmitted || state.passwordSubmitted) {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 2000 });
    } catch {
      // keep polling
    }
  }
}

/** Launch playwright chromium with best-available executable resolution. */
async function launchBrowserForCapture(options: {
  headless: boolean;
}): Promise<{
  browser: Awaited<ReturnType<(typeof import('playwright-core'))['chromium']['launch']>>;
  plan: BrowserLaunchPlan;
}> {
  let playwrightModule: typeof import('playwright-core');
  try {
    playwrightModule = await import('playwright-core');
  } catch {
    throw new SsoFallbackError(
      'browser_unavailable',
      'fallback',
      'Auto login requires dependency "playwright-core". Install the CLI with dependencies and retry.',
    );
  }

  const plan = resolveBrowserLaunchPlan();
  const launchArgs =
    plan.executablePath !== undefined
      ? {
          headless: options.headless,
          executablePath: plan.executablePath,
        }
      : {
          headless: options.headless,
        };

  let installAttempted = false;
  while (true) {
    try {
      const browser = await playwrightModule.chromium.launch(launchArgs);
      return {
        browser,
        plan,
      };
    } catch (error) {
      const detail = asErrorMessage(error);
      const canAutoInstall =
        !installAttempted &&
        (isMissingBrowserBinaryError(detail) ||
          (plan.source === 'bundled' && isMissingSharedLibraryError(detail)));

      if (canAutoInstall) {
        installAttempted = true;
        const installed = await autoInstallChromiumBrowser();
        if (installed.ok) {
          continue;
        }
        throw new SsoFallbackError(
          'browser_unavailable',
          'fallback',
          `Browser runtime is missing and auto-install failed. ${installed.detail}`,
        );
      }

      if (isMissingDisplayServerError(detail)) {
        throw new SsoFallbackError(
          'browser_unavailable',
          'fallback',
          'No display server found ($DISPLAY). Use default headless mode, or run with xvfb-run if you need --show-browser.',
        );
      }

      if (isMissingSharedLibraryError(detail)) {
        throw new SsoFallbackError(
          'browser_unavailable',
          'fallback',
          'Browser dependencies are missing on this system. Install OS libraries or run "npx playwright install --with-deps chromium".',
        );
      }

      if (plan.source === 'bundled') {
        throw new SsoFallbackError(
          'browser_unavailable',
          'fallback',
          `${browserInstallHint()} (${detail})`,
        );
      }
      throw new SsoFallbackError(
        'browser_unavailable',
        'fallback',
        `Unable to launch browser at "${plan.executablePath}": ${detail}`,
      );
    }
  }
}

/**
 * Core capture loop:
 * - optionally drives guided SSO interactions
 * - observes pages/requests/responses for credentials
 * - falls back with typed errors when flow cannot be automated
 */
async function captureSsoCredentialsInternal(
  options: AutoLoginOptions,
  guidedLogin?: {
    username: string;
    password: string;
    onStep?: (step: SsoStep) => void;
    chooseMfaMethod?: (options: MfaMethodOption[]) => Promise<number | null | undefined>;
    onMfaNumberChallenge?: (numbers: string[]) => void;
  },
): Promise<LoginCredentials> {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;

  // Browser launch plan supports env override, system browser, then bundled Chromium.
  const launch = await launchBrowserForCapture({
    headless: options.headless ?? false,
  });
  const browser = launch.browser;

  // New isolated browser context avoids leaking cookies between login attempts.
  const context = await browser.newContext();
  const page = await context.newPage();
  const seenPages = new Set<Page>();
  const targetOrigin = new URL(options.apiBaseUrl).origin;
  let captured: LoginCredentials | null = null;

  const setCaptured = (value: LoginCredentials | null): void => {
    // Capture first valid credential source and ignore later duplicates.
    if (!captured && value) {
      captured = value;
    }
  };

  const registerPage = (currentPage: Page): void => {
    if (seenPages.has(currentPage)) {
      return;
    }
    seenPages.add(currentPage);

    // Immediate URL check covers flows where auth token appears in address bar.
    setCaptured(extractCredentialsFromUrl(currentPage.url()));

    currentPage.on('framenavigated', () => {
      // Re-check URL after every navigation in case redirect carries token.
      setCaptured(extractCredentialsFromUrl(currentPage.url()));
    });

    currentPage.on('request', (...args: unknown[]) => {
      const request = args[0] as {
        method: () => string;
        url: () => string;
        postData: () => string | null;
      };

      if (request.method() !== 'POST') {
        return;
      }
      if (!request.url().includes('/api/auth')) {
        return;
      }

      const payload = request.postData();
      if (!payload) {
        return;
      }
      const parsed = tryParseJson(payload);
      const maybe = extractCredentialsFromAuthPayload(parsed);
      setCaptured(maybe);
    });

    currentPage.on('response', (...args: unknown[]) => {
      void (async () => {
        if (captured) {
          return;
        }

        const response = args[0] as {
          url: () => string;
          status: () => number;
          json: () => Promise<unknown>;
        };
        if (!response.url().includes('/api/auth') || response.status() >= 400) {
          return;
        }

        try {
          const body = await response.json();
          const parsed = extractCredentialsFromAuthPayload(body);
          if (parsed) {
            setCaptured({
              ...parsed,
              source: 'auth_response',
            });
          }
        } catch {
          // ignore non-json responses
        }
      })();
    });
  };

  registerPage(page);
  context.on('page', (newPage: Page) => registerPage(newPage));

  try {
    await page.goto(options.ssoUrl, { waitUntil: 'domcontentloaded' });
    const start = Date.now();
    let sawOktaVerifyChallenge = false;
    const guidedState: GuidedSsoRuntimeState | null = guidedLogin
      ? {
          usernameSubmitted: false,
          passwordSubmitted: false,
          sawUsernameField: false,
          sawPasswordField: false,
          ssoEntryClicked: false,
          mfaWaitNotified: false,
          sawOktaVerifyChallenge: false,
          mfaSelectionDone: false,
          mfaSelectionPrompted: false,
          lastMfaChallengeNumbersKey: undefined,
        }
      : null;

    while (!captured && Date.now() - start < timeoutMs) {
      for (const openPage of context.pages()) {
        if (captured) {
          break;
        }

        const scopes = collectScopes(openPage);

        if (guidedLogin && guidedState) {
          // Guided mode actively interacts with fields/buttons every polling cycle.
          await advanceGuidedSsoOnPage(
            openPage,
            guidedLogin.username,
            guidedLogin.password,
            guidedState,
            guidedLogin.chooseMfaMethod,
            guidedLogin.onMfaNumberChallenge,
            guidedLogin.onStep,
          );
        }

        if (await detectSsoCaptcha(scopes)) {
          throw new SsoFallbackError(
            'captcha',
            'fallback',
            'SSO page requested CAPTCHA verification, which is not supported in automated mode.',
          );
        }

        if (await detectUnsupportedMfa(scopes)) {
          throw new SsoFallbackError(
            'unsupported_mfa',
            'fallback',
            'Detected a non-Okta-Verify MFA challenge. This flow currently supports Okta Verify push/number only.',
          );
        }

        if (await detectOktaVerifyChallenge(scopes)) {
          sawOktaVerifyChallenge = true;
          if (guidedState) {
            guidedState.sawOktaVerifyChallenge = true;
          }
        }

        setCaptured(extractCredentialsFromUrl(openPage.url()));
        if (captured) {
          break;
        }

        try {
          const pageOrigin = new URL(openPage.url()).origin;
          if (pageOrigin === targetOrigin) {
            // Some flows only expose credentials in localStorage after landing on origin.
            setCaptured(await extractCredentialsFromLocalStorage(openPage));
          }
        } catch {
          // ignore invalid/intermediate URLs
        }
      }

      if (captured) {
        break;
      }

      const cookies = await context.cookies();
      // Cookie extraction is final in-loop fallback before next polling tick.
      setCaptured(extractCredentialsFromCookieJar(cookies));

      if (captured) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!captured) {
      if (guidedLogin) {
        const pageSnapshot = summarizePageLocations(context.pages());
        if (guidedState && !guidedState.sawUsernameField && !guidedState.sawPasswordField) {
          throw new SsoFallbackError(
            'selector_missing',
            'username',
            `Unable to locate Monash SSO username/password fields after redirects. Seen pages: ${pageSnapshot}. Run with --show-browser and retry.`,
          );
        }
        throw new SsoFallbackError(
          'timeout',
          'fallback',
          sawOktaVerifyChallenge
            ? 'Timed out waiting for Okta Verify approval. Please approve in the app and retry.'
            : `Timed out waiting for SSO completion after submitting credentials. Seen pages: ${pageSnapshot}`,
        );
      }
      throw new Error(
        'Timed out waiting for SSO credentials. You can retry with --auto or use manual redirect URL paste.',
      );
    }
  } finally {
    await browser.close();
  }

  return captured;
}

/** Browser-only credential capture (no guided username/password actions). */
export async function captureSsoCredentials(options: AutoLoginOptions): Promise<LoginCredentials> {
  return captureSsoCredentialsInternal(options);
}

/** Guided credential capture with step callbacks for terminal UX. */
export async function captureSsoCredentialsWithGuidedLogin(
  options: SsoLoginOptions,
  onStep?: (step: SsoStep) => void,
): Promise<LoginCredentials> {
  const credentials = await captureSsoCredentialsInternal(
    {
      ssoUrl: options.ssoUrl,
      apiBaseUrl: options.apiBaseUrl,
      timeoutMs: options.timeoutMs,
      headless: options.headless,
    },
    {
      username: options.username,
      password: options.password,
      onStep,
      chooseMfaMethod: options.chooseMfaMethod,
      onMfaNumberChallenge: options.onMfaNumberChallenge,
    },
  );
  onStep?.('completed');
  return credentials;
}
