import { useEffect, useMemo, useRef, useState } from 'react';
import type { InputRenderable } from '@opentui/core';
import { useKeyboard, useRenderer } from '@opentui/react';
import { darkTheme, lightTheme, type Theme } from './theme';
import {
  FAKE_TASKS,
  FAKE_UNIT,
  FAKE_USER,
  STATUS_ICON,
  STATUS_LABEL,
  STATUS_SHORT_LABEL,
  type FakeTask,
  type TaskStatus,
} from './tasks';

type Mode = 'main' | 'detail' | 'palette';
type TabId = 'all' | 'active' | 'ready' | 'done';

const TABS: { id: TabId; label: string; match: (t: FakeTask) => boolean }[] = [
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

function matches(task: FakeTask, query: string): boolean {
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

function dueBadge(task: FakeTask, theme: Theme): { text: string; fg: string } {
  if (task.status === 'complete') return { text: 'done', fg: theme.status.complete };
  const days = task.dueInDays;
  if (days < 0) return { text: `${-days}d overdue`, fg: theme.urgent };
  if (days === 0) return { text: 'today', fg: theme.soon };
  if (days <= 3) return { text: `in ${days}d`, fg: theme.soon };
  return { text: `in ${days}d`, fg: theme.muted };
}

function StatusPill({ status, theme }: { status: TaskStatus; theme: Theme }) {
  return (
    <box
      style={{
        backgroundColor: theme.status[status],
        paddingLeft: 1,
        paddingRight: 1,
        alignSelf: 'flex-start',
      }}
    >
      <text>
        <strong fg={theme.onAccent}>
          {STATUS_ICON[status]} {STATUS_LABEL[status]}
        </strong>
      </text>
    </box>
  );
}

function Header({
  theme,
  watchOn,
  onToggleWatch,
}: {
  theme: Theme;
  watchOn: boolean;
  onToggleWatch: () => void;
}) {
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
        <text>
          <span fg={theme.status.complete}>● </span>
          <span fg={theme.fg}>{FAKE_USER}</span>
          <span fg={theme.muted}> · {FAKE_UNIT}</span>
        </text>
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
  task: FakeTask;
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

function TaskDetailBody({ task, theme }: { task: FakeTask; theme: Theme }) {
  const badge = dueBadge(task, theme);
  return (
    <box style={{ flexDirection: 'column', gap: 1 }}>
      <StatusPill status={task.status} theme={theme} />
      <text>
        <span fg={theme.muted}>Due    </span>
        <span fg={theme.fg}>{task.due}</span>
        <span fg={badge.fg}>  {badge.text}</span>
        <span fg={theme.muted}>  ({task.dateSource})</span>
      </text>
      <text>
        <span fg={theme.muted}>Unit   </span>
        <span fg={theme.fg}>{task.unit}</span>
      </text>
      <text fg={theme.fg}>{task.description}</text>
      {task.prerequisites.length > 0 ? (
        <text>
          <span fg={theme.muted}>Requires </span>
          <span fg={theme.accent}>{task.prerequisites.join(', ')}</span>
        </text>
      ) : null}
    </box>
  );
}

function StatusBar({ theme, tasks }: { theme: Theme; tasks: FakeTask[] }) {
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

export function App() {
  const renderer = useRenderer();
  const [theme, setTheme] = useState<Theme>(darkTheme);
  const [mode, setMode] = useState<Mode>('main');
  const [tab, setTab] = useState<TabId>('all');
  const [query, setQuery] = useState('');
  const [paletteQuery, setPaletteQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [paletteSelected, setPaletteSelected] = useState(0);
  const [watchOn, setWatchOn] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<InputRenderable>(null);
  const paletteInputRef = useRef<InputRenderable>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus is imperative and race-prone in OpenTUI; re-assert it on mode
  // changes instead of relying only on the `focused` prop.
  useEffect(() => {
    if (mode === 'main') inputRef.current?.focus();
    if (mode === 'palette') paletteInputRef.current?.focus();
  }, [mode]);

  // Never leave a pending toast timer behind on unmount.
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

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

  const cycleTab = (dir: 1 | -1) => {
    setTab((current) => {
      const i = TABS.findIndex((t) => t.id === current);
      const next = TABS[(i + dir + TABS.length) % TABS.length];
      return next.id;
    });
    setSelected(0);
  };

  const visible = useMemo(
    () => FAKE_TASKS.filter((t) => TABS.find((x) => x.id === tab)!.match(t) && matches(t, query)),
    [tab, query],
  );
  const selectedTask = visible[Math.min(selected, Math.max(visible.length - 1, 0))];

  const tabCounts = useMemo(() => {
    const counts = {} as Record<TabId, number>;
    for (const t of TABS) counts[t.id] = FAKE_TASKS.filter(t.match).length;
    return counts;
  }, []);

  // Command closures only touch stable refs/setters, so memoize once and keep
  // visibleCommands' dependency list honest.
  const commands = useMemo<Command[]>(
    () => [
      {
        name: 'login',
        description: 'Sign in with Monash SSO',
        run: () => showToast('login flow not wired yet (skeleton)'),
      },
      {
        name: 'submit',
        description: 'Submit files for the selected task',
        run: () => showToast('submission wizard not wired yet (skeleton)'),
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
    [],
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
    if (key.ctrl && key.name === 'k') {
      setMode((m) => (m === 'palette' ? 'main' : 'palette'));
      setPaletteQuery('');
      setPaletteSelected(0);
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
        setMode('main');
      } else if (query !== '') {
        clearFilterInput();
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
      if (key.name === 'down') setSelected((i) => Math.min(i + 1, visible.length - 1));
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

  return (
    <box
      style={{
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: theme.bg,
      }}
    >
      <Header theme={theme} watchOn={watchOn} onToggleWatch={toggleWatch} />

      <Tabs theme={theme} tab={tab} counts={tabCounts} onSelect={(t) => { setTab(t); setSelected(0); }} />

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
              <text fg={theme.muted}>no tasks match "{query}"</text>
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

      <StatusBar theme={theme} tasks={FAKE_TASKS} />

      {mode === 'detail' && selectedTask ? (
        <box
          onMouseDown={() => setMode('main')}
          style={{
            position: 'absolute',
            top: 7,
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
          <text fg={theme.muted}>esc / click to close</text>
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
    </box>
  );
}
