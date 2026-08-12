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

const setup = await testRender(<App />, { width: 100, height: 32 });
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

// Wrap destroy in act: testRender's onDestroy unmounts the React root, and
// doing it outside act() prints a spurious "not wrapped in act" warning.
await act(async () => {
  renderer.destroy();
});

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nall smoke checks passed');
