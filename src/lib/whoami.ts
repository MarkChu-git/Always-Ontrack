import type { SessionData } from './types.js';

/** Explicitly safe identity fields rendered by the `whoami` command. */
export interface WhoAmIView {
  username: string;
  id?: number;
  role?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  savedAt: string;
}

/** Return a new, allowlisted identity projection that never contains session credentials. */
export function toWhoAmIView(session: SessionData): WhoAmIView {
  const user = session.user as Record<string, unknown>;
  const role = nonBlankStringValue(user.role) ?? nonBlankStringValue(user.system_role);

  return {
    username: session.username,
    id: numberValue(user.id),
    role,
    firstName: stringValue(user.firstName) ?? stringValue(user.first_name),
    lastName: stringValue(user.lastName) ?? stringValue(user.last_name),
    email: stringValue(user.email),
    savedAt: session.savedAt,
  };
}

/** Keep only primitive string identity values, excluding arbitrary nested user payload fields. */
function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Ignore blank role values so the established system_role fallback remains available. */
function nonBlankStringValue(value: unknown): string | undefined {
  const string = stringValue(value);
  return string?.trim() ? string : undefined;
}

/** Keep only numeric user ids from the persisted profile snapshot. */
function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
