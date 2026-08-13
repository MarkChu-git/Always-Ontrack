import { useEffect, useMemo, useRef, useState } from 'react';
import type { InputRenderable } from '@opentui/core';
import { useKeyboard, useRenderer } from '@opentui/react';
import type { StudentStatusTrigger } from '../lib/types';
import { DEFAULT_TUI_AUTH, type TuiAuthActions } from './auth';
import { bucketStatus, type LoadState, type TaskLoader } from './data';
import { LoginWizard } from './login';
import { runSetStatus, type SetStatusRunner } from './status';
import { isFilesRequiredRejection } from '../lib/set-task-status';
import { PRODUCTION_SUBMIT_ACTIONS, type SubmitActions } from './submit';
import { SubmitWizard } from './submit-wizard';
import {
  PRODUCTION_TASK_EXTRAS,
  type SubmissionStatusInfo,
  type TaskExtrasActions,
} from './task-extras';
import { darkTheme, lightTheme, type Theme } from './theme';
import {
  STATUS_ICON,
  STATUS_LABEL,
  STATUS_SHORT_LABEL,
  humanizeStatus,
  type TaskStatus,
  type TuiTask,
} from './tasks';

type Mode = 'main' | 'detail' | 'palette' | 'login' | 'submit';
type TabId = 'all' | 'active' | 'ready' | 'done';

const TABS: { id: TabId; label: string; match: (t: TuiTask) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  {
    id: 'active',
    label: 'Active',
    match: (t) => t.status === 'not_started' || t.status === 'working_on_it' || t.status === 'need_help',
  },
  {
    id: 'ready',
    label: 'Ready',
    match: (t) => t.status === 'ready_for_feedback' || t.status === 'assess_in_portfolio',
  },
  { id: 'done', label: 'Done', match: (t) => t.status === 'complete' },
];

interface Command {
  name: string;
  description: string;
  run: () => void;
}

function matches(task: TuiTask, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return (
    task.title.toLowerCase().includes(q) ||
    task.unit.toLowerCase().includes(q) ||
    STATUS_LABEL[task.status].toLowerCase().includes(q)
  );
}

/** Subsequence match, opencode-palette style: "th" matches "theme". */
function fuzzyMatch(query: string, text: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  let i = 0;
  for (const ch of text.toLowerCase()) {
    if (ch === q[i]) i += 1;
    if (i === q.length) return true;
  }
  return false;
}

/** Keyboard/click accelerators for the detail pane's student status triggers. */
const TRIGGER_ACTIONS: { key: string; trigger: StudentStatusTrigger }[] = [
  { key: 'w', trigger: 'working_on_it' },
  { key: 'h', trigger: 'need_help' },
  { key: 'n', trigger: 'not_started' },
  { key: 'r', trigger: 'ready_for_feedback' },
  { key: 'a', trigger: 'assess_in_portfolio' },
];

function dueBadge(task: TuiTask, theme: Theme): { text: string; fg: string } {
  if (task.status === 'complete') return { text: 'done', fg: theme.status.complete };
  if (task.dueInDays === null) return { text: 'no date', fg: theme.muted };
  const days = task.dueInDays;
  if (days < 0) return { text: `${-days}d overdue`, fg: theme.urgent };
  if (days === 0) return { text: 'today', fg: theme.soon };
  if (days <= 3) return { text: `in ${days}d`, fg: theme.soon };
  return { text: `in ${days}d`, fg: theme.muted };
}

/** Colour-coded session-token lifetime pill for the header. */
function tokenBadge(expiresAt: string | null, theme: Theme): { text: string; fg: string } | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return { text: 'token expired', fg: theme.urgent };
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return { text: `${Math.max(1, minutes)}m left`, fg: theme.soon };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { text: `${hours}h left`, fg: theme.soon };
  return { text: `${Math.floor(hours / 24)}d left`, fg: theme.status.complete };
}

function StatusPill({ task, theme }: { task: TuiTask; theme: Theme }) {
  // Colour comes from the bucket; the label stays the honest raw status.
  const label = task.statusRaw ? humanizeStatus(task.statusRaw) : STATUS_LABEL[task.status];
  return (
    <box
      style={{
        backgroundColor: theme.status[task.status],
        paddingLeft: 1,
        paddingRight: 1,
        alignSelf: 'flex-start',
      }}
    >
      <text>
        <strong fg={theme.onAccent}>
          {STATUS_ICON[task.status]} {label}
        </strong>
      </text>
    </box>
  );
}

function Header({
  theme,
  watchOn,
  onToggleWatch,
  username,
  expiresAt,
  unitLabel,
  onCycleUnit,
}: {
  theme: Theme;
  watchOn: boolean;
  onToggleWatch: () => void;
  username: string | null;
  expiresAt: string | null;
  unitLabel: string;
  onCycleUnit: () => void;
}) {
  const token = tokenBadge(expiresAt, theme);
  return (
    <box
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: theme.panel,
      }}
    >
      <ascii-font text="OnTrack" font="tiny" color={theme.accent} backgroundColor={theme.panel} />
      <box style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 0 }}>
        <box style={{ flexDirection: 'row' }}>
          <text>
            <span fg={username ? theme.status.complete : theme.muted}>● </span>
            <span fg={theme.fg}>{username ?? 'not signed in'}</span>
            {token ? (
              <>
                <span fg={theme.muted}> · </span>
                <span fg={token.fg}>{token.text}</span>
              </>
            ) : null}
            <span fg={theme.muted}> · </span>
          </text>
          <text onMouseDown={onCycleUnit}>
            <span fg={theme.accent}>{unitLabel}</span>
          </text>
        </box>
        <box
          onMouseDown={onToggleWatch}
          style={{
            backgroundColor: watchOn ? theme.accent : theme.hover,
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          <text fg={watchOn ? theme.onAccent : theme.muted}>
            {watchOn ? '● watching' : '○ watch off'}
          </text>
        </box>
      </box>
    </box>
  );
}

function Tabs({
  theme,
  tab,
  counts,
  onSelect,
}: {
  theme: Theme;
  tab: TabId;
  counts: Record<TabId, number>;
  onSelect: (tab: TabId) => void;
}) {
  return (
    <box style={{ flexDirection: 'row', gap: 1, paddingLeft: 1, marginTop: 1 }}>
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <box
            key={t.id}
            onMouseDown={() => onSelect(t.id)}
            style={{
              backgroundColor: active ? theme.accent : theme.hover,
              paddingLeft: 1,
              paddingRight: 1,
            }}
          >
            <text>
              <span fg={active ? theme.onAccent : theme.fg}>{t.label}</span>
              <span fg={active ? theme.onAccent : theme.muted}> {counts[t.id]}</span>
            </text>
          </box>
        );
      })}
    </box>
  );
}

function TaskRow({
  task,
  selected,
  hovered,
  theme,
  onHover,
  onOpen,
}: {
  task: TuiTask;
  selected: boolean;
  hovered: boolean;
  theme: Theme;
  onHover: () => void;
  onOpen: () => void;
}) {
  const badge = dueBadge(task, theme);
  return (
    <box
      onMouseOver={onHover}
      onMouseDown={onOpen}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: selected ? theme.selection : hovered ? theme.hover : undefined,
      }}
    >
      <text>
        <span fg={theme.status[task.status]}>{STATUS_ICON[task.status]} </span>
        <span fg={theme.fg}>{task.title}</span>
      </text>
      <text fg={badge.fg}>{badge.text}</text>
    </box>
  );
}

function TaskDetailBody({ task, theme }: { task: TuiTask; theme: Theme }) {
  const badge = dueBadge(task, theme);
  return (
    <box style={{ flexDirection: 'column', gap: 1 }}>
      <StatusPill task={task} theme={theme} />
      <text>
        <span fg={theme.muted}>Due    </span>
        <span fg={theme.fg}>{task.due}</span>
        <span fg={badge.fg}>  {badge.text}</span>
        {task.dueInDays !== null ? <span fg={theme.muted}>  ({task.dateSource})</span> : null}
      </text>
      <text>
        <span fg={theme.muted}>Unit   </span>
        <span fg={theme.fg}>{task.unit}</span>
      </text>
      {task.description !== '' ? <text fg={theme.fg}>{task.description}</text> : null}
      {task.prerequisites.length > 0 ? (
        <text>
          <span fg={theme.muted}>Requires </span>
          <span fg={theme.accent}>{task.prerequisites.join(', ')}</span>
        </text>
      ) : null}
    </box>
  );
}

function StatusBar({ theme, tasks }: { theme: Theme; tasks: TuiTask[] }) {
  const counts = useMemo(() => {
    const map = new Map<TaskStatus, number>();
    for (const t of tasks) map.set(t.status, (map.get(t.status) ?? 0) + 1);
    return map;
  }, [tasks]);

  const parts = (['ready_for_feedback', 'need_help', 'working_on_it'] as TaskStatus[]).filter(
    (s) => counts.get(s),
  );

  return (
    <box
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: theme.panel,
      }}
    >
      <text>
        {parts.length === 0 ? (
          <span fg={theme.muted}>all clear</span>
        ) : (
          parts.map((s, i) => (
            <span key={s}>
              <span fg={theme.status[s]}>{STATUS_ICON[s]}</span>
              <span fg={theme.muted}>
                {' '}
                {counts.get(s)} {STATUS_SHORT_LABEL[s]}
                {i < parts.length - 1 ? '  ' : ''}
              </span>
            </span>
          ))
        )}
      </text>
      <text>
        <span fg={theme.accent}>↑↓</span>
        <span fg={theme.muted}> select  </span>
        <span fg={theme.accent}>enter</span>
        <span fg={theme.muted}> open  </span>
        <span fg={theme.accent}>ctrl+←→</span>
        <span fg={theme.muted}> tabs  </span>
        <span fg={theme.accent}>ctrl+k</span>
        <span fg={theme.muted}> palette</span>
      </text>
    </box>
  );
}

/** Full-screen states used before the task catalogue becomes available. */
function NoticeScreen({
  theme,
  title,
  lines,
  hint,
}: {
  theme: Theme;
  title: string;
  lines: string[];
  hint: string;
}) {
  return (
    <box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
      <box
        style={{
          border: true,
          borderStyle: 'rounded',
          borderColor: theme.border,
          backgroundColor: theme.panel,
          padding: 2,
          flexDirection: 'column',
          gap: 1,
          width: 64,
        }}
      >
        <text>
          <strong fg={theme.fg}>{title}</strong>
        </text>
        {lines.map((line) => (
          <text key={line} fg={theme.muted}>
            {line}
          </text>
        ))}
        <text fg={theme.accent}>{hint}</text>
      </box>
    </box>
  );
}

export function App({
  load,
  auth = DEFAULT_TUI_AUTH,
  setStatus = runSetStatus,
  extras = PRODUCTION_TASK_EXTRAS,
  submit = PRODUCTION_SUBMIT_ACTIONS,
}: {
  load: TaskLoader;
  auth?: TuiAuthActions;
  setStatus?: SetStatusRunner;
  extras?: TaskExtrasActions;
  submit?: SubmitActions;
}) {
  const renderer = useRenderer();
  const [theme, setTheme] = useState<Theme>(darkTheme);
  const [screen, setScreen] = useState<LoadState>({ kind: 'loading' });
  const [reloadTick, setReloadTick] = useState(0);
  const [mode, setMode] = useState<Mode>('main');
  const [tab, setTab] = useState<TabId>('all');
  const [unitFilter, setUnitFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [paletteQuery, setPaletteQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [paletteSelected, setPaletteSelected] = useState(0);
  const [watchOn, setWatchOn] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  /** Trigger selected in the detail pane, awaiting an explicit confirm. */
  const [pendingTrigger, setPendingTrigger] = useState<StudentStatusTrigger | null>(null);
  /** Latest submission-status read per task id, shown on the detail pane. */
  const [submissionInfo, setSubmissionInfo] = useState<Record<string, SubmissionStatusInfo>>({});
  const inputRef = useRef<InputRenderable>(null);
  const paletteInputRef = useRef<InputRenderable>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Double-invoke guard for destructive-ish /logout: first run arms, second
  // within 4s executes. Ref (not state) so the memoized command sees it.
  const logoutArmed = useRef(false);
  const logoutArmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Detail extras are fetched once per task until a write invalidates them. */
  const extrasRequested = useRef<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    void load().then((state) => {
      if (live) setScreen(state);
    });
    return () => {
      live = false;
    };
  }, [load, reloadTick]);

  // Focus is imperative and race-prone in OpenTUI; re-assert it on mode
  // changes instead of relying only on the `focused` prop. Leaving `main`
  // must explicitly blur the filter input, or it keeps swallowing keystrokes
  // while an overlay (detail pane) is up.
  useEffect(() => {
    if (mode === 'main') inputRef.current?.focus();
    else inputRef.current?.blur();
    if (mode === 'palette') paletteInputRef.current?.focus();
    // A pending status confirmation never survives a mode change.
    setPendingTrigger(null);
  }, [mode]);

  // Never leave a pending toast timer behind on unmount.
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (logoutArmTimer.current) clearTimeout(logoutArmTimer.current);
    },
    [],
  );

  // Re-render once a minute so the header's token-lifetime pill decays while
  // the app idles (the pill is computed from the load-time expiresAt snapshot).
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setClockTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  };

  const clearFilterInput = () => {
    setQuery('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const toggleWatch = () => {
    setWatchOn((w) => {
      showToast(`watch ${w ? 'off' : 'on'}`);
      return !w;
    });
  };

  /** Patch one task row with the server-returned status (never an optimistic one). */
  const patchTaskStatus = (taskId: string, statusRaw: string) => {
    setScreen((prev) =>
      prev.kind === 'ready'
        ? {
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === taskId ? { ...t, statusRaw, status: bucketStatus(statusRaw) } : t,
            ),
          }
        : prev,
    );
  };

  /** Patch one task row with prerequisite display names from the read path. */
  const patchTaskPrerequisites = (taskId: string, names: string[]) => {
    setScreen((prev) =>
      prev.kind === 'ready'
        ? {
            ...prev,
            tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, prerequisites: names } : t)),
          }
        : prev,
    );
  };

  /** Any action answering auth_required drops the app to the sign-in screen. */
  const handleAuthRequired = () => {
    setMode('main');
    setScreen({ kind: 'auth_required' });
    showToast('session expired — sign in again');
  };

  /** Run one detail-pane artifact download and report the saved path. */
  const runDownload = (kind: 'taskPdf' | 'resources' | 'submissionPdf', task: TuiTask) => {
    showToast('downloading…');
    const promise =
      kind === 'taskPdf'
        ? extras.downloadTaskPdf(task)
        : kind === 'resources'
          ? extras.downloadResources(task)
          : extras.downloadSubmissionPdf(task);
    void promise
      .then((result) => {
        if (result.kind === 'auth_required') {
          handleAuthRequired();
          return;
        }
        if (result.kind === 'error') {
          showToast(result.message);
          return;
        }
        if (result.value === null) {
          showToast('no resource archive for this task');
          return;
        }
        showToast(`saved → ${result.value.path}`);
      })
      .catch(() => showToast('download failed'));
  };

  const applyTrigger = (task: TuiTask, trigger: StudentStatusTrigger) => {
    setPendingTrigger(null);
    showToast(`setting ${humanizeStatus(trigger)}…`);
    void setStatus({ task, trigger })
      .then((outcome) => {
        switch (outcome.kind) {
          case 'applied':
            patchTaskStatus(task.id, outcome.after);
            showToast(`status: ${humanizeStatus(outcome.after)}`);
            break;
          case 'remapped':
            // The server wins: render the returned status, say it was remapped.
            patchTaskStatus(task.id, outcome.after);
            showToast(`server remapped to ${humanizeStatus(outcome.after)}`);
            break;
          case 'refused':
            showToast(`refused — still ${task.statusRaw ? humanizeStatus(task.statusRaw) : 'unchanged'}`);
            break;
          case 'rejected':
            showToast(
              isFilesRequiredRejection(outcome.error, trigger)
                ? 'refused: upload the required files first'
                : `rejected by the server (${outcome.error.status})`,
            );
            break;
          case 'unknown':
            // Unknown-outcome rule: never auto-retry; point at a later check.
            showToast('outcome unknown — not retried; reopen the task to verify');
            break;
          case 'auth_required':
            handleAuthRequired();
            break;
        }
      })
      .catch(() => showToast('status change failed'));
  };

  const tasks = screen.kind === 'ready' ? screen.tasks : [];
  const units = useMemo(() => [...new Set(tasks.map((t) => t.unit))].sort(), [tasks]);
  const unitLabel = unitFilter ?? (units.length > 1 ? 'all units' : (units[0] ?? '—'));

  const cycleUnit = () => {
    if (units.length === 0) return;
    const order: (string | null)[] = [null, ...units];
    const i = order.indexOf(unitFilter);
    const next = order[(i + 1) % order.length];
    setUnitFilter(next);
    setSelected(0);
    showToast(next === null ? 'all units' : `unit: ${next}`);
  };

  const cycleTab = (dir: 1 | -1) => {
    setTab((current) => {
      const i = TABS.findIndex((t) => t.id === current);
      const next = TABS[(i + dir + TABS.length) % TABS.length];
      return next.id;
    });
    setSelected(0);
  };

  const visible = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (unitFilter === null || t.unit === unitFilter) &&
          TABS.find((x) => x.id === tab)!.match(t) &&
          matches(t, query),
      ),
    [tasks, unitFilter, tab, query],
  );
  // Clamp defensively: an arrow key pressed during the loading screen computes
  // against an empty list (length-1 = -1) and must not park selection at -1.
  const selectedTask = visible[Math.min(Math.max(selected, 0), Math.max(visible.length - 1, 0))];

  const tabCounts = useMemo(() => {
    const counts = {} as Record<TabId, number>;
    for (const t of TABS) counts[t.id] = tasks.filter(t.match).length;
    return counts;
  }, [tasks]);

  const selectedInfo = selectedTask ? submissionInfo[selectedTask.id] : undefined;
  // Ref mirrors for the keyboard/palette paths that can observe stale closures.
  const selectedTaskRef = useRef(selectedTask);
  selectedTaskRef.current = selectedTask;
  const selectedInfoRef = useRef(selectedInfo);
  selectedInfoRef.current = selectedInfo;

  // Lazily pull prerequisites + submission status when a detail pane opens;
  // a write (submit) invalidates the entry so the next open refetches.
  useEffect(() => {
    if (mode !== 'detail' || !selectedTask) return;
    const task = selectedTask;
    const taskId = task.id;
    if (extrasRequested.current.has(taskId)) return;
    extrasRequested.current.add(taskId);
    void extras.prerequisites(task).then((result) => {
      if (result.kind === 'auth_required') {
        handleAuthRequired();
        return;
      }
      if (result.kind !== 'ok') return; // keep whatever the catalogue provided
      const names = result.value.map((p) => {
        const match = tasks.find(
          (t) => t.projectId === task.projectId && t.taskDefinitionId === p.taskDefinitionId,
        );
        const label = match ? match.title : `#${p.taskDefinitionId}`;
        return p.requiredStatus === 'unknown' ? label : `${label} (${p.requiredStatus})`;
      });
      patchTaskPrerequisites(taskId, names);
    });
    void extras.submissionStatus(task).then((result) => {
      if (result.kind === 'auth_required') {
        handleAuthRequired();
        return;
      }
      if (result.kind !== 'ok') return;
      setSubmissionInfo((prev) => ({ ...prev, [taskId]: result.value }));
    });
  }, [mode, selectedTask?.id]);

  // A processing submission PDF is polled until the server finishes rendering.
  useEffect(() => {
    if (mode !== 'detail' || !selectedTask) return;
    if (selectedInfo?.pdfState !== 'processing') return;
    const task = selectedTask;
    const taskId = task.id;
    const timer = setInterval(() => {
      void extras.submissionStatus(task).then((result) => {
        if (result.kind === 'auth_required') {
          handleAuthRequired();
          return;
        }
        if (result.kind !== 'ok') return; // keep polling on the next tick
        setSubmissionInfo((prev) => ({ ...prev, [taskId]: result.value }));
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [mode, selectedTask?.id, selectedInfo?.pdfState]);

  // Command closures only touch stable refs/setters, so memoize once and keep
  // visibleCommands' dependency list honest.
  const commands = useMemo<Command[]>(
    () => [
      {
        name: 'login',
        description: 'Sign in with Monash SSO',
        run: () => setMode('login'),
      },
      {
        name: 'logout',
        description: 'Sign out and clear the local session (run twice to confirm)',
        run: () => {
          if (!logoutArmed.current) {
            logoutArmed.current = true;
            showToast('run /logout again within 4s to confirm');
            if (logoutArmTimer.current) clearTimeout(logoutArmTimer.current);
            logoutArmTimer.current = setTimeout(() => {
              logoutArmed.current = false;
            }, 4000);
            return;
          }
          logoutArmed.current = false;
          if (logoutArmTimer.current) clearTimeout(logoutArmTimer.current);
          showToast('signing out…');
          void auth
            .logout()
            .catch(() => undefined) // local cleanup is best-effort too
            .then(() => {
              setScreen({ kind: 'auth_required' });
              setMode('main');
              showToast('signed out');
            });
        },
      },
      {
        name: 'submit',
        description: 'Submit files for the selected task',
        run: () => {
          if (!selectedTaskRef.current) {
            showToast('no task selected');
            return;
          }
          setMode('submit');
        },
      },
      { name: 'watch', description: 'Toggle watch mode', run: toggleWatch },
      {
        name: 'theme',
        description: 'Switch dark / light theme',
        run: () => {
          setTheme((t) => {
            const next = t.name === 'dark' ? lightTheme : darkTheme;
            showToast(`theme: ${next.name}`);
            return next;
          });
        },
      },
      {
        name: 'quit',
        description: 'Exit the TUI',
        run: () => {
          renderer.destroy();
          process.exit(0);
        },
      },
    ],
    [auth],
  );

  const visibleCommands = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    if (q === '') return commands;
    return commands.filter((c) => fuzzyMatch(q, c.name) || fuzzyMatch(q, c.description));
  }, [paletteQuery, commands]);

  const runCommand = (raw: string) => {
    const name = raw.replace(/^\//, '').trim().toLowerCase();
    const cmd = commands.find((c) => c.name === name);
    if (cmd) {
      cmd.run();
    } else {
      showToast(`unknown command: /${name}`);
    }
  };

  useKeyboard((key) => {
    // The wizards own the keyboard while mounted (self-drawn fields).
    if (mode === 'login' || mode === 'submit') return;
    if (key.ctrl && key.name === 'k') {
      setMode((m) => (m === 'palette' ? 'main' : 'palette'));
      setPaletteQuery('');
      setPaletteSelected(0);
      return;
    }
    if (screen.kind === 'error' || screen.kind === 'auth_required') {
      if (key.name === 'r') setReloadTick((n) => n + 1);
      if (key.name === 'l' && screen.kind === 'auth_required') setMode('login');
      return;
    }
    if (key.ctrl && (key.name === 'right' || key.name === 'left')) {
      if (mode === 'main') cycleTab(key.name === 'right' ? 1 : -1);
      return;
    }
    if (key.name === 'escape') {
      if (mode === 'palette') {
        setMode('main');
      } else if (mode === 'detail') {
        // A pending trigger confirmation eats the first ESC; the second closes.
        if (pendingTrigger) {
          setPendingTrigger(null);
        } else {
          setMode('main');
        }
      } else if (query !== '') {
        clearFilterInput();
      }
      return;
    }
    if (mode === 'detail' && selectedTask) {
      if (key.name === 'return' && pendingTrigger) {
        applyTrigger(selectedTask, pendingTrigger);
        return;
      }
      if (key.name === 's') {
        setMode('submit');
        return;
      }
      if (key.name === 'd') {
        runDownload('taskPdf', selectedTask);
        return;
      }
      if (key.name === 'z') {
        runDownload('resources', selectedTask);
        return;
      }
      if (key.name === 'u') {
        if (selectedInfoRef.current?.pdfState === 'ready') {
          runDownload('submissionPdf', selectedTask);
        } else {
          showToast('submission PDF is not ready yet');
        }
        return;
      }
      const trigger = TRIGGER_ACTIONS.find((a) => a.key === key.sequence)?.trigger;
      if (trigger && trigger !== selectedTask.statusRaw) {
        setPendingTrigger(trigger);
      }
      return;
    }
    if (mode === 'palette') {
      if (key.name === 'up') setPaletteSelected((i) => Math.max(i - 1, 0));
      if (key.name === 'down')
        setPaletteSelected((i) => Math.min(i + 1, visibleCommands.length - 1));
      return;
    }
    if (mode === 'main') {
      if (key.name === 'up') setSelected((i) => Math.max(i - 1, 0));
      if (key.name === 'down')
        setSelected((i) => Math.max(0, Math.min(i + 1, visible.length - 1)));
    }
  });

  // InputRenderable's option type declares onSubmit with SubmitEvent, while the
  // React wrapper passes the ENTER string value; `unknown` satisfies both.
  const onSubmitInput = (value: unknown) => {
    const v = String(value).trim();
    if (v.startsWith('/')) {
      runCommand(v);
      clearFilterInput();
      return;
    }
    if (selectedTask) setMode('detail');
  };

  const ready = screen.kind === 'ready';

  return (
    <box
      style={{
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: theme.bg,
      }}
    >
      <Header
        theme={theme}
        watchOn={watchOn}
        onToggleWatch={toggleWatch}
        username={screen.kind === 'ready' ? screen.identity.username : null}
        expiresAt={screen.kind === 'ready' ? screen.expiresAt : null}
        unitLabel={unitLabel}
        onCycleUnit={cycleUnit}
      />

      {!ready ? (
        <NoticeScreen
          theme={theme}
          title={
            screen.kind === 'loading'
              ? 'Loading tasks…'
              : screen.kind === 'auth_required'
                ? 'Not signed in'
                : 'Failed to load tasks'
          }
          lines={
            screen.kind === 'loading'
              ? ['Reading the stored session and projecting your Student Task View.']
              : screen.kind === 'auth_required'
                ? [
                    'The TUI needs a stored OnTrack session.',
                    'Press l to sign in with Monash SSO (guided, hidden browser).',
                  ]
                : [screen.message]
          }
          hint={
            screen.kind === 'loading'
              ? ''
              : screen.kind === 'auth_required'
                ? 'l sign in · r retry · ctrl+c quit'
                : 'r retry · ctrl+c quit'
          }
        />
      ) : (
        <>
          <Tabs
            theme={theme}
            tab={tab}
            counts={tabCounts}
            onSelect={(t) => {
              setTab(t);
              setSelected(0);
            }}
          />

          <box style={{ flexDirection: 'row', flexGrow: 1, padding: 1, gap: 1 }}>
            <box
              title={`Tasks (${visible.length})`}
              titleColor={theme.muted}
              style={{
                border: true,
                borderStyle: 'rounded',
                borderColor: theme.border,
                width: '45%',
                flexDirection: 'column',
                backgroundColor: theme.panel,
              }}
            >
              {visible.length === 0 ? (
                <box style={{ padding: 1 }}>
                  <text fg={theme.muted}>
                    {query !== '' || tab !== 'all' || unitFilter !== null
                      ? 'no tasks match the current filters'
                      : 'all clear — no tasks due'}
                  </text>
                </box>
              ) : (
                visible.map((task, i) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    selected={i === selected && mode !== 'palette'}
                    hovered={i === hovered}
                    theme={theme}
                    onHover={() => setHovered(i)}
                    onOpen={() => {
                      setSelected(i);
                      setMode('detail');
                    }}
                  />
                ))
              )}
            </box>

            {selectedTask ? (
              <box
                title={selectedTask.title}
                titleColor={theme.fg}
                style={{
                  border: true,
                  borderStyle: 'rounded',
                  borderColor: theme.border,
                  flexGrow: 1,
                  padding: 1,
                  backgroundColor: theme.panel,
                }}
              >
                <TaskDetailBody task={selectedTask} theme={theme} />
              </box>
            ) : (
              <box
                style={{
                  border: true,
                  borderStyle: 'rounded',
                  borderColor: theme.border,
                  flexGrow: 1,
                  backgroundColor: theme.panel,
                  padding: 1,
                }}
              >
                <text fg={theme.muted}>nothing selected</text>
              </box>
            )}
          </box>

          <box
            style={{
              border: true,
              borderStyle: 'rounded',
              borderColor: mode === 'main' ? theme.accent : theme.border,
              marginLeft: 1,
              marginRight: 1,
              flexDirection: 'row',
              paddingLeft: 1,
              backgroundColor: theme.panel,
            }}
          >
            <text fg={theme.accent}>❯ </text>
            <input
              ref={inputRef}
              placeholder="Filter tasks…  (type / for commands)"
              focused={mode === 'main'}
              onInput={(value: string) => {
                setQuery(value);
                setSelected(0);
              }}
              onSubmit={onSubmitInput}
              style={{ flexGrow: 1, backgroundColor: theme.panel, focusedBackgroundColor: theme.panel }}
            />
          </box>

          <StatusBar theme={theme} tasks={tasks} />
        </>
      )}

      {mode === 'detail' && selectedTask ? (
        <box
          onMouseDown={() => setMode('main')}
          style={{
            position: 'absolute',
            top: 5,
            left: 8,
            right: 8,
            bottom: 4,
            border: true,
            borderStyle: 'rounded',
            borderColor: theme.accent,
            backgroundColor: theme.bg,
            padding: 1,
            flexDirection: 'column',
            gap: 1,
          }}
        >
          <text>
            <strong fg={theme.fg}>{selectedTask.title}</strong>
          </text>
          <TaskDetailBody task={selectedTask} theme={theme} />
          <text>
            <span fg={theme.muted}>Submission </span>
            {selectedInfo ? (
              <>
                <span fg={selectedInfo.submissionObserved ? theme.status.complete : theme.muted}>
                  {selectedInfo.submissionObserved ? 'observed' : 'none yet'}
                </span>
                <span fg={theme.muted}> · pdf </span>
                <span
                  fg={
                    selectedInfo.pdfState === 'ready'
                      ? theme.status.complete
                      : selectedInfo.pdfState === 'processing'
                        ? theme.soon
                        : theme.muted
                  }
                >
                  {selectedInfo.pdfState}
                </span>
                {selectedInfo.submissionDate ? (
                  <span fg={theme.muted}> · {selectedInfo.submissionDate}</span>
                ) : null}
              </>
            ) : (
              <span fg={theme.muted}>checking…</span>
            )}
          </text>
          <box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 1 }}>
            {(
              [
                { keyLabel: 's', label: 'Submit files', run: () => setMode('submit') },
                { keyLabel: 'd', label: 'Task PDF', run: () => runDownload('taskPdf', selectedTask) },
                { keyLabel: 'z', label: 'Resources', run: () => runDownload('resources', selectedTask) },
                ...(selectedInfo?.pdfState === 'ready'
                  ? [
                      {
                        keyLabel: 'u',
                        label: 'Submission PDF',
                        run: () => runDownload('submissionPdf', selectedTask),
                      },
                    ]
                  : []),
              ] as const
            ).map((action) => (
              <box
                key={action.keyLabel}
                onMouseDown={(event) => {
                  // Keep the click from reaching the pane's close-on-click.
                  event.stopPropagation();
                  action.run();
                }}
                style={{
                  backgroundColor: theme.hover,
                  paddingLeft: 1,
                  paddingRight: 1,
                }}
              >
                <text>
                  <span fg={theme.accent}>[{action.keyLabel}] </span>
                  <span fg={theme.fg}>{action.label}</span>
                </text>
              </box>
            ))}
          </box>
          <box style={{ flexDirection: 'column', gap: 0 }}>
            <text fg={theme.muted}>Set status:</text>
            <box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 1 }}>
              {TRIGGER_ACTIONS.filter((a) => a.trigger !== selectedTask.statusRaw).map((action) => {
                const pending = pendingTrigger === action.trigger;
                return (
                  <box
                    key={action.trigger}
                    onMouseDown={(event) => {
                      // Keep the click from reaching the pane's close-on-click.
                      event.stopPropagation();
                      if (pending) {
                        applyTrigger(selectedTask, action.trigger);
                      } else {
                        setPendingTrigger(action.trigger);
                      }
                    }}
                    style={{
                      backgroundColor: pending ? theme.accent : theme.hover,
                      paddingLeft: 1,
                      paddingRight: 1,
                    }}
                  >
                    <text>
                      <span fg={pending ? theme.onAccent : theme.accent}>[{action.key}] </span>
                      <span fg={pending ? theme.onAccent : theme.fg}>
                        {humanizeStatus(action.trigger)}
                      </span>
                    </text>
                  </box>
                );
              })}
            </box>
          </box>
          {pendingTrigger ? (
            <text>
              <span fg={theme.soon}>Apply {humanizeStatus(pendingTrigger)}? </span>
              <span fg={theme.muted}>enter / click again to confirm · esc cancel</span>
            </text>
          ) : (
            <text fg={theme.muted}>esc / click to close</text>
          )}
        </box>
      ) : null}

      {mode === 'palette' ? (
        <box
          style={{
            position: 'absolute',
            top: 2,
            left: '15%',
            width: '70%',
            border: true,
            borderStyle: 'rounded',
            borderColor: theme.accent,
            backgroundColor: theme.bg,
            flexDirection: 'column',
            padding: 1,
          }}
        >
          <box style={{ flexDirection: 'row' }}>
            <text fg={theme.accent}>/ </text>
            <input
              placeholder="Type a command…"
              ref={paletteInputRef}
              focused
              onInput={(value: string) => {
                setPaletteQuery(value);
                setPaletteSelected(0);
              }}
              onSubmit={() => {
                const cmd = visibleCommands[Math.min(paletteSelected, visibleCommands.length - 1)];
                setMode('main');
                if (cmd) cmd.run();
              }}
              style={{ flexGrow: 1 }}
            />
          </box>
          {visibleCommands.length === 0 ? (
            <text fg={theme.muted}>  no matching commands</text>
          ) : (
            visibleCommands.map((cmd, i) => (
              <box
                key={cmd.name}
                onMouseOver={() => setPaletteSelected(i)}
                onMouseDown={() => {
                  setMode('main');
                  cmd.run();
                }}
                style={{
                  flexDirection: 'row',
                  paddingLeft: 1,
                  backgroundColor: i === paletteSelected ? theme.selection : undefined,
                }}
              >
                <text>
                  <span fg={i === paletteSelected ? theme.accent : theme.fg}>/{cmd.name}</span>
                  <span fg={theme.muted}>  {cmd.description}</span>
                </text>
              </box>
            ))
          )}
        </box>
      ) : null}

      {toast ? (
        <box
          style={{
            position: 'absolute',
            top: 1,
            right: 2,
            border: true,
            borderStyle: 'rounded',
            borderColor: theme.accent,
            backgroundColor: theme.bg,
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          <text fg={theme.fg}>{toast}</text>
        </box>
      ) : null}

      {mode === 'login' ? (
        <LoginWizard
          theme={theme}
          run={auth.login}
          onSignedIn={(name) => {
            setMode('main');
            showToast(`signed in as ${name}`);
            setReloadTick((n) => n + 1);
          }}
          onCancel={() => setMode('main')}
        />
      ) : null}

      {mode === 'submit' && selectedTask ? (
        <SubmitWizard
          theme={theme}
          task={selectedTask}
          submit={submit}
          loadStatus={() => extras.submissionStatus(selectedTask)}
          onAuthRequired={handleAuthRequired}
          onClose={(submitted) => {
            // A finished write invalidates the cached extras for this task.
            extrasRequested.current.delete(selectedTask.id);
            if (submitted) {
              setSubmissionInfo((prev) => {
                const next = { ...prev };
                delete next[selectedTask.id];
                return next;
              });
              setMode('main');
              setReloadTick((n) => n + 1);
            } else {
              setMode('detail');
            }
          }}
        />
      ) : null}
    </box>
  );
}
