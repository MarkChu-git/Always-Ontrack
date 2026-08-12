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
import { App } from '../src/tui/app';
import type { GuidedLoginRunner } from '../src/tui/auth';
import type { LoadState } from '../src/tui/data';
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

const setup = await testRender(<App load={readyLoad} />, { width: 100, height: 32 });
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

/** Type credentials into the wizard's self-drawn fields and submit. */
async function fillCredentials(
  mockInput: (typeof authSetup)['mockInput'],
  user: string,
  pass: string,
) {
  await act(async () => {
    await mockInput.pressKeys(user.split(''));
    await settle();
    await mockInput.pressKey('ARROW_DOWN'); // switch to the password field
    await settle();
    await mockInput.pressKeys(pass.split(''));
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
await act(async () => {
  await wizardSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
// The async loader resolves outside the act batch; one more tick paints
// the auth_required screen before l can open the wizard.
await act(async () => {
  await settle();
});
await act(async () => {
  await wizardSetup.mockInput.pressKey('l');
  await settle();
});
check('l opens the login wizard', wizardSetup.captureCharFrame(), [
  'Sign in to OnTrack',
  'Username',
  'Password',
]);

await fillCredentials(wizardSetup.mockInput, 'jdoe', 'hunter2');
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
await act(async () => {
  await selectSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
await act(async () => {
  await settle();
});
await act(async () => {
  await selectSetup.mockInput.pressKey('l');
  await settle();
});
await fillCredentials(selectSetup.mockInput, 'jdoe', 'hunter2');
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
await act(async () => {
  await codeSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
await act(async () => {
  await settle();
});
await act(async () => {
  await codeSetup.mockInput.pressKey('l');
  await settle();
});
await fillCredentials(codeSetup.mockInput, 'jdoe', 'hunter2');
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
await act(async () => {
  await failSetup.mockInput.pressKey('ARROW_DOWN');
  await settle();
});
await act(async () => {
  await settle();
});
await act(async () => {
  await failSetup.mockInput.pressKey('l');
  await settle();
});
await fillCredentials(failSetup.mockInput, 'jdoe', 'hunter2');
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

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nall smoke checks passed');
