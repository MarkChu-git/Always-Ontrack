import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

/** Trust assigned to production evidence; it is never inferred from route names. */
export type ContractTrust =
  | 'bundle-discovered'
  | 'http-observed'
  | 'student-verified'
  | 'write-verified'
  | 'staff-unknown';

/** Side-effect classification recorded alongside every observed contract. */
export type ContractRisk = 'read-only' | 'identity-sensitive' | 'write' | 'unknown';

/** Human-reviewable evidence for a Contract Fixture. */
export interface ContractProvenance {
  readonly observedAt: string;
  readonly role: string;
  readonly risk: ContractRisk;
  readonly trust: ContractTrust;
}

/** Versioned metadata that makes a fixture useful without production credentials. */
export interface ContractFixtureMetadata {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly method: string;
  readonly route: string;
  readonly provenance: ContractProvenance;
  readonly redactedFields?: readonly string[];
}

/** A contract shape retains structure and selected safe enums but never captured values. */
export type ContractShape =
  | {
      readonly type: 'null' | 'boolean' | 'number' | 'string';
      readonly enum?: readonly (boolean | number | string)[];
    }
  | {
      readonly type: 'array';
      readonly items: readonly ContractShape[];
    }
  | {
      readonly type: 'object';
      readonly fields: Readonly<Record<string, ContractShape>>;
    };

/** Non-personal, versioned fixture used by tests and CI only. */
export interface ContractFixture {
  readonly metadata: ContractFixtureMetadata;
  readonly payload: unknown;
  readonly shape?: ContractShape;
}

export interface FixtureValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface NormalizedReadOnlyRoute {
  readonly method: 'GET' | 'HEAD';
  readonly route: string;
  readonly template: string;
}

export interface ContractDrift {
  readonly kind: 'field_missing' | 'field_added' | 'type_changed' | 'enum_changed';
  readonly path: string;
  readonly expected?: string;
  readonly observed?: string;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const ONTRACK_ORIGIN = 'https://ontrack.infotech.monash.edu';
const READ_ONLY_METHODS = new Set(['GET', 'HEAD']);
const TRUST_VALUES = new Set<ContractTrust>([
  'bundle-discovered',
  'http-observed',
  'student-verified',
  'write-verified',
  'staff-unknown',
]);
const RISK_VALUES = new Set<ContractRisk>(['read-only', 'identity-sensitive', 'write', 'unknown']);
const SAFE_ENUM_FIELDS = new Set(['method', 'risk', 'role', 'source', 'status', 'trust', 'type']);
const SENSITIVE_STRING_PATTERN =
  /(?:bearer\s+[a-z0-9._~+\/-]+|basic\s+[a-z0-9+\/=._~-]{8,}|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|(?:\+?\d(?:[\s().-]*\d){9,})|-----begin(?: [a-z0-9]+)* private key-----|(?:gh[pousr]|github_pat)_[a-z0-9_]{20,}|sk-[a-z0-9_-]{16,}|xox[baprs]-[a-z0-9-]{10,}|akia[0-9a-z]{16}|eyj[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,})/i;
const PERSON_IDENTITY_CONTAINERS = new Set([
  'account',
  'accounts',
  'author',
  'authors',
  'identities',
  'identity',
  'member',
  'members',
  'owner',
  'owners',
  'people',
  'person',
  'student',
  'students',
  'user',
  'users',
]);

const ROUTE_CATALOG: readonly { readonly template: string; readonly pattern: RegExp }[] = [
  { template: '/projects', pattern: /^\/projects$/ },
  { template: '/projects/:projectId', pattern: /^\/projects\/(?:\d+|:projectId)$/ },
  {
    template: '/projects/:projectId/task_def_id/:taskDefId/comments',
    pattern: /^\/projects\/(?:\d+|:projectId)\/task_def_id\/(?:\d+|:taskDefId)\/comments$/,
  },
  {
    template: '/projects/:projectId/task_def_id/:taskDefId/submission',
    pattern: /^\/projects\/(?:\d+|:projectId)\/task_def_id\/(?:\d+|:taskDefId)\/submission$/,
  },
  {
    template: '/projects/:projectId/task_def_id/:taskDefId/submission_details',
    pattern: /^\/projects\/(?:\d+|:projectId)\/task_def_id\/(?:\d+|:taskDefId)\/submission_details$/,
  },
  { template: '/units', pattern: /^\/units$/ },
  { template: '/units/:unitId', pattern: /^\/units\/(?:\d+|:unitId)$/ },
  {
    template: '/units/:unitId/task_prerequisites',
    pattern: /^\/units\/(?:\d+|:unitId)\/task_prerequisites$/,
  },
  {
    template: '/units/:unitId/task_definitions/:taskDefId/prerequisites',
    pattern: /^\/units\/(?:\d+|:unitId)\/task_definitions\/(?:\d+|:taskDefId)\/prerequisites$/,
  },
  {
    template: '/units/:unitId/tasks/inbox',
    pattern: /^\/units\/(?:\d+|:unitId)\/tasks\/inbox$/,
  },
  {
    template: '/units/:unitId/task_definitions/:taskDefId/task_pdf.json',
    pattern: /^\/units\/(?:\d+|:unitId)\/task_definitions\/(?:\d+|:taskDefId)\/task_pdf\.json$/,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKey(key: string): string {
  return key.replace(/[_-]/g, '').toLowerCase();
}

function isSensitiveKey(
  key: string,
  parentKey?: string,
  identityContext: boolean = false,
): boolean {
  const normalized = normalizeKey(key);
  if (['authtokenexpiry', 'tokenexpiry', 'tokenexpiresat', 'tokentype'].includes(normalized)) {
    return false;
  }
  const normalizedParent = parentKey ? normalizeKey(parentKey) : undefined;
  if (
    normalized === 'id' &&
    (identityContext ||
      (normalizedParent && PERSON_IDENTITY_CONTAINERS.has(normalizedParent)))
  ) {
    return true;
  }
  return (
    normalized.includes('token') ||
    normalized.includes('cookie') ||
    normalized.includes('password') ||
    normalized.includes('passphrase') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.includes('authorization') ||
    normalized.includes('session') ||
    normalized.includes('csrf') ||
    normalized.includes('xsrf') ||
    normalized.includes('apikey') ||
    normalized.includes('accesskey') ||
    normalized.includes('privatekey') ||
    normalized.includes('clientkey') ||
    normalized.includes('email') ||
    normalized.includes('username') ||
    normalized === 'login' ||
    normalized === 'uid' ||
    normalized === 'userid' ||
    normalized === 'studentid' ||
    normalized === 'personid' ||
    normalized === 'accountid' ||
    normalized === 'studentnumber' ||
    normalized === 'phone' ||
    normalized === 'phonenumber' ||
    normalized === 'telephone' ||
    normalized === 'mobile' ||
    normalized === 'mobilenumber' ||
    normalized === 'address' ||
    normalized.endsWith('address') ||
    normalized === 'postcode' ||
    normalized === 'postalcode' ||
    normalized === 'dateofbirth' ||
    normalized === 'dob' ||
    normalized === 'firstname' ||
    normalized === 'lastname' ||
    normalized === 'fullname' ||
    normalized.includes('filename') ||
    normalized === 'filepath'
  );
}

function sanitizeValue(
  value: unknown,
  parentKey?: string,
  identityContext: boolean = false,
): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return SENSITIVE_STRING_PATTERN.test(value) ? '[redacted]' : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, parentKey, identityContext));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isSensitiveKey(key, parentKey, identityContext))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [
          key,
          sanitizeValue(
            child,
            key,
            identityContext || PERSON_IDENTITY_CONTAINERS.has(normalizeKey(key)),
          ),
        ]),
    );
  }
  return String(value);
}

/**
 * Remove secret and personal fields before a production payload can become a
 * fixture or a drift artifact. The returned tree is a new immutable value.
 */
export function sanitizeProductionPayload(payload: unknown): JsonValue {
  return sanitizeValue(payload);
}

function normalizeValue(value: JsonValue, fieldName?: string): ContractShape {
  if (value === null) {
    return { type: 'null' };
  }
  if (Array.isArray(value)) {
    const variants = value.map((item) => normalizeValue(item));
    const uniqueVariants = new Map(
      variants.map((variant) => [JSON.stringify(variant), variant]),
    );
    return {
      type: 'array',
      items: [...uniqueVariants.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, variant]) => variant),
    };
  }
  if (typeof value === 'object') {
    return {
      type: 'object',
      fields: Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalizeValue(child, key)]),
      ),
    };
  }

  const type = typeof value as 'boolean' | 'number' | 'string';
  if (fieldName && SAFE_ENUM_FIELDS.has(fieldName) && typeof value !== 'number') {
    return { type, enum: [value] };
  }
  return { type };
}

/**
 * Normalize a possibly sensitive production payload into a safe structural
 * contract. Sanitization deliberately happens before enum collection.
 */
export function normalizeProductionPayload(payload: unknown): ContractShape {
  return normalizeValue(sanitizeProductionPayload(payload));
}

function canonicalRoute(rawRoute: string): string {
  const parsed = new URL(rawRoute, ONTRACK_ORIGIN);
  if (parsed.origin !== ONTRACK_ORIGIN || parsed.protocol !== 'https:') {
    throw new Error('Read-only route must target the OnTrack production origin.');
  }

  const compactPath = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  return compactPath.startsWith('/api/') ? compactPath.slice(4) : compactPath;
}

/**
 * Accept only explicitly catalogued GET/HEAD paths. Query strings and hashes
 * are intentionally excluded so a probe cannot carry hidden request state.
 */
export function normalizeReadOnlyRoute(method: string, route: string): NormalizedReadOnlyRoute {
  const normalizedMethod = method.toUpperCase();
  if (!READ_ONLY_METHODS.has(normalizedMethod)) {
    throw new Error('Only GET and HEAD methods are allowed for contract probing.');
  }

  const normalizedRoute = canonicalRoute(route);
  const entry = ROUTE_CATALOG.find(({ pattern }) => pattern.test(normalizedRoute));
  if (!entry) {
    throw new Error(`Read-only route is not allowlisted: ${normalizedRoute}`);
  }

  return {
    method: normalizedMethod as 'GET' | 'HEAD',
    route: normalizedRoute,
    template: entry.template,
  };
}

function shapeType(shape: ContractShape): string {
  return shape.type;
}

function enumText(shape: ContractShape): string | undefined {
  return 'enum' in shape && shape.enum ? shape.enum.map(String).join('|') : undefined;
}

function collectShapeDrift(
  expected: ContractShape,
  observed: ContractShape,
  path: string,
  typeChanges: ContractDrift[],
  missing: ContractDrift[],
  added: ContractDrift[],
  enumChanges: ContractDrift[],
): void {
  if (expected.type !== observed.type) {
    typeChanges.push({
      kind: 'type_changed',
      path,
      expected: shapeType(expected),
      observed: shapeType(observed),
    });
    return;
  }

  if (expected.type === 'object' && observed.type === 'object') {
    for (const key of Object.keys(expected.fields).sort()) {
      const expectedField = expected.fields[key];
      const observedField = observed.fields[key];
      const fieldPath = `${path}.${key}`;
      if (!observedField) {
        missing.push({ kind: 'field_missing', path: fieldPath, expected: shapeType(expectedField) });
      } else {
        collectShapeDrift(expectedField, observedField, fieldPath, typeChanges, missing, added, enumChanges);
      }
    }
    for (const key of Object.keys(observed.fields).sort()) {
      if (!expected.fields[key]) {
        added.push({ kind: 'field_added', path: `${path}.${key}`, observed: shapeType(observed.fields[key]) });
      }
    }
    return;
  }

  if (expected.type === 'array' && observed.type === 'array') {
    const itemCount = Math.min(expected.items.length, observed.items.length);
    for (let index = 0; index < itemCount; index += 1) {
      collectShapeDrift(
        expected.items[index],
        observed.items[index],
        `${path}[${index}]`,
        typeChanges,
        missing,
        added,
        enumChanges,
      );
    }
    if (expected.items.length > observed.items.length) {
      for (let index = observed.items.length; index < expected.items.length; index += 1) {
        missing.push({ kind: 'field_missing', path: `${path}[${index}]`, expected: shapeType(expected.items[index]) });
      }
    }
    if (observed.items.length > expected.items.length) {
      for (let index = expected.items.length; index < observed.items.length; index += 1) {
        added.push({ kind: 'field_added', path: `${path}[${index}]`, observed: shapeType(observed.items[index]) });
      }
    }
    return;
  }

  const expectedEnum = enumText(expected);
  const observedEnum = enumText(observed);
  if (expectedEnum !== observedEnum && expectedEnum) {
    enumChanges.push({ kind: 'enum_changed', path, expected: expectedEnum, observed: observedEnum });
  }
}

/** Compare two sanitized contract shapes without exposing either raw payload. */
export function diffContractShapes(expected: ContractShape, observed: ContractShape): readonly ContractDrift[] {
  const typeChanges: ContractDrift[] = [];
  const missing: ContractDrift[] = [];
  const added: ContractDrift[] = [];
  const enumChanges: ContractDrift[] = [];
  collectShapeDrift(expected, observed, '$', typeChanges, missing, added, enumChanges);
  return [...typeChanges, ...missing, ...added, ...enumChanges];
}

function collectUnsafePayload(
  value: unknown,
  path: string,
  errors: string[],
  parentKey?: string,
  identityContext: boolean = false,
): void {
  if (typeof value === 'string' && SENSITIVE_STRING_PATTERN.test(value)) {
    errors.push(`${path} contains sensitive content.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectUnsafePayload(item, `${path}[${index}]`, errors, parentKey, identityContext),
    );
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (isSensitiveKey(key, parentKey, identityContext)) {
        errors.push(`${childPath} uses a sensitive field name.`);
      } else {
        collectUnsafePayload(
          child,
          childPath,
          errors,
          key,
          identityContext || PERSON_IDENTITY_CONTAINERS.has(normalizeKey(key)),
        );
      }
    }
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isContractShape(value: unknown): value is ContractShape {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  if (value.type === 'object') {
    return (
      hasOnlyKeys(value, ['type', 'fields']) &&
      isRecord(value.fields) &&
      Object.entries(value.fields).every(
        ([key, child]) => key.trim().length > 0 && isContractShape(child),
      )
    );
  }
  if (value.type === 'array') {
    return (
      hasOnlyKeys(value, ['type', 'items']) &&
      Array.isArray(value.items) &&
      value.items.every(isContractShape)
    );
  }
  if (!['null', 'boolean', 'number', 'string'].includes(value.type)) {
    return false;
  }
  if (!hasOnlyKeys(value, ['type', 'enum'])) {
    return false;
  }
  if (!('enum' in value)) {
    return true;
  }
  if (value.type === 'null' || !Array.isArray(value.enum)) {
    return false;
  }
  return value.enum.every((item) => typeof item === value.type);
}

function collectUnsafeShapeEnums(
  shape: ContractShape,
  path: string,
  errors: string[],
): void {
  if (shape.type === 'object') {
    for (const [key, child] of Object.entries(shape.fields)) {
      collectUnsafeShapeEnums(child, `${path}.fields.${key}`, errors);
    }
    return;
  }
  if (shape.type === 'array') {
    shape.items.forEach((item, index) =>
      collectUnsafeShapeEnums(item, `${path}.items[${index}]`, errors),
    );
    return;
  }
  if (shape.enum) {
    shape.enum.forEach((item, index) => {
      if (typeof item === 'string' && SENSITIVE_STRING_PATTERN.test(item)) {
        errors.push(`${path}.enum[${index}] contains sensitive content.`);
      }
    });
  }
}

function collectUnexpectedKeys(
  value: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
  errors: string[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      errors.push(`${path}.${key} is not an allowed fixture field.`);
    }
  }
}

function withoutRedactedShapePath(
  shape: ContractShape,
  path: readonly string[],
): ContractShape {
  if (path.length === 0 || shape.type !== 'object') {
    return shape;
  }
  const [head, ...tail] = path;
  const child = shape.fields[head];
  if (!child) {
    return shape;
  }
  if (tail.length === 0) {
    return {
      type: 'object',
      fields: Object.fromEntries(
        Object.entries(shape.fields).filter(([key]) => key !== head),
      ),
    };
  }
  return {
    type: 'object',
    fields: {
      ...shape.fields,
      [head]: withoutRedactedShapePath(child, tail),
    },
  };
}

function shapeWithoutRedactedFields(
  shape: ContractShape,
  redactedFields: readonly string[],
): ContractShape {
  return redactedFields.reduce(
    (current, field) =>
      withoutRedactedShapePath(current, field.split('.')),
    shape,
  );
}

/** Validate fixture provenance and enforce the no-secret/no-PII storage rule. */
export function validateContractFixture(value: unknown): FixtureValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ['Fixture must be an object.'] };
  }
  collectUnexpectedKeys(value, '$', ['metadata', 'payload', 'shape'], errors);
  const metadata = value.metadata;
  if (!isRecord(metadata)) {
    errors.push('Fixture metadata is required.');
  } else {
    collectUnexpectedKeys(
      metadata,
      '$.metadata',
      ['id', 'schemaVersion', 'method', 'route', 'provenance', 'redactedFields'],
      errors,
    );
    collectUnsafePayload(metadata, '$.metadata', errors);
    if (typeof metadata.id !== 'string' || !metadata.id.trim()) {
      errors.push('Fixture metadata.id is required.');
    }
    if (metadata.schemaVersion !== 1) {
      errors.push('Fixture metadata.schemaVersion must be 1.');
    }
    if (typeof metadata.method !== 'string' || !metadata.method.trim()) {
      errors.push('Fixture metadata.method is required.');
    }
    if (typeof metadata.route !== 'string' || !metadata.route.startsWith('/')) {
      errors.push('Fixture metadata.route must be a relative route.');
    }
    const provenance = metadata.provenance;
    if (!isRecord(provenance)) {
      errors.push('Fixture metadata.provenance is required.');
    } else {
      collectUnexpectedKeys(
        provenance,
        '$.metadata.provenance',
        ['observedAt', 'role', 'risk', 'trust'],
        errors,
      );
      if (typeof provenance.observedAt !== 'string' || !provenance.observedAt.trim()) {
        errors.push('Fixture provenance.observedAt is required.');
      }
      if (typeof provenance.role !== 'string' || !provenance.role.trim()) {
        errors.push('Fixture provenance.role is required.');
      }
      if (typeof provenance.risk !== 'string' || !RISK_VALUES.has(provenance.risk as ContractRisk)) {
        errors.push('Fixture provenance.risk is invalid.');
      }
      if (typeof provenance.trust !== 'string' || !TRUST_VALUES.has(provenance.trust as ContractTrust)) {
        errors.push('Fixture provenance.trust is invalid.');
      }
    }
    if (
      'redactedFields' in metadata &&
      (!Array.isArray(metadata.redactedFields) ||
        !metadata.redactedFields.every(
          (field) =>
            typeof field === 'string' &&
            /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/i.test(field),
        ))
    ) {
      errors.push('Fixture metadata.redactedFields must contain safe dotted field paths.');
    }
  }
  if (!('payload' in value)) {
    errors.push('Fixture payload is required.');
  } else {
    collectUnsafePayload(value.payload, '$.payload', errors);
  }
  if ('shape' in value) {
    if (!isContractShape(value.shape)) {
      errors.push('Fixture shape is invalid.');
    } else {
      collectUnsafeShapeEnums(value.shape, '$.shape', errors);
      const redactedFields =
        isRecord(metadata) && Array.isArray(metadata.redactedFields)
          ? metadata.redactedFields.filter(
              (field): field is string =>
                typeof field === 'string' &&
                /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/i.test(field),
            )
          : [];
      const declaredSafeShape = shapeWithoutRedactedFields(
        value.shape,
        redactedFields,
      );
      const payloadShape = normalizeProductionPayload(value.payload);
      if (JSON.stringify(declaredSafeShape) !== JSON.stringify(payloadShape)) {
        errors.push(
          'Fixture shape does not match its sanitized payload after declared redactions.',
        );
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Load one named fixture from a caller-supplied fixture catalog directory. */
export async function loadContractFixture(root: URL | string, id: string): Promise<ContractFixture> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
    throw new Error('Contract fixture id must contain only letters, numbers, and hyphens.');
  }
  const rootPath = resolve(typeof root === 'string' ? root : fileURLToPath(root));
  const fixturePath = resolve(rootPath, `${id}.json`);
  if (!fixturePath.startsWith(`${rootPath}${sep}`)) {
    throw new Error('Contract fixture path escapes its catalog.');
  }
  const parsed: unknown = JSON.parse(await readFile(fixturePath, 'utf8'));
  const validation = validateContractFixture(parsed);
  if (!validation.valid) {
    throw new Error(`Invalid contract fixture ${id}: ${validation.errors.join(' ')}`);
  }
  return parsed as ContractFixture;
}
