const FETCH_TIMEOUT_MS = 15_000;
const MAX_ERROR_BODY_CHARS = 512;
const MAX_RESPONSE_BODY_CHARS = 2_000_000;

const KNOWN_COMPAT_SUFFIXES = [
  '/api/claudecode',
  '/api/anthropic',
  '/apps/anthropic',
  '/api/coding',
  '/claudecode',
  '/anthropic',
  '/step_plan',
  '/coding',
  '/claude',
] as const;

export type ModelFetchApiProtocol = 'anthropic' | 'openai';

export interface FetchedModel {
  id: string;
  ownedBy: string | null;
  /** Codex model metadata, when the upstream exposes it. */
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string | null;
}

interface ModelFetchOptions {
  apiUrl: string;
  apiKey: string;
  apiProtocol?: ModelFetchApiProtocol;
}

type AuthMode = 'anthropic' | 'bearer';

/**
 * Fetch the model catalog exposed by an OpenAI-compatible or Anthropic API.
 *
 * The provider form stores a base URL, while users sometimes paste a complete
 * chat/completions URL. Supporting both keeps discovery consistent with the
 * existing request configuration and with cc-switch's URL fallback strategy.
 */
export async function fetchModels({
  apiUrl,
  apiKey,
  apiProtocol = 'openai',
}: ModelFetchOptions): Promise<FetchedModel[]> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error('API Key is required to fetch models');
  }

  const candidates = buildModelsUrlCandidates(apiUrl);
  const authModes: AuthMode[] = apiProtocol === 'anthropic'
    ? ['anthropic', 'bearer']
    : ['bearer'];
  let lastError = 'no candidates';
  let firstSuccessfulModels: FetchedModel[] | null = null;

  for (const url of candidates) {
    for (const authMode of authModes) {
      const response = await requestModels(url, trimmedApiKey, authMode);
      const status = response.status;

      if (response.ok) {
        try {
          const models = await parseFetchedModelsResponse(response);
          if (hasReasoningMetadata(models)) return models;
          firstSuccessfulModels ??= models;
          // A standard /v1/models response may not contain Codex metadata;
          // continue to a possible provider-specific /models catalog.
          continue;
        } catch (error) {
          if (firstSuccessfulModels) continue;
          throw error;
        }
      }

      const body = await readResponseBody(response, false);
      lastError = `HTTP ${status}: ${body}`;

      // A usable standard catalog was already found. An alternate endpoint
      // failing must not turn that successful discovery into an error.
      if (firstSuccessfulModels) continue;

      // A provider may expose /models at a different compatible path. Keep
      // trying candidates for the same behavior as cc-switch.
      if (status === 404 || status === 405) {
        break;
      }

      // Anthropic-compatible gateways are inconsistent about whether they
      // expect x-api-key or a Bearer token. Try the other auth style before
      // returning an authentication error.
      if ((status === 401 || status === 403) && authMode === 'anthropic' && authModes.length > 1) {
        continue;
      }

      throw new Error(lastError);
    }
  }

  if (firstSuccessfulModels) return firstSuccessfulModels;
  throw new Error(`All candidates failed: ${lastError}`);
}

async function requestModels(url: string, apiKey: string, authMode: AuthMode): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (authMode === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    return await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Model list request timed out');
    }
    throw new Error(`Model list request failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseBody(response: Response, enforceResponseLimit: boolean): Promise<string> {
  const body = await response.text().catch(() => '');
  if (enforceResponseLimit && body.length > MAX_RESPONSE_BODY_CHARS) {
    throw new Error('Model list response is too large');
  }
  return enforceResponseLimit ? body : truncateBody(body);
}

/** Build ordered, de-duplicated model endpoint candidates from a provider URL. */
export function buildModelsUrlCandidates(apiUrl: string): string[] {
  const parsed = parseHttpUrl(apiUrl);
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const origin = parsed.origin;
  const candidates: string[] = [];

  const add = (path: string) => {
    const normalizedPath = `/${path.replace(/^\/+/, '').replace(/\/+$/, '')}`;
    const candidate = `${origin}${normalizedPath}`;
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  const requestPath = stripKnownModelRequestPath(pathname);
  if (requestPath !== null) {
    addModelCandidates(add, requestPath);
  } else if (pathname.endsWith('/models')) {
    // Users may paste the exact model endpoint instead of the provider base.
    add(pathname);
    const basePath = pathname.slice(0, -'/models'.length);
    if (!endsWithVersionSegment(basePath)) {
      add(`${basePath}/v1/models`);
    }
  } else if (endsWithVersionSegment(pathname)) {
    add(`${pathname}/models`);
    add(`${pathname.slice(0, pathname.lastIndexOf('/'))}/models`);
    if (!pathname.endsWith('/v1')) {
      add(`${pathname}/v1/models`);
    }
  } else {
    add(`${pathname}/v1/models`);
    add(`${pathname}/models`);
  }

  const stripped = stripCompatSuffix(pathname);
  if (stripped !== null) {
    const root = stripped.replace(/\/+$/, '');
    add(`${root}/v1/models`);
    add(`${root}/models`);
  }

  return candidates;
}

function addModelCandidates(add: (path: string) => void, basePath: string): void {
  if (endsWithVersionSegment(basePath)) {
    add(`${basePath}/models`);
    add(`${basePath.slice(0, basePath.lastIndexOf('/'))}/models`);
    if (!basePath.endsWith('/v1')) {
      add(`${basePath}/v1/models`);
    }
    return;
  }
  add(`${basePath}/v1/models`);
}

function stripKnownModelRequestPath(pathname: string): string | null {
  const suffixes = ['/chat/completions', '/responses', '/messages'];
  for (const suffix of suffixes) {
    if (pathname.endsWith(suffix)) {
      const base = pathname.slice(0, -suffix.length);
      return base || '/';
    }
  }
  return null;
}

function parseHttpUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('API URL is required to fetch models');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('API URL must be a valid HTTP or HTTPS URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('API URL must use HTTP or HTTPS');
  }
  return parsed;
}

function stripCompatSuffix(pathname: string): string | null {
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (pathname.endsWith(suffix)) {
      return pathname.slice(0, -suffix.length);
    }
  }
  return null;
}

function endsWithVersionSegment(pathname: string): boolean {
  const lastSegment = pathname.split('/').pop() || '';
  return /^v\d+$/.test(lastSegment);
}

/**
 * Parse and normalize both standard OpenAI and Codex model catalogs.
 *
 * Standard OpenAI-compatible APIs return `{ data: [...] }`, while Codex's
 * model endpoint returns `{ models: [...] }` and may include per-model
 * reasoning metadata.
 */
export function parseFetchedModels(payload: unknown): FetchedModel[] {
  let entries: unknown[] | null = null;
  if (Array.isArray(payload)) {
    entries = payload;
  } else if (isRecord(payload)) {
    if (Array.isArray(payload.data)) {
      entries = payload.data;
    } else if (Array.isArray(payload.models)) {
      entries = payload.models;
    } else if (payload.data == null && payload.models == null) {
      entries = [];
    }
  }

  if (!entries) {
    throw new Error('Model list response does not contain a data array');
  }

  const models = new Map<string, FetchedModel>();
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const rawId = typeof entry.id === 'string'
      ? entry.id
      : typeof entry.slug === 'string'
        ? entry.slug
        : typeof entry.model === 'string'
          ? entry.model
          : '';
    const id = rawId.trim();
    if (!id || models.has(id)) continue;
    const ownedBy = typeof entry.owned_by === 'string'
      ? entry.owned_by.trim() || null
      : typeof entry.ownedBy === 'string'
        ? entry.ownedBy.trim() || null
        : typeof entry.owner === 'string'
          ? entry.owner.trim() || null
          : null;

    const supportedReasoningEfforts = parseReasoningEfforts(entry);
    const defaultReasoningEffort = parseReasoningEffort(
      entry.default_reasoning_level
        ?? entry.default_reasoning_effort
        ?? entry.defaultReasoningLevel
        ?? entry.defaultReasoningEffort,
    );
    const model: FetchedModel = { id, ownedBy };
    if (supportedReasoningEfforts.length > 0) {
      model.supportedReasoningEfforts = supportedReasoningEfforts;
    }
    if (defaultReasoningEffort !== null) {
      model.defaultReasoningEffort = defaultReasoningEffort;
    }
    models.set(id, model);
  }

  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function parseFetchedModelsResponse(response: Response): Promise<FetchedModel[]> {
  const body = await readResponseBody(response, true);
  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    throw new Error('Failed to parse model list response');
  }
  return parseFetchedModels(payload);
}

function hasReasoningMetadata(models: FetchedModel[]): boolean {
  return models.some((model) => (
    (model.supportedReasoningEfforts?.length ?? 0) > 0
    || model.defaultReasoningEffort != null
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseReasoningEfforts(entry: Record<string, unknown>): string[] {
  const rawLevels = [
    entry.supported_reasoning_levels,
    entry.supported_reasoning_efforts,
    entry.reasoning_efforts,
    entry.reasoningEfforts,
  ].find(Array.isArray);
  if (!Array.isArray(rawLevels)) return [];

  const efforts = new Set<string>();
  for (const level of rawLevels) {
    const rawEffort = typeof level === 'string'
      ? level
      : isRecord(level)
        ? level.effort ?? level.reasoning_effort ?? level.value
        : undefined;
    const effort = parseReasoningEffort(rawEffort);
    if (effort !== null) efforts.add(effort);
  }
  return [...efforts];
}

function parseReasoningEffort(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function truncateBody(body: string): string {
  if (body.length <= MAX_ERROR_BODY_CHARS) return body;
  return `${body.slice(0, MAX_ERROR_BODY_CHARS)}…`;
}
