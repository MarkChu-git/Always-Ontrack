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
import type { GuidedLoginRunner } from '../src/tui/auth';
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

/** Type credentials into the wizard's self-drawn fields (password second). */
async function fillCredentials(setup: TuiSetup, user: string, pass: string) {
  await act(async () => {
    await setup.mockInput.pressKeys(user.split(''));
    await settle();
    await setup.mockInput.pressKey('ARROW_DOWN'); // switch to the password field
    await settle();
    await setup.mockInput.pressKeys(pass.split(''));
    await settle();
  });
}

// Scenario A: happy path with an Okta Verify number challenge.
let seenCreds: { username: string; password: string } | null = null;
let releaseMfaWait: (() => void) | null = null;
const happyRunner: GuidedLoginRunner = async (creds, hooks) => {
  seenCreds = creds;
  hooks.onStep('username');
  hooks.onStep('password');
  hooks.onStep('mfa_wait');
  hooks.onMfaNumberChallenge(['42', '17', '93']);
  await new Promise<void>((resolve) => {
    releaseMfaWait = resolve;
  });
  return creds.username;
};
const wizardSetup = await testRender(
  <App load={wizardLoader()} auth={{ login: happyRunner, logout: async () => {} }} />,
  { width: 100, height: 32 },
);
await openWizard(wizardSetup);
check('l opens the login wizard', wizardSetup.captureCharFrame(), [
  'Sign in to OnTrack',
  'Username',
  'Password',
]);

await fillCredentials(wizardSetup, 'jdoe', 'hunter2');
check('password is masked', wizardSetup.captureCharFrame(), ['jdoe', '••••••']);

await act(async () => {
  await wizardSetup.mockInput.pressKey('RETURN');
  await settle();
});
check('mfa wait shows the number challenge', wizardSetup.captureCharFrame(), [
  'Approve the request in Okta Verify',
  'Tap',
  '42',
]);

await act(async () => {
  releaseMfaWait!();
  await settle();
});
await act(async () => {
  await settle();
});
check('successful login reloads into the task view', wizardSetup.captureCharFrame(), [
  'alice.zhang',
  'Tasks (7)',
]);
if (seenCreds?.username !== 'jdoe' || seenCreds?.password !== 'hunter2') {
  failures += 1;
  console.error('FAIL runner received the typed credentials');
} else {
  console.log('ok   runner received the typed credentials');
}
await act(async () => {
  wizardSetup.renderer.destroy();
});

// Scenario B: MFA method selection resolves the parked callback.
let chosenMfaId: number | null = null;
const selectRunner: GuidedLoginRunner = async (creds, hooks) => {
  hooks.onStep('mfa_select');
  chosenMfaId = await hooks.chooseMfaMethod([
    { id: 1, label: 'Okta Verify', recommended: true },
    { id: 2, label: 'SMS' },
  ]);
  return creds.username;
};
const selectSetup = await testRender(
  <App load={wizardLoader()} auth={{ login: selectRunner, logout: async () => {} }} />,
  { width: 100, height: 32 },
);
await openWizard(selectSetup);
await fillCredentials(selectSetup, 'jdoe', 'hunter2');
await act(async () => {
  await selectSetup.mockInput.pressKey('RETURN');
  await settle();
});
check('mfa select lists the methods', selectSetup.captureCharFrame(), [
  'Choose a security method',
  'Okta Verify',
  '(Recommended)',
  'SMS',
]);
await act(async () => {
  await selectSetup.mockInput.pressKey('2');
  await settle();
});
await act(async () => {
  await settle();
});
check('mfa choice completes the login', selectSetup.captureCharFrame(), ['Tasks (7)']);
if (chosenMfaId !== 2) {
  failures += 1;
  console.error(`FAIL mfa choice resolved with ${chosenMfaId}, expected 2`);
} else {
  console.log('ok   mfa choice resolved with id 2');
}
await act(async () => {
  selectSetup.renderer.destroy();
});

// Scenario C: MFA code entry resolves the parked callback.
let seenMfaCode: string | null = null;
const codeRunner: GuidedLoginRunner = async (creds, hooks) => {
  hooks.onStep('mfa_code');
  seenMfaCode = await hooks.requestMfaCode('Okta Verify');
  return creds.username;
};
const codeSetup = await testRender(
  <App load={wizardLoader()} auth={{ login: codeRunner, logout: async () => {} }} />,
  { width: 100, height: 32 },
);
await openWizard(codeSetup);
await fillCredentials(codeSetup, 'jdoe', 'hunter2');
await act(async () => {
  await codeSetup.mockInput.pressKey('RETURN');
  await settle();
});
check('mfa code prompt renders', codeSetup.captureCharFrame(), [
  'Okta Verify: enter the current code',
]);
await act(async () => {
  await codeSetup.mockInput.pressKeys(['1', '2', '3', '4', '5', '6']);
  await settle();
  await codeSetup.mockInput.pressKey('RETURN');
  await settle();
});
await act(async () => {
  await settle();
});
check('mfa code completes the login', codeSetup.captureCharFrame(), ['Tasks (7)']);
if (seenMfaCode !== '123456') {
  failures += 1;
  console.error(`FAIL mfa code resolved with ${seenMfaCode}, expected 123456`);
} else {
  console.log('ok   mfa code resolved with 123456');
}
await act(async () => {
  codeSetup.renderer.destroy();
});

// Scenario D: classified failure renders, r returns to credentials.
const failRunner: GuidedLoginRunner = async () => {
  throw {
    reason: 'timeout',
    step: 'mfa_wait',
    message: 'Timed out while waiting for the browser authentication flow.',
  };
};
const failSetup = await testRender(
  <App load={wizardLoader()} auth={{ login: failRunner, logout: async () => {} }} />,
  { width: 100, height: 32 },
);
await openWizard(failSetup);
await fillCredentials(failSetup, 'jdoe', 'hunter2');
await act(async () => {
  await failSetup.mockInput.pressKey('RETURN');
  await settle();
});
check('classified failure renders', failSetup.captureCharFrame(), [
  'Timed out waiting for the SSO flow',
  'r retry',
]);
await act(async () => {
  await failSetup.mockInput.pressKey('r');
  await settle();
});
check('r after failure returns to credentials', failSetup.captureCharFrame(), ['Password']);
await act(async () => {
  await failSetup.mockInput.pressKey('ESCAPE');
  await settle();
});
check('esc leaves the wizard', failSetup.captureCharFrame(), ['Not signed in']);
await act(async () => {
  failSetup.renderer.destroy();
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
check('second /logout signs out', logoutSetup.captureCharFrame(), ['Not signed in']);
if (logoutCalls !== 1) {
  failures += 1;
  console.error(`FAIL logout ran ${logoutCalls} times, expected 1`);
} else {
  console.log('ok   logout ran exactly once');
}
await act(async () => {
  logoutSetup.renderer.destroy();
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

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nall smoke checks passed');
