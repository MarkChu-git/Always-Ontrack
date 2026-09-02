interface TuiModule {
  readonly runTui: () => Promise<void>;
}

function resolveTuiModuleUrl(moduleUrl: string): URL {
  const extension = moduleUrl.endsWith('.ts') ? 'tsx' : 'js';
  return new URL(`../tui/index.${extension}`, moduleUrl);
}

/** Load the separately built OpenTUI renderer only for human TUI invocations. */
export async function launchTui(): Promise<void> {
  const moduleUrl = resolveTuiModuleUrl(import.meta.url);
  const tuiModule = (await import(moduleUrl.href)) as TuiModule;
  await tuiModule.runTui();
}
