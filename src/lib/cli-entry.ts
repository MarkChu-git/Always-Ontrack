export interface CliTerminalState {
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
}

export type CliEntryResolution =
  | { readonly mode: 'tui'; readonly args: readonly string[] }
  | { readonly mode: 'welcome'; readonly args: readonly string[] }
  | { readonly mode: 'command'; readonly args: readonly string[] };

/** Resolve the human entry experience before normal command dispatch. */
export function resolveCliEntry(
  args: readonly string[],
  terminal: CliTerminalState,
): CliEntryResolution {
  if (args.length === 0) {
    return terminal.stdinIsTTY && terminal.stdoutIsTTY
      ? { mode: 'tui', args: [] }
      : { mode: 'welcome', args: [] };
  }

  return { mode: 'command', args: [...args] };
}
