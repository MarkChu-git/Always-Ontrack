/**
 * Headless smoke test for the TUI skeleton: renders frames via the OpenTUI
 * test renderer and asserts on the character grid, so no-TTY environments
 * (CI, agents) can verify the app boots and reacts to input.
 *
 * Note: under the React test renderer, a state update needs a short settle
 * before the input's key handling is rewired — hence the `settle()` pauses.
 * The real renderer handles this correctly without pauses.
 *
 * Run: bun scripts/smoke-tui.tsx
 */
import { testRender } from '@opentui/react/test-utils';
import { act } from 'react';
import { AgentProtocolError } from '../src/lib/agent-protocol';
import { OnTrackHttpError } from '../src/lib/auth';
import { App } from '../src/tui/app';
import type { LoginRunner } from '../src/tui/auth';
import type { LoadState } from '../src/tui/data';
import type { SetStatusRunner } from '../src/tui/status';
import type { SubmitActions, SubmitRequest } from '../src/tui/submit';
import type { TaskExtrasActions } from '../src/tui/task-extras';
import { FAKE_TASKS } from '../src/tui/tasks';

let failures = 0;

function check(label: string, frame: string, expected: string[]) {
  const missing = expected.filter((s) => !frame.includes(s));
  if (missing.length > 0) {
    failures += 1;
    console.error(`FAIL ${label}: missing ${JSON.stringify(missing)}`);
    console.error(frame);
  } else {
    console.log(`ok   ${label}`);
  }
}

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/** Locate a rendered string so tests can click it at its real coordinates. */
function locate(frame: string, text: string): { x: number; y: number } {
  const lines = frame.split('\n');
  for (let y = 0; y < lines.length; y++) {
    const x = lines[y].indexOf(text);
    if (x >= 0) return { x, y };
  }
  throw new Error(`"${text}" not found in frame`);
}

const readyLoad = async (): Promise<LoadState> => ({
  kind: 'ready',
  identity: { username: 'alice.zhang', savedAt: '2026-08-12T00:00:00.000Z' },
  expiresAt: new Date(Date.now() + 5.5 * 86_400_000).toISOString(),
  tasks: FAKE_TASKS,
});

/** Detail-pane extras stub: deterministic reads, no network or session. */
const stubExtras: TaskExtrasActions = {
  prerequisites: async () => ({ kind: 'ok', value: [] }),
  submissionStatus: async () => ({
    kind: 'ok',
    value: {
      pdfState: 'unavailable',
      submissionObserved: false,
      submissionDate: null,
      taskStatus: null,
    },
  }),
  downloadTaskPdf: async () => ({
    kind: 'ok',
    value: { path: 'downloads/FIT1045-P1-task.pdf', bytes: 1234 },
  }),
  downloadResources: async () => ({
    kind: 'ok',
    value: { path: 'downloads/FIT1045-P1-resources.zip', bytes: 567 },
  }),
  downloadSubmissionPdf: async () => ({
    kind: 'ok',
    value: { path: 'downloads/FIT1045-P1-submission.pdf', bytes: 890 },
  }),
};

const setup = await testRender(<App load={readyLoad} extras={stubExtras} />, {
  width: 100,
  height: 32,
});
const { renderer, mockInput, mockMouse, captureCharFrame } = setup;

// Warm-up keypress: forces the first real paint (capturing before any input
// cycle reads an uninitialized buffer) without touching the text input.
await act(async () => {
  await mockInput.pressKey('ARROW_DOWN');
  await mockInput.pressKey('ARROW_UP');
  await settle();
});
check('initial frame', captureCharFrame(), [
  'alice.zhang',
  '5d left',
  'FIT1045',
  'Tasks (7)',
  'P1: Algorithm design',
  'ctrl+k',
]);

await act(async () => {
  await mockInput.pressKeys(['q', 'u', 'i', 'z']);
  await settle();
});
check('filter narrows the list', captureCharFrame(), ['Tasks (1)', 'Quiz 3: Data']);

// A lone ESC byte needs a beat for the key parser to flush it.
await act(async () => {
  await mockInput.pressKey('ESCAPE');
  await settle();
});
check('esc clears the filter', captureCharFrame(), ['Tasks (7)']);

await act(async () => {
  await mockInput.pressKey('ARROW_DOWN');
  await settle();
  await mockInput.pressKey('RETURN');
  await settle();
});
// The detail-pane extras read resolves outside the act batch.
await act(async () => {
  await settle();
});
check('enter opens task detail', captureCharFrame(), ['H1: Code reading homework', 'click to close']);

await act(async () => {
  await mockInput.pressKey('ESCAPE');
  await settle();
});
// The list row (with status icon) — the same title also appears in the
// detail pane border, so locate by the row's unique icon prefix.
await act(async () => {
  const at = locate(captureCharFrame(), '◐ H1: Code reading');
  await mockMouse.click(at.x, at.y);
  await settle();
});
// The detail-pane extras read resolves outside the act batch.
await act(async () => {
  await settle();
});
check('click opens task detail', captureCharFrame(), ['click to close']);

await act(async () => {
  await mockMouse.click(50, 15); // inside the modal: closes it
  await settle();
});
check('click closes task detail', captureCharFrame(), ['Tasks (7)']);

await act(async () => {
  const at = locate(captureCharFrame(), 'watching');
  await mockMouse.click(at.x, at.y);
  await settle();
});
check('click toggles watch pill', captureCharFrame(), ['watch off']);

await act(async () => {
  const at = locate(captureCharFrame(), 'Done');
  await mockMouse.click(at.x, at.y);
  await settle();
});
check('click filters via tab', captureCharFrame(), ['Tasks (2)', 'Lab test 1']);

await act(async () => {
  await mockInput.pressKey('k', { ctrl: true });
  await settle();
});
check('ctrl+k opens command palette', captureCharFrame(), ['Type a command', '/login', '/quit']);

await act(async () => {
  await mockInput.pressKeys(['t', 'h', 'e', 'm', 'e']);
  await settle();
});
await act(async () => {
  await mockInput.pressKey('RETURN');
  await settle();
});
check('palette runs /theme and shows toast', captureCharFrame(), ['theme: light']);

await act(async () => {
  const at = locate(captureCharFrame(), 'FIT1045'); // header unit label (first occurrence)
  await mockMouse.click(at.x, at.y);
  await settle();
});
await act(async () => {
  const again = locate(captureCharFrame(), 'FIT1045');
  await mockMouse.click(again.x, again.y);
  await settle();
});
check('click cycles unit filter', captureCharFrame(), ['all units']);

// Wrap destroy in act: testRender's onDestroy unmounts the React root, and
// doing it outside act() prints a spurious "not wrapped in act" warning.
await act(async () => {
  renderer.destroy();
});

const authSetup = await testRender(
  <App load={async (): Promise<LoadState> => ({ kind: 'auth_required' })} />,
  { width: 100, height: 32 },
);
await act(async () => {
  await authSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
check('auth screen', authSetup.captureCharFrame(), ['Not signed in', 'l sign in', 'r retry']);
await act(async () => {
  authSetup.renderer.destroy();
});

// First load fails, pressing r retries and the second load succeeds.
let errCalls = 0;
const flakyLoad = async (): Promise<LoadState> => {
  errCalls += 1;
  return errCalls === 1 ? { kind: 'error', message: 'boom' } : readyLoad();
};
const errSetup = await testRender(<App load={flakyLoad} />, { width: 100, height: 32 });
await act(async () => {
  await errSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
check('error screen', errSetup.captureCharFrame(), ['Failed to load tasks', 'boom']);
await act(async () => {
  await errSetup.mockInput.pressKey('r');
  await settle();
});
// The async loader resolves outside the act batch; one more tick paints it.
await act(async () => {
  await settle();
});
check('r retries after error', errSetup.captureCharFrame(), ['Tasks (7)']);
await act(async () => {
  errSetup.renderer.destroy();
});

// --- Login wizard scenarios (fixture runners, no browser) -------------------

/** Loader that starts signed-out and becomes ready after the wizard succeeds. */
function wizardLoader() {
  let calls = 0;
  return async (): Promise<LoadState> => {
    calls += 1;
    return calls === 1 ? { kind: 'auth_required' } : readyLoad();
  };
}

type TuiSetup = Awaited<ReturnType<typeof testRender>>;

/** Warm up, wait for the signed-out screen to paint, then open the wizard. */
async function openWizard(setup: TuiSetup) {
  await act(async () => {
    await setup.mockInput.pressKey('ARROW_DOWN');
    await settle();
  });
  // The async loader resolves outside the act batch; one more tick paints
  // the auth_required screen before l can open the wizard.
  await act(async () => {
    await settle();
  });
  await act(async () => {
    await setup.mockInput.pressKey('l');
    await settle();
  });
}

/** Confirm the method picker. Split from openWizard: a mode-change key only
 *  flushes at an act boundary, so picker paint and confirm must not share one. */
async function confirmLoginMethod(
  setup: TuiSetup,
  key: 'RETURN' | '1' | '2' | '3' = 'RETURN',
) {
  await act(async () => {
    await setup.mockInput.pressKey(key);
    await settle();
  });
}

// Scenario A: happy path — the wizard opens on a method picker, then runs.
let releaseLogin: (() => void) | null = null;
const happyRunner: LoginRunner = async (hooks) => {
  await new Promise<void>((resolve) => {
    releaseLogin = resolve;
  });
  hooks.onDiagnostic?.({
    code: 'refresh_cookie_persistence_failed',
    message: 'Refresh cookie could not be persisted; silent renewal may be unavailable.',
  });
  return 'alice.zhang';
};
const wizardSetup = await testRender(
  <App
    load={wizardLoader()}
    auth={{
      login: happyRunner,
      logout: async () => ({ remoteSignOutFailed: false }),
    }}
  />,
  { width: 100, height: 32 },
);
await openWizard(wizardSetup);
check('l opens the login method picker', wizardSetup.captureCharFrame(), [
  'Sign in to OnTrack',
  'Choose how to sign in',
  'This machine',
  'recommended',
  'Pairing',
  'Terminal',
]);
await confirmLoginMethod(wizardSetup, '1');
check('1 starts this-machine sign-in', wizardSetup.captureCharFrame(), [
  'Opening a browser on this machine',
]);

await act(async () => {
  releaseLogin!();
  await settle();
});
await act(async () => {
  await settle();
});
check('successful login reloads into the task view', wizardSetup.captureCharFrame(), [
  'alice.zhang',
  'Tasks (7)',
  'Refresh cookie could not be persisted',
]);
await act(async () => {
  wizardSetup.renderer.destroy();
});

// Scenario B: pairing session info renders while the runner waits.
let releasePairing: (() => void) | null = null;
const pairingRunner: LoginRunner = async (hooks) => {
  hooks.onPairingSession?.({
    pairingUrl: 'https://pair.example.test/#c=abcdefghijklmnop&k=abc123',
    displayCode: 'abcd-efgh-ijkl-mnop',
  });
  await new Promise<void>((resolve) => {
    releasePairing = resolve;
  });
  return 'alice.zhang';
};
const pairingSetup = await testRender(
  <App
    load={wizardLoader()}
    auth={{
      login: pairingRunner,
      logout: async () => ({ remoteSignOutFailed: false }),
    }}
  />,
  { width: 100, height: 32 },
);
await openWizard(pairingSetup);
check('l opens the login method picker for pairing', pairingSetup.captureCharFrame(), [
  'Choose how to sign in',
]);
await confirmLoginMethod(pairingSetup, '2');
await act(async () => {
  await settle();
});
check('pairing link and code render', pairingSetup.captureCharFrame(), [
  'Waiting for pairing sign-in',
  'https://pair.example.test/#c=abcdefghijklmnop&k=abc123',
  'abcd-efgh-ijkl-mnop',
]);
await act(async () => {
  releasePairing!();
  await settle();
});
await act(async () => {
  await settle();
});
check('pairing login reloads into the task view', pairingSetup.captureCharFrame(), [
  'Tasks (7)',
]);
await act(async () => {
  pairingSetup.renderer.destroy();
});

// Scenario B2: 3 opens terminal username/password fields (hidden-browser SSO).
const terminalSetup = await testRender(
  <App
    load={wizardLoader()}
    auth={{
      login: happyRunner,
      logout: async () => ({ remoteSignOutFailed: false }),
    }}
  />,
  { width: 100, height: 32 },
);
await openWizard(terminalSetup);
await confirmLoginMethod(terminalSetup, '3');
check('3 opens terminal username and password fields', terminalSetup.captureCharFrame(), [
  'Username',
  'Password',
]);
await act(async () => {
  terminalSetup.renderer.destroy();
});

// Scenario B3: pairing off still offers this-machine and terminal, and does not auto-start.
const noPairPickerSetup = await testRender(
  <App
    load={wizardLoader()}
    auth={{
      login: happyRunner,
      logout: async () => ({ remoteSignOutFailed: false }),
      pairingAvailable: false,
    }}
  />,
  { width: 100, height: 32 },
);
await openWizard(noPairPickerSetup);
check('pairing off still shows this-machine and terminal', noPairPickerSetup.captureCharFrame(), [
  'This machine',
  'Terminal',
]);
if (noPairPickerSetup.captureCharFrame().includes('Opening a browser')) {
  failures += 1;
  console.error('FAIL pairing-off picker auto-started this-machine capture');
} else {
  console.log('ok   pairing-off picker does not auto-start');
}
await act(async () => {
  noPairPickerSetup.renderer.destroy();
});

// Scenario C: classified failure renders, esc leaves the wizard.
const failRunner: LoginRunner = async () => {
  throw {
    reason: 'timeout',
    step: 'mfa_wait',
    message: 'Timed out while waiting for the browser authentication flow.',
  };
};
const failSetup = await testRender(
  <App
    load={wizardLoader()}
    auth={{
      login: failRunner,
      logout: async () => ({ remoteSignOutFailed: false }),
    }}
  />,
  { width: 100, height: 32 },
);
await openWizard(failSetup);
await confirmLoginMethod(failSetup);
await act(async () => {
  await settle();
});
check('classified failure renders', failSetup.captureCharFrame(), [
  'Timed out waiting for the sign-in to complete',
  'r retry',
]);
await act(async () => {
  await failSetup.mockInput.pressKey('ESCAPE');
  await settle();
});
check('esc leaves the wizard', failSetup.captureCharFrame(), ['Not signed in']);
await act(async () => {
  failSetup.renderer.destroy();
});

// Scenario D: r after failure restarts the runner and can succeed.
let retryCalls = 0;
const retryRunner: LoginRunner = async () => {
  retryCalls += 1;
  if (retryCalls === 1) {
    throw { reason: 'timeout', message: 'Timed out while waiting.' };
  }
  return 'alice.zhang';
};
const retryLoginSetup = await testRender(
  <App
    load={wizardLoader()}
    auth={{
      login: retryRunner,
      logout: async () => ({ remoteSignOutFailed: false }),
    }}
  />,
  { width: 100, height: 32 },
);
await openWizard(retryLoginSetup);
await confirmLoginMethod(retryLoginSetup);
await act(async () => {
  await settle();
});
check('first attempt fails', retryLoginSetup.captureCharFrame(), ['r retry']);
await act(async () => {
  await retryLoginSetup.mockInput.pressKey('r');
  await settle();
});
await act(async () => {
  await settle();
});
check('r retries and completes the login', retryLoginSetup.captureCharFrame(), ['Tasks (7)']);
if (retryCalls !== 2) {
  failures += 1;
  console.error(`FAIL retry ran the runner ${retryCalls} times, expected 2`);
} else {
  console.log('ok   r retry restarted the runner');
}
await act(async () => {
  retryLoginSetup.renderer.destroy();
});

// Scenario E: /logout needs a second confirm, then clears back to signed-out.
let logoutCalls = 0;
const logoutSetup = await testRender(
  <App
    load={readyLoad}
    auth={{
      login: happyRunner,
      logout: async () => {
        logoutCalls += 1;
        return { remoteSignOutFailed: true };
      },
    }}
  />,
  { width: 100, height: 32 },
);
await act(async () => {
  await logoutSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
// Palette interactions split across act boundaries: the palette input's focus
// effect only flushes at an act edge under testRender (same rhythm as the
// /theme scenario above).
await act(async () => {
  await logoutSetup.mockInput.pressKey('k', { ctrl: true });
  await settle();
});
await act(async () => {
  await logoutSetup.mockInput.pressKeys(['l', 'o', 'g', 'o', 'u', 't']);
  await settle();
});
await act(async () => {
  await logoutSetup.mockInput.pressKey('RETURN');
  await settle();
});
check('first /logout only arms the confirm', logoutSetup.captureCharFrame(), [
  'run /logout again',
  'Tasks (7)',
]);
await act(async () => {
  await logoutSetup.mockInput.pressKey('k', { ctrl: true });
  await settle();
});
await act(async () => {
  await logoutSetup.mockInput.pressKeys(['l', 'o', 'g', 'o', 'u', 't']);
  await settle();
});
await act(async () => {
  await logoutSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await settle();
});
check('second /logout reports local-only success', logoutSetup.captureCharFrame(), [
  'Not signed in',
  'signed out locally',
]);
if (logoutCalls !== 1) {
  failures += 1;
  console.error(`FAIL logout ran ${logoutCalls} times, expected 1`);
} else {
  console.log('ok   logout ran exactly once');
}
await act(async () => {
  logoutSetup.renderer.destroy();
});

// Scenario F: a local-cleanup rejection is visible and never reported as success.
const failedLogoutSetup = await testRender(
  <App
    load={readyLoad}
    auth={{
      login: happyRunner,
      logout: async () => {
        throw new Error('private cleanup detail');
      },
    }}
  />,
  { width: 100, height: 32 },
);
await act(async () => {
  await failedLogoutSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
for (let attempt = 0; attempt < 2; attempt += 1) {
  await act(async () => {
    await failedLogoutSetup.mockInput.pressKey('k', { ctrl: true });
    await settle();
  });
  await act(async () => {
    await failedLogoutSetup.mockInput.pressKeys(['l', 'o', 'g', 'o', 'u', 't']);
    await settle();
  });
  await act(async () => {
    await failedLogoutSetup.mockInput.pressKey('RETURN');
    await settle();
  });
}
await act(async () => {
  await settle();
});
check('logout cleanup failure remains signed in and is visible', failedLogoutSetup.captureCharFrame(), [
  'Tasks (7)',
  'sign-out cleanup failed',
]);
await act(async () => {
  failedLogoutSetup.renderer.destroy();
});

// Scenario F: status trigger with a server-side remap (keyboard flow).
let seenWrite: { taskId: string; trigger: string } | null = null;
const remapRunner: SetStatusRunner = async ({ task, trigger }) => {
  seenWrite = { taskId: task.id, trigger };
  // The server answers 200 but maps the request to a different final status.
  return { kind: 'remapped', before: null, requested: trigger, after: 'working_on_it' };
};
const writeSetup = await testRender(
  <App load={readyLoad} extras={stubExtras} setStatus={remapRunner} />,
  {
    width: 100,
    height: 32,
  },
);
await act(async () => {
  await writeSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
await act(async () => {
  await writeSetup.mockInput.pressKey('RETURN');
  await settle();
});
// The detail-pane extras read resolves outside the act batch.
await act(async () => {
  await settle();
});
check('detail pane lists status triggers', writeSetup.captureCharFrame(), [
  'Set status',
  '[r]',
  'Ready for feedback',
]);
await act(async () => {
  await writeSetup.mockInput.pressKey('n');
  await settle();
});
check('trigger preselects with a confirm line', writeSetup.captureCharFrame(), [
  'Apply Not started?',
  'click again to confirm',
]);
await act(async () => {
  await writeSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await settle();
});
check('remap surfaces the server remap note', writeSetup.captureCharFrame(), [
  'server remapped to Working on it',
]);
// The detail pane covers the list; close it to see the patched row.
await act(async () => {
  await writeSetup.mockInput.pressKey('ESCAPE');
  await settle();
});
check('remap patches the row with the server status', writeSetup.captureCharFrame(), [
  '◐ P1: Algorithm',
]);
if (seenWrite?.taskId !== '1' || seenWrite?.trigger !== 'not_started') {
  failures += 1;
  console.error(`FAIL writer saw ${JSON.stringify(seenWrite)}, expected task 1 + not_started`);
} else {
  console.log('ok   writer received the selected task and trigger');
}
await act(async () => {
  writeSetup.renderer.destroy();
});

// Scenario G: a 200-level refusal surfaces and never patches the row (click flow).
const refuseRunner: SetStatusRunner = async () => ({
  kind: 'refused',
  before: 'ready_for_feedback',
});
const refuseSetup = await testRender(
  <App load={readyLoad} extras={stubExtras} setStatus={refuseRunner} />,
  {
    width: 100,
    height: 32,
  },
);
await act(async () => {
  await refuseSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
await act(async () => {
  await refuseSetup.mockInput.pressKey('RETURN');
  await settle();
});
// The detail-pane extras read resolves outside the act batch.
await act(async () => {
  await settle();
});
await act(async () => {
  const at = locate(refuseSetup.captureCharFrame(), '[w]');
  await refuseSetup.mockMouse.click(at.x, at.y);
  await settle();
});
check('click preselects a trigger', refuseSetup.captureCharFrame(), ['Apply Working on it?']);
await act(async () => {
  const at = locate(refuseSetup.captureCharFrame(), '[w]');
  await refuseSetup.mockMouse.click(at.x, at.y);
  await settle();
});
await act(async () => {
  await settle();
});
check('refusal is surfaced', refuseSetup.captureCharFrame(), ['refused']);
// Close the detail pane to verify the row kept its pre-write status.
await act(async () => {
  await refuseSetup.mockInput.pressKey('ESCAPE');
  await settle();
});
check('refusal leaves the row unchanged', refuseSetup.captureCharFrame(), [
  '● P1: Algorithm',
]);
await act(async () => {
  refuseSetup.renderer.destroy();
});

// Scenario H: the detail pane pulls prerequisites + submission status through
// the extras read path, and [d] downloads the task PDF.
const extrasSetup = await testRender(
  <App
    load={readyLoad}
    extras={{
      ...stubExtras,
      prerequisites: async () => ({
        kind: 'ok',
        value: [{ taskDefinitionId: 1002, requiredStatus: 'complete' }],
      }),
      submissionStatus: async () => ({
        kind: 'ok',
        value: {
          pdfState: 'processing',
          submissionObserved: true,
          submissionDate: '2026-08-12',
          taskStatus: 'ready_for_feedback',
        },
      }),
    }}
  />,
  { width: 100, height: 32 },
);
await act(async () => {
  await extrasSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
await act(async () => {
  await extrasSetup.mockInput.pressKey('RETURN');
  await settle();
});
// The extras reads resolve outside the act batch; one more tick paints them.
await act(async () => {
  await settle();
});
check('detail shows prerequisites from the read path', extrasSetup.captureCharFrame(), [
  'Requires',
  'H1: Code reading homework (complete)',
]);
check('detail shows the submission status line', extrasSetup.captureCharFrame(), [
  'Submission',
  'observed',
  'processing',
]);
await act(async () => {
  const at = locate(extrasSetup.captureCharFrame(), '[d]');
  await extrasSetup.mockMouse.click(at.x, at.y);
  await settle();
});
await act(async () => {
  await settle();
});
check('task PDF download toasts the saved path', extrasSetup.captureCharFrame(), [
  'saved → downloads/FIT1045-P1-task.pdf',
]);
await act(async () => {
  extrasSetup.renderer.destroy();
});

// Scenario I: submit wizard happy path — slots, validate, preflight, receipt.
let seenSubmit: SubmitRequest | null = null;
const okSubmit: SubmitActions = {
  inspect: async () => ({ size: 2048 }),
  run: async (request) => {
    seenSubmit = request;
    return {
      kind: 'completed',
      output: {
        command: 'submission upload',
        projectId: 101,
        unitCode: 'FIT1045',
        task: 'P1',
        taskDefinitionId: 1001,
        operationId: 'op_fixture',
        state: 'succeeded',
        dryRun: false,
        confirmed: true,
        verification: 'observed',
        trigger: 'ready_for_feedback',
        files: request.files.map((f) => ({ key: f.key ?? 'file0', bytes: 2048 })),
        upload: { status: 'response_accepted' },
        comment: { status: 'not_requested' },
      },
    };
  },
};
const submitSetup = await testRender(
  <App load={readyLoad} extras={stubExtras} submit={okSubmit} />,
  { width: 100, height: 32 },
);
await act(async () => {
  await submitSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
await act(async () => {
  await submitSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await submitSetup.mockInput.pressKey('s');
  await settle();
});
// The wizard's status read resolves outside the act batch.
await act(async () => {
  await settle();
});
check('submit wizard lists the evidence slots', submitSetup.captureCharFrame(), [
  'Submit: P1: Algorithm design workbook',
  'Evidence slots',
  'file0',
  'Workbook PDF',
  'file1',
]);
await act(async () => {
  await submitSetup.mockInput.pressKeys(['.', '/', 'a', '.', 'p', 'd', 'f']);
  await settle();
  await submitSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
  await submitSetup.mockInput.pressKeys(['.', '/', 'b', '.', 'p', 'd', 'f']);
  await settle();
});
check('typed paths render in the slot fields', submitSetup.captureCharFrame(), [
  './a.pdf',
  './b.pdf',
]);
await act(async () => {
  await submitSetup.mockInput.pressKey('RETURN');
  await settle();
});
// Validation (inspect) resolves outside the act batch.
await act(async () => {
  await settle();
});
check('preflight summarizes the dispatch', submitSetup.captureCharFrame(), [
  'Preflight',
  './a.pdf',
  '2.0 KB',
  'auto (server default)',
  'tui:',
]);
await act(async () => {
  await submitSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await settle();
});
check('receipt renders the server outcome', submitSetup.captureCharFrame(), [
  '✓ response accepted',
  'succeeded',
  'observed',
]);
if (
  seenSubmit?.mode !== 'upload' ||
  seenSubmit?.files.length !== 2 ||
  seenSubmit?.files[0].key !== 'file0' ||
  seenSubmit?.files[0].path !== './a.pdf' ||
  seenSubmit?.files[1].key !== 'file1' ||
  !seenSubmit?.idempotencyKey.startsWith('tui:')
) {
  failures += 1;
  console.error(`FAIL submit runner saw ${JSON.stringify(seenSubmit)}`);
} else {
  console.log('ok   submit runner received slots, mode and idempotency key');
}
await act(async () => {
  await submitSetup.mockInput.pressKey('ESCAPE');
  await settle();
});
await act(async () => {
  await settle();
});
check('closing the receipt refreshes the list', submitSetup.captureCharFrame(), ['Tasks (7)']);
await act(async () => {
  submitSetup.renderer.destroy();
});

// Scenario J: an unknown transport outcome is never auto-retried.
const unknownSubmit: SubmitActions = {
  inspect: async () => ({ size: 10 }),
  run: async () => {
    throw new AgentProtocolError({
      code: 'IDEMPOTENCY_OUTCOME_UNKNOWN',
      status: 'action_required',
      summary: 'Submission was dispatched once, but the transport outcome is unknown.',
    });
  },
};
const unknownSetup = await testRender(
  <App load={readyLoad} extras={stubExtras} submit={unknownSubmit} />,
  { width: 100, height: 32 },
);
await act(async () => {
  await unknownSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
await act(async () => {
  await unknownSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await unknownSetup.mockInput.pressKey('s');
  await settle();
});
await act(async () => {
  await settle();
});
await act(async () => {
  await unknownSetup.mockInput.pressKeys(['.', '/', 'a', '.', 'p', 'd', 'f']);
  await settle();
  await unknownSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
  await unknownSetup.mockInput.pressKeys(['.', '/', 'b', '.', 'p', 'd', 'f']);
  await settle();
});
await act(async () => {
  await unknownSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await settle();
});
await act(async () => {
  await unknownSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await settle();
});
check('unknown outcome is surfaced without a retry', unknownSetup.captureCharFrame(), [
  'Outcome unknown — not retried automatically',
  'journal key',
  'tui:',
  'submission status',
]);
await act(async () => {
  unknownSetup.renderer.destroy();
});

// Scenario K: ESC during the wizard's loading stage abandons the status read.
const hangingExtras: TaskExtrasActions = {
  ...stubExtras,
  submissionStatus: () => new Promise(() => {}),
};
const hangingSetup = await testRender(
  <App load={readyLoad} extras={hangingExtras} submit={okSubmit} />,
  { width: 100, height: 32 },
);
await act(async () => {
  await hangingSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
await act(async () => {
  await hangingSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await hangingSetup.mockInput.pressKey('s');
  await settle();
});
await act(async () => {
  await settle();
});
check(
  'wizard waits on the loading stage while the status read hangs',
  hangingSetup.captureCharFrame(),
  ['reading the current submission state'],
);
await act(async () => {
  await hangingSetup.mockInput.pressKey('ESCAPE');
  await settle();
});
await act(async () => {
  await settle();
});
check('ESC during loading abandons the wizard', hangingSetup.captureCharFrame(), [
  '[s] Submit files',
  'esc / click to close',
]);
await act(async () => {
  hangingSetup.renderer.destroy();
});

// Scenario L: a rejection followed by a re-dispatch mints a fresh claim key.
const attemptKeys: string[] = [];
let rejected = false;
const retrySubmit: SubmitActions = {
  inspect: async () => ({ size: 2048 }),
  run: async (request) => {
    attemptKeys.push(request.idempotencyKey);
    if (!rejected) {
      rejected = true;
      throw new OnTrackHttpError(422, 'files rejected');
    }
    return {
      kind: 'completed',
      output: {
        command: 'submission upload',
        projectId: 101,
        unitCode: 'FIT1045',
        task: 'P1',
        taskDefinitionId: 1001,
        operationId: 'op_fixture',
        state: 'succeeded',
        dryRun: false,
        confirmed: true,
        verification: 'observed',
        trigger: 'ready_for_feedback',
        files: request.files.map((f) => ({ key: f.key ?? 'file0', bytes: 2048 })),
        upload: { status: 'response_accepted' },
        comment: { status: 'not_requested' },
      },
    };
  },
};
const retrySetup = await testRender(
  <App load={readyLoad} extras={stubExtras} submit={retrySubmit} />,
  { width: 100, height: 32 },
);
await act(async () => {
  await retrySetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
await act(async () => {
  await retrySetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await retrySetup.mockInput.pressKey('s');
  await settle();
});
await act(async () => {
  await settle();
});
await act(async () => {
  await retrySetup.mockInput.pressKeys(['.', '/', 'a', '.', 'p', 'd', 'f']);
  await settle();
  await retrySetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
  await retrySetup.mockInput.pressKeys(['.', '/', 'b', '.', 'p', 'd', 'f']);
  await settle();
});
await act(async () => {
  await retrySetup.mockInput.pressKey('RETURN');
  await settle();
});
// Validation (inspect) resolves outside the act batch.
await act(async () => {
  await settle();
});
await act(async () => {
  await retrySetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await settle();
});
check('a definitive rejection lands on the failed stage', retrySetup.captureCharFrame(), [
  'rejected by the server (HTTP 422)',
  'r back to files',
]);
await act(async () => {
  await retrySetup.mockInput.pressKey('r');
  await settle();
});
await act(async () => {
  await retrySetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await settle();
});
await act(async () => {
  await retrySetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await settle();
});
check('the retry lands on the receipt', retrySetup.captureCharFrame(), ['✓ response accepted']);
if (
  attemptKeys.length !== 2 ||
  !attemptKeys.every((key) => key.startsWith('tui:')) ||
  attemptKeys[0] === attemptKeys[1]
) {
  failures += 1;
  console.error(`FAIL retry attempt keys ${JSON.stringify(attemptKeys)}`);
} else {
  console.log('ok   re-dispatch after a rejection mints a fresh idempotency key');
}
await act(async () => {
  retrySetup.renderer.destroy();
});

// Scenario M: bracketed paste fills the submit wizard's path fields.
let pasteSubmit: SubmitRequest | null = null;
const pasteSubmitActions: SubmitActions = {
  inspect: async () => ({ size: 2048 }),
  run: async (request) => {
    pasteSubmit = request;
    return {
      kind: 'completed',
      output: {
        command: 'submission upload',
        projectId: 101,
        unitCode: 'FIT1045',
        task: 'P1',
        taskDefinitionId: 1001,
        operationId: 'op_fixture',
        state: 'succeeded',
        dryRun: false,
        confirmed: true,
        verification: 'observed',
        trigger: 'ready_for_feedback',
        files: request.files.map((f) => ({ key: f.key ?? 'file0', bytes: 2048 })),
        upload: { status: 'response_accepted' },
        comment: { status: 'not_requested' },
      },
    };
  },
};
const pasteSubmitSetup = await testRender(
  <App load={readyLoad} extras={stubExtras} submit={pasteSubmitActions} />,
  { width: 100, height: 32 },
);
await act(async () => {
  await pasteSubmitSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
await act(async () => {
  await pasteSubmitSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await pasteSubmitSetup.mockInput.pressKey('s');
  await settle();
});
await act(async () => {
  await settle();
});
await act(async () => {
  await pasteSubmitSetup.mockInput.pasteBracketedText('/tmp/evidence final.pdf');
  await settle();
});
await act(async () => {
  await pasteSubmitSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
await act(async () => {
  await pasteSubmitSetup.mockInput.pasteBracketedText('/tmp/logs.txt');
  await settle();
});
check('pasted paths render in the slot fields', pasteSubmitSetup.captureCharFrame(), [
  '/tmp/evidence final.pdf',
  '/tmp/logs.txt',
]);
await act(async () => {
  await pasteSubmitSetup.mockInput.pressKey('RETURN');
  await settle();
});
// Validation (inspect) resolves outside the act batch.
await act(async () => {
  await settle();
});
await act(async () => {
  await pasteSubmitSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await settle();
});
check('paste-driven dispatch lands on the receipt', pasteSubmitSetup.captureCharFrame(), [
  '✓ response accepted',
]);
if (
  pasteSubmit?.files[0]?.path !== '/tmp/evidence final.pdf' ||
  pasteSubmit?.files[1]?.path !== '/tmp/logs.txt'
) {
  failures += 1;
  console.error(`FAIL submit runner saw ${JSON.stringify(pasteSubmit)}`);
} else {
  console.log('ok   submit runner received the pasted paths');
}
await act(async () => {
  pasteSubmitSetup.renderer.destroy();
});

// Scenario N: an auth-classified rejection mid-submit drops to the sign-in
// screen instead of posing as a server refusal.
const expiredSubmit: SubmitActions = {
  inspect: async () => ({ size: 10 }),
  run: async () => {
    throw new OnTrackHttpError(419, 'Authentication timeout');
  },
};
const expiredSetup = await testRender(
  <App load={readyLoad} extras={stubExtras} submit={expiredSubmit} />,
  { width: 100, height: 32 },
);
await act(async () => {
  await expiredSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
await act(async () => {
  await expiredSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await expiredSetup.mockInput.pressKey('s');
  await settle();
});
await act(async () => {
  await settle();
});
await act(async () => {
  await expiredSetup.mockInput.pressKeys(['.', '/', 'a', '.', 'p', 'd', 'f']);
  await settle();
  await expiredSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
  await expiredSetup.mockInput.pressKeys(['.', '/', 'b', '.', 'p', 'd', 'f']);
  await settle();
});
await act(async () => {
  await expiredSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await settle();
});
await act(async () => {
  await expiredSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await settle();
});
check('a 419 mid-submit drops to the sign-in screen', expiredSetup.captureCharFrame(), [
  'Not signed in',
  'session expired — sign in again',
]);
await act(async () => {
  expiredSetup.renderer.destroy();
});

// Scenario O: an auth-classified set-status rejection drops to the sign-in
// screen instead of a refusal toast.
const expiredStatusRunner: SetStatusRunner = async () => ({
  kind: 'rejected',
  error: new OnTrackHttpError(419, 'Authentication timeout'),
});
const expiredStatusSetup = await testRender(
  <App load={readyLoad} extras={stubExtras} setStatus={expiredStatusRunner} />,
  { width: 100, height: 32 },
);
await act(async () => {
  await expiredStatusSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
await act(async () => {
  await expiredStatusSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await settle();
});
await act(async () => {
  await expiredStatusSetup.mockInput.pressKey('n');
  await settle();
});
await act(async () => {
  await expiredStatusSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await settle();
});
check('a 419 set-status rejection drops to the sign-in screen', expiredStatusSetup.captureCharFrame(), [
  'Not signed in',
  'session expired — sign in again',
]);
await act(async () => {
  expiredStatusSetup.renderer.destroy();
});

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nall smoke checks passed');
