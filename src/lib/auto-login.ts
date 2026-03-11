import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';

export interface LoginCredentials {
  authToken: string;
  username: string;
  source: 'url' | 'auth_request' | 'auth_response' | 'local_storage' | 'cookie';
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

function resolveBrowserExecutablePath(): string {
  const match = candidateBrowserPaths().find((path) => existsSync(path));
  if (!match) {
    throw new Error(
      'Auto login could not find a Chrome/Chromium/Edge executable. Install one browser or set ONTRACK_BROWSER_PATH.',
    );
  }
  return match;
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
}

export async function captureSsoCredentials(options: AutoLoginOptions): Promise<LoginCredentials> {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const executablePath = resolveBrowserExecutablePath();

  let playwrightModule: typeof import('playwright-core');
  try {
    playwrightModule = await import('playwright-core');
  } catch {
    throw new Error(
      'Auto login requires dependency "playwright-core". Install the CLI with dependencies and retry.',
    );
  }

  const browser = await playwrightModule.chromium.launch({
    headless: false,
    executablePath,
  });

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

    while (!captured && Date.now() - start < timeoutMs) {
      for (const openPage of context.pages()) {
        if (captured) {
          break;
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
  } finally {
    await browser.close();
  }

  if (!captured) {
    throw new Error(
      'Timed out waiting for SSO credentials. You can retry with --auto or use manual redirect URL paste.',
    );
  }

  return captured;
}
