import type { ProbeResult } from './api.js';
import type { ProjectSummary, SessionData } from './types.js';
import { getTaskDefinitionId } from './utils.js';

/**
 * Static frontend discovery helpers.
 *
 * Goal:
 * - inspect served HTML/JS bundles
 * - extract likely UI route literals and API templates
 * - optionally probe those templates with a real session
 */
const DEFAULT_SITE_URL = 'https://ontrack.infotech.monash.edu/home';

const PATH_LITERAL_PATTERN = /(["'`])(\/[A-Za-z0-9_./:-]+)\1/g;
const JS_SCRIPT_PATTERN = /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+\.js)["'][^>]*>/gi;

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
  listProjects(session: SessionData): Promise<ProjectSummary[]>;
  probeGet(session: SessionData, endpointPath: string): Promise<ProbeResult>;
}

/**
 * Normalize discovered path literals and drop obvious noise:
 * - static assets
 * - malformed regex fragments
 * - trivial path artifacts
 */
function normalizePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) {
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

/** Extract normalized absolute-like paths from string literals inside JS sources. */
export function extractDiscoveredPaths(source: string): string[] {
  const matches = new Set<string>();
  let match: RegExpExecArray | null = PATH_LITERAL_PATTERN.exec(source);
  while (match) {
    const normalized = normalizePath(match[2] || '');
    if (normalized) {
      matches.add(normalized);
    }
    match = PATH_LITERAL_PATTERN.exec(source);
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

/** Fetch text resources with a browser-like Accept header. */
async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    method: 'GET',
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
export async function discoverOnTrackSurface(siteUrl: string = DEFAULT_SITE_URL): Promise<DiscoveryResult> {
  const fetchedAt = new Date().toISOString();
  const html = await fetchText(siteUrl);
  const assetPaths = extractJavascriptAssetPaths(html);
  const assetUrls = assetPaths.map((path) => new URL(path, siteUrl).toString());

  const assets: DiscoveryAsset[] = [];
  const allPaths = new Set<string>();

  const settled = await Promise.allSettled(assetUrls.map((url) => fetchText(url)));
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const assetUrl = assetUrls[index];
    if (result.status === 'fulfilled') {
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
      url: assetUrl,
      status: 'error',
      detail: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  }

  const classified = classifyDiscoveredPaths([...allPaths]);
  return {
    siteUrl,
    fetchedAt,
    assets,
    uiRoutes: classified.uiRoutes,
    apiTemplates: classified.apiTemplates,
  };
}

export interface ProbeContext {
  projectId?: number;
  unitId?: number;
  taskDefId?: number;
}

/** Build best-effort probe context from the first visible project/task. */
function toProbeContext(projects: ProjectSummary[]): ProbeContext {
  const project = projects[0];
  if (!project) {
    return {};
  }
  return {
    projectId: project.id,
    unitId: project.unit?.id,
    taskDefId: project.tasks?.length ? getTaskDefinitionId(project.tasks[0]) : undefined,
  };
}

const PARAM_RESOLVER: Record<string, keyof ProbeContext> = {
  projectid: 'projectId',
  project_id: 'projectId',
  unitid: 'unitId',
  unit_id: 'unitId',
  id: 'unitId',
  taskdefid: 'taskDefId',
  task_def_id: 'taskDefId',
  task_definition_id: 'taskDefId',
};

/** Replace `:param` placeholders with concrete context values where possible. */
function materializeEndpoint(template: string, context: ProbeContext): {
  endpoint?: string;
  unresolved: string[];
} {
  const unresolved: string[] = [];
  const endpoint = template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, rawName: string) => {
    const key = rawName.toLowerCase();
    const contextKey = PARAM_RESOLVER[key];
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
  contextOverride?: ProbeContext,
): Promise<ProbeItem[]> {
  const context =
    contextOverride ??
    toProbeContext(await api.listProjects(session));

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

    try {
      const result = await api.probeGet(session, materialized.endpoint);
      probeItems.push({
        template,
        endpoint: result.endpoint,
        status: result.ok ? 'ok' : 'error',
        detail: statusDetail(result),
      });
    } catch (error) {
      probeItems.push({
        template,
        endpoint: materialized.endpoint,
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return probeItems;
}
