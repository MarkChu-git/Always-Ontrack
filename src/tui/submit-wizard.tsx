/**
 * Submission wizard. A staged state machine rendered over the app:
 * loading (submission status) → editing (evidence files + comment) →
 * preflight → dispatching → receipt | failed | unknown.
 *
 * Discipline mirrors the login wizard (see AGENTS.md): fields are
 * self-drawn, and the keyboard handler reads state through ref mirrors,
 * never through render closures.
 *
 * Write-path rules inherited from the shared lib: the dispatch fires exactly
 * once per wizard attempt (guarded by the stage machine and a fresh
 * idempotency key minted as each preflight opens), and an unknown transport outcome
 * is never auto-retried — the wizard shows the journal key and points at the
 * detail pane's status line instead.
 */
import { useEffect, useRef, useState } from 'react';
import { randomUUID } from 'node:crypto';
import { useKeyboard, usePaste } from '@opentui/react';
import { decodePasteBytes, stripAnsiSequences } from '@opentui/core';
import { AgentProtocolError } from '../lib/agent-protocol';
import { OnTrackHttpError } from '../lib/auth';
import type { SubmissionTrigger } from '../lib/types';
import { redactSensitiveText } from '../lib/utils';
import type { SubmitActions, SubmitOutcome } from './submit';
import type { ExtrasResult, SubmissionStatusInfo } from './task-extras';
import type { Theme } from './theme';
import type { TuiTask, UploadSlot } from './tasks';

type Stage =
  | { kind: 'loading' }
  | { kind: 'editing' }
  | { kind: 'preflight' }
  | { kind: 'dispatching' }
  | { kind: 'receipt'; outcome: Extract<SubmitOutcome, { kind: 'completed' | 'replayed' }> }
  | { kind: 'failed'; message: string }
  | { kind: 'unknown'; operationId: string; summary: string };

/** Trigger choices on the preflight step; 'auto' derives from task status. */
const TRIGGER_CHOICES: { id: SubmissionTrigger | 'auto'; label: string }[] = [
  { id: 'auto', label: 'auto (server default)' },
  { id: 'need_help', label: 'need help' },
  { id: 'ready_for_feedback', label: 'ready for feedback' },
];

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function humanizeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Free-form submissions (no server requirements) get a single evidence slot. */
function slotsFor(task: TuiTask): UploadSlot[] {
  return task.uploadRequirements.length > 0
    ? task.uploadRequirements
    : [{ key: 'file0', name: 'Evidence file' }];
}

export function SubmitWizard({
  theme,
  task,
  submit,
  loadStatus,
  onClose,
  onAuthRequired,
}: {
  theme: Theme;
  task: TuiTask;
  submit: SubmitActions;
  loadStatus: () => Promise<ExtrasResult<SubmissionStatusInfo>>;
  /** submitted=true asks the app to refresh the catalogue on close. */
  onClose: (submitted: boolean) => void;
  onAuthRequired: () => void;
}) {
  const slots = slotsFor(task);
  const [stage, setStageState] = useState<Stage>({ kind: 'loading' });
  const [mode, setMode] = useState<'upload' | 'upload-new-files'>('upload');
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [paths, setPathsState] = useState<string[]>(slots.map(() => ''));
  const [pathErrors, setPathErrorsState] = useState<(string | null)[]>(slots.map(() => null));
  const [sizes, setSizesState] = useState<(number | null)[]>(slots.map(() => null));
  const [focusIdx, setFocusIdxState] = useState(0);
  const [allowExternal, setAllowExternalState] = useState(false);
  const [comment, setCommentState] = useState('');
  const [triggerIdx, setTriggerIdxState] = useState(0);
  const [spin, setSpin] = useState(0);

  // Ref mirrors: the keyboard handler's single source of truth.
  const stageRef = useRef(stage);
  const pathsRef = useRef(paths);
  const focusIdxRef = useRef(focusIdx);
  const allowExternalRef = useRef(allowExternal);
  const commentRef = useRef(comment);
  const triggerIdxRef = useRef(triggerIdx);
  const modeRef = useRef(mode);
  const setStage = (next: Stage | ((prev: Stage) => Stage)) => {
    stageRef.current = typeof next === 'function' ? next(stageRef.current) : next;
    setStageState(stageRef.current);
  };
  const setPaths = (next: (prev: string[]) => string[]) => {
    pathsRef.current = next(pathsRef.current);
    setPathsState(pathsRef.current);
  };
  const setFocusIdx = (next: number | ((prev: number) => number)) => {
    focusIdxRef.current = typeof next === 'function' ? next(focusIdxRef.current) : next;
    setFocusIdxState(focusIdxRef.current);
  };
  const setAllowExternal = (next: boolean) => {
    allowExternalRef.current = next;
    setAllowExternalState(next);
  };
  const setComment = (next: (prev: string) => string) => {
    commentRef.current = next(commentRef.current);
    setCommentState(commentRef.current);
  };
  const setTriggerIdx = (next: (prev: number) => number) => {
    triggerIdxRef.current = next(triggerIdxRef.current);
    setTriggerIdxState(triggerIdxRef.current);
  };

  /** Current attempt's dispatch claim key; re-minted on every preflight entry. */
  const operationIdRef = useRef(`tui:${randomUUID()}`);
  const liveRef = useRef(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onAuthRequiredRef = useRef(onAuthRequired);
  onAuthRequiredRef.current = onAuthRequired;

  useEffect(
    () => () => {
      liveRef.current = false;
    },
    [],
  );

  // Read the current submission state once: an observed submission switches
  // the wizard to upload-new-files, exactly like the CLI's mode split.
  useEffect(() => {
    let cancelled = false;
    void loadStatus().then((result) => {
      if (cancelled || !liveRef.current) return;
      if (result.kind === 'auth_required') {
        onAuthRequiredRef.current();
        return;
      }
      if (result.kind === 'error') {
        setStatusNote('status unreadable — a first upload will be attempted');
        setStage({ kind: 'editing' });
        return;
      }
      const observed = result.value.submissionObserved;
      setMode(observed ? 'upload-new-files' : 'upload');
      modeRef.current = observed ? 'upload-new-files' : 'upload';
      setStatusNote(
        observed
          ? 'existing submission found — files will replace it'
          : 'no submission on the server yet',
      );
      setStage({ kind: 'editing' });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const busy = stage.kind === 'loading' || stage.kind === 'dispatching';
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setSpin((n) => n + 1), 120);
    return () => clearInterval(timer);
  }, [busy]);

  const fieldCount = slots.length + 1; // paths… + comment

  /** Validate every path through the artifact policy; true when all pass. */
  const validateAll = async (): Promise<boolean> => {
    const current = pathsRef.current;
    const errors: (string | null)[] = current.map((p) => (p.trim() ? null : 'required'));
    const nextSizes: (number | null)[] = current.map(() => null);
    await Promise.all(
      current.map(async (path, i) => {
        if (errors[i]) return;
        try {
          const inspected = await submit.inspect(path.trim(), allowExternalRef.current);
          nextSizes[i] = inspected.size;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors[i] = redactSensitiveText(message);
        }
      }),
    );
    if (!liveRef.current) return false;
    setPathErrorsState(errors);
    setSizesState(nextSizes);
    return errors.every((e) => e === null);
  };

  const dispatch = async () => {
    const triggerChoice = TRIGGER_CHOICES[triggerIdxRef.current].id;
    setStage({ kind: 'dispatching' });
    try {
      const outcome = await submit.run({
        task,
        mode: modeRef.current,
        files: slots.map((slot, i) => ({ key: slot.key, path: pathsRef.current[i].trim() })),
        allowExternalFile: allowExternalRef.current,
        trigger: triggerChoice === 'auto' ? undefined : triggerChoice,
        comment: commentRef.current.trim() || undefined,
        idempotencyKey: operationIdRef.current,
      });
      if (!liveRef.current) return;
      if (outcome.kind === 'auth_required') {
        onAuthRequiredRef.current();
        return;
      }
      setStage({ kind: 'receipt', outcome });
    } catch (error) {
      if (!liveRef.current) return;
      if (error instanceof AgentProtocolError && error.code === 'IDEMPOTENCY_OUTCOME_UNKNOWN') {
        setStage({
          kind: 'unknown',
          operationId: operationIdRef.current,
          summary: error.summary,
        });
        return;
      }
      if (error instanceof OnTrackHttpError) {
        setStage({
          kind: 'failed',
          message: `rejected by the server (HTTP ${error.status})`,
        });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setStage({ kind: 'failed', message: redactSensitiveText(message) });
    }
  };

  const close = (submitted: boolean) => onCloseRef.current(submitted);

  useKeyboard((key) => {
    const current = stageRef.current;
    if (current.kind === 'loading') {
      // Only the status read is in flight — safe to abandon; the load
      // effect's cancelled flag swallows the late resolution.
      if (key.name === 'escape') close(false);
      return;
    }
    if (current.kind === 'dispatching') {
      return; // never interrupt an in-flight dispatch
    }
    if (key.name === 'escape') {
      if (current.kind === 'preflight') {
        setStage({ kind: 'editing' });
      } else if (current.kind === 'editing') {
        close(false);
      } else {
        close(current.kind === 'receipt');
      }
      return;
    }
    if (current.kind === 'receipt' || current.kind === 'unknown') {
      if (key.name === 'return') close(current.kind === 'receipt');
      return;
    }
    if (current.kind === 'failed') {
      if (key.name === 'r') setStage({ kind: 'editing' });
      return;
    }
    if (current.kind === 'preflight') {
      if (key.name === 't') {
        setTriggerIdx((i) => (i + 1) % TRIGGER_CHOICES.length);
      } else if (key.name === 'return') {
        void dispatch();
      }
      return;
    }
    // editing
    if (key.name === 'up') {
      setFocusIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (key.name === 'down') {
      setFocusIdx((i) => Math.min(i + 1, fieldCount - 1));
      return;
    }
    if (key.name === 'x' && key.ctrl) {
      setAllowExternal(!allowExternalRef.current);
      return;
    }
    if (key.name === 'return') {
      void validateAll().then((ok) => {
        if (ok && liveRef.current) {
          // Fresh claim key per attempt, minted as preflight opens so the
          // displayed key is the one dispatch claims; retrying after a
          // definitive rejection must not collide with the previous key's
          // fingerprint in the execution journal.
          operationIdRef.current = `tui:${randomUUID()}`;
          setStage({ kind: 'preflight' });
        }
      });
      return;
    }
    const onComment = focusIdxRef.current === slots.length;
    if (key.name === 'backspace') {
      if (onComment) {
        setComment((c) => c.slice(0, -1));
      } else {
        const idx = focusIdxRef.current;
        setPaths((prev) => prev.map((p, i) => (i === idx ? p.slice(0, -1) : p)));
      }
      return;
    }
    if (key.sequence && key.sequence.length === 1) {
      if (onComment) {
        setComment((c) => c + key.sequence);
      } else {
        const idx = focusIdxRef.current;
        const ch = key.sequence;
        setPaths((prev) => prev.map((p, i) => (i === idx ? p + ch : p)));
      }
    }
  });

  // Bracketed paste never reaches useKeyboard (it is not a keypress); route it
  // into the focused field so paths and comments can be pasted.
  usePaste((event) => {
    if (stageRef.current.kind !== 'editing') return;
    const text = stripAnsiSequences(decodePasteBytes(event.bytes)).replace(/[\r\n]+/g, '');
    if (!text) return;
    if (focusIdxRef.current === slots.length) {
      setComment((c) => c + text);
    } else {
      const idx = focusIdxRef.current;
      setPaths((prev) => prev.map((p, i) => (i === idx ? p + text : p)));
    }
  });

  const spinner = SPINNER[spin % SPINNER.length];
  const border = { border: true, borderStyle: 'rounded' as const, borderColor: theme.accent };

  return (
    <box
      style={{
        position: 'absolute',
        top: 3,
        left: 10,
        right: 10,
        bottom: 3,
        ...border,
        backgroundColor: theme.bg,
        padding: 1,
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <text>
        <strong fg={theme.fg}>Submit: {task.title}</strong>
        <span fg={theme.muted}>  {mode === 'upload-new-files' ? 'replace files' : 'first upload'}</span>
      </text>

      {stage.kind === 'loading' ? (
        <text fg={theme.muted}>{spinner} reading the current submission state…</text>
      ) : null}

      {stage.kind === 'editing' ? (
        <>
          {statusNote ? <text fg={theme.muted}>{statusNote}</text> : null}
          <text fg={theme.muted}>Evidence slots:</text>
          {slots.map((slot, i) => {
            const focused = focusIdx === i;
            const error = pathErrors[i];
            const size = sizes[i];
            return (
              <box
                key={slot.key}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  setFocusIdx(i);
                }}
                style={{ flexDirection: 'column', paddingLeft: 1 }}
              >
                <text>
                  <span fg={focused ? theme.accent : theme.muted}>{focused ? '▸ ' : '  '}</span>
                  <span fg={theme.accent}>{slot.key}</span>
                  <span fg={theme.muted}>  {slot.name}</span>
                  {size !== null ? <span fg={theme.status.complete}>  ✓ {humanizeBytes(size)}</span> : null}
                </text>
                <text>
                  <span fg={theme.muted}>    </span>
                  <span fg={focused ? theme.fg : theme.muted}>
                    {paths[i] || (focused ? 'type or paste the file path…' : '—')}
                  </span>
                </text>
                {error ? (
                  <text>
                    <span fg={theme.muted}>    </span>
                    <span fg={theme.urgent}>{error}</span>
                  </text>
                ) : null}
              </box>
            );
          })}
          <box
            onMouseDown={(event) => {
              event.stopPropagation();
              setAllowExternal(!allowExternal);
            }}
          >
            <text>
              <span fg={theme.accent}>{allowExternal ? '[x]' : '[ ]'} </span>
              <span fg={theme.fg}>allow files outside the project directory</span>
              <span fg={theme.muted}>  (ctrl+x)</span>
            </text>
          </box>
          <box
            onMouseDown={(event) => {
              event.stopPropagation();
              setFocusIdx(slots.length);
            }}
            style={{ paddingLeft: 1 }}
          >
            <text>
              <span fg={focusIdx === slots.length ? theme.accent : theme.muted}>
                {focusIdx === slots.length ? '▸ ' : '  '}
              </span>
              <span fg={theme.muted}>comment (optional): </span>
              <span fg={theme.fg}>{comment}</span>
            </text>
          </box>
          <text fg={theme.muted}>↑↓ switch field · enter validate · esc cancel</text>
        </>
      ) : null}

      {stage.kind === 'preflight' ? (
        <>
          <text fg={theme.muted}>Preflight — dispatched exactly once on confirm:</text>
          {slots.map((slot, i) => (
            <text key={slot.key}>
              <span fg={theme.accent}>  {slot.key}</span>
              <span fg={theme.fg}>  {paths[i]}</span>
              {sizes[i] !== null ? <span fg={theme.muted}>  ({humanizeBytes(sizes[i]!)})</span> : null}
            </text>
          ))}
          <text>
            <span fg={theme.muted}>  trigger  </span>
            <span fg={theme.fg}>{TRIGGER_CHOICES[triggerIdx].label}</span>
            <span fg={theme.muted}>  (t to change)</span>
          </text>
          <text>
            <span fg={theme.muted}>  comment  </span>
            <span fg={theme.fg}>{comment.trim() || '—'}</span>
          </text>
          <text>
            <span fg={theme.muted}>  key      </span>
            <span fg={theme.muted}>{operationIdRef.current}</span>
          </text>
          <text fg={theme.soon}>enter dispatch · esc back</text>
        </>
      ) : null}

      {stage.kind === 'dispatching' ? (
        <text fg={theme.muted}>{spinner} dispatching the upload (exactly once)…</text>
      ) : null}

      {stage.kind === 'receipt' ? (
        <>
          {stage.outcome.kind === 'replayed' ? (
            <text fg={theme.soon}>
              This exact submission was already dispatched — replayed the stored result instead of
              sending again.
            </text>
          ) : (
            <>
              <text>
                <span fg={theme.status.complete}>✓ response accepted</span>
                <span fg={theme.muted}>
                  {'  '}
                  {stage.outcome.output.files.length} slot(s) · state {stage.outcome.output.state} (
                  {stage.outcome.output.verification})
                </span>
              </text>
              <text fg={theme.muted}>
                trigger: {stage.outcome.output.trigger ?? 'ready_for_feedback (server default)'}
              </text>
              <text fg={theme.muted}>
                comment:{' '}
                {stage.outcome.output.comment.status === 'posted'
                  ? 'posted'
                  : stage.outcome.output.comment.status === 'failed'
                    ? 'requested but failed (the upload itself is safe)'
                    : stage.outcome.output.comment.status === 'skipped_until_submission_observed'
                      ? 'queued until the submission is observed'
                      : 'not requested'}
              </text>
              <text fg={theme.muted}>
                The server now renders the submission PDF — track it from the detail pane.
              </text>
            </>
          )}
          <text fg={theme.accent}>enter / esc close</text>
        </>
      ) : null}

      {stage.kind === 'failed' ? (
        <>
          <text fg={theme.urgent}>Submission failed: {stage.message}</text>
          <text fg={theme.muted}>Nothing was applied server-side that we could confirm.</text>
          <text fg={theme.muted}>r back to files · esc cancel</text>
        </>
      ) : null}

      {stage.kind === 'unknown' ? (
        <>
          <text fg={theme.soon}>Outcome unknown — not retried automatically.</text>
          <text fg={theme.muted}>{stage.summary}</text>
          <text>
            <span fg={theme.muted}>journal key  </span>
            <span fg={theme.fg}>{stage.operationId}</span>
          </text>
          <text fg={theme.muted}>
            Next: close this wizard and check the submission status in the detail pane before
            deciding to upload again.
          </text>
          <text fg={theme.accent}>enter / esc close</text>
        </>
      ) : null}
    </box>
  );
}
