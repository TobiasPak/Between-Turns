export interface BetweenTurnsConfig {
  enabled: boolean;
  translation: string;
  modes: {
    ambient: boolean;
    visible: boolean;
  };
  pacing: {
    ambient_min_turns_between_deliveries: number;
    ambient_stuck_loop_failure_threshold: number;
    ambient_backoff_base_turns: number;
    repetition_window: number;
  };
  gloo: {
    tenant: string;
    collection: string;
    api_key_env: string;
  };
  youversion: {
    api_key_env: string;
  };
  log_dir: string;
}
