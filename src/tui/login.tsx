/**
 * Login wizard. The user first chooses this-machine capture, pairing, or
 * terminal username/password. Pairing shows the link and code while it waits;
 * this-machine capture pops a visible browser on a display; terminal uses
 * self-drawn credential fields and parks MFA callbacks (method pick, TOTP,
 * Okta Verify number) in the wizard.
 *
 * OpenTUI inputs have no secure-echo mode, so password-style fields are
 * self-drawn. Bracketed paste is not a keypress, so those fields also wire
 * `usePaste` (decode with `decodePasteBytes` + `stripAnsiSequences`).
 *
 * The actual browser/pairing/guided flow lives behind the injectable
 * LoginRunner; this component only renders the picker, credentials, progress,
 * MFA, and classified failure, and bridges esc/r keyboard intent.
 *
 * The keyboard handler reads state through the ref mirror, never through
 * render closures: under testRender the useKeyboard handler can observe a
 * stale render closure after a state update. Refs are always current in both
 * renderers.
 */
import { useEffect, useRef, useState } from 'react';
import { useKeyboard, usePaste } from '@opentui/react';
import { decodePasteBytes, stripAnsiSequences } from '@opentui/core';
import type { MfaMethodOption, SsoFallbackReason, SsoStep } from '../lib/auto-login';
import type { AuthDiagnosticSink } from '../lib/auth-diagnostic';
import {
  LOGIN_METHOD_NUMBER,
  availableLoginMethods,
  type LoginMethod,
} from '../lib/login-method';
import {
  isLoginFailure,
  type LoginRequest,
  type LoginRunner,
  type PairingSessionInfo,
} from './auth';
import type { Theme } from './theme';

type Stage =
  | { kind: 'choose'; selected: LoginMethod }
  | { kind: 'credentials'; field: 'username' | 'password' }
  | { kind: 'running'; method: LoginMethod; pairing: PairingSessionInfo | null; step: SsoStep; numbers: string[] | null }
  | { kind: 'mfa_select'; options: MfaMethodOption[]; selected: number }
  | { kind: 'mfa_code'; label: string }
  | { kind: 'failed'; method: LoginMethod; reason: SsoFallbackReason; step?: string; message: string };

const submittingPassword = 'Submitting password…';
const STEP_LABEL: Record<SsoStep, string> = {
  username: 'Submitting username…',
  password: submittingPassword,
  mfa_select: 'Reading security methods…',
  mfa_code: 'Waiting for verification code…',
  mfa_wait: 'Approve the request in Okta Verify on your phone…',
  completed: 'SSO flow completed.',
  fallback: 'Switching sign-in strategy…',
};

/** Honest, user-actionable labels for the classified fallback reasons. */
const REASON_LABEL: Record<SsoFallbackReason, string> = {
  captcha: 'Captcha challenge detected — solve it via `ontrack login` in a terminal',
  unsupported_mfa: 'This MFA method is not supported by the browser flow',
  selector_missing: 'The SSO page layout changed unexpectedly',
  timeout: 'Timed out waiting for the sign-in to complete',
  browser_unavailable: 'No usable browser engine found on this machine',
  automation_error: 'The sign-in flow hit an error',
};

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function LoginWizard({
  theme,
  run,
  onSignedIn,
  onCancel,
  onDiagnostic,
  pairingAvailable = true,
}: {
  theme: Theme;
  run: LoginRunner;
  onSignedIn: (username: string) => void;
  onCancel: () => void;
  onDiagnostic: AuthDiagnosticSink;
  pairingAvailable?: boolean;
}) {
  const methods = availableLoginMethods(pairingAvailable);
  const methodsRef = useRef(methods);
  methodsRef.current = methods;
  const [stage, setStageState] = useState<Stage>({
    kind: 'choose',
    selected: methods[0]?.id ?? 'browser',
  });
  const [username, setUsernameState] = useState('');
  const [password, setPasswordState] = useState('');
  const [mfaCode, setMfaCodeState] = useState('');
  const [spin, setSpin] = useState(0);
  const [attempt, setAttempt] = useState(0);

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
  const methodRef = useRef<LoginMethod>(methods[0]?.id ?? 'browser');
  const requestRef = useRef<LoginRequest>({ method: 'browser' });

  // Async runner callbacks outlive renders; gate every setState through live.
  const liveRef = useRef(true);
  const cancelledRef = useRef(false);
  const mfaSelectResolver = useRef<((id: number | null) => void) | null>(null);
  const mfaCodeResolver = useRef<((code: string | null) => void) | null>(null);
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const onDiagnosticRef = useRef(onDiagnostic);
  onDiagnosticRef.current = onDiagnostic;
  const pairingAvailableRef = useRef(pairingAvailable);
  pairingAvailableRef.current = pairingAvailable;

  const begin = (method: Exclude<LoginMethod, 'terminal'>) => {
    methodRef.current = method;
    requestRef.current = { method };
    cancelledRef.current = false;
    setStage({ kind: 'running', method, pairing: null, step: 'username', numbers: null });
    setAttempt((n) => n + 1);
  };

  const startTerminal = (user: string, pass: string) => {
    methodRef.current = 'terminal';
    requestRef.current = { method: 'terminal', username: user, password: pass };
    cancelledRef.current = false;
    setStage({ kind: 'running', method: 'terminal', pairing: null, step: 'username', numbers: null });
    setAttempt((n) => n + 1);
  };

  const openCredentials = () => {
    methodRef.current = 'terminal';
    setStage({ kind: 'credentials', field: 'username' });
  };

  useEffect(
    () => () => {
      liveRef.current = false;
    },
    [],
  );

  const busy = stage.kind === 'running' || stage.kind === 'mfa_select' || stage.kind === 'mfa_code';
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setSpin((n) => n + 1), 120);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (attempt === 0) return;
    cancelledRef.current = false;
    run(
      {
        onPairingSession: (info) => {
          if (!liveRef.current || cancelledRef.current) return;
          setStage({
            kind: 'running',
            method: methodRef.current,
            pairing: info,
            step: 'username',
            numbers: null,
          });
        },
        onDiagnostic: (diagnostic) => {
          if (!liveRef.current || cancelledRef.current) return;
          onDiagnosticRef.current(diagnostic);
        },
        onStep: (step) => {
          if (!liveRef.current || cancelledRef.current) return;
          setStage((prev) =>
            prev.kind === 'running'
              ? { ...prev, step }
              : { kind: 'running', method: methodRef.current, pairing: null, step, numbers: null },
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
              selected: Math.max(0, options.findIndex((option) => option.recommended)),
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
      requestRef.current,
    )
      .then((name) => {
        setPassword(() => '');
        if (liveRef.current && !cancelledRef.current) onSignedInRef.current(name);
      })
      .catch((error: unknown) => {
        setPassword(() => '');
        if (!liveRef.current || cancelledRef.current) return;
        const failure = isLoginFailure(error)
          ? error
          : {
              reason: 'automation_error' as const,
              message: error instanceof Error ? error.message : String(error),
            };
        setStage({ kind: 'failed', method: methodRef.current, ...failure });
      });
    // The runner and callbacks are stable across renders; `attempt` restarts.
  }, [attempt, run]);

  const cancel = () => {
    cancelledRef.current = true;
    mfaSelectResolver.current?.(null);
    mfaCodeResolver.current?.(null);
    // The browser/pairing/guided flow itself is not abortable — it keeps
    // running in the background until it settles or hits its timeout. Its
    // late result is ignored via the cancelled gate; a session it may have
    // persisted simply becomes usable on the next load.
    onCancelRef.current();
  };

  const answerMfaSelect = (id: number) => {
    mfaSelectResolver.current?.(id);
    mfaSelectResolver.current = null;
    setStage({ kind: 'running', method: 'terminal', pairing: null, step: 'mfa_wait', numbers: null });
  };

  const appendField = (text: string) => {
    const current = stageRef.current;
    if (current.kind === 'credentials') {
      if (current.field === 'username') setUsername((value) => value + text);
      else setPassword((value) => value + text);
      return;
    }
    if (current.kind === 'mfa_code') {
      setMfaCode((value) => value + text);
    }
  };

  usePaste((event) => {
    const current = stageRef.current;
    if (current.kind !== 'credentials' && current.kind !== 'mfa_code') return;
    const text = stripAnsiSequences(decodePasteBytes(event.bytes)).replace(/[\r\n]+/g, '');
    if (!text) return;
    appendField(text);
  });

  useKeyboard((key) => {
    const current = stageRef.current;
    if (key.name === 'escape') {
      if (current.kind === 'credentials') {
        setStage({ kind: 'choose', selected: 'terminal' });
        return;
      }
      cancel();
      return;
    }
    if (current.kind === 'failed' && key.name === 'r') {
      if (current.method === 'terminal') {
        setStage({ kind: 'credentials', field: 'password' });
        return;
      }
      begin(current.method);
      return;
    }
    if (current.kind === 'choose') {
      const options = methodsRef.current;
      if (key.name === 'up' || key.name === 'down') {
        const idx = options.findIndex((choice) => choice.id === current.selected);
        const delta = key.name === 'up' ? -1 : 1;
        const next = options[(idx + delta + options.length) % options.length];
        if (next) setStage({ kind: 'choose', selected: next.id });
        return;
      }
      if (key.name === '1') {
        begin('browser');
        return;
      }
      if (key.name === '2' && pairingAvailableRef.current) {
        begin('pair');
        return;
      }
      if (key.name === '3') {
        openCredentials();
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        if (current.selected === 'terminal') openCredentials();
        else begin(current.selected);
      }
      return;
    }
    if (current.kind === 'credentials') {
      if (key.name === 'tab' || key.name === 'up' || key.name === 'down') {
        setStage({
          kind: 'credentials',
          field: current.field === 'username' ? 'password' : 'username',
        });
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        if (current.field === 'username') {
          if (usernameRef.current.trim()) setStage({ kind: 'credentials', field: 'password' });
        } else if (usernameRef.current.trim() && passwordRef.current) {
          startTerminal(usernameRef.current.trim(), passwordRef.current);
        }
        return;
      }
      if (key.name === 'backspace') {
        if (current.field === 'username') setUsername((value) => value.slice(0, -1));
        else setPassword((value) => value.slice(0, -1));
        return;
      }
      if (key.sequence.length === 1 && !key.ctrl && !key.meta) {
        appendField(key.sequence);
      }
      return;
    }
    if (current.kind === 'mfa_select') {
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
      if (key.name === 'return' || key.name === 'enter') {
        const option = current.options[current.selected];
        if (option) answerMfaSelect(option.id);
        return;
      }
      if (/^[1-9]$/.test(key.sequence)) {
        const option = current.options.find((item) => item.id === Number(key.sequence));
        if (option) answerMfaSelect(option.id);
      }
      return;
    }
    if (current.kind === 'mfa_code') {
      if (key.name === 'return' || key.name === 'enter') {
        if (mfaCodeRef.current.trim()) {
          mfaCodeResolver.current?.(mfaCodeRef.current.trim());
          mfaCodeResolver.current = null;
          setStage({
            kind: 'running',
            method: 'terminal',
            pairing: null,
            step: 'mfa_wait',
            numbers: null,
          });
        }
        return;
      }
      if (key.name === 'backspace') {
        setMfaCode((value) => value.slice(0, -1));
        return;
      }
      if (key.sequence.length === 1 && !key.ctrl && !key.meta) {
        appendField(key.sequence);
      }
    }
  });

  const chooseHint = pairingAvailable
    ? '↑↓ select · 1 this machine · 2 pairing · 3 terminal · enter · esc cancel'
    : '↑↓ select · 1 this machine · 3 terminal · enter · esc cancel';
  const hint =
    stage.kind === 'choose'
      ? chooseHint
      : stage.kind === 'credentials'
        ? 'tab switch field · enter next · esc back'
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
          width: 72,
        }}
      >
        <text>
          <strong fg={theme.fg}>Sign in to OnTrack</strong>
          <span fg={theme.muted}>  Monash SSO</span>
        </text>

        {stage.kind === 'choose' ? (
          <box style={{ flexDirection: 'column', gap: 1 }}>
            <text fg={theme.muted}>Choose how to sign in</text>
            {methods.map((choice) => {
              const selected = stage.selected === choice.id;
              return (
                <box key={choice.id} style={{ flexDirection: 'column', gap: 0 }}>
                  <text>
                    <span fg={selected ? theme.accent : theme.muted}>
                      {selected ? '▸ ' : '  '}
                      {LOGIN_METHOD_NUMBER[choice.id]}. {choice.title}
                      {choice.recommended ? '  recommended' : ''}
                    </span>
                  </text>
                  <text fg={theme.muted}>    {choice.summary}</text>
                </box>
              );
            })}
          </box>
        ) : null}

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
              <span fg={theme.fg}>
                {stage.pairing
                  ? 'Waiting for pairing sign-in…'
                  : stage.method === 'pair'
                    ? 'Preparing pairing sign-in…'
                    : stage.method === 'terminal'
                      ? STEP_LABEL[stage.step]
                      : 'Opening a browser on this machine…'}
              </span>
            </text>
            {stage.pairing ? (
              <box style={{ flexDirection: 'column', gap: 0 }}>
                <text fg={theme.muted}>Open this link on any device:</text>
                <text fg={theme.accent}>{stage.pairing.pairingUrl}</text>
                <text>
                  <span fg={theme.muted}>Pairing code: </span>
                  <strong fg={theme.soon}>{stage.pairing.displayCode}</strong>
                </text>
              </box>
            ) : null}
            {stage.method === 'terminal' && stage.step === 'mfa_wait' && stage.numbers && stage.numbers.length > 0 ? (
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
