export type StatusKind = 'ok' | 'warn' | 'danger' | 'muted'

export interface OverviewResponse {
  health?: Record<string, unknown>
  usage?: Record<string, unknown>
  quota?: Record<string, unknown>
  latency?: Record<string, unknown>
  governance?: Record<string, unknown>
  config?: Record<string, unknown>
  [key: string]: unknown
}

export interface UsageRow {
  value?: string
  key?: string
  provider?: string
  model?: string
  inbound?: string
  source?: string
  outbound?: string
  error_kind?: string
  date?: string
  agent?: string
  session_id?: string
  request_count?: number
  input_tokens?: number
  output_tokens?: number
  cached_input_read_tokens?: number
  cached_input_write_tokens?: number
  cache_read_tokens?: number
  cache_create_tokens?: number
  total_tokens?: number
  cost_usd?: number
  success_count?: number
  error_count?: number
  fallback_count?: number
  provider_usage_count?: number
  estimated_usage_count?: number
  [key: string]: unknown
}

export interface UsageResponse {
  items?: UsageRow[]
  rows?: UsageRow[]
  [key: string]: unknown
}

export interface LogItem {
  time?: string
  level?: string
  message?: string
  status?: number
  client?: string
  inbound?: string
  outbound?: string[]
  error_kind?: string
  duration?: string
  fields?: Record<string, string>
  content: string
  parsed: boolean
}

export interface LogsResponse {
  path?: string
  content?: string
  redacted_content?: string
  items?: LogItem[]
  truncated?: boolean
  bytes_read?: number
  max_bytes?: number
  lines?: number
  line_count?: number
  matched_count?: number
  scanned_line_count?: number
  scanned_file_count?: number
  includes_archives?: boolean
  source?: 'memory' | 'file'
  since?: string
  until?: string
  limit?: number
  has_more?: boolean
  next_cursor?: string
  scan_truncated?: boolean
  [key: string]: unknown
}

export interface SessionCommands {
  attach?: string
  select_window?: string
  select_pane?: string
}

export interface SessionTmux {
  present?: boolean
  session?: string
  window_index?: string
  window_name?: string
  pane_index?: string
  pane_id?: string
}

export interface SessionItem {
  id: string
  client_name?: string
  inbound_name?: string
  host?: string
  pid?: number
  cwd?: string
  git_branch?: string
  command?: string[]
  tmux?: SessionTmux
  status?: string
  mode?: string
  last_event?: string
  started_at?: string
  last_seen_at?: string
  stopped_at?: string
  exit_code?: number
  commands?: SessionCommands
}

export interface SessionsResponse {
  items: SessionItem[]
}

export interface ProviderHealthItem {
  outbound: string
  state: string
  last_success_at?: string
  last_failure_at?: string
  last_error_kind?: string
  consecutive_failures?: number
  next_probe_at?: string
}

export interface QuotaWindow {
  name: string
  duration?: string
  limit?: number
  used?: number
  remaining?: number
  reset_at?: string
}

export interface QuotaItem {
  outbound?: string
  client?: string
  inbound?: string
  enabled?: boolean
  state: string
  cooldown_until?: string
  next_probe_at?: string
  last_quota_exceeded_at?: string
  last_success_at?: string
  windows?: QuotaWindow[]
}

export interface GovernanceEvent {
  time: string
  type: string
  client?: string
  inbound?: string
  outbound?: string
  reason?: string
  retry_after?: string
}

export interface ProviderDebugResponse {
  health?: ProviderHealthItem[]
  outbound_quota?: QuotaItem[]
  client_quota?: QuotaItem[]
  events?: GovernanceEvent[]
  latency_summary?: Record<string, unknown>
}

export interface LatencyTrace {
  request_id: string
  method?: string
  path?: string
  inbound?: string
  client_name?: string
  fallback_count?: number
  status?: number
  error_kind?: string
  started_at?: string
  finished_at?: string
  duration_ms?: number
  outbound_name?: string
  ttft_ms?: number
}

export interface LatencyTracesResponse {
  items?: LatencyTrace[]
}
