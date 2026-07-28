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

export type RoutingStrategy = 'failover' | 'round_robin' | 'weighted_round_robin'

export interface RouteModelMatch {
  models: string[]
}

export interface RouteResource {
  name: string
  from_tags: string[]
  to_tags: string[]
  strategy: RoutingStrategy
  weights: Record<string, number>
  target_model: string
  model_map: Record<string, string>
  match: RouteModelMatch | null
}

export interface RoutesResponse {
  items: RouteResource[]
  order_revision?: string
}

export type RouteUpsertRequest = RouteResource

export interface RouteDeleteRequest {
  name: string
}

export interface RouteReorderRequest {
  from_index: number
  to_index: number
  expected_revision: string
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
  quota_state_reset?: boolean
}

export type ClientQuotaType = 'requests' | 'tokens' | 'cost'

export interface ClientQuotaWindowConfig {
  name: string
  /** Older Core responses omit type and are request quotas. */
  type?: ClientQuotaType
  duration: string
  max_requests?: number
  max_tokens?: number
  max_cost_usd?: number
}

export interface ClientQuotaConfig {
  enabled: boolean
  windows: ClientQuotaWindowConfig[]
}

export interface ClientBindingResource {
  inbound: string
  inbound_protocol: string
  inbound_path: string
  ref: string
  tag: string
}

export interface ClientResource {
  name: string
  token: string
  quota: ClientQuotaConfig
  bindings: ClientBindingResource[]
}

export interface ConfigInboundOption {
  name: string
  protocol: string
  path: string
  clients?: Array<{ ref: string; tag: string }>
}

export interface ConfigOutboundOption {
  name: string
  protocol: string
  tag: string
}

export interface ConfigOptionsResponse {
  inbounds: ConfigInboundOption[]
  outbounds?: ConfigOutboundOption[]
  client_tags?: string[]
  outbound_tags?: string[]
  routing_strategies?: RoutingStrategy[]
}

export interface ClientsResponse {
  items: ClientResource[]
}

export interface ClientFrequency {
  requests: number
  active_days: number
  calendar_days: number
  requests_per_day: number
  requests_per_active_day: number
}

export interface ClientQuotaWindowMetrics {
  name: string
  /** Older Core responses omit type and expose request fields or aliases. */
  type?: ClientQuotaType
  duration?: string
  max_requests?: number
  used_requests?: number
  remaining_requests?: number
  max_tokens?: number
  used_tokens?: number
  remaining_tokens?: number
  max_cost_usd?: number
  used_cost_usd?: number
  remaining_cost_usd?: number
  unpriced_count?: number
  warning?: string
  reset_at?: string
  limit?: number
  used?: number
  remaining?: number
}

export interface ClientQuotaMetrics {
  client?: string
  inbound?: string
  enabled: boolean
  state: string
  windows: ClientQuotaWindowMetrics[]
}

export interface ClientMetricsItem {
  client: ClientResource
  all_time: UsageRow
  frequency: ClientFrequency
  quota?: ClientQuotaMetrics
}

export interface ClientsMetricsResponse {
  items: ClientMetricsItem[]
  days: number
  start_date: string
  end_date: string
}

export interface ClientUpsertRequest {
  name: string
  token: string
  quota: ClientQuotaConfig
}

export interface ClientDeleteRequest {
  name: string
}

export interface ClientBindingUpsertRequest {
  inbound: string
  ref: string
  tag: string
}

export interface ClientBindingDeleteRequest {
  inbound: string
  ref: string
}

export interface ClientUsageStats extends UsageRow {
  value: string
  request_count: number
  success_count: number
  error_count: number
  fallback_count: number
  input_tokens: number
  output_tokens: number
  cached_input_read_tokens: number
  cached_input_write_tokens: number
  cache_read_tokens: number
  cache_create_tokens: number
  total_tokens: number
  cost_usd: number
  provider_usage_count: number
  estimated_usage_count: number
  tool_units?: Record<string, number>
  last_seen_at: string
}

export type ClientDailyUsageStatus = 'complete' | 'partial' | 'unknown'

export interface ClientDailyUsage extends ClientUsageStats {
  date: string
  status: ClientDailyUsageStatus
}

export interface ClientUsageCoverage {
  tracking_started_at?: string
  known: boolean
  backend: string
  aggregates_persisted: boolean
  raw_retention_days: number
}

export interface ClientUsageResponse {
  client: ClientResource
  all_time: ClientUsageStats
  range_summary: ClientUsageStats
  quota?: ClientQuotaMetrics
  coverage: ClientUsageCoverage
  start_date: string
  end_date: string
  daily: ClientDailyUsage[]
}

export interface ConfigReadResponse {
  config_ready: boolean
  redacted_content: string
  revision: string
  checksum: string
}

export interface ConfigValidateResponse {
  ok: boolean
}

export interface ConfigUpdateResponse {
  ok: boolean
  saved: boolean
  applied: boolean
  revision: string
  checksum: string
}

export interface ConfigApplyResponse {
  ok: boolean
  saved?: boolean
  applied: boolean
  restart_required: boolean
  reason?: string
  history_id?: string
  quota_state_reset: boolean
}

export interface ConfigHistoryItem {
  id: string
  created_at: string
  reason: string
  checksum: string
}

export interface ConfigHistoryResponse {
  items: ConfigHistoryItem[]
}

export interface ConfigHistoryDiffResponse {
  id: string
  current_content: string
  history_content: string
}

export interface ConfigRollbackRequest {
  id: string
}
