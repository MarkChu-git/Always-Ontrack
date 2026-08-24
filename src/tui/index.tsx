#!/usr/bin/env bun
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './app';
import { loadOnTrackTasks } from './data';

export async function runTui(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  });

  createRoot(renderer).render(<App load={loadOnTrackTasks} />);
}

if (import.meta.main) {
  await runTui();
}
