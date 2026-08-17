/**
 * Login wizard. There are no credential fields by design: locally the runner
 * pops a visible browser window and the user signs in through the real SSO
 * pages; on headless environments the runner pairs through the blind relay
 * and the wizard shows the pairing link and code while it waits.
 *
 * The actual browser/pairing flow lives behind the injectable LoginRunner;
 * this component only renders its progress (spinner, pairing session info)
 * and its classified failure, and bridges esc/r keyboard intent.
 *
 * The keyboard handler reads state through the ref mirror, never through
 * render closures: under testRender the useKeyboard handler can observe a
 * stale render closure after a state update. Refs are always current in both
 * renderers.
 */
import { useEffect, useRef, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import type { SsoFallbackReason } from '../lib/auto-login';
import { isLoginFailure, type LoginRunner, type PairingSessionInfo } from './auth';
import type { Theme } from './theme';

type Stage =
  | { kind: 'running'; pairing: PairingSessionInfo | null }
  | { kind: 'failed'; reason: SsoFallbackReason; step?: string; message: string };

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
}: {
  theme: Theme;
  run: LoginRunner;
  onSignedIn: (username: string) => void;
  onCancel: () => void;
}) {
  const [stage, setStageState] = useState<Stage>({ kind: 'running', pairing: null });
  const [spin, setSpin] = useState(0);
  const [attempt, setAttempt] = useState(0);

  // Ref mirror: the keyboard handler's single source of truth (see header).
  const stageRef = useRef(stage);
  const setStage = (next: Stage) => {
    stageRef.current = next;
    setStageState(next);
  };

  // Async runner callbacks outlive renders; gate every setState through live.
  const liveRef = useRef(true);
  const cancelledRef = useRef(false);
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

  useEffect(() => {
    if (stage.kind === 'failed') return;
    const timer = setInterval(() => setSpin((n) => n + 1), 120);
    return () => clearInterval(timer);
  }, [stage.kind]);

  useEffect(() => {
    cancelledRef.current = false;
    run({
      onPairingSession: (info) => {
        if (!liveRef.current || cancelledRef.current) return;
        setStage({ kind: 'running', pairing: info });
      },
    })
      .then((name) => {
        if (liveRef.current && !cancelledRef.current) onSignedInRef.current(name);
      })
      .catch((error: unknown) => {
        if (!liveRef.current || cancelledRef.current) return;
        const failure = isLoginFailure(error)
          ? error
          : {
              reason: 'automation_error' as const,
              message: error instanceof Error ? error.message : String(error),
            };
        setStage({ kind: 'failed', ...failure });
      });
    // The runner and callbacks are stable across renders; `attempt` restarts.
  }, [attempt, run]);

  const cancel = () => {
    cancelledRef.current = true;
    // The browser/pairing flow itself is not abortable — it keeps running in
    // the background until it settles or hits its timeout. Its late result is
    // ignored via the cancelled gate; a session it may have persisted simply
    // becomes usable on the next load.
    onCancelRef.current();
  };

  useKeyboard((key) => {
    if (key.name === 'escape') {
      cancel();
      return;
    }
    if (stageRef.current.kind === 'failed' && key.name === 'r') {
      setStage({ kind: 'running', pairing: null });
      setAttempt((n) => n + 1);
    }
  });

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

        {stage.kind === 'running' ? (
          <box style={{ flexDirection: 'column', gap: 1 }}>
            <text>
              <span fg={theme.accent}>{SPINNER[spin % SPINNER.length]} </span>
              <span fg={theme.fg}>
                {stage.pairing
                  ? 'Waiting for pairing sign-in…'
                  : 'Preparing sign-in…'}
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

        <text fg={theme.muted}>
          {stage.kind === 'failed' ? 'r retry · esc back' : 'esc cancel'}
        </text>
      </box>
    </box>
  );
}
