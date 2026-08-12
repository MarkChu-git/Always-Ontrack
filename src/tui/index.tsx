#!/usr/bin/env bun
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './app';
import { loadOnTrackTasks } from './data';

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
});

createRoot(renderer).render(<App load={loadOnTrackTasks} />);
