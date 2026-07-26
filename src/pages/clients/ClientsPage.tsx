import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card, Checkbox, Divider, Form, Input, Select, Space, Table, Tag, Typography } from '@arco-design/web-react'
import type { TableColumnProps } from '@arco-design/web-react'
import { IconDelete, IconEdit, IconPlus, IconRefresh } from '@arco-design/web-react/icon'
import { apiGet, apiPost, buildQuery } from '../../api/client'
import { ApiError, errorMessage } from '../../api/errors'
import type { ClientBindingDeleteRequest, ClientBindingResource, ClientBindingUpsertRequest, ClientDeleteRequest, ClientMetricsItem, ClientQuotaType, ClientQuotaWindowConfig, ClientQuotaWindowMetrics, ClientResource, ClientsMetricsResponse, ClientsResponse, ClientUpsertRequest, ConfigMutationResponse, ConfigOptionsResponse } from '../../api/types'
import { useFeedback } from '../../app/feedbackContext'
import { PageDialog } from '../../components/PageDialog'
import { useDialogPopupContainer } from '../../components/dialogPopupContainer'

const dayOptions = [7, 30, 90] as const
const durationPresets = ['30s', '1m', '5m', '1h', '5h', '24h', '168h']
const AUTO_REFRESH_MS = 30_000

type Days = (typeof dayOptions)[number]
type ClientRow = ClientResource & { metrics?: ClientMetricsItem }
type Draft = ClientUpsertRequest
type ValidationErrors = Record<string, string>

function emptyDraft(): Draft {
  return { name: '', token: '', quota: { enabled: false, windows: [] } }
}

function quotaType(window: ClientQuotaWindowConfig | ClientQuotaWindowMetrics): ClientQuotaType {
  return window.type || 'requests'
}

function strictWindow(window: ClientQuotaWindowConfig): ClientQuotaWindowConfig {
  const common = { name: window.name.trim(), type: quotaType(window), duration: window.duration.trim() }
  if (common.type === 'tokens') return { ...common, max_tokens: window.max_tokens }
  if (common.type === 'cost') return { ...common, max_cost_usd: window.max_cost_usd }
  return { ...common, max_requests: window.max_requests }
}

function toPayload(client: Draft): ClientUpsertRequest {
  return { name: client.name.trim(), token: client.token, quota: { enabled: client.quota.enabled, windows: client.quota.windows.map(strictWindow) } }
}

function draftFromClient(client: ClientResource): Draft {
  const quota = client.quota || { enabled: false, windows: [] }
  return toPayload({ name: client.name, token: '', quota: { ...quota, windows: quota.windows.map((window) => ({ ...window, type: quotaType(window) })) } })
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
    if (count) { parts.push(`${count} ${label}${count === 1 ? '' : 's'}`); totalMs -= count * size }
  }
  return parts.length ? parts.slice(0, 3).join(' ') : 'Less than one second'
}

function validateDraft(draft: Draft, editing: boolean): ValidationErrors {
  const errors: ValidationErrors = {}
  if (!draft.name.trim()) errors.name = 'Name is required.'
  if (!editing && (!draft.token.trim() || draft.token === '<redacted>')) errors.token = 'Token is required for a new client.'
  if (draft.quota.enabled) {
    if (!draft.quota.windows.length) errors.windows = 'Add at least one quota window.'
    const names = new Set<string>()
    draft.quota.windows.forEach((window, index) => {
      const name = window.name.trim()
      if (!name) errors[`window_name_${index}`] = 'Window name is required.'
      else if (names.has(name)) errors[`window_name_${index}`] = 'Window names must be unique.'
      names.add(name)
      if (!positiveDuration(window.duration)) errors[`window_duration_${index}`] = 'Enter a positive Go duration.'
      const type = quotaType(window)
      if (type === 'requests' && (!Number.isInteger(window.max_requests) || Number(window.max_requests) <= 0)) errors[`window_limit_${index}`] = 'Enter a positive integer.'
      if (type === 'tokens' && (!Number.isInteger(window.max_tokens) || Number(window.max_tokens) <= 0)) errors[`window_limit_${index}`] = 'Enter a positive integer.'
      if (type === 'cost') {
        const raw = String(window.max_cost_usd ?? '')
        if (!/^\d+(?:\.\d{1,6})?$/.test(raw) || Number(raw) <= 0) errors[`window_limit_${index}`] = 'Enter a positive decimal with at most 6 decimal places.'
      }
    })
  }
  return errors
}

function formatNumber(value: unknown): string { return new Intl.NumberFormat('en-US').format(Number(value || 0)) }
function formatCost(value: unknown): string { const number = Number(value || 0); return number ? `$${number.toFixed(4)}` : '-' }
function formatUSD(value: unknown): string { return `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(value || 0))}` }
function HelpText({ children }: { children: ReactNode }) { return <Typography.Text className="field-help" type="secondary">{children}</Typography.Text> }

function DurationInput({ ariaLabel, value, onChange }: { ariaLabel: string; value: string; onChange: (value: string) => void }) {
  return <div className="duration-control"><Input aria-label={ariaLabel} value={value} onChange={onChange} /><Space size={4} wrap className="duration-presets">{durationPresets.map((preset) => <Button key={preset} size="mini" onClick={() => onChange(preset)}>{preset}</Button>)}</Space><HelpText>{durationPreview(value)}. Combine units such as 1h30m; d is not supported.</HelpText></div>
}

function QuotaLimitInput({ window, index, error, onChange }: { window: ClientQuotaWindowConfig; index: number; error?: string; onChange: (patch: Partial<ClientQuotaWindowConfig>) => void }) {
  const type = quotaType(window)
  const label = type === 'tokens' ? 'Max tokens' : type === 'cost' ? 'Max cost (USD)' : 'Max requests'
  const value = type === 'tokens' ? window.max_tokens : type === 'cost' ? window.max_cost_usd : window.max_requests
  const field = type === 'tokens' ? 'max_tokens' : type === 'cost' ? 'max_cost_usd' : 'max_requests'
  return <Form.Item label={label} validateStatus={error ? 'error' : undefined} help={error}><Input aria-label={`Window ${index + 1} ${label.toLowerCase()}`} type="number" min="0" step={type === 'cost' ? '0.000001' : '1'} value={value === undefined ? '' : String(value)} onChange={(raw) => onChange({ [field]: raw === '' ? undefined : Number(raw) })} /></Form.Item>
}

function QuotaTypeSelect({ index, value, onChange }: { index: number; value: ClientQuotaType; onChange: (type: ClientQuotaType) => void }) {
  const popupContainer = useDialogPopupContainer()
  return <Select aria-label={`Window ${index + 1} type`} value={value} getPopupContainer={() => popupContainer || document.body} onChange={onChange}><Select.Option value="requests">Requests</Select.Option><Select.Option value="tokens">Tokens</Select.Option><Select.Option value="cost">Cost</Select.Option></Select>
}

interface ClientModalProps { initial?: ClientResource; saving: boolean; onDirtyChange: (dirty: boolean) => void; onCancel: () => void; onSave: (draft: Draft) => void }
function ClientModal({ initial, saving, onDirtyChange, onCancel, onSave }: ClientModalProps) {
  const editing = Boolean(initial)
  const [draft, setDraft] = useState<Draft>(() => initial ? draftFromClient(initial) : emptyDraft())
  const [errors, setErrors] = useState<ValidationErrors>({})
  function update<K extends keyof Draft>(key: K, value: Draft[K]) { onDirtyChange(true); setDraft((current) => ({ ...current, [key]: value })) }
  function updateQuota(enabled: boolean) { onDirtyChange(true); setDraft((current) => ({ ...current, quota: { ...current.quota, enabled } })) }
  function updateWindow(index: number, patch: Partial<ClientQuotaWindowConfig>) { onDirtyChange(true); setDraft((current) => ({ ...current, quota: { ...current.quota, windows: current.quota.windows.map((window, itemIndex) => itemIndex === index ? { ...window, ...patch } : window) } })) }
  function save() { const next = validateDraft(draft, editing); setErrors(next); if (!Object.keys(next).length) onSave(toPayload(draft)) }
  return <PageDialog className="client-editor-dialog" title={editing ? `Edit client: ${initial?.name}` : 'New client'} onCancel={onCancel} footer={<><Button onClick={onCancel}>Cancel</Button><Button type="primary" loading={saving} onClick={save}>Save</Button></>}>
    <HelpText>Save applies this client directly to Core. Bindings are managed separately.</HelpText>
    <Form layout="vertical"><div className="client-form-grid"><Form.Item label="Name" validateStatus={errors.name ? 'error' : undefined} help={errors.name}><Input aria-label="Name" value={draft.name} disabled={editing} onChange={(value) => update('name', value)} /><HelpText>Stable client identity; it cannot be changed after creation.</HelpText></Form.Item><Form.Item label="Token" validateStatus={errors.token ? 'error' : undefined} help={errors.token}><Input.Password aria-label="Token" value={draft.token} onChange={(value) => update('token', value)} /><HelpText>{editing ? 'Leave empty to preserve the stored token.' : 'Required when creating a client.'}</HelpText></Form.Item></div>
      <Divider orientation="left">Quota</Divider><Form.Item><Checkbox checked={draft.quota.enabled} onChange={updateQuota}>Enable quota</Checkbox><HelpText>Requests are measured at entry. Tokens and Cost are measured only at successful terminal completion, so current or concurrent requests can overshoot a limit. Cost uses configured pricing; unpriced usage counts as $0 and raises a warning.</HelpText></Form.Item>
      {draft.quota.enabled ? <>{errors.windows ? <Alert type="error" content={errors.windows} /> : null}<div className="quota-window-list">{draft.quota.windows.map((window, index) => <Card key={index} size="small" className="quota-window-card" title={window.name || `Quota window ${index + 1}`} extra={<Button aria-label={`Delete window ${index + 1}`} status="danger" icon={<IconDelete />} onClick={() => { onDirtyChange(true); setDraft((current) => ({ ...current, quota: { ...current.quota, windows: current.quota.windows.filter((_, itemIndex) => itemIndex !== index) } })) }} />}><div className="client-quota-grid"><Form.Item label="Window name" validateStatus={errors[`window_name_${index}`] ? 'error' : undefined} help={errors[`window_name_${index}`]}><Input aria-label={`Window ${index + 1} name`} value={window.name} onChange={(value) => updateWindow(index, { name: value })} /></Form.Item><Form.Item label="Type"><QuotaTypeSelect index={index} value={quotaType(window)} onChange={(type) => updateWindow(index, { type, max_requests: undefined, max_tokens: undefined, max_cost_usd: undefined })} /></Form.Item><Form.Item label="Duration" validateStatus={errors[`window_duration_${index}`] ? 'error' : undefined} help={errors[`window_duration_${index}`]}><DurationInput ariaLabel={`Window ${index + 1} duration`} value={window.duration} onChange={(value) => updateWindow(index, { duration: value })} /></Form.Item><QuotaLimitInput window={window} index={index} error={errors[`window_limit_${index}`]} onChange={(patch) => updateWindow(index, patch)} /></div></Card>)}</div><Button icon={<IconPlus />} onClick={() => { onDirtyChange(true); setDraft((current) => ({ ...current, quota: { ...current.quota, windows: [...current.quota.windows, { name: '', type: 'requests', duration: '1h', max_requests: 1 }] } })) }}>Add window</Button></> : null}
    </Form>
  </PageDialog>
}

function DirtyCancelDialog({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) { return <PageDialog title="Discard unsaved client changes?" onCancel={onKeep} footer={<><Button onClick={onKeep}>Keep editing</Button><Button status="danger" type="primary" onClick={onDiscard}>Discard</Button></>}><p className="provider-confirm-content">Your unsaved client changes will be lost.</p></PageDialog> }
function DeleteDialog({ client, deleting, onCancel, onDelete }: { client: ClientResource; deleting: boolean; onCancel: () => void; onDelete: () => void }) {
  const [confirmation, setConfirmation] = useState('')
  return <PageDialog title={`Permanently delete ${client.name}?`} onCancel={onCancel} footer={<><Button onClick={onCancel}>Cancel</Button><Button type="primary" status="danger" loading={deleting} disabled={confirmation !== client.name} onClick={onDelete}>Delete</Button></>}><Typography.Paragraph>Delete permanently removes client identity <Typography.Text bold>“{client.name}”</Typography.Text>. This is applied immediately and cannot be undone.</Typography.Paragraph><Form layout="vertical"><Form.Item label={`Type ${client.name} to confirm`}><Input aria-label="Confirm client name" value={confirmation} onChange={setConfirmation} /></Form.Item></Form></PageDialog>
}

type BindingLastSourceDetails = { operation: string; client: string; inbound: string; tag: string; route_names: string[] }

function bindingLastSourceDetails(error: unknown): BindingLastSourceDetails | undefined {
  if (!(error instanceof ApiError) || error.errorCode !== 'binding_tag_last_source' || !error.details || typeof error.details !== 'object') return undefined
  const details = error.details as Record<string, unknown>
  if (typeof details.operation !== 'string' || typeof details.client !== 'string' || typeof details.inbound !== 'string' || typeof details.tag !== 'string' || !Array.isArray(details.route_names) || !details.route_names.every((name) => typeof name === 'string')) return undefined
  return details as BindingLastSourceDetails
}

function BindingLastSourceAlert({ details }: { details: BindingLastSourceDetails }) {
  return <Alert type="error" title="This binding is the last source for a route tag" content={<div><Typography.Paragraph>Cannot {details.operation} binding <Typography.Text code>{details.client} / {details.inbound}</Typography.Text> because tag <Typography.Text code>{details.tag}</Typography.Text> is still required by:</Typography.Paragraph><ul>{details.route_names.map((name) => <li key={name}><Typography.Text code>{name}</Typography.Text></li>)}</ul><Typography.Paragraph>Choose one action:</Typography.Paragraph><ol><li>Add another binding with tag <Typography.Text code>{details.tag}</Typography.Text>, then retry.</li><li>First update each route’s <Typography.Text code>from_tags</Typography.Text> so it no longer references <Typography.Text code>{details.tag}</Typography.Text>.</li></ol></div>} />
}

function BindingInboundSelect({ value, disabled, options, invalid, onChange }: { value: string; disabled: boolean; options: ConfigOptionsResponse['inbounds']; invalid: boolean; onChange: (value: string) => void }) {
  const popupContainer = useDialogPopupContainer()
  return <Form.Item label="Inbound" validateStatus={invalid ? 'error' : undefined} help={invalid ? 'Inbound is required.' : undefined}><Select aria-label="Binding inbound" value={value || undefined} disabled={disabled} placeholder="Select a configured inbound" getPopupContainer={() => popupContainer || document.body} onChange={onChange}>{options.map((option) => <Select.Option key={option.name} value={option.name}>{option.name} ({option.protocol}) · {option.path}</Select.Option>)}</Select></Form.Item>
}
function BindingModal({ client, initial, inbounds, saving, failure, onCancel, onSave }: { client: ClientResource; initial?: ClientBindingResource; inbounds: ConfigOptionsResponse['inbounds']; saving: boolean; failure?: BindingLastSourceDetails; onCancel: () => void; onSave: (payload: ClientBindingUpsertRequest) => void }) {
  const [inbound, setInbound] = useState(initial?.inbound || '')
  const [tag, setTag] = useState(initial?.tag || '')
  const [submitted, setSubmitted] = useState(false)
  const used = new Set(client.bindings.map((binding) => binding.inbound))
  const available = inbounds.filter((option) => initial?.inbound === option.name || !used.has(option.name))
  const save = () => { setSubmitted(true); if (inbound && tag.trim()) onSave({ inbound, ref: client.name, tag: tag.trim() }) }
  return <PageDialog className="client-binding-dialog" title={`${initial ? 'Edit' : 'Add'} binding: ${client.name}`} onCancel={onCancel} footer={<><Button onClick={onCancel}>Cancel</Button><Button type="primary" loading={saving} disabled={!available.length} onClick={save}>Save binding</Button></>}><HelpText>Binding changes are applied directly to Core. Client ref is set automatically to {client.name}.</HelpText>{failure ? <BindingLastSourceAlert details={failure} /> : null}{available.length ? <Form layout="vertical"><BindingInboundSelect value={inbound} disabled={Boolean(initial)} options={available} invalid={submitted && !inbound} onChange={setInbound} /><Form.Item label="Tag" validateStatus={submitted && !tag.trim() ? 'error' : undefined} help={submitted && !tag.trim() ? 'Tag is required.' : undefined}><Input aria-label="Binding tag" value={tag} onChange={setTag} /></Form.Item></Form> : <Alert type="info" title="No inbound available" content="Every configured inbound is already bound to this client. Add another inbound in Core or edit an existing binding." />}</PageDialog>
}
function BindingDeleteDialog({ binding, deleting, failure, onCancel, onDelete }: { binding: ClientBindingResource; deleting: boolean; failure?: BindingLastSourceDetails; onCancel: () => void; onDelete: () => void }) { return <PageDialog title={`Delete binding from ${binding.inbound}?`} onCancel={onCancel} footer={<><Button onClick={onCancel}>Cancel</Button><Button type="primary" status="danger" loading={deleting} onClick={onDelete}>Delete binding</Button></>}><Typography.Paragraph>Remove this client from <Typography.Text bold>{binding.inbound}</Typography.Text> with tag <Typography.Text bold>{binding.tag}</Typography.Text>. The client identity and its usage remain available.</Typography.Paragraph>{failure ? <BindingLastSourceAlert details={failure} /> : null}</PageDialog> }

function quotaMetric(window: ClientQuotaWindowMetrics) {
  const type = quotaType(window)
  if (type === 'tokens') return { used: formatNumber(window.used_tokens), remaining: formatNumber(window.remaining_tokens), limit: formatNumber(window.max_tokens), unit: 'tokens' }
  if (type === 'cost') return { used: formatUSD(window.used_cost_usd), remaining: formatUSD(window.remaining_cost_usd), limit: formatUSD(window.max_cost_usd), unit: 'USD' }
  return { used: formatNumber(window.used_requests ?? window.used), remaining: formatNumber(window.remaining_requests ?? window.remaining), limit: formatNumber(window.max_requests ?? window.limit), unit: 'requests' }
}

function quotaSummary(row: ClientRow) {
  if (!row.quota.enabled) return <Typography.Text type="secondary">Disabled</Typography.Text>
  if (!row.metrics?.quota) return <Typography.Text type="secondary">No runtime data</Typography.Text>
  return <div><Tag color={row.metrics.quota.state === 'available' ? 'green' : 'orange'}>{row.metrics.quota.state}</Tag>{row.metrics.quota.windows.map((window) => { const metric = quotaMetric(window); return <div className="quota-metric-window" key={window.name}><strong>{window.name}</strong> <Tag>{quotaType(window)}</Tag> <Typography.Text type="secondary">({window.duration || 'rolling'})</Typography.Text><div>{metric.used} used · {metric.remaining} remaining / {metric.limit} {metric.unit}</div>{window.reset_at ? <div>Resets: {window.reset_at}</div> : null}{window.unpriced_count || window.warning ? <Alert type="warning" title="Unpriced usage" content={`${formatNumber(window.unpriced_count)} successful terminal ${window.unpriced_count === 1 ? 'request was' : 'requests were'} counted as $0.${window.warning ? ` ${window.warning}` : ''}`} /> : null}</div> })}</div>
}

export function ClientsPage() {
  const feedback = useFeedback()
  const queryClient = useQueryClient()
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [refreshGeneration, setRefreshGeneration] = useState(0)
  const [days, setDays] = useState<Days>(30)
  const [search, setSearch] = useState('')
  const [inboundFilter, setInboundFilter] = useState('all')
  const [quotaFilter, setQuotaFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [editing, setEditing] = useState<ClientResource | null>()
  const [dirty, setDirty] = useState(false)
  const [confirmDirtyCancel, setConfirmDirtyCancel] = useState(false)
  const [deleting, setDeleting] = useState<ClientResource>()
  const [bindingEditor, setBindingEditor] = useState<{ client: ClientResource; binding?: ClientBindingResource }>()
  const [bindingDeleting, setBindingDeleting] = useState<{ client: ClientResource; binding: ClientBindingResource }>()
  const [bindingFailure, setBindingFailure] = useState<BindingLastSourceDetails>()

  const configQuery = useQuery({ queryKey: ['clients'], queryFn: () => apiGet<ClientsResponse>('/admin/config/clients') })
  const optionsQuery = useQuery({ queryKey: ['config-options'], queryFn: () => apiGet<ConfigOptionsResponse>('/admin/config/options') })
  const metricsQuery = useQuery({ queryKey: ['client-metrics', days], queryFn: () => apiGet<ClientsMetricsResponse>(`/admin/config/clients/metrics${buildQuery({ days })}`) })
  const mutationApplied = async (result: ConfigMutationResponse) => { if (!result.applied) feedback.warning(`Core accepted the request but did not apply the change${result.reason ? `: ${result.reason}` : '.'}`); if (result.quota_state_reset) feedback.warning('Client quota counters were reset while applying this change.'); await Promise.all([queryClient.invalidateQueries({ queryKey: ['clients'] }), queryClient.invalidateQueries({ queryKey: ['client-metrics'] }), queryClient.invalidateQueries({ queryKey: ['config-options'] })]) }
  const mutationError = (error: unknown) => feedback.error(errorMessage(error))
  const bindingMutationError = (error: unknown) => { const details = bindingLastSourceDetails(error); if (details) setBindingFailure(details); else mutationError(error) }
  const upsert = useMutation({ mutationFn: (payload: ClientUpsertRequest) => apiPost<ConfigMutationResponse>('/admin/config/client/upsert', payload), onSuccess: mutationApplied, onError: mutationError })
  const remove = useMutation({ mutationFn: (payload: ClientDeleteRequest) => apiPost<ConfigMutationResponse>('/admin/config/client/delete', payload), onSuccess: mutationApplied, onError: mutationError })
  const bindingUpsert = useMutation({ mutationFn: (payload: ClientBindingUpsertRequest) => apiPost<ConfigMutationResponse>('/admin/config/client-binding/upsert', payload), onSuccess: mutationApplied, onError: bindingMutationError })
  const bindingRemove = useMutation({ mutationFn: (payload: ClientBindingDeleteRequest) => apiPost<ConfigMutationResponse>('/admin/config/client-binding/delete', payload), onSuccess: mutationApplied, onError: bindingMutationError })

  const inbounds = useMemo(() => (optionsQuery.data?.inbounds || []).map((item) => item.name).sort(), [optionsQuery.data])
  const rows = useMemo<ClientRow[]>(() => {
    const metrics = new Map((metricsQuery.data?.items || []).map((item) => [item.client.name, item]))
    const needle = search.trim().toLowerCase()
    return (configQuery.data?.items || []).map((client) => ({ ...client, bindings: client.bindings || [], metrics: metrics.get(client.name) })).filter((client) => {
      const bindingValues = client.bindings.flatMap((binding) => [binding.tag, binding.inbound, binding.inbound_protocol, binding.inbound_path])
      return (!needle || [client.name, ...bindingValues].some((value) => value.toLowerCase().includes(needle))) && (inboundFilter === 'all' || client.bindings.some((binding) => binding.inbound === inboundFilter)) && (quotaFilter === 'all' || client.quota.enabled === (quotaFilter === 'enabled'))
    })
  }, [configQuery.data, metricsQuery.data, search, inboundFilter, quotaFilter])

  const columns: TableColumnProps<ClientRow>[] = [
    { title: 'Client', fixed: 'left', width: 180, render: (_, row) => <Link to={`/clients/${encodeURIComponent(row.name)}`}><Typography.Text bold>{row.name}</Typography.Text></Link> },
    { title: 'Bindings', width: 380, render: (_, row) => <div className="client-bindings-cell">{row.bindings.length ? row.bindings.map((binding) => <div className="client-binding-summary" key={binding.inbound}><div><Typography.Text bold>{binding.inbound}</Typography.Text> <Tag color="arcoblue">{binding.inbound_protocol}</Tag><Tag>{binding.tag}</Tag><Typography.Text className="client-inbound-path" type="secondary">{binding.inbound_path}</Typography.Text></div><Space size={4}><Button aria-label={`Edit binding ${binding.inbound}`} size="mini" icon={<IconEdit />} onClick={() => { setBindingFailure(undefined); setBindingEditor({ client: row, binding }) }} /><Button aria-label={`Delete binding ${binding.inbound}`} size="mini" status="danger" icon={<IconDelete />} onClick={() => { setBindingFailure(undefined); setBindingDeleting({ client: row, binding }) }} /></Space></div>) : <Typography.Text type="secondary">No bindings</Typography.Text>}<Button className="client-add-binding" size="mini" icon={<IconPlus />} disabled={!optionsQuery.data} onClick={() => { setBindingFailure(undefined); setBindingEditor({ client: row }) }}>Add binding</Button></div> },
    { title: 'Usage (all-time)', width: 215, render: (_, row) => <div>Requests: {formatNumber(row.metrics?.all_time.request_count)}<br />Tokens: {formatNumber(row.metrics?.all_time.total_tokens)}<br />Cost: {formatCost(row.metrics?.all_time.cost_usd)}</div> },
    { title: `Frequency (${days}d)`, width: 210, render: (_, row) => row.metrics ? <div>Requests: {formatNumber(row.metrics.frequency.requests)}<br />Active days: {row.metrics.frequency.active_days} / {row.metrics.frequency.calendar_days}<br />Per day: {row.metrics.frequency.requests_per_day.toFixed(2)}</div> : <Typography.Text type="secondary">Unavailable</Typography.Text> },
    { title: 'Quota', width: 330, render: (_, row) => quotaSummary(row) },
    { title: 'Actions', fixed: 'right', width: 175, render: (_, row) => <div><Space size={4}><Button size="mini" icon={<IconEdit />} onClick={() => { setDirty(false); setEditing(row) }}>Edit</Button><Button size="mini" status="danger" disabled={row.bindings.length > 0} title={row.bindings.length ? 'Remove all bindings before deleting this client.' : undefined} onClick={() => setDeleting(row)}>Delete</Button></Space>{row.bindings.length ? <Typography.Text className="client-delete-hint" type="secondary">Unbind first to delete</Typography.Text> : null}</div> },
  ]

  const configRefetch = configQuery.refetch
  const metricsRefetch = metricsQuery.refetch
  const optionsRefetch = optionsQuery.refetch
  const refreshAll = useCallback(async () => { await Promise.all([configRefetch(), metricsRefetch(), optionsRefetch()]) }, [configRefetch, metricsRefetch, optionsRefetch])
  const blocked = editing !== undefined || deleting !== undefined || bindingEditor !== undefined || bindingDeleting !== undefined || confirmDirtyCancel || dirty || upsert.isPending || remove.isPending || bindingUpsert.isPending || bindingRemove.isPending || configQuery.isFetching || metricsQuery.isFetching || optionsQuery.isFetching
  const resetIdle = useCallback(() => { if (!blocked) setRefreshGeneration((value) => value + 1) }, [blocked])
  useEffect(() => { if (refreshTimer.current) clearTimeout(refreshTimer.current); if (blocked) return; refreshTimer.current = setTimeout(() => { void refreshAll() }, AUTO_REFRESH_MS); return () => { if (refreshTimer.current) clearTimeout(refreshTimer.current) } }, [blocked, refreshAll, refreshGeneration])
  function requestEditorClose() { if (dirty) setConfirmDirtyCancel(true); else setEditing(undefined) }

  return <div className="page-stack clients-page" onPointerDown={resetIdle} onKeyDown={resetIdle} onInput={resetIdle} onChange={resetIdle} onScroll={resetIdle}>
    <div className="console-hero compact-hero"><div><Tag color="arcoblue">Configuration</Tag><Typography.Title heading={3}>Clients</Typography.Title><Typography.Text type="secondary">Manage client credentials and quota once, then bind each client to one or more inbounds.</Typography.Text></div><Space wrap><Button icon={<IconRefresh />} loading={configQuery.isFetching || metricsQuery.isFetching || optionsQuery.isFetching} onClick={() => { resetIdle(); void refreshAll() }}>Refresh</Button><Button icon={<IconPlus />} onClick={() => { setDirty(false); setEditing(null) }}>New</Button></Space></div>
    {configQuery.isError ? <Alert type="error" title="Unable to load client configuration" content={errorMessage(configQuery.error)} /> : null}
    {optionsQuery.isError ? <Alert type="warning" title="Inbound options unavailable" content={`${errorMessage(optionsQuery.error)}. Client CRUD remains available; refresh before adding bindings.`} /> : null}
    {metricsQuery.isError ? <Alert type="warning" title="Runtime metrics unavailable" content={`${errorMessage(metricsQuery.error)}. Client editing remains available.`} /> : null}
    <Card bordered={false} className="toolbar-card"><Space wrap><Input.Search aria-label="Search clients" allowClear value={search} onChange={setSearch} placeholder="Search client or binding" style={{ width: 310 }} /><Select aria-label="Inbound filter" value={inboundFilter} onChange={setInboundFilter} style={{ width: 180 }}><Select.Option value="all">All inbounds</Select.Option>{inbounds.map((inbound) => <Select.Option key={inbound} value={inbound}>{inbound}</Select.Option>)}</Select><Select aria-label="Quota filter" value={quotaFilter} onChange={setQuotaFilter} style={{ width: 160 }}><Select.Option value="all">All quota states</Select.Option><Select.Option value="enabled">Quota enabled</Select.Option><Select.Option value="disabled">Quota disabled</Select.Option></Select><Select aria-label="Frequency range" value={days} onChange={setDays} style={{ width: 160 }}>{dayOptions.map((value) => <Select.Option key={value} value={value}>Last {value} days</Select.Option>)}</Select><HelpText>Frequency range does not change all-time usage.</HelpText></Space></Card>
    <Card bordered={false} className="data-card panel-card" title="Configured clients"><Table rowKey="name" loading={configQuery.isLoading} columns={columns} data={rows} pagination={false} scroll={{ x: 1490 }} /></Card>
    {editing !== undefined ? <ClientModal key={editing?.name || 'new'} initial={editing || undefined} saving={upsert.isPending} onDirtyChange={setDirty} onCancel={requestEditorClose} onSave={async (draft) => { try { const result = await upsert.mutateAsync(draft); if (result.applied) { setDirty(false); setEditing(undefined); feedback.success('Client saved and applied.') } } catch { /* mutation reports the error */ } }} /> : null}
    {confirmDirtyCancel ? <DirtyCancelDialog onKeep={() => setConfirmDirtyCancel(false)} onDiscard={() => { setConfirmDirtyCancel(false); setDirty(false); setEditing(undefined) }} /> : null}
    {deleting ? <DeleteDialog client={deleting} deleting={remove.isPending} onCancel={() => setDeleting(undefined)} onDelete={async () => { try { const result = await remove.mutateAsync({ name: deleting.name }); if (result.applied) { setDeleting(undefined); feedback.success('Client deleted and applied.') } } catch { /* mutation reports the error */ } }} /> : null}
    {bindingEditor ? <BindingModal client={bindingEditor.client} initial={bindingEditor.binding} inbounds={optionsQuery.data?.inbounds || []} saving={bindingUpsert.isPending} failure={bindingFailure} onCancel={() => { setBindingFailure(undefined); setBindingEditor(undefined) }} onSave={async (payload) => { setBindingFailure(undefined); try { const result = await bindingUpsert.mutateAsync(payload); if (result.applied) { setBindingEditor(undefined); feedback.success('Binding saved and applied.') } } catch { /* mutation reports the error */ } }} /> : null}
    {bindingDeleting ? <BindingDeleteDialog binding={bindingDeleting.binding} deleting={bindingRemove.isPending} failure={bindingFailure} onCancel={() => { setBindingFailure(undefined); setBindingDeleting(undefined) }} onDelete={async () => { setBindingFailure(undefined); try { const result = await bindingRemove.mutateAsync({ inbound: bindingDeleting.binding.inbound, ref: bindingDeleting.client.name }); if (result.applied) { setBindingDeleting(undefined); feedback.success('Binding deleted and applied.') } } catch { /* mutation reports the error */ } }} /> : null}
  </div>
}
