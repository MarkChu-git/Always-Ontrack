/**
 * Pairing vs this-machine browser capture vs terminal username/password.
 * Interactive login asks; flags and non-TTY callers skip the prompt. Pairing
 * stays the non-interactive default whenever a relay is configured, so scripts
 * and e2e keep working. Without a relay, the non-interactive default is
 * this-machine capture; an interactive terminal can still pick terminal SSO.
 */
export type LoginMethod = 'pair' | 'browser' | 'terminal';

export const LOGIN_METHOD_NUMBER: Record<LoginMethod, '1' | '2' | '3'> = {
  browser: '1',
  pair: '2',
  terminal: '3',
};

export const LOGIN_METHOD_CHOICES: readonly {
  id: LoginMethod;
  title: string;
  summary: string;
  recommended?: boolean;
}[] = [
  {
    id: 'browser',
    title: 'This machine',
    summary: 'Open a browser here. Renews silently for about a week.',
    recommended: true,
  },
  {
    id: 'pair',
    title: 'Pairing',
    summary: 'Use any already signed-in browser. Short session.',
  },
  {
    id: 'terminal',
    title: 'Terminal',
    summary: 'Type username and password here. Hidden browser fills Okta.',
  },
];

/** Drop pairing when no relay is configured; keep the 1 / 3 numbering. */
export function availableLoginMethods(pairingAvailable: boolean) {
  return LOGIN_METHOD_CHOICES.filter((choice) => pairingAvailable || choice.id !== 'pair');
}

/** Non-interactive fallback when the caller did not pass a method flag. */
export function defaultLoginMethod(relayAvailable: boolean): LoginMethod {
  return relayAvailable ? 'pair' : 'browser';
}

/** Map a typed answer to a method; null means ask again. */
export function parseLoginMethodChoice(raw: string): LoginMethod | null {
  const trimmed = raw.trim().toLowerCase();
  if (
    trimmed === '1' ||
    trimmed === 'b' ||
    trimmed === 'browser' ||
    trimmed === 'auto' ||
    trimmed === 'this'
  ) {
    return 'browser';
  }
  if (
    trimmed === '2' ||
    trimmed === 'p' ||
    trimmed === 'pair' ||
    trimmed === 'pairing'
  ) {
    return 'pair';
  }
  if (
    trimmed === '3' ||
    trimmed === 't' ||
    trimmed === 'terminal' ||
    trimmed === 'sso' ||
    trimmed === 'guided'
  ) {
    return 'terminal';
  }
  return null;
}

/**
 * Whether an interactive terminal should ask how to sign in.
 * Explicit headless/CI must not block on stdin (e2e sets ONTRACK_HEADLESS).
 * An SSH TTY still asks: pairing is available there, and so is the prompt.
 */
export function shouldPromptLoginMethod(
  env: NodeJS.ProcessEnv = process.env,
  streams: {
    stdin: Pick<NodeJS.ReadStream, 'isTTY'>;
    stdout: Pick<NodeJS.WriteStream, 'isTTY'>;
  } = { stdin: process.stdin, stdout: process.stdout },
): boolean {
  if (env.ONTRACK_HEADLESS === '1' || env.ONTRACK_HEADLESS === 'true') {
    return false;
  }
  if (env.CI && env.CI !== 'false') {
    return false;
  }
  return Boolean(streams.stdin.isTTY && streams.stdout.isTTY);
}

/**
 * Flag-driven method, or `'choose'` when an interactive terminal should ask.
 * `--auto` / `--no-pair` force this-machine capture; `--pair` forces pairing;
 * `--sso` forces terminal username/password. A missing relay still returns
 * `'choose'` so a TTY can pick terminal SSO; the caller maps `'choose'` on a
 * non-TTY to pairing when a relay exists, otherwise this-machine capture.
 */
export function resolveLoginMethod(options: {
  auto: boolean;
  pairFlag: boolean;
  noPairFlag: boolean;
  sso: boolean;
  relayAvailable: boolean;
}): LoginMethod | 'choose' {
  if (options.sso) {
    return 'terminal';
  }
  if (options.auto || options.noPairFlag) {
    return 'browser';
  }
  if (options.pairFlag) {
    return 'pair';
  }
  void options.relayAvailable;
  return 'choose';
}
