import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card, Form, Input, Radio, Select, Space, Table, Tag, Tooltip, Typography } from '@arco-design/web-react'
import type { TableColumnProps } from '@arco-design/web-react'
import { IconDelete, IconEdit, IconPlus, IconRefresh } from '@arco-design/web-react/icon'
import { apiGet, apiPost } from '../../api/client'
import { errorMessage } from '../../api/errors'
import type { ConfigMutationResponse, ConfigOptionsResponse, ProviderResource, ProvidersResponse, RouteDeleteRequest, RouteResource, RoutesResponse, RouteUpsertRequest, RoutingStrategy } from '../../api/types'
import { useFeedback } from '../../app/feedbackContext'
import { PageDialog } from '../../components/PageDialog'
import { useDialogPopupContainer } from '../../components/dialogPopupContainer'

const AUTO_REFRESH_MS = 30_000
const strategies: RoutingStrategy[] = ['failover', 'round_robin', 'weighted_round_robin']
type ModelMode = 'passthrough' | 'fixed' | 'map'
type ValidationErrors = Record<string, string>
type RouteRow = RouteResource & { priority: number; shadowedTags: string[] }
type ModelMapRow = { id: number; source: string; target: string }
type Draft = Omit<RouteResource, 'model_map'> & { modelMode: ModelMode; modelRows: ModelMapRow[] }
type SourceContext = { client: string; inbound: string; protocol: string; path: string }
type DestinationContext = { name: string; protocol: string; enabled: boolean }
type TagContextMap<T> = Map<string, T[]>
type ContextKind = 'source' | 'destination'

function HelpText({ children }: { children: ReactNode }) {
  return <Typography.Text className="field-help" type="secondary">{children}</Typography.Text>
}

function emptyDraft(): Draft {
  return { name: '', from_tags: [], to_tags: [], strategy: 'failover', weights: {}, target_model: '', modelMode: 'passthrough', modelRows: [] }
}

function draftFromRoute(route: RouteResource): Draft {
  const entries = Object.entries(route.model_map || {})
  const modelMode: ModelMode = entries.length ? 'map' : route.target_model ? 'fixed' : 'passthrough'
  return { name: route.name, from_tags: [...route.from_tags], to_tags: [...route.to_tags], strategy: route.strategy, weights: { ...route.weights }, target_model: route.target_model, modelMode, modelRows: entries.map(([source, target], id) => ({ id, source, target })) }
}

function toPayload(draft: Draft): RouteUpsertRequest {
  const modelMap = draft.modelMode === 'map' ? Object.fromEntries(draft.modelRows.map((row) => [row.source.trim(), row.target.trim()])) : {}
  return {
    name: draft.name.trim(),
    from_tags: draft.from_tags,
    to_tags: draft.to_tags,
    strategy: draft.strategy,
    weights: draft.strategy === 'weighted_round_robin' ? Object.fromEntries(draft.to_tags.map((tag) => [tag, draft.weights[tag]])) : {},
    target_model: draft.modelMode === 'fixed' ? draft.target_model.trim() : '',
    model_map: modelMap,
  }
}

function validateDraft(draft: Draft, editing: boolean, existingNames: string[], destinationTags: string[], strategyOptions: RoutingStrategy[]): ValidationErrors {
  const errors: ValidationErrors = {}
  const name = draft.name.trim()
  if (!name) errors.name = 'Name is required.'
  else if (!editing && existingNames.includes(name)) errors.name = 'Route names must be unique.'
  if (!draft.from_tags.length) errors.from_tags = 'Select at least one source tag.'
  if (!draft.to_tags.length) errors.to_tags = 'Select at least one destination tag.'
  else if (draft.to_tags.some((tag) => !destinationTags.includes(tag))) errors.to_tags = 'Remove destination tags that no longer exist.'
  if (!strategyOptions.includes(draft.strategy)) errors.strategy = 'Select a routing strategy.'
  if (draft.strategy === 'weighted_round_robin') draft.to_tags.forEach((tag) => {
    if (!Number.isInteger(draft.weights[tag]) || draft.weights[tag] <= 0) errors[`weight_${tag}`] = 'Enter a positive integer.'
  })
  if (draft.modelMode === 'fixed' && !draft.target_model.trim()) errors.target_model = 'Enter a fixed target model.'
  if (draft.modelMode === 'map') {
    if (!draft.modelRows.length) errors.model_map = 'Add at least one model mapping.'
    const sources = new Set<string>()
    draft.modelRows.forEach((row, index) => {
      const source = row.source.trim()
      if (!source) errors[`source_${index}`] = 'Source model is required.'
      else if (sources.has(source)) errors[`source_${index}`] = 'Source models must be unique.'
      sources.add(source)
      if (!row.target.trim()) errors[`target_${index}`] = 'Target model is required.'
    })
  }
  return errors
}

function contextStatus(contexts: SourceContext[] | DestinationContext[], available: boolean, kind: ContextKind) {
  if (!available) return 'Context unavailable'
  if (!contexts.length) return 'Orphaned'
  if (kind === 'destination' && (contexts as DestinationContext[]).every((context) => !context.enabled)) return 'Unavailable'
  if (contexts.length > 1) return 'Shared'
  return ''
}

function contextSummary(contexts: SourceContext[] | DestinationContext[], available: boolean, kind: ContextKind) {
  if (!available) return kind === 'source' ? 'Client context not loaded' : 'Provider context not loaded'
  if (!contexts.length) return kind === 'source' ? 'No matching client' : 'No matching provider'
  if (kind === 'source') {
    const sources = contexts as SourceContext[]
    const clients = new Set(sources.map((context) => context.client)).size
    const inbounds = new Set(sources.map((context) => context.inbound)).size
    return sources.length > 1 ? `${clients} clients · ${inbounds} inbounds` : `${sources[0].client} · ${sources[0].inbound}`
  }
  const providers = contexts as DestinationContext[]
  if (providers.every((context) => !context.enabled)) return `${providers.length} disabled provider${providers.length === 1 ? '' : 's'}`
  return providers.length > 1 ? `${providers.length} providers` : `${providers[0].name} · ${providers[0].protocol} · ${providers[0].enabled ? 'enabled' : 'disabled'}`
}

function contextTooltip(contexts: SourceContext[] | DestinationContext[], available: boolean, kind: ContextKind) {
  if (!available) return <span>Context unavailable</span>
  if (!contexts.length) return <span>{kind === 'source' ? 'No client or inbound references this tag.' : 'No provider references this tag.'}</span>
  return <div className="route-tag-tooltip">{contexts.map((context, index) => kind === 'source'
    ? <div key={`${(context as SourceContext).client}::${(context as SourceContext).inbound}::${(context as SourceContext).protocol}::${(context as SourceContext).path}::${index}`}><strong>Client:</strong> {(context as SourceContext).client}<br /><strong>Inbound:</strong> {(context as SourceContext).inbound}<br /><strong>Protocol:</strong> {(context as SourceContext).protocol}<br /><strong>Path:</strong> {(context as SourceContext).path}</div>
    : <div key={`${(context as DestinationContext).name}::${(context as DestinationContext).protocol}::${index}`}><strong>Provider:</strong> {(context as DestinationContext).name}<br /><strong>Protocol:</strong> {(context as DestinationContext).protocol}<br /><strong>Enabled:</strong> {(context as DestinationContext).enabled ? 'yes' : 'no'}</div>)}</div>
}

function ContextSummary({ contexts, available, kind }: { contexts: SourceContext[] | DestinationContext[]; available: boolean; kind: ContextKind }) {
  if (!available || !contexts.length || kind === 'source' || contexts.length > 1) return <>{contextSummary(contexts, available, kind)}</>
  const provider = (contexts as DestinationContext[])[0]
  return <>{provider.name} · {provider.protocol} · <span className={provider.enabled ? 'route-provider-enabled' : 'route-provider-disabled'}>{provider.enabled ? 'enabled' : 'disabled'}</span></>
}

function OptionContextDetails({ contexts, available, kind }: { contexts: SourceContext[] | DestinationContext[]; available: boolean; kind: ContextKind }) {
  if (!available || !contexts.length) return <div className="route-tag-option-detail">{contextSummary(contexts, available, kind)}</div>
  if (kind === 'source') return <div className="route-tag-option-details">{(contexts as SourceContext[]).map((context) => <div key={`${context.client}::${context.inbound}::${context.protocol}::${context.path}`}>{context.client} · {context.inbound} · {context.protocol} · {context.path}</div>)}</div>
  return <div className="route-tag-option-details">{(contexts as DestinationContext[]).map((provider) => <div key={`${provider.name}::${provider.protocol}::${provider.enabled}`}>{provider.name} · {provider.protocol} · <span className={provider.enabled ? 'route-provider-enabled' : 'route-provider-disabled'}>{provider.enabled ? 'enabled' : 'disabled'}</span></div>)}</div>
}

function ContextTag({ tag, contexts, available, kind, option = false }: { tag: string; contexts: SourceContext[] | DestinationContext[]; available: boolean; kind: ContextKind; option?: boolean }) {
  const status = contextStatus(contexts, available, kind)
  return <Tooltip content={contextTooltip(contexts, available, kind)}><div className={option ? 'route-tag-option' : 'route-tag-resource'}>
    <div className="route-tag-header">{option ? <Typography.Text bold>{tag}</Typography.Text> : <Tag>{tag}</Tag>}{status ? <Tag size="small" color={status === 'Unavailable' ? 'red' : status === 'Orphaned' ? 'orange' : 'gray'}>{status}</Tag> : null}</div>
    {option ? <OptionContextDetails contexts={contexts} available={available} kind={kind} /> : <Typography.Text type="secondary" className="route-tag-summary"><ContextSummary contexts={contexts} available={available} kind={kind} /></Typography.Text>}
  </div></Tooltip>
}

function TagSelect({ label, value, options, contexts, available, kind, onChange }: { label: string; value: string[]; options: string[]; contexts: TagContextMap<SourceContext> | TagContextMap<DestinationContext>; available: boolean; kind: ContextKind; onChange: (value: string[]) => void }) {
  const popupContainer = useDialogPopupContainer()
  return <Select aria-label={label} mode="multiple" value={value} renderFormat={(_, selectedValue) => String(selectedValue)} getPopupContainer={() => popupContainer || document.body} onChange={onChange}>{options.map((option) => <Select.Option key={option} value={option}><ContextTag tag={option} contexts={contexts.get(option) || []} available={available} kind={kind} option /></Select.Option>)}</Select>
}

function StrategySelect({ value, options, onChange }: { value: RoutingStrategy; options: RoutingStrategy[]; onChange: (value: RoutingStrategy) => void }) {
  const popupContainer = useDialogPopupContainer()
  return <Select aria-label="Strategy" value={value} getPopupContainer={() => popupContainer || document.body} onChange={onChange}>{options.map((strategy) => <Select.Option key={strategy} value={strategy}>{strategy}</Select.Option>)}</Select>
}

function ModelInput({ label, value, suggestions, onChange }: { label: string; value: string; suggestions: string[]; onChange: (value: string) => void }) {
  const listId = useId()
  return <><Input aria-label={label} list={listId} value={value} onChange={onChange} /><datalist id={listId}>{suggestions.map((value) => <option key={value} value={value} />)}</datalist></>
}

function RouteEditor({ initial, sourceTags, destinationTags, validDestinationTags, sourceContexts, destinationContexts, providersAvailable, strategyOptions, modelSuggestions, existingNames, saving, failure, onDirtyChange, onCancel, onSave }: { initial?: RouteResource; sourceTags: string[]; destinationTags: string[]; validDestinationTags: string[]; sourceContexts: TagContextMap<SourceContext>; destinationContexts: TagContextMap<DestinationContext>; providersAvailable: boolean; strategyOptions: RoutingStrategy[]; modelSuggestions: string[]; existingNames: string[]; saving: boolean; failure: string; onDirtyChange: (dirty: boolean) => void; onCancel: () => void; onSave: (payload: RouteUpsertRequest) => void }) {
  const editing = Boolean(initial)
  const nextId = useRef(1_000)
  const [draft, setDraft] = useState<Draft>(() => initial ? draftFromRoute(initial) : emptyDraft())
  const [errors, setErrors] = useState<ValidationErrors>({})
  function update(patch: Partial<Draft>) { onDirtyChange(true); setDraft((current) => ({ ...current, ...patch })) }
  function save() { const next = validateDraft(draft, editing, existingNames, validDestinationTags, strategyOptions); setErrors(next); if (!Object.keys(next).length) onSave(toPayload(draft)) }
  function changeToTags(tags: string[]) {
    const weights = { ...draft.weights }
    tags.forEach((tag) => { if (!Number.isInteger(weights[tag]) || weights[tag] <= 0) weights[tag] = 1 })
    Object.keys(weights).forEach((tag) => { if (!tags.includes(tag)) delete weights[tag] })
    update({ to_tags: tags, weights })
  }
  function updateMapRow(index: number, patch: Partial<ModelMapRow>) { update({ modelRows: draft.modelRows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row) }) }
  return <PageDialog className="route-editor-dialog" title={editing ? `Edit route: ${initial?.name}` : 'New route'} onCancel={onCancel} footer={<><Button onClick={onCancel}>Cancel</Button><Button type="primary" loading={saving} onClick={save}>Save</Button></>}>
    <HelpText>Rules are evaluated in the displayed order; saving updates this rule in place and does not reorder routes.</HelpText>
    {failure ? <Alert className="route-dialog-alert" type="error" title="Unable to save route" content={failure} /> : null}
    <Form layout="vertical">
      <div className="route-form-grid">
        <Form.Item label="Name" validateStatus={errors.name ? 'error' : undefined} help={errors.name}><Input aria-label="Name" value={draft.name} disabled={editing} onChange={(name) => update({ name })} /><HelpText>Required unique identity; it cannot be renamed after creation.</HelpText></Form.Item>
        <Form.Item label="Strategy" validateStatus={errors.strategy ? 'error' : undefined} help={errors.strategy}><StrategySelect value={draft.strategy} options={strategyOptions} onChange={(strategy) => update({ strategy })} /></Form.Item>
      </div>
      <div className="route-form-grid">
        <Form.Item label="From tags" validateStatus={errors.from_tags ? 'error' : undefined} help={errors.from_tags}><TagSelect label="From tags" value={draft.from_tags} options={sourceTags} contexts={sourceContexts} available kind="source" onChange={(from_tags) => update({ from_tags })} /><HelpText>First matching route wins. Overlap with an earlier rule makes these tags shadowed.</HelpText></Form.Item>
        <Form.Item label="To tags" validateStatus={errors.to_tags ? 'error' : undefined} help={errors.to_tags}><TagSelect label="To tags" value={draft.to_tags} options={destinationTags} contexts={destinationContexts} available={providersAvailable} kind="destination" onChange={changeToTags} /></Form.Item>
      </div>
      {draft.strategy === 'weighted_round_robin' ? <Card size="small" title="Destination weights" className="route-subcard"><div className="route-weight-grid">{draft.to_tags.map((tag) => <Form.Item key={tag} label={tag} validateStatus={errors[`weight_${tag}`] ? 'error' : undefined} help={errors[`weight_${tag}`]}><Input aria-label={`Weight for ${tag}`} type="number" min="1" step="1" value={String(draft.weights[tag] ?? 1)} onChange={(value) => update({ weights: { ...draft.weights, [tag]: Number(value) } })} /></Form.Item>)}</div><HelpText>Each selected destination requires a positive integer weight.</HelpText></Card> : null}
      <Card size="small" title="Model handling" className="route-subcard">
        <Radio.Group value={draft.modelMode} onChange={(modelMode) => update({ modelMode })}><Radio value="passthrough">Passthrough</Radio><Radio value="fixed">Fixed</Radio><Radio value="map">Map</Radio></Radio.Group>
        {draft.modelMode === 'passthrough' ? <HelpText>Forward the requested model unchanged.</HelpText> : null}
        {draft.modelMode === 'fixed' ? <Form.Item label="Target model" validateStatus={errors.target_model ? 'error' : undefined} help={errors.target_model}><ModelInput label="Target model" value={draft.target_model} suggestions={modelSuggestions} onChange={(target_model) => update({ target_model })} /><HelpText>Provider models are suggestions only; free input is allowed.</HelpText></Form.Item> : null}
        {draft.modelMode === 'map' ? <>{errors.model_map ? <Alert type="error" content={errors.model_map} /> : null}<div className="route-model-map">{draft.modelRows.map((row, index) => <div className="route-model-map-row" key={row.id}><Form.Item label="Source" validateStatus={errors[`source_${index}`] ? 'error' : undefined} help={errors[`source_${index}`]}><ModelInput label={`Mapping ${index + 1} source`} value={row.source} suggestions={['*', ...modelSuggestions]} onChange={(source) => updateMapRow(index, { source })} /></Form.Item><span className="route-map-arrow">→</span><Form.Item label="Target" validateStatus={errors[`target_${index}`] ? 'error' : undefined} help={errors[`target_${index}`]}><ModelInput label={`Mapping ${index + 1} target`} value={row.target} suggestions={modelSuggestions} onChange={(target) => updateMapRow(index, { target })} /></Form.Item><Button aria-label={`Delete mapping ${index + 1}`} status="danger" icon={<IconDelete />} onClick={() => update({ modelRows: draft.modelRows.filter((_, rowIndex) => rowIndex !== index) })} /></div>)}</div><Button icon={<IconPlus />} onClick={() => update({ modelRows: [...draft.modelRows, { id: nextId.current++, source: '', target: '' }] })}>Add mapping</Button><HelpText>Source models must be unique. Use * as a catch-all. Provider models are suggestions only.</HelpText></> : null}
      </Card>
    </Form>
  </PageDialog>
}

function DirtyCancelDialog({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  return <PageDialog title="Discard unsaved route changes?" onCancel={onKeep} footer={<><Button onClick={onKeep}>Keep editing</Button><Button type="primary" status="danger" onClick={onDiscard}>Discard</Button></>}><p className="provider-confirm-content">Your unsaved route changes will be lost.</p></PageDialog>
}

function DeleteRouteDialog({ route, deleting, failure, onCancel, onDelete }: { route: RouteResource; deleting: boolean; failure: string; onCancel: () => void; onDelete: () => void }) {
  const [confirmation, setConfirmation] = useState('')
  return <PageDialog title={`Permanently delete ${route.name}?`} onCancel={onCancel} footer={<><Button onClick={onCancel}>Cancel</Button><Button type="primary" status="danger" loading={deleting} disabled={confirmation !== route.name} onClick={onDelete}>Delete</Button></>}><Typography.Paragraph>This immediately removes route <Typography.Text bold>“{route.name}”</Typography.Text> and changes priority matching for later rules.</Typography.Paragraph>{failure ? <Alert className="route-dialog-alert" type="error" title="Unable to delete route" content={failure} /> : null}<Form layout="vertical"><Form.Item label={`Type ${route.name} to confirm`}><Input aria-label="Confirm route name" value={confirmation} onChange={setConfirmation} /></Form.Item></Form></PageDialog>
}

function contextualTagList(tags: string[], contexts: TagContextMap<SourceContext> | TagContextMap<DestinationContext>, available: boolean, kind: ContextKind) {
  return <div className="route-tag-list">{tags.map((tag) => <ContextTag key={tag} tag={tag} contexts={contexts.get(tag) || []} available={available} kind={kind} />)}</div>
}
function modelHandling(route: RouteResource) {
  if (Object.keys(route.model_map || {}).length) return <div className="route-model-summary"><Tag color="purple">map</Tag>{Object.entries(route.model_map).map(([source, target]) => <span key={source}><code>{source}</code> → <code>{target}</code></span>)}</div>
  if (route.target_model) return <div><Tag color="arcoblue">fixed</Tag><code>{route.target_model}</code></div>
  return <Tag color="gray">passthrough</Tag>
}

export function RoutesPage() {
  const feedback = useFeedback()
  const queryClient = useQueryClient()
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [refreshGeneration, setRefreshGeneration] = useState(0)
  const [search, setSearch] = useState('')
  const [strategyFilter, setStrategyFilter] = useState<'all' | RoutingStrategy>('all')
  const [editing, setEditing] = useState<RouteResource | null>()
  const [deleting, setDeleting] = useState<RouteResource>()
  const [dirty, setDirty] = useState(false)
  const [confirmDirtyCancel, setConfirmDirtyCancel] = useState(false)
  const [mutationFailure, setMutationFailure] = useState('')

  const routesQuery = useQuery({ queryKey: ['routes'], queryFn: () => apiGet<RoutesResponse>('/admin/config/routes') })
  const optionsQuery = useQuery({ queryKey: ['config-options'], queryFn: () => apiGet<ConfigOptionsResponse>('/admin/config/options') })
  const providersQuery = useQuery({ queryKey: ['providers'], queryFn: () => apiGet<ProvidersResponse>('/admin/config/providers'), retry: false })
  const mutationApplied = async (result: ConfigMutationResponse) => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['routes'] }), queryClient.invalidateQueries({ queryKey: ['config-options'] })]); return result }
  const upsert = useMutation({ mutationFn: (payload: RouteUpsertRequest) => apiPost<ConfigMutationResponse>('/admin/config/route/upsert', payload), onSuccess: mutationApplied })
  const remove = useMutation({ mutationFn: (payload: RouteDeleteRequest) => apiPost<ConfigMutationResponse>('/admin/config/route/delete', payload), onSuccess: mutationApplied })

  const sourceTags = useMemo(() => [...new Set(optionsQuery.data?.client_tags || [])].sort(), [optionsQuery.data])
  const destinationTags = useMemo(() => [...new Set(optionsQuery.data?.outbound_tags || optionsQuery.data?.outbounds?.map((item) => item.tag) || [])].sort(), [optionsQuery.data])
  const sourceContexts = useMemo<TagContextMap<SourceContext>>(() => {
    const result = new Map<string, SourceContext[]>()
    const seen = new Set<string>()
    for (const inbound of optionsQuery.data?.inbounds || []) for (const client of inbound.clients || []) {
      const context = { client: client.ref, inbound: inbound.name, protocol: inbound.protocol, path: inbound.path }
      const key = `${client.tag}::${context.client}::${context.inbound}::${context.protocol}::${context.path}`
      if (seen.has(key)) continue
      seen.add(key)
      result.set(client.tag, [...(result.get(client.tag) || []), context])
    }
    return result
  }, [optionsQuery.data])
  const destinationContexts = useMemo<TagContextMap<DestinationContext>>(() => {
    const result = new Map<string, DestinationContext[]>()
    const seen = new Set<string>()
    for (const provider of providersQuery.data?.items || []) {
      const context = { name: provider.name, protocol: provider.protocol, enabled: provider.enabled }
      const key = `${provider.tag}::${context.name}::${context.protocol}::${context.enabled}`
      if (seen.has(key)) continue
      seen.add(key)
      result.set(provider.tag, [...(result.get(provider.tag) || []), context])
    }
    return result
  }, [providersQuery.data])
  const strategyOptions = useMemo(() => optionsQuery.data?.routing_strategies?.filter((strategy) => strategies.includes(strategy)) || strategies, [optionsQuery.data])
  const modelSuggestions = useMemo(() => [...new Set((providersQuery.data?.items || []).flatMap((provider: ProviderResource) => (provider.models || []).flatMap((model) => [model.name, ...model.aliases])).map((value) => value.trim()).filter(Boolean))].sort(), [providersQuery.data])
  const allRows = useMemo<RouteRow[]>(() => {
    const seen = new Set<string>()
    return (routesQuery.data?.items || []).map((route, index) => {
      const normalized = { ...route, from_tags: route.from_tags || [], to_tags: route.to_tags || [], weights: route.weights || {}, target_model: route.target_model || '', model_map: route.model_map || {} }
      const shadowedTags = normalized.from_tags.filter((tag) => seen.has(tag))
      normalized.from_tags.forEach((tag) => seen.add(tag))
      return { ...normalized, priority: index + 1, shadowedTags }
    })
  }, [routesQuery.data])
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return allRows.filter((route) => (!needle || [route.name, ...route.from_tags, ...route.to_tags, route.strategy, route.target_model, ...Object.keys(route.model_map || {}), ...Object.values(route.model_map || {})].some((value) => value.toLowerCase().includes(needle))) && (strategyFilter === 'all' || route.strategy === strategyFilter))
  }, [allRows, search, strategyFilter])

  const columns: TableColumnProps<RouteRow>[] = [
    { title: '#', width: 65, fixed: 'left', render: (_, row) => <Typography.Text bold>#{row.priority}</Typography.Text> },
    { title: 'Name', width: 170, render: (_, row) => <Typography.Text bold>{row.name}</Typography.Text> },
    { title: 'From tags', width: 300, render: (_, row) => <div>{contextualTagList(row.from_tags, sourceContexts, Boolean(optionsQuery.data) && !optionsQuery.isError, 'source')}{row.shadowedTags.length ? <Alert className="route-shadow-warning" type="warning" content={`Shadowed by earlier rules: ${row.shadowedTags.join(', ')}`} /> : null}</div> },
    { title: 'Destinations', width: 370, render: (_, row) => <div className="route-destination"><Tag color="arcoblue">{row.strategy}</Tag>{contextualTagList(row.to_tags, destinationContexts, Boolean(providersQuery.data) && !providersQuery.isError, 'destination')}{row.strategy === 'weighted_round_robin' ? <Typography.Text type="secondary">{row.to_tags.map((tag) => `${tag}: ${row.weights[tag]}`).join(' · ')}</Typography.Text> : null}</div> },
    { title: 'Model handling', width: 300, render: (_, row) => modelHandling(row) },
    { title: 'Actions', width: 170, fixed: 'right', render: (_, row) => <Space size={4}><Button size="mini" icon={<IconEdit />} disabled={!optionsQuery.data} title={!optionsQuery.data ? 'Configuration options are unavailable.' : undefined} onClick={() => { setDirty(false); setMutationFailure(''); setEditing(row) }}>Edit</Button><Button size="mini" status="danger" disabled={allRows.length <= 1} title={allRows.length <= 1 ? 'The last route cannot be deleted.' : undefined} onClick={() => { setMutationFailure(''); setDeleting(row) }}>Delete</Button></Space> },
  ]

  const routesRefetch = routesQuery.refetch
  const optionsRefetch = optionsQuery.refetch
  const providersRefetch = providersQuery.refetch
  const refreshAll = useCallback(async () => { await Promise.all([routesRefetch(), optionsRefetch(), providersRefetch()]) }, [routesRefetch, optionsRefetch, providersRefetch])
  const blocked = editing !== undefined || deleting !== undefined || confirmDirtyCancel || dirty || upsert.isPending || remove.isPending || routesQuery.isFetching || optionsQuery.isFetching || providersQuery.isFetching
  const resetIdle = useCallback(() => { if (!blocked) setRefreshGeneration((value) => value + 1) }, [blocked])
  useEffect(() => { if (refreshTimer.current) clearTimeout(refreshTimer.current); if (blocked) return; refreshTimer.current = setTimeout(() => { void refreshAll() }, AUTO_REFRESH_MS); return () => { if (refreshTimer.current) clearTimeout(refreshTimer.current) } }, [blocked, refreshAll, refreshGeneration])
  function requestEditorClose() { if (dirty) setConfirmDirtyCancel(true); else { setMutationFailure(''); setEditing(undefined) } }

  return <div className="page-stack routes-page" onPointerDown={resetIdle} onKeyDown={resetIdle} onInput={resetIdle} onChange={resetIdle} onScroll={resetIdle}>
    <div className="console-hero compact-hero"><div><Tag color="arcoblue">Configuration</Tag><Typography.Title heading={3}>Routes</Typography.Title><Typography.Text type="secondary">Manage first-match routing rules. Their original order is their priority.</Typography.Text></div><Space wrap><Button icon={<IconRefresh />} loading={routesQuery.isFetching || optionsQuery.isFetching || providersQuery.isFetching} onClick={() => { resetIdle(); void refreshAll() }}>Refresh</Button><Button icon={<IconPlus />} disabled={!optionsQuery.data} title={!optionsQuery.data ? 'Configuration options are unavailable.' : undefined} onClick={() => { setDirty(false); setMutationFailure(''); setEditing(null) }}>New</Button></Space></div>
    {routesQuery.isError ? <Alert type="error" title="Unable to load routes" content={errorMessage(routesQuery.error)} /> : null}
    {optionsQuery.isError ? <Alert type="error" title="Configuration options unavailable" content={`${errorMessage(optionsQuery.error)}. New and Edit are disabled; existing routes can still be deleted.`} /> : null}
    {providersQuery.isError ? <Alert type="warning" title="Provider model suggestions unavailable" content={`${errorMessage(providersQuery.error)}. Model fields still accept free input.`} /> : null}
    <Card bordered={false} className="toolbar-card"><Space wrap><Input.Search aria-label="Search routes" allowClear value={search} onChange={setSearch} placeholder="Search name, tags, or models" style={{ width: 310 }} /><Select aria-label="Strategy filter" value={strategyFilter} onChange={setStrategyFilter} style={{ width: 220 }}><Select.Option value="all">All strategies</Select.Option>{strategies.map((strategy) => <Select.Option key={strategy} value={strategy}>{strategy}</Select.Option>)}</Select><HelpText>Filtering preserves each rule’s original priority number.</HelpText></Space></Card>
    <Card bordered={false} className="data-card panel-card" title="Ordered routing rules"><Table rowKey="name" loading={routesQuery.isLoading} columns={columns} data={rows} pagination={false} scroll={{ x: 1375 }} /></Card>
    {editing !== undefined && optionsQuery.data ? <RouteEditor key={editing?.name || 'new'} initial={editing || undefined} sourceTags={[...new Set([...sourceTags, ...(editing?.from_tags || [])])]} destinationTags={[...new Set([...destinationTags, ...(editing?.to_tags || [])])]} validDestinationTags={destinationTags} sourceContexts={sourceContexts} destinationContexts={destinationContexts} providersAvailable={Boolean(providersQuery.data) && !providersQuery.isError} strategyOptions={strategyOptions} modelSuggestions={modelSuggestions} existingNames={allRows.map((row) => row.name)} saving={upsert.isPending} failure={mutationFailure} onDirtyChange={setDirty} onCancel={requestEditorClose} onSave={async (payload) => { setMutationFailure(''); try { const result = await upsert.mutateAsync(payload); if (!result.applied) { setMutationFailure(result.reason || 'Core accepted the request but did not apply the route.'); feedback.warning('Core did not apply the route change.'); return } setDirty(false); setEditing(undefined); feedback.success('Route saved and applied.') } catch (error) { const message = errorMessage(error); setMutationFailure(message); feedback.error(message) } }} /> : null}
    {confirmDirtyCancel ? <DirtyCancelDialog onKeep={() => setConfirmDirtyCancel(false)} onDiscard={() => { setConfirmDirtyCancel(false); setDirty(false); setMutationFailure(''); setEditing(undefined) }} /> : null}
    {deleting ? <DeleteRouteDialog route={deleting} deleting={remove.isPending} failure={mutationFailure} onCancel={() => { setMutationFailure(''); setDeleting(undefined) }} onDelete={async () => { setMutationFailure(''); try { const result = await remove.mutateAsync({ name: deleting.name }); if (!result.applied) { setMutationFailure(result.reason || 'Core accepted the request but did not apply the deletion.'); feedback.warning('Core did not apply the route deletion.'); return } setDeleting(undefined); feedback.success('Route deleted and applied.') } catch (error) { const message = errorMessage(error); setMutationFailure(message); feedback.error(message) } }} /> : null}
  </div>
}
