import { AgentProtocolError } from './agent-protocol.js';

export const AGENT_SAFE_TEXT_PATTERN =
  /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u;
export const AGENT_NONEMPTY_SAFE_TEXT_PATTERN =
  /^(?=.*\S)[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+$/u;

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
