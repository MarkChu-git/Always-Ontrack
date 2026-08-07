import type { ProbeResult } from './api.js';
import { normalizeReadOnlyRoute } from './contracts.js';
import type { SessionData } from './types.js';

/**
 * Static frontend discovery helpers.
 *
 * Goal:
 * - inspect served HTML/JS bundles
 * - extract likely UI route literals and API templates
 * - optionally probe those templates with a real session
 */
const DEFAULT_SITE_URL = 'https://ontrack.infotech.monash.edu/home';
const DEFAULT_SITE_ORIGIN = new URL(DEFAULT_SITE_URL).origin;

const JS_SCRIPT_PATTERN = /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+\.js)["'][^>]*>/gi;
const IDENTIFIER_EXPRESSION_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*)*$/;

const ASSET_IGNORE_PATTERN = /\.(?:js|css|woff2?|ttf|png|jpe?g|svg|ico|map)$/i;

const API_HINTS = [
  '/api/',
  '/auth',
  '/task_def_id/',
  '/task_definitions/',
  '/comments/',
  '/submission',
  '/inbox',
  '/moderation',
  '/overflow',
  '/reset_target_dates',
  '/target_dates',
  '/scorm-player/',
];

export interface DiscoveryAsset {
  url: string;
  status: 'ok' | 'error';
  detail?: string;
}

export interface DiscoveryResult {
  siteUrl: string;
  fetchedAt: string;
  assets: DiscoveryAsset[];
  uiRoutes: string[];
  apiTemplates: string[];
}

export interface ProbeItem {
  template: string;
  endpoint?: string;
  status: 'ok' | 'error' | 'skip';
  detail: string;
}

export interface ProbeApiClient {
  probeGet(session: SessionData, endpointPath: string): Promise<ProbeResult>;
}

/** Conservative cap for all authenticated discovery probes in one invocation. */
export const MAX_DISCOVERY_PROBE_REQUEST_BUDGET = 25;
/** Default probe budget prevents bundle discovery from fanning out across an account. */
export const DEFAULT_DISCOVERY_PROBE_REQUEST_BUDGET = 10;

/**
 * Normalize discovered path literals and drop obvious noise:
 * - static assets
 * - malformed regex fragments
 * - trivial path artifacts
 */
function normalizePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.includes('?') || trimmed.includes('#')) {
    return null;
  }

  if (trimmed.startsWith('/assets/') || trimmed.startsWith('/media/')) {
    return null;
  }

  let value = trimmed.replace(/:\\\//g, '/');
  value = value.replace(/:\//g, '/');
  value = value.replace(/\/{2,}/g, '/');
  value = value.replace(/:+$/g, '');

  if (value.length > 1 && value.endsWith('/')) {
    value = value.slice(0, -1);
  }

  if (value === '/.' || value === '/..') {
    return null;
  }

  const segments = value.split('/').filter(Boolean);
  if (
    segments.length === 2 &&
    segments[0].length === 1 &&
    /^[gimsuy]+$/i.test(segments[1])
  ) {
    return null;
  }

  if (!value || ASSET_IGNORE_PATTERN.test(value)) {
    return null;
  }

  return value;
}

/** Heuristic: classify a path as API-oriented if it contains a known API hint. */
function isApiTemplate(path: string): boolean {
  return API_HINTS.some((hint) => path.includes(hint));
}

/** Parse JS asset paths from HTML script/link tags. */
export function extractJavascriptAssetPaths(html: string): string[] {
  const paths = new Set<string>();
  let match: RegExpExecArray | null = JS_SCRIPT_PATTERN.exec(html);
  while (match) {
    const path = match[1]?.trim();
    if (path) {
      paths.add(path);
    }
    match = JS_SCRIPT_PATTERN.exec(html);
  }
  return [...paths];
}

interface ParsedString {
  readonly value: string;
  readonly end: number;
}

/** Read one quoted JavaScript string without evaluating any source expression. */
function readQuotedString(source: string, start: number): ParsedString | null {
  const quote = source[start];
  if (quote !== "'" && quote !== '"') {
    return null;
  }

  let value = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\') {
      const escaped = source[index + 1];
      if (escaped === undefined) {
        return null;
      }
      value += escaped;
      index += 1;
      continue;
    }
    if (character === quote) {
      return { value, end: index + 1 };
    }
    if (character === '\n' || character === '\r') {
      return null;
    }
    value += character;
  }
  return null;
}

/** Convert a static identifier/member expression into an auditable path parameter. */
function placeholderForExpression(expression: string): string | null {
  if (!IDENTIFIER_EXPRESSION_PATTERN.test(expression)) {
    return null;
  }
  const name = expression
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('_');
  return name ? `:${name}` : null;
}

/** Read a single template literal while retaining only safe named interpolations. */
function readTemplatePath(source: string, start: number): ParsedString | null {
  if (source[start] !== '`') {
    return null;
  }
  const end = source.indexOf('`', start + 1);
  if (end === -1) {
    return null;
  }
  const raw = source.slice(start + 1, end);
  let valid = true;
  const value = raw.replace(/\$\{([^{}]+)\}/g, (_match, expression: string) => {
    const placeholder = placeholderForExpression(expression.trim());
    if (!placeholder) {
      valid = false;
      return '';
    }
    return placeholder;
  });
  return valid && !value.includes('${') ? { value, end: end + 1 } : null;
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/.test(source[index] ?? '')) {
    index += 1;
  }
  return index;
}

/** Only delimiters may follow an identifier/member path segment. */
function isStaticExpressionBoundary(character: string | undefined): boolean {
  return character === undefined || ['+', ';', ',', ')', ']', '}'].includes(character);
}

/** Reconstruct a path assembled only from quoted strings and identifier members. */
function readConcatenatedPath(source: string, start: number): ParsedString | null {
  const first = readQuotedString(source, start);
  if (!first || !first.value.startsWith('/')) {
    return null;
  }

  let value = first.value;
  let cursor = skipWhitespace(source, first.end);
  let sawConcatenation = false;
  while (source[cursor] === '+') {
    cursor = skipWhitespace(source, cursor + 1);
    const stringPart = readQuotedString(source, cursor);
    if (stringPart) {
      value += stringPart.value;
      cursor = skipWhitespace(source, stringPart.end);
      sawConcatenation = true;
      continue;
    }

    const expressionMatch = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*)*/.exec(
      source.slice(cursor),
    );
    if (!expressionMatch) {
      return null;
    }
    const placeholder = placeholderForExpression(expressionMatch[0]);
    if (!placeholder) {
      return null;
    }
    value += placeholder;
    cursor = skipWhitespace(source, cursor + expressionMatch[0].length);
    if (!isStaticExpressionBoundary(source[cursor])) {
      return null;
    }
    sawConcatenation = true;
  }

  return sawConcatenation ? { value, end: cursor } : null;
}

function isConcatenationPart(source: string, start: number, end: number): boolean {
  const before = source.slice(0, start).trimEnd();
  const after = source.slice(end).trimStart();
  return before.endsWith('+') || after.startsWith('+');
}

/** Extract normalized absolute-like paths from static JS literals and concatenations. */
export function extractDiscoveredPaths(source: string): string[] {
  const matches = new Set<string>();
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const parsed = character === '`'
      ? readTemplatePath(source, index)
      : readConcatenatedPath(source, index) ?? readQuotedString(source, index);
    if (!parsed) {
      continue;
    }
    if (character !== '`' && isConcatenationPart(source, index, parsed.end)) {
      index = parsed.end - 1;
      continue;
    }
    const normalized = normalizePath(parsed.value);
    if (normalized) {
      matches.add(normalized);
    }
    index = parsed.end - 1;
  }
  return [...matches];
}

/** Split discovered literals into UI routes and API templates. */
export function classifyDiscoveredPaths(paths: string[]): {
  uiRoutes: string[];
  apiTemplates: string[];
} {
  const ui = new Set<string>();
  const api = new Set<string>();

  for (const path of paths) {
    if (isApiTemplate(path)) {
      api.add(path);
    } else {
      ui.add(path);
    }
  }

  return {
    uiRoutes: [...ui].sort(),
    apiTemplates: [...api].sort(),
  };
}

/** Resolve only exact-origin OnTrack paths; cross-origin assets are never fetched. */
function resolveDiscoveryUrl(path: string): string {
  const candidate = new URL(path, DEFAULT_SITE_URL);
  if (
    candidate.origin !== DEFAULT_SITE_ORIGIN ||
    candidate.username ||
    candidate.password
  ) {
    throw new Error('Discovery is restricted to the exact OnTrack origin.');
  }
  return new URL(`${candidate.pathname}${candidate.search}`, DEFAULT_SITE_ORIGIN).toString();
}

/** Fetch exact-origin text resources with a browser-like Accept header. */
async function fetchText(path: string): Promise<string> {
  // resolveDiscoveryUrl rebuilds against a compile-time origin after exact-origin validation.
  // codeql[js/request-forgery]
  const response = await fetch(resolveDiscoveryUrl(path), {
    method: 'GET',
    redirect: 'error',
    headers: {
      Accept: 'text/html, application/javascript, text/javascript, */*',
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.text();
}

/**
 * Crawl index + JS bundles to build a route/API discovery snapshot.
 * This is read-only and does not require an authenticated session.
 */
export async function discoverOnTrackSurface(): Promise<DiscoveryResult> {
  const fetchedAt = new Date().toISOString();
  const html = await fetchText(DEFAULT_SITE_URL);
  const assetPaths = extractJavascriptAssetPaths(html);
  const assetUrls = assetPaths.map((path) => {
    try {
      return resolveDiscoveryUrl(path);
    } catch {
      return null;
    }
  });

  const assets: DiscoveryAsset[] = [];
  const allPaths = new Set<string>();

  const settled = await Promise.allSettled(
    assetUrls.map((url) =>
      url
        ? fetchText(url)
        : Promise.reject(new Error('Cross-origin discovery asset was not fetched.')),
    ),
  );
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const assetUrl = assetUrls[index];
    if (result.status === 'fulfilled') {
      if (!assetUrl) {
        throw new Error('Cross-origin discovery asset unexpectedly resolved.');
      }
      assets.push({
        url: assetUrl,
        status: 'ok',
      });
      for (const path of extractDiscoveredPaths(result.value)) {
        allPaths.add(path);
      }
      continue;
    }

    assets.push({
      url: assetUrl ?? '[cross-origin asset omitted]',
      status: 'error',
      detail: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  }

  const classified = classifyDiscoveredPaths([...allPaths]);
  return {
    siteUrl: DEFAULT_SITE_URL,
    fetchedAt,
    assets,
    uiRoutes: classified.uiRoutes,
    apiTemplates: classified.apiTemplates,
  };
}

export interface ProbeContext {
  readonly projectId?: number;
  readonly unitId?: number;
  readonly taskDefinitionId?: number;
}

export interface ProbeOptions {
  readonly requestBudget?: number;
}

const PARAM_RESOLVER: Record<string, keyof ProbeContext> = {
  projectid: 'projectId',
  unitid: 'unitId',
  taskdefid: 'taskDefinitionId',
  taskdefinitionid: 'taskDefinitionId',
};

function contextKeyForParameter(
  rawName: string,
  template: string,
  parameterOffset: number,
): keyof ProbeContext | undefined {
  const normalizedName = rawName.replace(/[_-]/g, '').toLowerCase();
  if (normalizedName !== 'id') {
    return PARAM_RESOLVER[normalizedName];
  }

  const prefix = template.slice(0, parameterOffset);
  if (/\/projects\/$/.test(prefix)) {
    return 'projectId';
  }
  if (/\/units\/$/.test(prefix)) {
    return 'unitId';
  }
  if (/\/(?:task_def_id|task_definitions)\/$/.test(prefix)) {
    return 'taskDefinitionId';
  }
  return undefined;
}

/** Replace `:param` placeholders with concrete context values where possible. */
function materializeEndpoint(template: string, context: ProbeContext): {
  endpoint?: string;
  unresolved: string[];
} {
  const unresolved: string[] = [];
  const endpoint = template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, rawName: string, offset: number) => {
    const contextKey = contextKeyForParameter(rawName, template, offset);
    if (!contextKey || context[contextKey] === undefined) {
      unresolved.push(rawName);
      return `:${rawName}`;
    }

    return String(context[contextKey]);
  });

  if (unresolved.length > 0) {
    return {
      unresolved,
    };
  }

  return {
    endpoint,
    unresolved: [],
  };
}

function probeRequestBudget(options: ProbeOptions): number {
  const requested = options.requestBudget ?? DEFAULT_DISCOVERY_PROBE_REQUEST_BUDGET;
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_DISCOVERY_PROBE_REQUEST_BUDGET) {
    throw new Error(
      `Probe request budget must be an integer between 1 and ${MAX_DISCOVERY_PROBE_REQUEST_BUDGET}.`,
    );
  }
  return requested;
}

/** Standardize probe status text to keep table output compact. */
function statusDetail(result: ProbeResult): string {
  return result.ok ? `HTTP ${result.status}` : `HTTP ${result.status} (not accessible)`;
}

/**
 * Probe discovered API templates with a real logged-in session.
 * Unresolved templates are explicitly reported as `skip`.
 */
export async function probeDiscoveredApiTemplates(
  api: ProbeApiClient,
  session: SessionData,
  templates: string[],
  context: ProbeContext = {},
  options: ProbeOptions = {},
): Promise<ProbeItem[]> {
  const requestBudget = probeRequestBudget(options);
  let requestsSent = 0;
  const probeItems: ProbeItem[] = [];
  for (const template of templates) {
    const materialized = materializeEndpoint(template, context);
    if (materialized.unresolved.length > 0 || !materialized.endpoint) {
      probeItems.push({
        template,
        status: 'skip',
        detail: `Unresolved params: ${materialized.unresolved.join(', ')}`,
      });
      continue;
    }

    let route: string;
    try {
      route = normalizeReadOnlyRoute('GET', materialized.endpoint).route;
    } catch (error) {
      probeItems.push({
        template,
        status: 'skip',
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (requestsSent >= requestBudget) {
      probeItems.push({
        template,
        endpoint: route,
        status: 'skip',
        detail: `Probe request budget exhausted (${requestBudget} request(s)).`,
      });
      continue;
    }

    try {
      requestsSent += 1;
      const result = await api.probeGet(session, route);
      probeItems.push({
        template,
        endpoint: route,
        status: result.ok ? 'ok' : 'error',
        detail: statusDetail(result),
      });
    } catch (error) {
      probeItems.push({
        template,
        endpoint: route,
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return probeItems;
}
