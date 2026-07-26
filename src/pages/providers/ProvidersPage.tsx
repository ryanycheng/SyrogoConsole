import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Form,
  Input,
  Popover,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from '@arco-design/web-react'
import type { TableColumnProps } from '@arco-design/web-react'
import { IconDelete, IconEdit, IconPlus, IconRefresh } from '@arco-design/web-react/icon'
import { apiGet, apiPost, buildQuery } from '../../api/client'
import { errorMessage } from '../../api/errors'
import { useFeedback } from '../../app/feedbackContext'
import { PageDialog } from '../../components/PageDialog'
import type {
  ConfigMutationResponse,
  ProviderCapabilities,
  ProviderCheckRequest,
  ProviderCheckResponse,
  ProviderMetricsItem,
  ProviderProtocol,
  ProviderQuotaFixedPeriod,
  ProviderQuotaFixedSchedule,
  ProviderQuotaReset,
  ProviderQuotaWindowConfig,
  ProviderQuotaWindowMetrics,
  ProviderResource,
  ProvidersMetricsResponse,
  ProvidersResponse,
  RoutesResponse,
} from '../../api/types'

const protocols: ProviderProtocol[] = ['mock', 'openai_chat', 'openai_responses', 'anthropic_messages']
const hourOptions = [1, 6, 12, 24, 48] as const
const fixedPeriods: ProviderQuotaFixedPeriod[] = ['interval', 'daily', 'weekly']
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const durationPresets = ['30s', '1m', '5m', '1h', '5h', '24h', '168h']
const AUTO_REFRESH_MS = 30_000
const capabilityFields: { key: keyof Pick<ProviderCapabilities, 'responses_previous_response_id' | 'responses_builtin_tools' | 'responses_tool_result_status_error' | 'responses_assistant_history_native'>; label: string; help: string }[] = [
  { key: 'responses_previous_response_id', label: 'Previous response ID', help: 'Inherit uses Core defaults; Yes or No explicitly advertises previous_response_id support.' },
  { key: 'responses_builtin_tools', label: 'Built-in tools', help: 'Controls whether Responses built-in tool definitions are sent upstream.' },
  { key: 'responses_tool_result_status_error', label: 'Tool result error status', help: 'Controls native forwarding of error status on tool results.' },
  { key: 'responses_assistant_history_native', label: 'Native assistant history', help: 'Controls whether assistant history uses the upstream-native representation.' },
]

type Hours = (typeof hourOptions)[number]
type ProviderRow = ProviderResource & { metrics?: ProviderMetricsItem }
type Draft = ProviderResource

type ValidationErrors = Record<string, string>

function emptyCapabilities(): ProviderCapabilities {
  return {
    responses_previous_response_id: null,
    responses_builtin_tools: null,
    responses_tool_result_status_error: null,
    responses_assistant_history_native: null,
    usage_estimation: false,
    usage_estimation_mode: '',
  }
}

function capabilitiesForProtocol(protocol: ProviderProtocol, capabilities: ProviderCapabilities): ProviderCapabilities {
  const next = { ...capabilities }
  if (protocol !== 'openai_responses') {
    capabilityFields.forEach(({ key }) => { next[key] = null })
  }
  if (protocol !== 'openai_chat' && protocol !== 'anthropic_messages') {
    next.usage_estimation = false
    next.usage_estimation_mode = ''
  } else if (!next.usage_estimation) {
    next.usage_estimation_mode = ''
  }
  return protocol === 'mock' ? emptyCapabilities() : next
}

function emptySchedule(): ProviderQuotaFixedSchedule & { duration?: string } {
  return { period: 'daily', time: '00:00', timezone: 'UTC' }
}

function emptyDraft(): Draft {
  return {
    name: '', models: [], protocol: 'openai_chat', tag: '', endpoint: '', auth_token: '', enabled: true,
    capabilities: emptyCapabilities(),
    quota: { enabled: false, windows: [], cooldown: '1m', probe_interval: '1m', reset_all: { enabled: false, schedule: emptySchedule() } },
    proxy: { url: '' },
  }
}

function normalizeWindow(window: ProviderQuotaWindowConfig): ProviderQuotaWindowConfig {
  const reset = window.reset || 'rolling'
  return { ...window, reset, duration: reset === 'rolling' || window.fixed?.period === 'interval' ? (window.duration || '1h') : undefined }
}

function normalizeProvider(provider: ProviderResource): Draft {
  const capabilities = { ...emptyCapabilities(), ...provider.capabilities }
  const quota = provider.quota || emptyDraft().quota
  return {
    ...emptyDraft(),
    ...provider,
    capabilities: capabilitiesForProtocol(provider.protocol, capabilities),
    quota: {
      ...emptyDraft().quota,
      ...quota,
      windows: (quota.windows || []).map(normalizeWindow),
      reset_all: { ...emptyDraft().quota.reset_all, ...quota.reset_all, schedule: { ...emptySchedule(), ...quota.reset_all?.schedule } },
    },
    proxy: { url: provider.proxy?.url || '' },
  }
}

function positiveDuration(value: string): boolean {
  const parts = value.trim().match(/(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+/g)
  if (!parts || parts.join('') !== value.trim()) return false
  return [...value.matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g)].some((match) => Number(match[1]) > 0)
}

function durationPreview(value: string): string {
  if (!positiveDuration(value)) return 'Use Go duration units h, m, s (d is not supported).'
  const unitMs: Record<string, number> = { ns: 1e-6, us: 1e-3, 'µs': 1e-3, ms: 1, s: 1000, m: 60_000, h: 3_600_000 }
  let totalMs = 0
  for (const match of value.trim().matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g)) totalMs += Number(match[1]) * unitMs[match[2]]
  const units: [string, number][] = [['week', 604_800_000], ['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000], ['second', 1000]]
  const parts: string[] = []
  for (const [label, size] of units) {
    const count = Math.floor(totalMs / size)
    if (count) {
      parts.push(`${count} ${label}${count === 1 ? '' : 's'}`)
      totalMs -= count * size
    }
  }
  return parts.length ? parts.slice(0, 3).join(' ') : 'Less than one second'
}

function ModelAutoComplete({ ariaLabel, value, suggestions, onChange }: { ariaLabel: string; value: string; suggestions: string[]; onChange: (value: string) => void }) {
  const listId = useId()
  return <>
    <Input aria-label={ariaLabel} list={listId} value={value} onChange={onChange} />
    <datalist id={listId}>{suggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}</datalist>
  </>
}

function DurationInput({ ariaLabel, value, onChange }: { ariaLabel: string; value: string; onChange: (value: string) => void }) {
  return <div className="duration-control">
    <Input aria-label={ariaLabel} value={value} onChange={onChange} />
    <Space size={4} wrap className="duration-presets">{durationPresets.map((preset) => <Button key={preset} size="mini" onClick={() => onChange(preset)}>{preset}</Button>)}</Space>
    <HelpText>{durationPreview(value)}. Combine units such as 1h30m; d is not supported.</HelpText>
  </div>
}

function toProviderPayload(provider: ProviderResource): ProviderResource {
  return {
    name: provider.name,
    models: (provider.models || []).map((model) => ({ name: model.name.trim(), aliases: model.aliases.map((alias) => alias.trim()).filter(Boolean) })),
    protocol: provider.protocol,
    endpoint: provider.endpoint,
    auth_token: provider.auth_token,
    tag: provider.tag,
    enabled: provider.enabled,
    capabilities: { ...provider.capabilities },
    quota: {
      enabled: provider.quota.enabled,
      windows: provider.quota.windows.map((window) => ({
        name: window.name,
        reset: window.reset,
        duration: window.duration,
        fixed: window.fixed ? { ...window.fixed } : undefined,
        max_requests: window.max_requests,
        max_tokens: window.max_tokens,
      })),
      cooldown: provider.quota.cooldown,
      probe_interval: provider.quota.probe_interval,
      reset_all: { enabled: provider.quota.reset_all.enabled, schedule: { ...provider.quota.reset_all.schedule } },
    },
    proxy: { url: provider.proxy.url },
  }
}

function validProxy(value: string): boolean {
  if (!value.trim()) return true
  try {
    const url = new URL(value)
    return ['http:', 'https:', 'socks5:'].includes(url.protocol) && Boolean(url.hostname)
  } catch {
    return false
  }
}

function validTime(value?: string): boolean {
  return Boolean(value && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value))
}

function validOffsetRFC3339(value?: string): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false
  return !Number.isNaN(Date.parse(value))
}

function validTimezone(value?: string): boolean {
  if (!value) return false
  if (value === 'UTC') return true
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function positiveInteger(value?: number): boolean {
  return Number.isInteger(value) && Number(value) > 0
}

function validateSchedule(schedule: ProviderQuotaFixedSchedule & { duration?: string }, prefix: string, errors: ValidationErrors) {
  if (schedule.period === 'interval') {
    if (!positiveDuration(schedule.duration || '')) errors[`${prefix}_duration`] = 'Enter a positive Go duration.'
    if (!validOffsetRFC3339(schedule.anchor)) errors[`${prefix}_anchor`] = 'Enter RFC3339 with Z or an explicit offset.'
  } else {
    if (!validTime(schedule.time)) errors[`${prefix}_time`] = 'Enter HH:MM or HH:MM:SS.'
    if (!validTimezone(schedule.timezone)) errors[`${prefix}_timezone`] = 'Enter UTC or a valid IANA timezone.'
    if (schedule.period === 'weekly' && (!Number.isInteger(schedule.weekday) || Number(schedule.weekday) < 0 || Number(schedule.weekday) > 6)) errors[`${prefix}_weekday`] = 'Select a weekday.'
  }
}

function validateDraft(draft: Draft, editing: boolean): ValidationErrors {
  const errors: ValidationErrors = {}
  if (!draft.name.trim()) errors.name = 'Name is required.'
  const modelNames = new Map<string, string>()
  draft.models.forEach((model, index) => {
    const canonical = model.name.trim()
    if (!canonical) errors[`model_name_${index}`] = 'Canonical model name is required.'
    for (const identity of [canonical, ...model.aliases.map((alias) => alias.trim())].filter(Boolean)) {
      const normalized = identity.toLowerCase()
      const existing = modelNames.get(normalized)
      if (existing) errors[`model_aliases_${index}`] = `Model identity “${identity}” conflicts with ${existing}.`
      else modelNames.set(normalized, canonical || `model ${index + 1}`)
    }
  })
  if (!protocols.includes(draft.protocol)) errors.protocol = 'Protocol is required.'
  if (!draft.tag.trim()) errors.tag = 'Tag is required.'
  if (draft.protocol !== 'mock' && !draft.endpoint.trim()) errors.endpoint = 'Endpoint is required for non-mock providers.'
  if (!editing && draft.protocol !== 'mock' && (!draft.auth_token.trim() || draft.auth_token === '<redacted>')) errors.auth_token = 'Auth token is required for a new non-mock provider.'
  const hasResponseCapabilities = capabilityFields.some(({ key }) => draft.capabilities[key] !== null)
  if (draft.protocol !== 'openai_responses' && hasResponseCapabilities) errors.capabilities = 'Responses capabilities are only supported for openai_responses.'
  const supportsUsageEstimation = draft.protocol === 'openai_chat' || draft.protocol === 'anthropic_messages'
  if (!supportsUsageEstimation && (draft.capabilities.usage_estimation || draft.capabilities.usage_estimation_mode !== '')) errors.usage_estimation = 'Usage estimation is only supported for openai_chat and anthropic_messages.'
  if (supportsUsageEstimation && draft.capabilities.usage_estimation && !draft.capabilities.usage_estimation_mode) errors.usage_estimation_mode = 'Usage estimation mode is required when enabled.'
  if (!draft.capabilities.usage_estimation && draft.capabilities.usage_estimation_mode !== '') errors.usage_estimation_mode = 'Usage estimation mode must be empty when disabled.'
  if (draft.protocol === 'mock' && draft.capabilities !== undefined && (hasResponseCapabilities || draft.capabilities.usage_estimation || draft.capabilities.usage_estimation_mode !== '')) errors.capabilities = 'Capabilities are unsupported for mock providers.'
  if (draft.quota.enabled) {
    if (!draft.quota.windows.length) errors.windows = 'Add at least one quota window.'
    const names = new Set<string>()
    draft.quota.windows.forEach((window, index) => {
      const name = window.name.trim()
      if (!name) errors[`window_name_${index}`] = 'Window name is required.'
      else if (names.has(name)) errors[`window_name_${index}`] = 'Window names must be unique.'
      names.add(name)
      const reset = window.reset || 'rolling'
      if (!['rolling', 'fixed'].includes(reset)) errors[`window_reset_${index}`] = 'Select rolling or fixed.'
      if (reset === 'rolling') {
        if (!positiveDuration(window.duration || '')) errors[`window_duration_${index}`] = 'Enter a positive Go duration.'
      } else if (window.fixed) {
        validateSchedule({ ...window.fixed, duration: window.duration }, `window_${index}`, errors)
      } else {
        errors[`window_period_${index}`] = 'Select a fixed period.'
      }
      if (!positiveInteger(window.max_requests) && !positiveInteger(window.max_tokens)) errors[`window_limit_${index}`] = 'Set at least one positive request or token limit.'
      if (window.max_requests !== undefined && !positiveInteger(window.max_requests)) errors[`window_requests_${index}`] = 'Enter a positive integer or leave blank.'
      if (window.max_tokens !== undefined && !positiveInteger(window.max_tokens)) errors[`window_tokens_${index}`] = 'Enter a positive integer or leave blank.'
    })
    if (draft.quota.reset_all.enabled) validateSchedule(draft.quota.reset_all.schedule, 'reset_all', errors)
    if (!positiveDuration(draft.quota.cooldown)) errors.cooldown = 'Enter a positive Go duration.'
    if (!positiveDuration(draft.quota.probe_interval)) errors.probe_interval = 'Enter a positive Go duration.'
  }
  if (!validProxy(draft.proxy.url)) errors.proxy = 'Use an http, https, or socks5 URL with a host.'
  return errors
}

function validateTest(draft: Draft, editing: boolean, model: string): ValidationErrors {
  const all = validateDraft(draft, editing)
  const errors: ValidationErrors = {}
  ;['name', 'protocol', 'tag', 'endpoint', 'auth_token', 'capabilities', 'usage_estimation', 'usage_estimation_mode'].forEach((key) => {
    if (all[key]) errors[key] = all[key]
  })
  if (draft.protocol !== 'mock' && !model.trim()) errors.test_model = 'Test model is required for non-mock providers.'
  return errors
}

function formatNumber(value: unknown): string {
  return new Intl.NumberFormat('en-US').format(Number(value || 0))
}

function formatCost(value: unknown): string {
  return `$${Number(value || 0).toFixed(4)}`
}

interface Confirmation {
  title: string
  content: string
  confirmText: string
  action: () => void
}

function HelpText({ children }: { children: ReactNode }) {
  return <Typography.Text className="field-help" type="secondary">{children}</Typography.Text>
}

function ConfirmationDialog({ confirmation, onCancel, onConfirm }: { confirmation: Confirmation; onCancel: () => void; onConfirm: () => void }) {
  return <PageDialog title={confirmation.title} onCancel={onCancel} footer={<><Button onClick={onCancel}>Cancel</Button><Button type="primary" status="danger" onClick={onConfirm}>{confirmation.confirmText}</Button></>}>
    <p className="provider-confirm-content">{confirmation.content}</p>
  </PageDialog>
}

function quotaWindowLines(window: ProviderQuotaWindowMetrics) {
  const maxRequests = window.max_requests ?? window.limit
  const usedRequests = window.used_requests ?? window.used
  const remainingRequests = window.remaining_requests ?? window.remaining
  const reset = window.reset || 'rolling'
  const resetDetail = window.fixed_period ? `${reset} ${window.fixed_period}` : reset
  return <div className="quota-metric-window" key={window.name}>
    <strong>{window.name}</strong> <Typography.Text type="secondary">({resetDetail}{window.duration ? ` · ${window.duration}` : ''})</Typography.Text>
    {maxRequests !== undefined ? <div>Requests: {formatNumber(usedRequests)} used · {formatNumber(remainingRequests)} remaining / {formatNumber(maxRequests)} requests</div> : null}
    {window.max_tokens !== undefined ? <div>Tokens: {formatNumber(window.used_tokens)} used · {formatNumber(window.remaining_tokens)} remaining / {formatNumber(window.max_tokens)} tokens</div> : null}
    {window.reset_at ? <div>Resets: {window.reset_at}</div> : null}
  </div>
}

function formatTimelineTime(value: string): string {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/)
  return match ? `${match[1]} ${match[2]}` : value
}

function Timeline({ item }: { item?: ProviderMetricsItem }) {
  if (!item) return <Typography.Text type="secondary">Unavailable</Typography.Text>
  const maxRequests = Math.max(1, ...item.timeline.map((bucket) => bucket.request_count))
  return <div className="provider-timeline-cell">
    <div className="provider-timeline" aria-label={`${item.timeline.length} activity buckets`}>
      {item.timeline.map((bucket, index) => {
        const height = bucket.request_count ? Math.max(18, Math.round((bucket.request_count / maxRequests) * 72)) : 8
        const start = formatTimelineTime(bucket.start)
        const end = formatTimelineTime(bucket.end)
        const content = <div className="timeline-popover">
          <strong className="timeline-popover-time">{start} – {end}</strong>
          <span>State: {bucket.state}</span><span>Requests: {formatNumber(bucket.request_count)}</span>
          <span>Successes: {formatNumber(bucket.success_count)}</span><span>Errors: {formatNumber(bucket.error_count)}</span>
        </div>
        return <Popover key={`${bucket.start}-${index}`} trigger="hover" content={content} position="top" triggerProps={{ mouseEnterDelay: 0, mouseLeaveDelay: 50 }}>
          <button type="button" className={`provider-bucket provider-bucket-${bucket.state}`} style={{ height }} aria-label={`${bucket.start} to ${bucket.end}: ${bucket.state}, ${bucket.request_count} requests, ${bucket.success_count} successes, ${bucket.error_count} errors`} />
        </Popover>
      })}
    </div>
    <div className="provider-timeline-legend" aria-label="Timeline legend"><span className="legend-success">Success</span><span className="legend-partial">Partial</span><span className="legend-failed">Failed</span><span className="legend-empty">Empty</span></div>
  </div>
}

interface ProviderModalProps {
  visible: boolean
  initial?: ProviderResource
  saving: boolean
  testing: boolean
  modelSuggestions: string[]
  onDirtyChange: (dirty: boolean) => void
  onCancel: () => void
  onSave: (draft: Draft) => void
  onTest: (draft: Draft, model: string) => Promise<ProviderCheckResponse>
}

function ProviderModal({ visible: _visible, initial, saving, testing, modelSuggestions, onDirtyChange, onCancel, onSave, onTest }: ProviderModalProps) {
  const editing = Boolean(initial)
  const [draft, setDraft] = useState<Draft>(() => initial ? normalizeProvider(initial) : emptyDraft())
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [testModel, setTestModel] = useState('')
  const [testResult, setTestResult] = useState<ProviderCheckResponse>()
  const [testError, setTestError] = useState('')

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    onDirtyChange(true)
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function updateProtocol(protocol: ProviderProtocol) {
    setDraft((current) => ({ ...current, protocol, capabilities: capabilitiesForProtocol(protocol, current.capabilities) }))
    setErrors((current) => {
      const next = { ...current }
      delete next.capabilities
      delete next.usage_estimation
      delete next.usage_estimation_mode
      return next
    })
  }

  function updateCapability(key: keyof ProviderCapabilities, value: ProviderCapabilities[typeof key]) {
    setDraft((current) => ({ ...current, capabilities: { ...current.capabilities, [key]: value } }))
  }

  function updateUsageEstimation(enabled: boolean) {
    setDraft((current) => ({
      ...current,
      capabilities: {
        ...current.capabilities,
        usage_estimation: enabled,
        usage_estimation_mode: enabled ? 'heuristic' : '',
      },
    }))
  }

  function updateQuota(key: keyof Draft['quota'], value: Draft['quota'][typeof key]) {
    setDraft((current) => ({ ...current, quota: { ...current.quota, [key]: value } }))
  }

  function updateWindow(index: number, patch: Partial<ProviderQuotaWindowConfig>) {
    updateQuota('windows', draft.quota.windows.map((window, itemIndex) => itemIndex === index ? { ...window, ...patch } : window))
  }

  function updateWindowReset(index: number, reset: ProviderQuotaReset) {
    const window = draft.quota.windows[index]
    updateWindow(index, reset === 'rolling'
      ? { reset, duration: window.duration || '1h', fixed: undefined }
      : { reset, duration: undefined, fixed: { period: 'daily', time: '00:00', timezone: 'UTC' } })
  }

  function updateWindowPeriod(index: number, period: ProviderQuotaFixedPeriod) {
    updateWindow(index, period === 'interval'
      ? { duration: '1h', fixed: { period, anchor: new Date().toISOString() } }
      : { duration: undefined, fixed: { period, time: '00:00', timezone: 'UTC', ...(period === 'weekly' ? { weekday: 1 } : {}) } })
  }

  function updateResetAllPeriod(period: ProviderQuotaFixedPeriod) {
    updateQuota('reset_all', {
      ...draft.quota.reset_all,
      schedule: period === 'interval'
        ? { period, duration: '1h', anchor: new Date().toISOString() }
        : { period, time: '00:00', timezone: 'UTC', ...(period === 'weekly' ? { weekday: 1 } : {}) },
    })
  }

  function scheduleFields(schedule: ProviderQuotaFixedSchedule & { duration?: string }, prefix: string, labels: string, updateSchedule: (patch: Partial<typeof schedule>) => void) {
    return <div className="quota-schedule-grid">
      <Form.Item label="Fixed period" validateStatus={errors[`${prefix}_period`] ? 'error' : undefined} help={errors[`${prefix}_period`]}>
        <Select aria-label={`${labels} fixed period`} value={schedule.period} onChange={(value) => prefix === 'reset_all' ? updateResetAllPeriod(value) : updateWindowPeriod(Number(prefix.replace('window_', '')), value)}>{fixedPeriods.map((period) => <Select.Option key={period} value={period}>{period}</Select.Option>)}</Select>
        <HelpText>Interval aligns to an RFC3339 anchor; daily and weekly use local wall-clock time.</HelpText>
      </Form.Item>
      {schedule.period === 'interval' ? <>
        <Form.Item label="Duration" validateStatus={errors[`${prefix}_duration`] ? 'error' : undefined} help={errors[`${prefix}_duration`]}><DurationInput ariaLabel={`${labels} duration`} value={schedule.duration || ''} onChange={(value) => updateSchedule({ duration: value })} /></Form.Item>
        <Form.Item label="Anchor" validateStatus={errors[`${prefix}_anchor`] ? 'error' : undefined} help={errors[`${prefix}_anchor`]}><Input aria-label={`${labels} anchor`} value={schedule.anchor || ''} onChange={(value) => updateSchedule({ anchor: value })} /><HelpText>RFC3339 timestamp with Z or an explicit UTC offset; it determines interval alignment.</HelpText></Form.Item>
      </> : <>
        <Form.Item label="Time" validateStatus={errors[`${prefix}_time`] ? 'error' : undefined} help={errors[`${prefix}_time`]}><Input aria-label={`${labels} time`} value={schedule.time || ''} onChange={(value) => updateSchedule({ time: value })} /><HelpText>Boundary time in HH:MM or HH:MM:SS.</HelpText></Form.Item>
        <Form.Item label="Timezone" validateStatus={errors[`${prefix}_timezone`] ? 'error' : undefined} help={errors[`${prefix}_timezone`]}><Input aria-label={`${labels} timezone`} value={schedule.timezone || ''} onChange={(value) => updateSchedule({ timezone: value })} /><HelpText>UTC or an IANA timezone such as Asia/Shanghai.</HelpText></Form.Item>
        {schedule.period === 'weekly' ? <Form.Item label="Weekday" validateStatus={errors[`${prefix}_weekday`] ? 'error' : undefined} help={errors[`${prefix}_weekday`]}><Select aria-label={`${labels} weekday`} value={schedule.weekday} onChange={(value) => updateSchedule({ weekday: value })}>{weekdays.map((day, value) => <Select.Option key={day} value={value}>{day}</Select.Option>)}</Select><HelpText>The local weekday on which the weekly boundary occurs.</HelpText></Form.Item> : null}
      </>}
    </div>
  }

  function check(): boolean {
    const next = validateDraft(draft, editing)
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function testDraft() {
    const next = validateTest(draft, editing, testModel)
    setErrors(next)
    if (Object.keys(next).length) return
    setTestResult(undefined)
    setTestError('')
    try {
      setTestResult(await onTest(draft, testModel.trim()))
    } catch (error) {
      setTestError(errorMessage(error))
    }
  }

  return (
    <PageDialog className="provider-editor-dialog" title={editing ? `Edit provider: ${initial?.name}` : 'New provider'} onCancel={onCancel} footer={<><Button onClick={onCancel}>Cancel</Button><Button type="primary" loading={saving} onClick={() => { if (check()) onSave(draft) }}>Save</Button></>}>
      <HelpText>Save applies this provider directly to Core.</HelpText>
      <Form layout="vertical" className="provider-form">
        <div className="provider-form-grid">
          <Form.Item label="Name" validateStatus={errors.name ? 'error' : undefined} help={errors.name}>
            <Input aria-label="Name" value={draft.name} disabled={editing} onChange={(value) => update('name', value)} /><HelpText>Stable Core identifier; it cannot be changed after creation.</HelpText>
          </Form.Item>
          <Form.Item label="Protocol" validateStatus={errors.protocol ? 'error' : undefined} help={errors.protocol}>
            <Select aria-label="Protocol" value={draft.protocol} onChange={(value) => updateProtocol(value)}>{protocols.map((protocol) => <Select.Option key={protocol} value={protocol}>{protocol}</Select.Option>)}</Select><HelpText>Selects the upstream wire format and available capabilities.</HelpText>
          </Form.Item>
          <Form.Item label="Tag" validateStatus={errors.tag ? 'error' : undefined} help={errors.tag}>
            <Input aria-label="Tag" value={draft.tag} onChange={(value) => update('tag', value)} /><HelpText>Routing label used to group or select this provider.</HelpText>
          </Form.Item>
          <Form.Item label="Enabled"><Switch aria-label="Enabled" checked={draft.enabled} onChange={(value) => update('enabled', value)} /><HelpText>Disabled providers remain configured but cannot receive traffic.</HelpText></Form.Item>
        </div>
        <Form.Item label="Endpoint" validateStatus={errors.endpoint ? 'error' : undefined} help={errors.endpoint}>
          <Input aria-label="Endpoint" value={draft.endpoint} onChange={(value) => update('endpoint', value)} /><HelpText>Base URL used for outbound API requests; mock providers may leave it empty.</HelpText>
        </Form.Item>
        <Form.Item label="Auth token" validateStatus={errors.auth_token ? 'error' : undefined} help={errors.auth_token}>
          <Input.Password aria-label="Auth token" value={draft.auth_token} onChange={(value) => update('auth_token', value)} /><HelpText>{editing ? 'Leave empty or keep <redacted> to preserve the stored secret.' : 'Secret sent to the upstream; required for new non-mock providers.'}</HelpText>
        </Form.Item>
        <Divider orientation="left">Models</Divider>
        <HelpText>Canonical names and aliases define model identities accepted by this provider. Leave the list empty for unrestricted model access.</HelpText>
        <div className="provider-model-list">{draft.models.map((model, index) => <Card key={index} size="small" title={model.name || `Model ${index + 1}`} extra={<Button aria-label={`Delete model ${index + 1}`} size="mini" status="danger" icon={<IconDelete />} onClick={() => update('models', draft.models.filter((_, itemIndex) => itemIndex !== index))} />}>
          <div className="provider-form-grid">
            <Form.Item label="Canonical name" validateStatus={errors[`model_name_${index}`] ? 'error' : undefined} help={errors[`model_name_${index}`]}><ModelAutoComplete ariaLabel={`Model ${index + 1} canonical name`} suggestions={modelSuggestions} value={model.name} onChange={(value) => update('models', draft.models.map((item, itemIndex) => itemIndex === index ? { ...item, name: value } : item))} /><HelpText>Saved canonical upstream model name; free input is allowed.</HelpText></Form.Item>
            <Form.Item label="Aliases" validateStatus={errors[`model_aliases_${index}`] ? 'error' : undefined} help={errors[`model_aliases_${index}`]}><Input aria-label={`Model ${index + 1} aliases`} value={model.aliases.join(', ')} onChange={(value) => update('models', draft.models.map((item, itemIndex) => itemIndex === index ? { ...item, aliases: value.split(',').map((alias) => alias.trim()).filter(Boolean) } : item))} /><HelpText>Comma-separated alternate identities; aliases and canonical names must be unique.</HelpText></Form.Item>
          </div>
        </Card>)}</div>
        <Button icon={<IconPlus />} onClick={() => update('models', [...draft.models, { name: '', aliases: [] }])}>Add model</Button>
        <Card size="small" title="Test provider" style={{ marginTop: 20, marginBottom: 20 }}>
          <Form.Item label="Test model" validateStatus={errors.test_model ? 'error' : undefined} help={errors.test_model}>
            <ModelAutoComplete ariaLabel="Test model" suggestions={modelSuggestions} value={testModel} onChange={(value) => { setTestModel(value); setErrors((current) => ({ ...current, test_model: '' })) }} /><HelpText>Not saved; suggestions include provider and route models, and free input is allowed.</HelpText>
          </Form.Item>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Button loading={testing} onClick={testDraft}>Test draft</Button>
            {testResult ? <Alert type={testResult.ok ? 'success' : 'error'} title={`Test ${testResult.ok ? 'passed' : 'failed'}: ${testResult.state}`} content={`${testResult.latency_ms} ms${testResult.error ? ` — ${testResult.error}` : ''}`} /> : null}
            {testError ? <Alert type="error" title="Test failed" content={testError} /> : null}
          </Space>
        </Card>

        <Divider orientation="left">Capabilities</Divider>
        {draft.protocol === 'openai_responses' ? capabilityFields.map((field) => <Form.Item key={field.key} label={field.label}>
          <Radio.Group value={String(draft.capabilities[field.key])} onChange={(value) => updateCapability(field.key, value === 'null' ? null : value === 'true')}>
            <Radio value="null">Inherit</Radio><Radio value="true">Yes</Radio><Radio value="false">No</Radio>
          </Radio.Group><HelpText>{field.help}</HelpText>
        </Form.Item>) : null}
        {draft.protocol === 'openai_chat' || draft.protocol === 'anthropic_messages' ? <Form.Item label="Usage estimation" validateStatus={errors.usage_estimation_mode ? 'error' : undefined} help={errors.usage_estimation_mode}>
          <Switch aria-label="Usage estimation" checked={draft.capabilities.usage_estimation} onChange={updateUsageEstimation} />
          <HelpText>When enabled, heuristic estimation is used only if upstream usage is missing. It is not exact billing data, and estimated tokens participate in max_tokens quota. Unknown future modes are preserved unless you change this switch.</HelpText>
        </Form.Item> : <Typography.Text type="secondary">No configurable capabilities for this protocol.</Typography.Text>}

        <Divider orientation="left">Quota</Divider>
        <Form.Item><Checkbox checked={draft.quota.enabled} onChange={(value) => updateQuota('enabled', value)}>Enable quota</Checkbox><HelpText>Enforces each configured request and/or token window before routing traffic.</HelpText></Form.Item>
        {draft.quota.enabled ? <>
          {errors.windows ? <Alert type="error" content={errors.windows} /> : null}
          <div className="quota-window-list">{draft.quota.windows.map((window, index) => <Card size="small" className="quota-window-card" title={window.name || `Quota window ${index + 1}`} key={index} extra={<Button aria-label={`Delete window ${index + 1}`} status="danger" icon={<IconDelete />} onClick={() => updateQuota('windows', draft.quota.windows.filter((_, itemIndex) => itemIndex !== index))} />}>
            {errors[`window_limit_${index}`] ? <Alert type="error" content={errors[`window_limit_${index}`]} /> : null}
            <div className="quota-rule-grid">
              <Form.Item label="Window name" validateStatus={errors[`window_name_${index}`] ? 'error' : undefined} help={errors[`window_name_${index}`]}><Input aria-label={`Window ${index + 1} name`} value={window.name} onChange={(value) => updateWindow(index, { name: value })} /><HelpText>Unique label shown in runtime quota metrics.</HelpText></Form.Item>
              <Form.Item label="Reset" validateStatus={errors[`window_reset_${index}`] ? 'error' : undefined} help={errors[`window_reset_${index}`]}><Select aria-label={`Window ${index + 1} reset`} value={window.reset || 'rolling'} onChange={(value) => updateWindowReset(index, value)}><Select.Option value="rolling">rolling</Select.Option><Select.Option value="fixed">fixed</Select.Option></Select><HelpText>Rolling follows recent activity; fixed resets at aligned calendar or interval boundaries.</HelpText></Form.Item>
              {(window.reset || 'rolling') === 'rolling' ? <Form.Item label="Duration" validateStatus={errors[`window_duration_${index}`] ? 'error' : undefined} help={errors[`window_duration_${index}`]}><DurationInput ariaLabel={`Window ${index + 1} duration`} value={window.duration || ''} onChange={(value) => updateWindow(index, { duration: value })} /></Form.Item> : null}
              <Form.Item label="Max requests" validateStatus={errors[`window_requests_${index}`] ? 'error' : undefined} help={errors[`window_requests_${index}`]}><Input aria-label={`Window ${index + 1} max requests`} type="number" value={window.max_requests === undefined ? '' : String(window.max_requests)} onChange={(value) => updateWindow(index, { max_requests: value === '' ? undefined : Number(value) })} /><HelpText>Optional positive request count; leave blank when only limiting tokens.</HelpText></Form.Item>
              <Form.Item label="Max tokens" validateStatus={errors[`window_tokens_${index}`] ? 'error' : undefined} help={errors[`window_tokens_${index}`]}><Input aria-label={`Window ${index + 1} max tokens`} type="number" value={window.max_tokens === undefined ? '' : String(window.max_tokens)} onChange={(value) => updateWindow(index, { max_tokens: value === '' ? undefined : Number(value) })} /><HelpText>Optional positive token count, including heuristic usage when enabled.</HelpText></Form.Item>
            </div>
            {(window.reset || 'rolling') === 'fixed' ? scheduleFields({ ...(window.fixed || { period: 'daily' }), duration: window.duration }, `window_${index}`, `Window ${index + 1}`, (patch) => {
              const { duration, ...fixedPatch } = patch
              updateWindow(index, { ...(duration !== undefined ? { duration } : {}), fixed: { ...(window.fixed || { period: 'daily' }), ...fixedPatch } })
            }) : null}
          </Card>)}</div>
          <Button icon={<IconPlus />} onClick={() => updateQuota('windows', [...draft.quota.windows, { name: '', reset: 'rolling', duration: '1h', max_requests: 1 }])}>Add window</Button>
          <Card size="small" className="reset-all-card" title="Reset all quota windows">
            <Form.Item><Switch aria-label="Reset all" checked={draft.quota.reset_all.enabled} onChange={(enabled) => updateQuota('reset_all', { ...draft.quota.reset_all, enabled })} /><HelpText>Applies one fixed schedule to clear every quota window together. A weekly reset can clear daily and 5h counters, but never clears Cooldown or Probe state.</HelpText></Form.Item>
            {draft.quota.reset_all.enabled ? scheduleFields(draft.quota.reset_all.schedule, 'reset_all', 'Reset all', (patch) => updateQuota('reset_all', { ...draft.quota.reset_all, schedule: { ...draft.quota.reset_all.schedule, ...patch } })) : null}
          </Card>
          <div className="provider-form-grid">
            <Form.Item label="Cooldown" validateStatus={errors.cooldown ? 'error' : undefined} help={errors.cooldown}><DurationInput ariaLabel="Cooldown" value={draft.quota.cooldown} onChange={(value) => updateQuota('cooldown', value)} /><HelpText>How long a quota-exceeded provider remains unavailable before probing.</HelpText></Form.Item>
            <Form.Item label="Probe interval" validateStatus={errors.probe_interval ? 'error' : undefined} help={errors.probe_interval}><DurationInput ariaLabel="Probe interval" value={draft.quota.probe_interval} onChange={(value) => updateQuota('probe_interval', value)} /><HelpText>Minimum spacing between recovery probes; reset-all does not clear this state.</HelpText></Form.Item>
          </div>
        </> : null}

        <Divider orientation="left">Proxy</Divider>
        <Form.Item label="Proxy URL" validateStatus={errors.proxy ? 'error' : undefined} help={errors.proxy}><Input aria-label="Proxy URL" value={draft.proxy.url} placeholder="socks5://proxy.example:1080" onChange={(value) => setDraft((current) => ({ ...current, proxy: { url: value } }))} /><HelpText>Optional http, https, or socks5 proxy used only for this provider.</HelpText></Form.Item>
      </Form>
    </PageDialog>
  )
}

function TestProviderModal({ provider, testing, modelSuggestions, onClose, onTest }: { provider: ProviderResource; testing: boolean; modelSuggestions: string[]; onClose: () => void; onTest: (model: string) => Promise<ProviderCheckResponse> }) {
  const [model, setModel] = useState('')
  const [validation, setValidation] = useState('')
  const [result, setResult] = useState<ProviderCheckResponse>()
  const [requestError, setRequestError] = useState('')

  async function test() {
    if (provider.protocol !== 'mock' && !model.trim()) {
      setValidation('Test model is required for non-mock providers.')
      return
    }
    setValidation('')
    setResult(undefined)
    setRequestError('')
    try {
      setResult(await onTest(model.trim()))
    } catch (error) {
      setRequestError(errorMessage(error))
    }
  }

  return <PageDialog title="Test Provider" onCancel={onClose} footer={<><Button onClick={onClose}>Close</Button><Button type="primary" loading={testing} onClick={test}>Test provider</Button></>}>
    <Typography.Paragraph><Typography.Text bold>Provider:</Typography.Text> {provider.name}</Typography.Paragraph>
    <Form layout="vertical">
      <Form.Item label="Test model" validateStatus={validation ? 'error' : undefined} help={validation || (provider.protocol === 'mock' ? 'Optional for mock providers.' : 'Required; not saved.')}>
        <ModelAutoComplete ariaLabel="Test model" suggestions={modelSuggestions} value={model} onChange={(value) => { setModel(value); setValidation('') }} />
      </Form.Item>
    </Form>
    {result ? <Alert type={result.ok ? 'success' : 'error'} title={`Test ${result.ok ? 'passed' : 'failed'}: ${result.state}`} content={`${result.latency_ms} ms${result.error ? ` — ${result.error}` : ''}`} /> : null}
    {requestError ? <Alert type="error" title="Test failed" content={requestError} /> : null}
  </PageDialog>
}

export function ProvidersPage() {
  const feedback = useFeedback()
  const queryClient = useQueryClient()
  const pageRef = useRef<HTMLDivElement>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [refreshGeneration, setRefreshGeneration] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [hours, setHours] = useState<Hours>(6)
  const [search, setSearch] = useState('')
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [editing, setEditing] = useState<ProviderResource | null>()
  const [testingProvider, setTestingProvider] = useState<ProviderResource>()
  const [confirmation, setConfirmation] = useState<Confirmation>()

  const configQuery = useQuery({ queryKey: ['providers'], queryFn: () => apiGet<ProvidersResponse>('/admin/config/providers') })
  const metricsQuery = useQuery({ queryKey: ['provider-metrics', hours], queryFn: () => apiGet<ProvidersMetricsResponse>(`/admin/config/providers/metrics${buildQuery({ hours })}`) })
  const routesQuery = useQuery({ queryKey: ['routes'], queryFn: () => apiGet<RoutesResponse>('/admin/config/routes'), retry: false })

  const refreshConfig = async () => { await queryClient.invalidateQueries({ queryKey: ['providers'] }) }
  const mutationApplied = async (result: ConfigMutationResponse) => {
    if (!result.applied) feedback.warning(`Core accepted the request but did not apply the change${result.reason ? `: ${result.reason}` : '.'}`)
    await Promise.all([refreshConfig(), queryClient.invalidateQueries({ queryKey: ['provider-metrics'] })])
  }
  const upsert = useMutation({ mutationFn: (provider: ProviderResource) => apiPost<ConfigMutationResponse>('/admin/config/provider/upsert', toProviderPayload(provider)), onSuccess: mutationApplied, onError: (error) => feedback.error(errorMessage(error)) })
  const enabled = useMutation({ mutationFn: (payload: { name: string; enabled: boolean }) => apiPost<ConfigMutationResponse>('/admin/config/provider/enabled', payload), onSuccess: mutationApplied, onError: (error) => feedback.error(errorMessage(error)) })
  const remove = useMutation({ mutationFn: (name: string) => apiPost<ConfigMutationResponse>('/admin/config/provider/delete', { name }), onSuccess: mutationApplied, onError: (error) => feedback.error(errorMessage(error)) })
  const checkProvider = useMutation({ mutationFn: (payload: ProviderCheckRequest) => apiPost<ProviderCheckResponse>('/admin/config/provider/check', payload) })

  const modelSuggestions = useMemo(() => {
    const values: string[] = []
    for (const provider of configQuery.data?.items || []) for (const model of provider.models || []) values.push(model.name, ...model.aliases)
    const routes = routesQuery.data?.items || []
    for (const route of routes) {
      if (route.target_model) values.push(route.target_model)
      if (route.model_map) values.push(...Object.keys(route.model_map), ...Object.values(route.model_map))
    }
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort()
  }, [configQuery.data, routesQuery.data])

  const rows = useMemo<ProviderRow[]>(() => {
    const metrics = new Map((metricsQuery.data?.items || []).map((item) => [item.provider.name, item]))
    const needle = search.trim().toLowerCase()
    return (configQuery.data?.items || []).map((provider) => ({ ...provider, metrics: metrics.get(provider.name) })).filter((provider) => {
      const matchesSearch = !needle || [provider.name, provider.tag, provider.endpoint].some((value) => value.toLowerCase().includes(needle))
      const matchesEnabled = enabledFilter === 'all' || provider.enabled === (enabledFilter === 'enabled')
      return matchesSearch && matchesEnabled
    })
  }, [configQuery.data, metricsQuery.data, search, enabledFilter])

  const columns: TableColumnProps<ProviderRow>[] = [
    { title: 'Provider', fixed: 'left', width: 180, render: (_, row) => <div><Typography.Text bold>{row.name}</Typography.Text><br /><Tag>{row.tag}</Tag></div> },
    { title: 'Protocol / Endpoint', width: 250, render: (_, row) => <div><Tag color="arcoblue">{row.protocol}</Tag><Typography.Text className="provider-endpoint" type="secondary">{row.endpoint || 'No endpoint'}</Typography.Text></div> },
    { title: 'Enabled', width: 95, render: (_, row) => <Tag color={row.enabled ? 'green' : 'gray'}>{row.enabled ? 'Enabled' : 'Disabled'}</Tag> },
    { title: 'Usage (all-time totals)', width: 200, render: (_, row) => <div>Requests: {formatNumber(row.metrics?.usage.request_count)}<br />Tokens: {formatNumber(row.metrics?.usage.total_tokens)}<br />Cost: {formatCost(row.metrics?.usage.cost_usd)}</div> },
    { title: 'Health now', width: 155, render: (_, row) => row.metrics?.health ? <div><Tag color={row.metrics.health.state === 'available' ? 'green' : 'orange'}>{row.metrics.health.state}</Tag><br /><Popover trigger="hover" content="Current consecutive recoverable failures. Unlike Usage errors, this resets after a successful request."><span className="provider-health-failures" tabIndex={0}>Failures: {row.metrics.health.consecutive_failures}</span></Popover></div> : <Typography.Text type="secondary">Unknown</Typography.Text> },
    { title: 'Quota (current windows)', width: 330, render: (_, row) => row.metrics?.quota ? <div><Tag>{row.metrics.quota.state}</Tag>{row.metrics.quota.windows.map(quotaWindowLines)}</div> : <Typography.Text type="secondary">{row.quota.enabled ? 'No runtime data' : 'Disabled'}</Typography.Text> },
    { title: `Timeline (${hours}h)`, width: 330, render: (_, row) => <Timeline item={row.metrics} /> },
    { title: 'Actions', fixed: 'right', width: 290, render: (_, row) => <Space size={4} wrap>
      <Button size="mini" icon={<IconEdit />} onClick={() => { setDirty(false); setEditing(toProviderPayload(row)) }}>Edit</Button>
      <Button size="mini" onClick={() => setTestingProvider(row)}>Test</Button>
      <Button size="mini" onClick={() => setConfirmation({ title: `${row.enabled ? 'Disable' : 'Enable'} ${row.name}?`, content: row.enabled ? 'Disable removes this provider from traffic immediately after Core applies the response.' : 'Enable makes this provider eligible for traffic immediately after Core applies the response.', confirmText: row.enabled ? 'Disable' : 'Enable', action: () => enabled.mutate({ name: row.name, enabled: !row.enabled }) })}>{row.enabled ? 'Disable' : 'Enable'}</Button>
      <Button size="mini" status="danger" onClick={() => setConfirmation({ title: `Permanently delete ${row.name}?`, content: `Delete permanently removes provider identity “${row.name}”. This cannot be undone and is applied immediately.`, confirmText: 'Delete', action: () => remove.mutate(row.name) })}>Delete</Button>
    </Space> },
  ]

  const configRefetch = configQuery.refetch
  const metricsRefetch = metricsQuery.refetch
  const routesRefetch = routesQuery.refetch
  const refreshAll = useCallback(async () => {
    await Promise.all([configRefetch(), metricsRefetch(), routesRefetch()])
  }, [configRefetch, metricsRefetch, routesRefetch])

  const blocked = editing !== undefined || testingProvider !== undefined || confirmation !== undefined || dirty || upsert.isPending || enabled.isPending || remove.isPending || checkProvider.isPending || configQuery.isFetching || metricsQuery.isFetching || routesQuery.isFetching
  const resetIdle = useCallback(() => setRefreshGeneration((value) => value + 1), [])
  useEffect(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    if (blocked) return
    refreshTimer.current = setTimeout(() => { void refreshAll() }, AUTO_REFRESH_MS)
    return () => { if (refreshTimer.current) clearTimeout(refreshTimer.current) }
  }, [blocked, refreshAll, refreshGeneration])

  return <div ref={pageRef} className="page-stack providers-page" onPointerDown={resetIdle} onKeyDown={resetIdle} onInput={resetIdle} onChange={resetIdle} onScroll={resetIdle}>
    <div className="console-hero compact-hero">
      <div><Tag color="arcoblue">Configuration</Tag><Typography.Title heading={3}>Providers</Typography.Title><Typography.Text type="secondary">Manage outbound providers and inspect independent runtime metrics.</Typography.Text></div>
      <Space wrap>
        <Button icon={<IconRefresh />} loading={configQuery.isFetching || metricsQuery.isFetching} onClick={() => { resetIdle(); void refreshAll() }}>Refresh</Button>
        <Button icon={<IconPlus />} onClick={() => { setDirty(false); setEditing(null) }}>New</Button>
      </Space>
    </div>
    {configQuery.isError ? <Alert type="error" title="Unable to load provider configuration" content={errorMessage(configQuery.error)} /> : null}
    {metricsQuery.isError ? <Alert type="warning" title="Runtime metrics unavailable" content={`${errorMessage(metricsQuery.error)}. Provider editing remains available.`} /> : null}
    <Card bordered={false} className="toolbar-card"><Space wrap>
      <Input.Search aria-label="Search providers" allowClear value={search} onChange={setSearch} placeholder="Search name, tag, or endpoint" style={{ width: 290 }} />
      <Select aria-label="Enabled status" value={enabledFilter} onChange={setEnabledFilter} style={{ width: 150 }}><Select.Option value="all">All statuses</Select.Option><Select.Option value="enabled">Enabled</Select.Option><Select.Option value="disabled">Disabled</Select.Option></Select>
      <Select aria-label="Timeline range" value={hours} onChange={setHours} style={{ width: 160 }}>{hourOptions.map((value) => <Select.Option key={value} value={value}>Last {value}h</Select.Option>)}</Select>
      <HelpText>Timeline range only changes activity buckets. Usage remains all-time.</HelpText>
    </Space></Card>
    <Card bordered={false} className="data-card panel-card" title="Configured providers"><Table rowKey="name" loading={configQuery.isLoading} columns={columns} data={rows} pagination={false} scroll={{ x: 1480 }} /></Card>
    {confirmation ? <ConfirmationDialog confirmation={confirmation} onCancel={() => setConfirmation(undefined)} onConfirm={() => { const action = confirmation.action; setConfirmation(undefined); action() }} /> : null}
    {testingProvider ? <TestProviderModal provider={testingProvider} testing={checkProvider.isPending} modelSuggestions={modelSuggestions} onClose={() => setTestingProvider(undefined)} onTest={(model) => checkProvider.mutateAsync({ name: testingProvider.name, model })} /> : null}
    {editing !== undefined ? <ProviderModal key={editing?.name || 'new'} visible initial={editing || undefined} saving={upsert.isPending} testing={checkProvider.isPending} modelSuggestions={modelSuggestions} onDirtyChange={setDirty} onCancel={() => { setDirty(false); setEditing(undefined) }} onSave={async (draft) => { try { const result = await upsert.mutateAsync(toProviderPayload(draft)); if (result.applied) { setDirty(false); setEditing(undefined); feedback.success('Provider saved and applied.') } } catch { /* mutation reports the error */ } }} onTest={(draft, model) => checkProvider.mutateAsync({ name: draft.name, model, provider: toProviderPayload(draft) })} /> : null}
  </div>
}
