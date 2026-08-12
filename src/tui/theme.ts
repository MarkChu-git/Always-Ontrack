/**
 * Theme tokens for the OnTrack TUI.
 * Status colors map 1:1 to the OnTrack Status Trigger semantics.
 */
export interface Theme {
  name: string;
  bg: string;
  panel: string;
  border: string;
  fg: string;
  muted: string;
  accent: string;
  /** Background of the selected list row. */
  selection: string;
  /** Background of a hovered list row. */
  hover: string;
  /** Text drawn on top of accent/status colored pills. */
  onAccent: string;
  /** Overdue / due-soon due-date colors. */
  urgent: string;
  soon: string;
  status: {
    not_started: string;
    working_on_it: string;
    need_help: string;
    ready_for_feedback: string;
    assess_in_portfolio: string;
    complete: string;
  };
}

export const darkTheme: Theme = {
  name: 'dark',
  bg: '#0d1117',
  panel: '#161b22',
  border: '#30363d',
  fg: '#e6edf3',
  muted: '#7d8590',
  accent: '#58a6ff',
  selection: '#2d333b',
  hover: '#21262d',
  onAccent: '#0d1117',
  urgent: '#f85149',
  soon: '#d29922',
  status: {
    not_started: '#7d8590',
    working_on_it: '#58a6ff',
    need_help: '#f85149',
    ready_for_feedback: '#d29922',
    assess_in_portfolio: '#bc8cff',
    complete: '#3fb950',
  },
};

export const lightTheme: Theme = {
  name: 'light',
  bg: '#ffffff',
  panel: '#f6f8fa',
  border: '#d0d7de',
  fg: '#1f2328',
  muted: '#59636e',
  accent: '#0969da',
  selection: '#d0e3ff',
  hover: '#eaeef2',
  onAccent: '#ffffff',
  urgent: '#cf222e',
  soon: '#9a6700',
  status: {
    not_started: '#59636e',
    working_on_it: '#0969da',
    need_help: '#cf222e',
    ready_for_feedback: '#9a6700',
    assess_in_portfolio: '#8250df',
    complete: '#1a7f37',
  },
};
