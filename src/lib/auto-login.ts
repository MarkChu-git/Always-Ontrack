import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Frame, Locator, Page } from 'playwright-core';

export interface LoginCredentials {
  authToken: string;
  username: string;
  source: 'url' | 'auth_request' | 'auth_response' | 'local_storage' | 'cookie';
}

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

export interface MfaMethodOption {
  id: number;
  label: string;
  recommended?: boolean;
}

export type SsoStep = 'username' | 'password' | 'mfa_select' | 'mfa_wait' | 'completed' | 'fallback';

export type SsoFallbackReason =
  | 'captcha'
  | 'unsupported_mfa'
  | 'selector_missing'
  | 'timeout'
  | 'browser_unavailable'
  | 'automation_error';

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

export interface BrowserLaunchPlan {
  source: 'env' | 'system' | 'bundled';
  executablePath?: string;
}

function hasValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

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

function browserInstallHint(): string {
  return (
    'No browser executable found. Install Chrome/Chromium/Edge, or run "npx playwright install chromium", ' +
    'or set ONTRACK_BROWSER_PATH.'
  );
}

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

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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

export interface AutoLoginOptions {
  ssoUrl: string;
  apiBaseUrl: string;
  timeoutMs?: number;
  headless?: boolean;
}

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

const PRIMARY_SUBMIT_SELECTORS = [
  'input#okta-signin-submit',
  '#idSIButton9',
  'button[type="submit"]',
  'input[type="submit"]',
  'button[name="action"]',
  'button[data-type="save"]',
];

const SSO_ENTRY_SELECTORS = [
  'a[href*="sso"]',
  'a[href*="monashuni.okta.com"]',
  'a[href*="saml"]',
  'button[id*="sso"]',
  'button[class*="sso"]',
  'button[data-sso]',
];

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

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

const MFA_CHALLENGE_TEXT_SIGNAL =
  /number challenge|following number|enter the number|tap the number|okta verify|approve sign in|push notification/i;
const MFA_CHALLENGE_NUMBER_TOKEN = /\b\d{1,3}\b/g;

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

async function detectSsoCaptcha(scopes: ScopeRef[]): Promise<boolean> {
  return (
    (await hasTextSignal(scopes, /captcha|prove you are human|i am human|recaptcha/i)) ||
    (await canUseSelectorInScopes(scopes, 'iframe[src*="recaptcha"], div.g-recaptcha'))
  );
}

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

async function detectOktaVerifyChallenge(scopes: ScopeRef[]): Promise<boolean> {
  return (
    (await hasTextSignal(scopes, /okta verify|check your okta verify app|number challenge/i)) ||
    (await canUseSelectorInScopes(
      scopes,
      '[data-se*="okta_verify"], [data-se*="factor-push"], [data-se*="factor-number"]',
    ))
  );
}

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

function extractNumberTokens(text: string): string[] {
  const matches = text.match(MFA_CHALLENGE_NUMBER_TOKEN);
  if (!matches) {
    return [];
  }
  return matches;
}

function hasMfaChallengeSignal(text: string): boolean {
  return MFA_CHALLENGE_TEXT_SIGNAL.test(text);
}

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

async function canUseSelectorInScopes(scopes: ScopeRef[], selector: string): Promise<boolean> {
  for (const scopeRef of scopes) {
    if (await canUseSelector(scopeRef.scope, selector)) {
      return true;
    }
  }
  return false;
}

async function hasAnySelectorInScopes(scopes: ScopeRef[], selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    if (await canUseSelectorInScopes(scopes, selector)) {
      return true;
    }
  }
  return false;
}

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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function countKnownMfaMethodMentions(text: string): number {
  let count = 0;
  for (const method of KNOWN_MFA_METHODS) {
    if (method.pattern.test(text)) {
      count += 1;
    }
  }
  return count;
}

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

  try {
    const browser = await playwrightModule.chromium.launch(launchArgs);
    return {
      browser,
      plan,
    };
  } catch (error) {
    if (plan.source === 'bundled') {
      throw new SsoFallbackError(
        'browser_unavailable',
        'fallback',
        `${browserInstallHint()} (${asErrorMessage(error)})`,
      );
    }
    throw new SsoFallbackError(
      'browser_unavailable',
      'fallback',
      `Unable to launch browser at "${plan.executablePath}": ${asErrorMessage(error)}`,
    );
  }
}

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

  const launch = await launchBrowserForCapture({
    headless: options.headless ?? false,
  });
  const browser = launch.browser;

  const context = await browser.newContext();
  const page = await context.newPage();
  const seenPages = new Set<Page>();
  const targetOrigin = new URL(options.apiBaseUrl).origin;
  let captured: LoginCredentials | null = null;

  const setCaptured = (value: LoginCredentials | null): void => {
    if (!captured && value) {
      captured = value;
    }
  };

  const registerPage = (currentPage: Page): void => {
    if (seenPages.has(currentPage)) {
      return;
    }
    seenPages.add(currentPage);

    setCaptured(extractCredentialsFromUrl(currentPage.url()));

    currentPage.on('framenavigated', () => {
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

export async function captureSsoCredentials(options: AutoLoginOptions): Promise<LoginCredentials> {
  return captureSsoCredentialsInternal(options);
}

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
