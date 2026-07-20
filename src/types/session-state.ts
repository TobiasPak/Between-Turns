export interface RecentToolFailure {
  turn: number;
  tool: string;
  error_signature: string;
  had_edit_since_prior: boolean;
}

export interface AmbientState {
  last_delivery_turn: number | null;
  consecutive_failure_count: number;
  stuck_loop_signature: string | null;
  cooldown_strikes: number;
  false_positive_backoff_until_turn: number | null;
  /** Set on any Edit/Write/MultiEdit/NotebookEdit tool call, cleared each time a qualifying (heterogeneous) failure is recorded. */
  edit_since_last_failure: boolean;
}

export interface VisibleState {
  /** Turn of the last *successful* debrief -- a suppressed/failed attempt never sets this, so it never costs a session its next real chance. */
  last_debrief_turn: number | null;
  pr_comment_delivered_for: string[];
}

export interface SessionState {
  session_id: string;
  opted_in: boolean;
  turn_counter: number;
  recent_selections: string[];
  ambient: AmbientState;
  visible: VisibleState;
  recent_tool_failures: RecentToolFailure[];
}

export function newSessionState(sessionId: string): SessionState {
  return {
    session_id: sessionId,
    opted_in: false,
    turn_counter: 0,
    recent_selections: [],
    ambient: {
      last_delivery_turn: null,
      consecutive_failure_count: 0,
      stuck_loop_signature: null,
      cooldown_strikes: 0,
      false_positive_backoff_until_turn: null,
      edit_since_last_failure: false,
    },
    visible: {
      last_debrief_turn: null,
      pr_comment_delivered_for: [],
    },
    recent_tool_failures: [],
  };
}
