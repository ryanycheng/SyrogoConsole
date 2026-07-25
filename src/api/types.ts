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

export type ProviderProtocol = 'mock' | 'openai_chat' | 'openai_responses' | 'anthropic_messages'
export type NullableBoolean = boolean | null
export type ProviderUsageEstimationMode = '' | 'heuristic' | (string & {})
export type ProviderQuotaReset = 'rolling' | 'fixed'
export type ProviderQuotaFixedPeriod = 'interval' | 'daily' | 'weekly'

export interface ProviderCapabilities {
  responses_previous_response_id: NullableBoolean
  responses_builtin_tools: NullableBoolean
  responses_tool_result_status_error: NullableBoolean
  responses_assistant_history_native: NullableBoolean
  usage_estimation: boolean
  usage_estimation_mode: ProviderUsageEstimationMode
}

export interface ProviderQuotaFixedSchedule {
  period: ProviderQuotaFixedPeriod
  anchor?: string
  time?: string
  timezone?: string
  weekday?: number
}

export interface ProviderQuotaWindowConfig {
  name: string
  reset?: ProviderQuotaReset
  duration?: string
  fixed?: ProviderQuotaFixedSchedule
  max_requests?: number
  max_tokens?: number
}

export interface ProviderQuotaResetAllConfig {
  enabled: boolean
  schedule: ProviderQuotaFixedSchedule & { duration?: string }
}

export interface ProviderQuotaConfig {
  enabled: boolean
  windows: ProviderQuotaWindowConfig[]
  cooldown: string
  probe_interval: string
  reset_all: ProviderQuotaResetAllConfig
}

export interface ProviderProxyConfig {
  url: string
}

export interface ProviderModel {
  name: string
  aliases: string[]
}

export interface ProviderResource {
  name: string
  models: ProviderModel[]
  protocol: ProviderProtocol
  endpoint: string
  auth_token: string
  tag: string
  enabled: boolean
  capabilities: ProviderCapabilities
  quota: ProviderQuotaConfig
  proxy: ProviderProxyConfig
}

export interface ProvidersResponse {
  items: ProviderResource[]
}

export interface ProviderUsageMetrics extends UsageRow {
  value: string
}

export interface ProviderHealthMetrics {
  outbound: string
  state: string
  last_success_at: string
  last_failure_at: string
  last_error_kind?: string
  consecutive_failures: number
  next_probe_at?: string
}

export interface ProviderQuotaWindowMetrics {
  name: string
  reset?: ProviderQuotaReset
  fixed_period?: ProviderQuotaFixedPeriod
  duration?: string
  max_requests?: number
  used_requests?: number
  remaining_requests?: number
  max_tokens?: number
  used_tokens?: number
  remaining_tokens?: number
  reset_at?: string
  /** Legacy request-only aliases returned by older Core versions. */
  limit?: number
  used?: number
  remaining?: number
}

export interface ProviderQuotaMetrics {
  outbound?: string
  enabled: boolean
  state: string
  cooldown_until?: string
  next_probe_at: string
  last_quota_exceeded_at?: string
  last_success_at: string
  windows: ProviderQuotaWindowMetrics[]
}

export interface ProviderTimelineBucket {
  start: string
  end: string
  request_count: number
  success_count: number
  error_count: number
  state: 'empty' | 'success' | 'failed' | 'mostly_failed' | 'partial_failed'
}

export interface ProviderMetricsItem {
  provider: ProviderResource
  usage: ProviderUsageMetrics
  health?: ProviderHealthMetrics
  quota?: ProviderQuotaMetrics
  timeline: ProviderTimelineBucket[]
}

export interface ProvidersMetricsResponse {
  items: ProviderMetricsItem[]
  hours: 1 | 6 | 12 | 24 | 48
  bucket_minutes: number
  bucket_count: number
}

export interface ProviderCheckRequest {
  name: string
  model: string
  provider?: ProviderResource
}

export interface RouteResource {
  target_model?: string
  model_map?: Record<string, string>
  [key: string]: unknown
}

export interface RoutesResponse {
  items?: RouteResource[]
  routes?: RouteResource[]
  [key: string]: unknown
}

export interface ProviderCheckResponse {
  name: string
  ok: boolean
  state: string
  latency_ms: number
  checked_at: string
  error?: string
}

export interface ConfigMutationResponse {
  ok: boolean
  applied: boolean
  restart_required?: boolean
  reason?: string
  history_id?: string
}

export interface ConfigApplyResponse {
  ok: boolean
  applied: boolean
  restart_required: boolean
  reason?: string
  history_id?: string
  quota_state_reset: boolean
}
