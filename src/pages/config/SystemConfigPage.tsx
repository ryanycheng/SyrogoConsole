import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card, Input, Space, Table, Tag, Typography } from '@arco-design/web-react'
import type { TableColumnProps } from '@arco-design/web-react'
import { IconCheck, IconHistory, IconRefresh, IconSave, IconStorage } from '@arco-design/web-react/icon'
import { useNavigate } from 'react-router-dom'
import { apiGet, apiPost, apiPostText, buildQuery } from '../../api/client'
import { ApiError, errorMessage } from '../../api/errors'
import type { ConfigApplyResponse, ConfigHistoryDiffResponse, ConfigHistoryItem, ConfigHistoryResponse, ConfigReadResponse, ConfigUpdateResponse, ConfigValidateResponse } from '../../api/types'
import { useFeedback } from '../../app/feedbackContext'
import { PageDialog } from '../../components/PageDialog'

type ConfirmAction = { type: 'update' } | { type: 'apply' } | { type: 'rollback'; item: ConfigHistoryItem } | { type: 'clear' } | { type: 'navigate'; path: string }
type Notice = { type: 'success' | 'warning' | 'error'; title: string; content: string }

function shortRevision(value: string) {
  return value.replace(/^sha256:/, '').slice(0, 12) || 'Unavailable'
}

async function fetchHistoryDiff(id: string): Promise<ConfigHistoryDiffResponse> {
  const response = await apiGet<unknown>(`/admin/config/history/diff${buildQuery({ id })}`)
  if (
    !response ||
    typeof response !== 'object' ||
    !('id' in response) ||
    !('current_content' in response) ||
    !('history_content' in response) ||
    typeof response.id !== 'string' ||
    typeof response.current_content !== 'string' ||
    typeof response.history_content !== 'string'
  ) {
    throw new Error('Core does not support history comparison. Upgrade and restart Syrogo Core, then try again.')
  }
  return response as ConfigHistoryDiffResponse
}

function reloadNotice(result: ConfigApplyResponse, action: 'apply' | 'rollback'): Notice {
  if (result.restart_required) return { type: 'warning', title: 'Restart required', content: result.reason || `The ${action} operation was saved but cannot be applied without restarting Core.` }
  if (!result.applied) return { type: 'warning', title: 'Configuration not applied', content: result.reason || `Core did not apply the ${action} operation.` }
  if (result.quota_state_reset) return { type: 'warning', title: 'Applied with quota reset', content: `The ${action} operation succeeded, but one or more quota counters were reset.` }
  return { type: 'success', title: action === 'apply' ? 'Configuration applied' : 'Configuration rolled back', content: result.history_id ? `Runtime updated successfully. History ID: ${result.history_id}` : 'Runtime updated successfully.' }
}

function ConfirmDialog({ action, pending, onCancel, onConfirm }: { action: ConfirmAction; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  const destructive = action.type === 'update' || action.type === 'rollback' || action.type === 'clear' || action.type === 'navigate'
  const title = action.type === 'update' ? 'Replace the complete config file?' : action.type === 'apply' ? 'Apply the current config file?' : action.type === 'rollback' ? `Roll back to ${action.item.id}?` : action.type === 'clear' ? 'Discard the replacement draft?' : 'Discard the replacement draft and leave?'
  const content = action.type === 'update'
    ? 'This validates and replaces the complete startup config file. It does not apply the file to the running Core.'
    : action.type === 'apply'
      ? 'Core will read and apply the file currently saved on the server. Any unsubmitted replacement draft will not be applied.'
      : action.type === 'rollback'
        ? 'This replaces the current config with the selected history item and immediately attempts to apply it.'
        : 'The complete YAML currently in the replacement editor will be lost.'
  return <PageDialog title={title} onCancel={onCancel} footer={<><Button onClick={onCancel}>Cancel</Button><Button type="primary" status={destructive ? 'danger' : undefined} loading={pending} onClick={onConfirm}>{action.type === 'navigate' ? 'Discard and leave' : action.type === 'clear' ? 'Discard' : action.type === 'rollback' ? 'Rollback' : action.type === 'apply' ? 'Apply' : 'Update file'}</Button></>}><Typography.Paragraph className="provider-confirm-content">{content}</Typography.Paragraph></PageDialog>
}

export function SystemConfigPage() {
  const navigate = useNavigate()
  const feedback = useFeedback()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [validatedDraft, setValidatedDraft] = useState('')
  const [baselineRevision, setBaselineRevision] = useState('')
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>()
  const [notice, setNotice] = useState<Notice>()
  const [selectedHistoryID, setSelectedHistoryID] = useState('')

  const configQuery = useQuery({ queryKey: ['system-config'], queryFn: () => apiGet<ConfigReadResponse>('/admin/config'), refetchOnWindowFocus: false })
  const historyQuery = useQuery({ queryKey: ['config-history'], queryFn: () => apiGet<ConfigHistoryResponse>('/admin/config/history'), refetchOnWindowFocus: false })
  const diffQuery = useQuery({ queryKey: ['config-history-diff', selectedHistoryID], queryFn: () => fetchHistoryDiff(selectedHistoryID), enabled: Boolean(selectedHistoryID), retry: false })

  useEffect(() => {
    if (configQuery.data?.revision && !draft) setBaselineRevision(configQuery.data.revision)
  }, [configQuery.data?.revision, draft])
  useEffect(() => {
    if (!draft) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [draft])

  const validate = useMutation({ mutationFn: (content: string) => apiPostText<ConfigValidateResponse>('/admin/config/validate', content), onSuccess: () => { setValidatedDraft(draft); setNotice({ type: 'success', title: 'Configuration is valid', content: 'Core accepted the complete YAML. No file or runtime change has been made.' }); feedback.success('Configuration is valid.') }, onError: (error) => { setNotice({ type: 'error', title: 'Validation failed', content: errorMessage(error) }); feedback.error(errorMessage(error)) } })
  const update = useMutation({ mutationFn: () => apiPostText<ConfigUpdateResponse>('/admin/config/update', draft, baselineRevision), onSuccess: async (result) => { setDraft(''); setValidatedDraft(''); setBaselineRevision(result.revision); setNotice({ type: 'warning', title: 'File updated, not applied', content: 'The startup config file was replaced successfully. Apply the current file to update the running Core.' }); setConfirmAction(undefined); await Promise.all([queryClient.invalidateQueries({ queryKey: ['system-config'] }), queryClient.invalidateQueries({ queryKey: ['config-history'] })]); feedback.success('Configuration file updated.') }, onError: (error) => { setConfirmAction(undefined); const conflict = error instanceof ApiError && error.status === 409; setNotice({ type: conflict ? 'warning' : 'error', title: conflict ? 'Configuration changed on the server' : 'Unable to update config', content: conflict ? 'Your replacement draft was preserved. Reload the current revision, review the draft, validate it again, and retry.' : errorMessage(error) }); feedback.error(errorMessage(error)) } })
  const apply = useMutation({ mutationFn: () => apiPost<ConfigApplyResponse>('/admin/config/apply'), onSuccess: async (result) => { setNotice(reloadNotice(result, 'apply')); setConfirmAction(undefined); await Promise.all([queryClient.invalidateQueries({ queryKey: ['system-config'] }), queryClient.invalidateQueries({ queryKey: ['config-history'] })]); if (result.applied) feedback.success('Configuration applied.'); else feedback.warning(result.reason || 'Configuration was not applied.') }, onError: (error) => { setConfirmAction(undefined); setNotice({ type: 'error', title: 'Unable to apply config', content: errorMessage(error) }); feedback.error(errorMessage(error)) } })
  const rollback = useMutation({ mutationFn: (id: string) => apiPost<ConfigApplyResponse>('/admin/config/rollback', { id }), onSuccess: async (result) => { setNotice(reloadNotice(result, 'rollback')); setConfirmAction(undefined); setSelectedHistoryID(''); await Promise.all([queryClient.invalidateQueries({ queryKey: ['system-config'] }), queryClient.invalidateQueries({ queryKey: ['config-history'] })]); if (result.applied) feedback.success('Configuration rolled back.'); else feedback.warning(result.reason || 'Rollback requires attention.') }, onError: (error) => { setConfirmAction(undefined); setNotice({ type: 'error', title: 'Unable to roll back config', content: errorMessage(error) }); feedback.error(errorMessage(error)) } })

  const dirty = Boolean(draft)
  const containsRedaction = draft.includes('<redacted>')
  const updateReady = Boolean(draft.trim() && baselineRevision && validatedDraft === draft && !containsRedaction)
  const pending = validate.isPending || update.isPending || apply.isPending || rollback.isPending
  const historyColumns = useMemo<TableColumnProps<ConfigHistoryItem>[]>(() => [
    { title: 'Created', width: 190, render: (_, item) => new Date(item.created_at).toLocaleString() },
    { title: 'Reason', width: 220, dataIndex: 'reason' },
    { title: 'ID', width: 210, render: (_, item) => <Typography.Text code>{item.id}</Typography.Text> },
    { title: 'Checksum', width: 130, render: (_, item) => <Typography.Text code>{item.checksum.slice(0, 12)}</Typography.Text> },
    { title: 'Actions', width: 180, render: (_, item) => <Space size={4}><Button size="mini" onClick={() => setSelectedHistoryID(item.id)}>Compare</Button><Button size="mini" status="danger" onClick={() => setConfirmAction({ type: 'rollback', item })}>Rollback</Button></Space> },
  ], [])

  function refreshCurrent() {
    if (dirty) { setNotice({ type: 'warning', title: 'Draft uses an older baseline', content: 'The replacement draft was preserved. Reloading metadata does not rebase or validate it.' }) }
    void configQuery.refetch().then((result) => { if (result.data?.revision) { setBaselineRevision(result.data.revision); setValidatedDraft('') } })
  }
  function visit(path: string) { if (dirty) setConfirmAction({ type: 'navigate', path }); else navigate(path) }
  function confirm() {
    if (!confirmAction) return
    if (confirmAction.type === 'update') update.mutate()
    else if (confirmAction.type === 'apply') apply.mutate()
    else if (confirmAction.type === 'rollback') rollback.mutate(confirmAction.item.id)
    else if (confirmAction.type === 'clear') { setDraft(''); setValidatedDraft(''); setConfirmAction(undefined) }
    else navigate(confirmAction.path)
  }

  return <div className="page-stack system-config-page">
    <div className="console-hero compact-hero"><div><Tag color="arcoblue">Configuration</Tag><Typography.Title heading={3}>System Config</Typography.Title><Typography.Text type="secondary">Inspect, validate, replace, apply, and roll back the complete Syrogo startup configuration.</Typography.Text></div><Space wrap><Button icon={<IconRefresh />} loading={configQuery.isFetching || historyQuery.isFetching} disabled={pending} onClick={refreshCurrent}>Refresh</Button><Button type="primary" icon={<IconCheck />} disabled={!configQuery.data?.config_ready || pending} onClick={() => setConfirmAction({ type: 'apply' })}>Apply current file</Button></Space></div>
    {notice ? <Alert type={notice.type} title={notice.title} content={notice.content} closable onClose={() => setNotice(undefined)} /> : null}
    {configQuery.isError ? <Alert type="error" title="Unable to load system config" content={errorMessage(configQuery.error)} /> : null}
    {historyQuery.isError ? <Alert type="warning" title="Configuration history unavailable" content={errorMessage(historyQuery.error)} /> : null}
    <Card bordered={false} className="panel-card system-config-managed" title="Managed resources"><Typography.Paragraph type="secondary">Prefer structured pages for routine changes. Use complete YAML replacement for listeners, accounting, logging, recovery, and other system-level settings.</Typography.Paragraph><Space wrap><Button icon={<IconStorage />} onClick={() => visit('/providers')}>Providers</Button><Button onClick={() => visit('/clients')}>Clients</Button><Button onClick={() => visit('/routes')}>Routes</Button></Space></Card>
    <div className="system-config-grid">
      <Card bordered={false} className="panel-card" title={<Space><span>Current file</span><Tag color="green">Redacted</Tag></Space>} extra={configQuery.data?.config_ready ? <Typography.Text type="secondary">Revision {shortRevision(configQuery.data.revision)}</Typography.Text> : null}>
        {configQuery.data && !configQuery.data.config_ready ? <Alert type="warning" title="Configuration file unavailable" content="Core was started without a manageable config path." /> : <><Typography.Paragraph type="secondary">Secrets are removed by Core. This view cannot be submitted as a complete config.</Typography.Paragraph><Input.TextArea aria-label="Redacted current config" className="system-config-editor" readOnly spellCheck={false} value={configQuery.data?.redacted_content || ''} placeholder={configQuery.isLoading ? 'Loading current configuration…' : ''} /></>}
      </Card>
      <Card bordered={false} className="panel-card" title={<Space><span>Replace complete file</span>{dirty ? <Tag color="orange">Draft</Tag> : null}{validatedDraft === draft && draft ? <Tag color="green">Validated</Tag> : null}</Space>}>
        <Alert type="warning" content="Paste complete YAML including real secrets. Draft content stays in browser memory only and is cleared after a successful update." />
        <Input.TextArea aria-label="Complete replacement config" className="system-config-editor" spellCheck={false} value={draft} placeholder="Paste the complete YAML configuration here" onChange={(value) => { setDraft(value); setValidatedDraft(''); if (notice?.title === 'Configuration is valid') setNotice(undefined) }} />
        {containsRedaction ? <Typography.Text className="system-config-error">Replace &lt;redacted&gt; values with complete secrets before updating.</Typography.Text> : null}
        <Space wrap className="system-config-actions"><Button icon={<IconCheck />} loading={validate.isPending} disabled={!draft.trim() || containsRedaction || pending && !validate.isPending} onClick={() => validate.mutate(draft)}>Validate</Button><Button type="primary" icon={<IconSave />} loading={update.isPending} disabled={!updateReady || pending} onClick={() => setConfirmAction({ type: 'update' })}>Update file</Button><Button disabled={!dirty || pending} onClick={() => setConfirmAction({ type: 'clear' })}>Clear</Button></Space>
        <Typography.Paragraph type="secondary">Update replaces the disk file only. Apply is a separate operation and always reads the current server file.</Typography.Paragraph>
      </Card>
    </div>
    <Card bordered={false} className="panel-card data-card" title={<Space><IconHistory /><span>Configuration history</span></Space>}><Table rowKey="id" loading={historyQuery.isLoading} columns={historyColumns} data={historyQuery.data?.items || []} pagination={false} scroll={{ x: 930 }} noDataElement="No configuration history yet." /></Card>
    {selectedHistoryID ? <Card bordered={false} className="panel-card" title={`Compare ${selectedHistoryID}`} extra={<Button size="small" onClick={() => setSelectedHistoryID('')}>Close comparison</Button>}>{diffQuery.isError ? <Alert type="error" title="Unable to compare history" content={errorMessage(diffQuery.error)} /> : <div className="system-config-diff"><div><Typography.Title heading={6}>Historical config</Typography.Title><pre>{diffQuery.data?.history_content || 'Loading…'}</pre></div><div><Typography.Title heading={6}>Current config</Typography.Title><pre>{diffQuery.data?.current_content || 'Loading…'}</pre></div></div>}</Card> : null}
    {confirmAction ? <ConfirmDialog action={confirmAction} pending={pending} onCancel={() => setConfirmAction(undefined)} onConfirm={confirm} /> : null}
  </div>
}
