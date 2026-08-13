/**
 * Guided SSO login wizard. A staged state machine rendered over the app:
 * credentials → (running / mfa_select / mfa_code) → done|failed.
 *
 * The actual browser automation lives behind the injectable GuidedLoginRunner;
 * this component only bridges its async callbacks (chooseMfaMethod,
 * requestMfaCode, onMfaNumberChallenge) to keyboard/mouse interaction by
 * parking each callback's Promise resolver until the user answers.
 *
 * Inputs are self-drawn (password masked) instead of using InputRenderable:
 * OpenTUI has no secure-echo mode, and self-drawn fields avoid the testRender
 * focus/settle quirks documented in AGENTS.md.
 *
 * The keyboard handler reads state through ref mirrors (stageRef & friends),
 * never through render closures: under testRender the useKeyboard handler can
 * observe a stale render closure after a state update, which would misroute
 * keystrokes. Refs are always current in both renderers.
 */
import { useEffect, useRef, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import type { MfaMethodOption, SsoFallbackReason, SsoStep } from '../lib/auto-login';
import { isGuidedLoginFailure, type GuidedLoginRunner } from './auth';
import type { Theme } from './theme';

type Stage =
  | { kind: 'credentials'; field: 'username' | 'password' }
  | { kind: 'running'; step: SsoStep; numbers: string[] | null }
  | { kind: 'mfa_select'; options: MfaMethodOption[]; selected: number }
  | { kind: 'mfa_code'; label: string }
  | { kind: 'failed'; reason: SsoFallbackReason; step?: SsoStep; message: string };

const STEP_LABEL: Record<SsoStep, string> = {
  username: 'Submitting username…',
  password: 'Submitting password…',
  mfa_select: 'Reading security methods…',
  mfa_code: 'Waiting for verification code…',
  mfa_wait: 'Approve the request in Okta Verify on your phone…',
  completed: 'SSO flow completed.',
  fallback: 'Switching sign-in strategy…',
};

/** Honest, user-actionable labels for the classified fallback reasons. */
const REASON_LABEL: Record<SsoFallbackReason, string> = {
  captcha: 'Captcha challenge detected — solve it via `ontrack login` in a terminal',
  unsupported_mfa: 'This MFA method is not supported by the guided flow',
  selector_missing: 'The SSO page layout changed unexpectedly',
  timeout: 'Timed out waiting for the SSO flow',
  browser_unavailable: 'No usable browser engine found on this machine',
  automation_error: 'The sign-in automation hit an error',
};

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function LoginWizard({
  theme,
  run,
  onSignedIn,
  onCancel,
}: {
  theme: Theme;
  run: GuidedLoginRunner;
  onSignedIn: (username: string) => void;
  onCancel: () => void;
}) {
  const [stage, setStageState] = useState<Stage>({ kind: 'credentials', field: 'username' });
  const [username, setUsernameState] = useState('');
  const [password, setPasswordState] = useState('');
  const [mfaCode, setMfaCodeState] = useState('');
  const [spin, setSpin] = useState(0);

  // Ref mirrors: the keyboard handler's single source of truth (see header).
  const stageRef = useRef(stage);
  const usernameRef = useRef(username);
  const passwordRef = useRef(password);
  const mfaCodeRef = useRef(mfaCode);
  const setStage = (next: Stage | ((prev: Stage) => Stage)) => {
    stageRef.current = typeof next === 'function' ? next(stageRef.current) : next;
    setStageState(stageRef.current);
  };
  const setUsername = (next: (prev: string) => string) => {
    usernameRef.current = next(usernameRef.current);
    setUsernameState(usernameRef.current);
  };
  const setPassword = (next: (prev: string) => string) => {
    passwordRef.current = next(passwordRef.current);
    setPasswordState(passwordRef.current);
  };
  const setMfaCode = (next: (prev: string) => string) => {
    mfaCodeRef.current = next(mfaCodeRef.current);
    setMfaCodeState(mfaCodeRef.current);
  };

  // Async runner callbacks outlive renders; gate every setState through live.
  const liveRef = useRef(true);
  const cancelledRef = useRef(false);
  const mfaSelectResolver = useRef<((id: number | null) => void) | null>(null);
  const mfaCodeResolver = useRef<((code: string | null) => void) | null>(null);
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(
    () => () => {
      liveRef.current = false;
    },
    [],
  );

  const busy = stage.kind !== 'credentials' && stage.kind !== 'failed';
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setSpin((n) => n + 1), 120);
    return () => clearInterval(timer);
  }, [busy]);

  const start = (user: string, pass: string) => {
    setStage({ kind: 'running', step: 'username', numbers: null });
    run(
      { username: user, password: pass },
      {
        onStep: (step) => {
          if (!liveRef.current || cancelledRef.current) return;
          setStage((prev) =>
            prev.kind === 'running' ? { ...prev, step } : { kind: 'running', step, numbers: null },
          );
        },
        chooseMfaMethod: (options) =>
          new Promise<number | null>((resolve) => {
            if (!liveRef.current || cancelledRef.current) {
              resolve(null);
              return;
            }
            mfaSelectResolver.current = resolve;
            setStage({
              kind: 'mfa_select',
              options,
              selected: Math.max(0, options.findIndex((o) => o.recommended)),
            });
          }),
        requestMfaCode: (label) =>
          new Promise<string | null>((resolve) => {
            if (!liveRef.current || cancelledRef.current) {
              resolve(null);
              return;
            }
            mfaCodeResolver.current = resolve;
            setMfaCode(() => '');
            setStage({ kind: 'mfa_code', label });
          }),
        onMfaNumberChallenge: (numbers) => {
          if (!liveRef.current || cancelledRef.current) return;
          setStage((prev) => (prev.kind === 'running' ? { ...prev, numbers } : prev));
        },
      },
    )
      .then((name) => {
        setPassword(() => '');
        if (liveRef.current && !cancelledRef.current) onSignedInRef.current(name);
      })
      .catch((error: unknown) => {
        setPassword(() => '');
        if (!liveRef.current || cancelledRef.current) return;
        const failure = isGuidedLoginFailure(error)
          ? error
          : {
              reason: 'automation_error' as const,
              message: error instanceof Error ? error.message : String(error),
            };
        setStage({ kind: 'failed', ...failure });
      });
  };

  const cancel = () => {
    cancelledRef.current = true;
    // Parked MFA callbacks are released so the runner can unwind, but the
    // headless browser flow itself is not abortable — it keeps running in the
    // background until it settles or hits the SSO timeout. Its late result is
    // ignored via the cancelled gate; a session it may have persisted simply
    // becomes usable on the next load.
    mfaSelectResolver.current?.(null);
    mfaCodeResolver.current?.(null);
    onCancelRef.current();
  };

  const answerMfaSelect = (id: number) => {
    mfaSelectResolver.current?.(id);
    mfaSelectResolver.current = null;
    setStage({ kind: 'running', step: 'mfa_wait', numbers: null });
  };

  useKeyboard((key) => {
    const current = stageRef.current;
    if (key.name === 'escape') {
      cancel();
      return;
    }
    switch (current.kind) {
      case 'credentials': {
        if (key.name === 'tab' || key.name === 'up' || key.name === 'down') {
          setStage({
            kind: 'credentials',
            field: current.field === 'username' ? 'password' : 'username',
          });
          return;
        }
        if (key.name === 'return') {
          if (current.field === 'username') {
            if (usernameRef.current.trim()) setStage({ kind: 'credentials', field: 'password' });
          } else if (usernameRef.current.trim() && passwordRef.current) {
            start(usernameRef.current.trim(), passwordRef.current);
          }
          return;
        }
        if (key.name === 'backspace') {
          if (current.field === 'username') setUsername((u) => u.slice(0, -1));
          else setPassword((p) => p.slice(0, -1));
          return;
        }
        if (key.sequence.length === 1 && !key.ctrl && !key.meta) {
          if (current.field === 'username') setUsername((u) => u + key.sequence);
          else setPassword((p) => p + key.sequence);
        }
        return;
      }
      case 'mfa_select': {
        if (key.name === 'up') {
          setStage({ ...current, selected: Math.max(0, current.selected - 1) });
          return;
        }
        if (key.name === 'down') {
          setStage({
            ...current,
            selected: Math.min(current.options.length - 1, current.selected + 1),
          });
          return;
        }
        if (key.name === 'return') {
          answerMfaSelect(current.options[current.selected].id);
          return;
        }
        if (/^[1-9]$/.test(key.sequence)) {
          const option = current.options.find((o) => o.id === Number(key.sequence));
          if (option) answerMfaSelect(option.id);
        }
        return;
      }
      case 'mfa_code': {
        if (key.name === 'return') {
          if (mfaCodeRef.current.trim()) {
            mfaCodeResolver.current?.(mfaCodeRef.current.trim());
            mfaCodeResolver.current = null;
            setStage({ kind: 'running', step: 'mfa_wait', numbers: null });
          }
          return;
        }
        if (key.name === 'backspace') {
          setMfaCode((c) => c.slice(0, -1));
          return;
        }
        if (key.sequence.length === 1 && !key.ctrl && !key.meta) {
          setMfaCode((c) => c + key.sequence);
        }
        return;
      }
      case 'failed': {
        // Keep the username; only the password must be re-entered.
        if (key.name === 'r') setStage({ kind: 'credentials', field: 'password' });
        return;
      }
      default:
        return;
    }
  });

  const hint =
    stage.kind === 'credentials'
      ? 'tab switch field · enter next · esc cancel'
      : stage.kind === 'mfa_select'
        ? '↑↓ choose · enter confirm · esc cancel'
        : stage.kind === 'mfa_code'
          ? 'enter submit · esc cancel'
          : stage.kind === 'failed'
            ? 'r retry · esc back'
            : 'esc cancel';

  return (
    <box
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.bg,
      }}
    >
      <box
        style={{
          border: true,
          borderStyle: 'rounded',
          borderColor: stage.kind === 'failed' ? theme.urgent : theme.accent,
          backgroundColor: theme.panel,
          padding: 2,
          flexDirection: 'column',
          gap: 1,
          width: 64,
        }}
      >
        <text>
          <strong fg={theme.fg}>Sign in to OnTrack</strong>
          <span fg={theme.muted}>  Monash SSO</span>
        </text>

        {stage.kind === 'credentials' ? (
          <box style={{ flexDirection: 'column', gap: 0 }}>
            {(
              [
                { label: 'Username', value: username, masked: false, id: 'username' as const },
                { label: 'Password', value: password, masked: true, id: 'password' as const },
              ]
            ).map((field) => {
              const active = stage.field === field.id;
              return (
                <box
                  key={field.id}
                  onMouseDown={() => setStage({ kind: 'credentials', field: field.id })}
                  style={{ flexDirection: 'row' }}
                >
                  <text>
                    <span fg={active ? theme.accent : theme.muted}>
                      {active ? '▸' : ' '} {field.label.padEnd(10)}
                    </span>
                    <span fg={theme.fg}>
                      {field.masked ? '•'.repeat(field.value.length) : field.value}
                    </span>
                    {active ? <span fg={theme.accent}>█</span> : null}
                  </text>
                </box>
              );
            })}
          </box>
        ) : null}

        {stage.kind === 'running' ? (
          <box style={{ flexDirection: 'column', gap: 1 }}>
            <text>
              <span fg={theme.accent}>{SPINNER[spin % SPINNER.length]} </span>
              <span fg={theme.fg}>{STEP_LABEL[stage.step]}</span>
            </text>
            {stage.step === 'mfa_wait' && stage.numbers && stage.numbers.length > 0 ? (
              <text>
                <span fg={theme.muted}>Tap </span>
                <strong fg={theme.soon}>{stage.numbers.join('  ')}</strong>
                <span fg={theme.muted}> in Okta Verify</span>
              </text>
            ) : null}
          </box>
        ) : null}

        {stage.kind === 'mfa_select' ? (
          <box style={{ flexDirection: 'column', gap: 0 }}>
            <text fg={theme.muted}>Choose a security method:</text>
            {stage.options.map((option, i) => (
              <box
                key={option.id}
                onMouseDown={() => answerMfaSelect(option.id)}
                style={{
                  paddingLeft: 1,
                  backgroundColor: i === stage.selected ? theme.selection : undefined,
                }}
              >
                <text>
                  <span fg={i === stage.selected ? theme.accent : theme.fg}>
                    {option.id}. {option.label}
                  </span>
                  {option.recommended ? <span fg={theme.muted}> (Recommended)</span> : null}
                </text>
              </box>
            ))}
          </box>
        ) : null}

        {stage.kind === 'mfa_code' ? (
          <box style={{ flexDirection: 'column', gap: 0 }}>
            <text fg={theme.muted}>{stage.label}: enter the current code</text>
            <text>
              <span fg={theme.accent}>▸ Code     </span>
              <span fg={theme.fg}>{mfaCode}</span>
              <span fg={theme.accent}>█</span>
            </text>
          </box>
        ) : null}

        {stage.kind === 'failed' ? (
          <box style={{ flexDirection: 'column', gap: 1 }}>
            <text>
              <strong fg={theme.urgent}>{REASON_LABEL[stage.reason]}</strong>
            </text>
            <text fg={theme.muted}>{stage.message}</text>
          </box>
        ) : null}

        <text fg={theme.muted}>{hint}</text>
      </box>
    </box>
  );
}
