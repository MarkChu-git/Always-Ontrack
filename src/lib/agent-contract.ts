import { AgentProtocolError } from './agent-protocol.js';

export const AGENT_SAFE_TEXT_PATTERN =
  /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u;
export const AGENT_NONEMPTY_SAFE_TEXT_PATTERN =
  /^(?=.*\S)[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+$/u;
export const AGENT_MULTILINE_SAFE_TEXT_PATTERN =
  /^[^\u0000-\u0009\u000b-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}]*$/u;
export const AGENT_RFC3339_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

export function remoteContractFailure(summary: string): never {
  throw new AgentProtocolError({ code: 'REMOTE_UNAVAILABLE', summary });
}

export function hasOwnField(
  record: Record<string, unknown>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function contractRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    remoteContractFailure(`OnTrack returned malformed ${context} metadata.`);
  }
  return value as Record<string, unknown>;
}

export function contractPositiveInteger(
  value: unknown,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    remoteContractFailure(`OnTrack returned an invalid ${context}.`);
  }
  return value;
}

export function contractNonNegativeInteger(
  value: unknown,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    remoteContractFailure(`OnTrack returned an invalid ${context}.`);
  }
  return value;
}

export function contractSafeText(
  value: unknown,
  maxLength: number,
  context: string,
): string {
  if (typeof value !== 'string' || !AGENT_SAFE_TEXT_PATTERN.test(value)) {
    remoteContractFailure(`OnTrack returned an invalid ${context}.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    remoteContractFailure(`OnTrack returned an invalid ${context}.`);
  }
  return normalized;
}

/** Return whether a value is a real RFC 3339 instant without accepting arbitrary text. */
export function isAgentRfc3339Timestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = AGENT_RFC3339_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = match.slice(1, 4).map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

/** Validate and normalize timestamps so Agent outputs cannot carry arbitrary text. */
export function contractRfc3339Timestamp(
  value: unknown,
  context: string,
): string {
  if (!isAgentRfc3339Timestamp(value)) {
    remoteContractFailure(`OnTrack returned an invalid ${context}.`);
  }
  return new Date(Date.parse(value)).toISOString();
}

/** Normalize feedback-style text while allowing line feeds but rejecting other controls. */
export function contractSafeMultilineText(
  value: unknown,
  maxLength: number,
  context: string,
): string {
  if (typeof value !== 'string') {
    remoteContractFailure(`OnTrack returned an invalid ${context}.`);
  }
  const normalized = value.replace(/\r\n?/gu, '\n').trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    !AGENT_MULTILINE_SAFE_TEXT_PATTERN.test(normalized)
  ) {
    remoteContractFailure(`OnTrack returned an invalid ${context}.`);
  }
  return normalized;
}

export function contractAliasedValue<T>(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
  parse: (value: unknown, context: string) => T,
): T | null {
  const rawValues = keys
    .filter((key) => hasOwnField(record, key))
    .map((key) => record[key]);
  if (rawValues.length === 0) {
    return null;
  }
  if (rawValues.some((value) => value === undefined)) {
    remoteContractFailure(`OnTrack returned an invalid ${context}.`);
  }
  if (
    rawValues.some((value) => value === null) &&
    rawValues.some((value) => value !== null)
  ) {
    remoteContractFailure(`OnTrack returned conflicting ${context} aliases.`);
  }
  if (rawValues.every((value) => value === null)) {
    return null;
  }
  const values = rawValues.map((value) => parse(value, context));
  if (values.some((value) => value !== values[0])) {
    remoteContractFailure(`OnTrack returned conflicting ${context} aliases.`);
  }
  return values[0] ?? null;
}

export function contractAliasedArray(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
  required: true,
): unknown[];
export function contractAliasedArray(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
  required: false,
): unknown[] | undefined;
/** Read equal snake/camel collection aliases without accepting malformed arrays. */
export function contractAliasedArray(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
  required: boolean,
): unknown[] | undefined {
  const presentKeys = keys.filter((key) => hasOwnField(record, key));
  if (presentKeys.length === 0) {
    if (required) {
      remoteContractFailure(`OnTrack omitted ${context}.`);
    }
    return undefined;
  }
  const values = presentKeys.map((key) => record[key]);
  if (values.some((value) => !Array.isArray(value))) {
    remoteContractFailure(`OnTrack returned an invalid ${context}.`);
  }
  if (
    values.length > 1 &&
    values.slice(1).some((value) => JSON.stringify(value) !== JSON.stringify(values[0]))
  ) {
    remoteContractFailure(`OnTrack returned conflicting ${context} aliases.`);
  }
  return values[0] as unknown[];
}

export function requiredContractPositiveInteger(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
): number {
  const value = contractAliasedValue(
    record,
    keys,
    context,
    contractPositiveInteger,
  );
  if (value === null) {
    remoteContractFailure(`OnTrack omitted ${context}.`);
  }
  return value;
}

export interface ContractProjectUnit {
  readonly id: number;
  readonly code: string | null;
  readonly name: string | null;
}

/** Resolve the authoritative project unit across nested and flat API aliases. */
export function contractProjectUnit(
  project: Record<string, unknown>,
): ContractProjectUnit {
  const rawUnit = hasOwnField(project, 'unit') ? project.unit : undefined;
  const unit = rawUnit === undefined
    ? undefined
    : contractRecord(rawUnit, 'project unit');
  const nestedIdPresent = unit ? hasOwnField(unit, 'id') : false;
  const nestedId = unit
    ? contractAliasedValue(unit, ['id'], 'unit id', contractPositiveInteger)
    : null;
  const flatIdPresent = ['unitId', 'unit_id'].some((key) =>
    hasOwnField(project, key),
  );
  const flatId = contractAliasedValue(
    project,
    ['unitId', 'unit_id'],
    'unit id',
    contractPositiveInteger,
  );
  if (
    (nestedId !== null && flatIdPresent && flatId === null) ||
    (flatId !== null && nestedIdPresent && nestedId === null)
  ) {
    remoteContractFailure('OnTrack returned conflicting unit identity aliases.');
  }
  if (nestedId !== null && flatId !== null && nestedId !== flatId) {
    remoteContractFailure('OnTrack returned conflicting unit identities.');
  }
  const id = nestedId ?? flatId;
  if (id === null) {
    remoteContractFailure('OnTrack omitted unit id.');
  }
  return {
    id,
    code: unit
      ? contractAliasedValue(unit, ['code'], 'unit code', (value, context) =>
          contractSafeText(value, 80, context))
      : null,
    name: unit
      ? contractAliasedValue(unit, ['name'], 'unit name', (value, context) =>
          contractSafeText(value, 512, context))
      : null,
  };
}
