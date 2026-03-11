import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';

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
}

export type SsoStep = 'username' | 'password' | 'mfa_wait' | 'completed' | 'fallback';

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
  'input[name="identifier"]',
  'input[name="username"]',
  'input[type="email"]',
];

const PASSWORD_SELECTORS = [
  'input#okta-signin-password',
  'input[name="password"]',
  'input[type="password"]',
];

const PRIMARY_SUBMIT_SELECTORS = [
  'input#okta-signin-submit',
  'button[type="submit"]',
  'input[type="submit"]',
  'button[data-type="save"]',
];

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function canUseSelector(page: Page, selector: string): Promise<boolean> {
  const locator = page.locator(selector).first();
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

async function fillFirstVisible(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    if (!(await canUseSelector(page, selector))) {
      continue;
    }
    await page.locator(selector).first().fill(value);
    return true;
  }
  return false;
}

async function clickFirstVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    if (!(await canUseSelector(page, selector))) {
      continue;
    }
    await page.locator(selector).first().click();
    return true;
  }
  return false;
}

async function clickLikelyActionButton(page: Page, labels: string[]): Promise<boolean> {
  for (const label of labels) {
    const button = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
    try {
      if (await button.isVisible({ timeout: 400 })) {
        await button.click();
        return true;
      }
    } catch {
      // keep searching
    }
  }
  return false;
}

async function hasTextSignal(page: Page, pattern: RegExp): Promise<boolean> {
  try {
    const node = page.getByText(pattern).first();
    return await node.isVisible({ timeout: 200 });
  } catch {
    return false;
  }
}

async function detectSsoCaptcha(page: Page): Promise<boolean> {
  return (
    (await hasTextSignal(page, /captcha|prove you are human|i am human|recaptcha/i)) ||
    (await canUseSelector(page, 'iframe[src*="recaptcha"], div.g-recaptcha'))
  );
}

async function detectUnsupportedMfa(page: Page): Promise<boolean> {
  return (
    (await hasTextSignal(page, /security key|webauthn|passkey/i)) ||
    (await hasTextSignal(page, /email|sms|text message/i))
  );
}

async function detectOktaVerifyChallenge(page: Page): Promise<boolean> {
  return (
    (await hasTextSignal(page, /okta verify|check your okta verify app|number challenge/i)) ||
    (await canUseSelector(page, '[data-se*="okta_verify"], [data-se*="factor-push"], [data-se*="factor-number"]'))
  );
}

async function performGuidedSsoLogin(
  page: Page,
  username: string,
  password: string,
  onStep?: (step: SsoStep) => void,
): Promise<void> {
  onStep?.('username');
  const usernameFilled = await fillFirstVisible(page, USERNAME_SELECTORS, username);
  if (!usernameFilled) {
    throw new SsoFallbackError(
      'selector_missing',
      'fallback',
      'Unable to locate username field on the Monash SSO page.',
    );
  }

  const advancedAfterUsername =
    (await clickFirstVisible(page, PRIMARY_SUBMIT_SELECTORS)) ||
    (await clickLikelyActionButton(page, ['next', 'continue', 'sign in']));

  if (advancedAfterUsername) {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 8000 });
    } catch {
      // continue scanning current page
    }
  }

  onStep?.('password');
  const passwordFilled = await fillFirstVisible(page, PASSWORD_SELECTORS, password);
  if (!passwordFilled) {
    throw new SsoFallbackError(
      'selector_missing',
      'fallback',
      'Unable to locate password field on the Monash SSO page.',
    );
  }

  const submitted =
    (await clickFirstVisible(page, PRIMARY_SUBMIT_SELECTORS)) ||
    (await clickLikelyActionButton(page, ['sign in', 'verify', 'next', 'continue']));

  if (!submitted) {
    throw new SsoFallbackError(
      'selector_missing',
      'fallback',
      'Unable to locate the sign-in submit control on the Monash SSO page.',
    );
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
    if (guidedLogin) {
      await performGuidedSsoLogin(page, guidedLogin.username, guidedLogin.password, guidedLogin.onStep);
      guidedLogin.onStep?.('mfa_wait');
    }
    const start = Date.now();
    let sawOktaVerifyChallenge = false;

    while (!captured && Date.now() - start < timeoutMs) {
      for (const openPage of context.pages()) {
        if (captured) {
          break;
        }

        if (await detectSsoCaptcha(openPage)) {
          throw new SsoFallbackError(
            'captcha',
            'fallback',
            'SSO page requested CAPTCHA verification, which is not supported in automated mode.',
          );
        }

        if (await detectUnsupportedMfa(openPage)) {
          throw new SsoFallbackError(
            'unsupported_mfa',
            'fallback',
            'Detected a non-Okta-Verify MFA challenge. This flow currently supports Okta Verify push/number only.',
          );
        }

        if (await detectOktaVerifyChallenge(openPage)) {
          sawOktaVerifyChallenge = true;
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
        throw new SsoFallbackError(
          'timeout',
          'fallback',
          sawOktaVerifyChallenge
            ? 'Timed out waiting for Okta Verify approval. Please approve in the app and retry.'
            : 'Timed out waiting for SSO completion after submitting credentials.',
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
    },
  );
  onStep?.('completed');
  return credentials;
}
