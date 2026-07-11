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
    /** The Gloo "Publisher Name" (Organizations -> Publishers in Studio) -- passed as `tenant` on search requests. Not the org name or org UUID. */
    tenant: string;
    /** Always "GlooProd" -- a fixed platform-wide constant, not tenant-specific. */
    collection: string;
    /** The Publisher's UUID -- passed as `publisher_id` on ingestion requests. */
    publisher_id: string;
    client_id_env: string;
    client_secret_env: string;
  };
  youversion: {
    api_key_env: string;
  };
  log_dir: string;
}
