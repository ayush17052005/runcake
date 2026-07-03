import React, { useState, useEffect, useMemo, useRef } from 'react'
import { businessCaseCreatorAPI, targetGroupsAPI } from '../lib/api'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import {
  Plus,
  Trash2,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
} from 'lucide-react'

const emptyMetric = () => ({ title: '', description: '', min_marks: 0, max_marks: 10 })

const formatMetricsPreview = (metrics) =>
  metrics
    .filter((m) => m.title.trim() || m.description.trim())
    .map((m) => `${m.title.trim()}: ${m.description.trim()}`)
    .join('\n')

// Parse a comma/space/newline-separated string of metric IDs. Returns
// { ids, error } — error is non-null when input is malformed or contains
// non-positive-integer tokens.
const parseMetricIdsInput = (raw) => {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return { ids: [], error: 'Enter at least one metric ID' }
  const tokens = trimmed.split(/[\s,]+/).filter(Boolean)
  const ids = []
  for (const t of tokens) {
    if (!/^\d+$/.test(t)) return { ids: [], error: `"${t}" is not a positive integer` }
    const n = Number(t)
    if (!Number.isFinite(n) || n <= 0) return { ids: [], error: `"${t}" is not a positive integer` }
    ids.push(n)
  }
  return { ids: Array.from(new Set(ids)), error: null }
}

const validateClientSide = ({ problemId, mode, metrics, metricIds, targetGroupId }) => {
  const errors = { metrics: (metrics || []).map(() => ({})) }
  let hasError = false

  if (!problemId || !/^\d+$/.test(String(problemId).trim()) || Number(problemId) <= 0) {
    errors.problemId = 'Must be a positive integer'
    hasError = true
  }

  if (!targetGroupId) {
    errors.targetGroupId = 'Select a target group'
    hasError = true
  }

  if (mode === 'existing') {
    if (!Array.isArray(metricIds) || metricIds.length === 0) {
      errors.metricIdsRoot = 'Enter at least one metric ID and load the preview before starting'
      hasError = true
    }
    return { hasError, errors }
  }

  if (!metrics || metrics.length === 0) {
    errors.metricsRoot = 'Add at least one metric'
    hasError = true
  }

  ;(metrics || []).forEach((m, i) => {
    const rowErr = {}
    if (!m.title.trim()) {
      rowErr.title = 'Required'
      hasError = true
    } else if (m.title.includes(':')) {
      rowErr.title = 'Cannot contain ":"'
      hasError = true
    } else if (m.title.includes('"')) {
      rowErr.title = 'Cannot contain \'"\''
      hasError = true
    }
    if (!m.description.trim()) {
      rowErr.description = 'Required'
      hasError = true
    } else if (m.description.includes(':')) {
      rowErr.description = 'Cannot contain ":"'
      hasError = true
    } else if (m.description.includes('"')) {
      rowErr.description = 'Cannot contain \'"\''
      hasError = true
    }
    const min = Number(m.min_marks)
    const max = Number(m.max_marks)
    if (!Number.isFinite(min) || min < 0) {
      rowErr.min_marks = 'Must be ≥ 0'
      hasError = true
    }
    if (!Number.isFinite(max) || max < 0) {
      rowErr.max_marks = 'Must be ≥ 0'
      hasError = true
    }
    if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
      rowErr.min_marks = rowErr.min_marks || 'Min must be ≤ max'
      hasError = true
    }
    errors.metrics[i] = rowErr
  })

  return { hasError, errors }
}

const ProgressPanel = ({ status, errorMessage }) => (
  <Card className="p-6 space-y-3">
    <div className="flex items-center gap-3">
      <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Running on EC2 via SSM</h3>
        <p className="text-sm text-slate-600">
          Status: <strong>{status}</strong>. This can take a minute or two — don't close the tab.
        </p>
      </div>
    </div>
    {errorMessage && (
      <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{errorMessage}</span>
      </div>
    )}
  </Card>
)

const BusinessCaseCreatorPage = () => {
  const [problemId, setProblemId] = useState('')
  const [targetGroups, setTargetGroups] = useState([])
  const [targetGroupId, setTargetGroupId] = useState('')
  // 'create' (new metrics inline) or 'existing' (look up by id)
  const [metricsMode, setMetricsMode] = useState('create')
  const [metrics, setMetrics] = useState([emptyMetric()])
  // Map-existing mode state. Raw textarea contents + parsed/loaded results.
  const [metricIdsInput, setMetricIdsInput] = useState('')
  const [loadedMetricIds, setLoadedMetricIds] = useState([])
  const [previewMetrics, setPreviewMetrics] = useState([]) // [{ id, name, description, min_score, max_score }]
  const [previewMissingIds, setPreviewMissingIds] = useState([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(null)
  const previewPollRef = useRef(null)

  const [useAi, setUseAi] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [formErrors, setFormErrors] = useState({ metrics: [{}] })

  const [execution, setExecution] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [result, setResult] = useState(null)

  const pollRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const tgResp = await targetGroupsAPI.getAll()
        if (!cancelled && tgResp?.success) setTargetGroups(tgResp.data || [])
      } catch (e) {
        console.error('Failed to load target groups:', e)
      }
    })()
    return () => {
      cancelled = true
      if (pollRef.current) clearInterval(pollRef.current)
      if (previewPollRef.current) clearInterval(previewPollRef.current)
    }
  }, [])

  // Kick off a preview-metrics SSM run, then poll the execution until it
  // terminates. On success, populate previewMetrics + previewMissingIds.
  const handleLoadPreview = async () => {
    setPreviewError(null)
    setPreviewMetrics([])
    setPreviewMissingIds([])
    setLoadedMetricIds([])

    if (!targetGroupId) {
      setPreviewError('Select a target group first')
      return
    }
    const { ids, error } = parseMetricIdsInput(metricIdsInput)
    if (error) {
      setPreviewError(error)
      return
    }

    setPreviewLoading(true)
    try {
      const resp = await businessCaseCreatorAPI.previewMetrics({
        target_group_id: Number(targetGroupId),
        metric_ids: ids,
      })
      if (!resp?.success) {
        setPreviewError(resp?.message || 'Failed to start preview')
        setPreviewLoading(false)
        return
      }
      const executionId = resp.data.executionId
      if (previewPollRef.current) clearInterval(previewPollRef.current)
      const poll = async () => {
        try {
          const status = await businessCaseCreatorAPI.getExecution(executionId)
          if (!status?.success) return
          if (status.data.isTerminal) {
            clearInterval(previewPollRef.current)
            previewPollRef.current = null
            setPreviewLoading(false)
            const parsed = status.data.parsed
            if (status.data.status === 'success' && parsed && parsed.status === 'success') {
              setPreviewMetrics(parsed.metrics || [])
              setPreviewMissingIds(parsed.missing || [])
              const foundIds = (parsed.metrics || []).map((m) => m.id)
              setLoadedMetricIds(foundIds)
              if ((parsed.missing || []).length > 0) {
                setPreviewError(
                  `Some IDs not found on the Rails DB: ${(parsed.missing || []).join(', ')}`
                )
              }
            } else {
              setPreviewError(
                status.data.errorMessage || parsed?.message || 'Preview failed — check audit log'
              )
            }
          }
        } catch (e) {
          console.error('preview poll error:', e)
        }
      }
      poll()
      previewPollRef.current = setInterval(poll, 3000)
    } catch (e) {
      setPreviewError(e.message || 'Failed to start preview')
      setPreviewLoading(false)
    }
  }

  const metricsPreview = useMemo(() => formatMetricsPreview(metrics), [metrics])

  // Clear a single top-level form error key when the user starts editing that
  // field. Keeps the red message from sticking around after the user has
  // already corrected the input.
  const clearTopError = (key) => {
    setFormErrors((prev) => {
      if (!prev || prev[key] == null) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const clearMetricRowError = (index, field) => {
    setFormErrors((prev) => {
      const rows = prev?.metrics
      if (!Array.isArray(rows) || !rows[index] || rows[index][field] == null) return prev
      const nextRows = rows.map((r, i) => (i === index ? { ...r, [field]: undefined } : r))
      return { ...prev, metrics: nextRows }
    })
  }

  const updateMetric = (index, field, value) => {
    setMetrics((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)))
    clearMetricRowError(index, field)
    clearTopError('metricsRoot')
  }

  const addMetric = () => {
    setMetrics((prev) => [...prev, emptyMetric()])
    setFormErrors((prev) => ({ ...prev, metrics: [...(prev.metrics || []), {}] }))
  }

  const removeMetric = (index) => {
    setMetrics((prev) => prev.filter((_, i) => i !== index))
    setFormErrors((prev) => ({
      ...prev,
      metrics: (prev.metrics || []).filter((_, i) => i !== index),
    }))
  }

  const startPollingExecution = (executionId) => {
    if (pollRef.current) clearInterval(pollRef.current)
    const poll = async () => {
      try {
        const resp = await businessCaseCreatorAPI.getExecution(executionId)
        if (!resp?.success) return
        setExecution({
          executionId: resp.data.executionId,
          status: resp.data.status,
          errorMessage: resp.data.errorMessage,
        })
        if (resp.data.isTerminal) {
          clearInterval(pollRef.current)
          pollRef.current = null
          if (resp.data.status === 'success' && resp.data.parsed) {
            setResult({
              metricIds: resp.data.parsed.metric_ids || [],
              problemId: resp.data.parsed.problem_id,
              useAi: Boolean(resp.data.parsed.use_ai),
              status: 'success',
            })
            setExecution(null)
          } else {
            setSubmitError(resp.data.errorMessage || 'Execution failed')
          }
        }
      } catch (e) {
        console.error('Polling error:', e)
      }
    }
    poll()
    pollRef.current = setInterval(poll, 3000)
  }

  const handleStart = async () => {
    setSubmitError(null)
    const { hasError, errors } = validateClientSide({
      problemId,
      mode: metricsMode,
      metrics,
      metricIds: loadedMetricIds,
      targetGroupId,
    })
    setFormErrors(errors)
    if (hasError) return

    setSubmitting(true)
    try {
      const basePayload = {
        problem_id: Number(problemId),
        target_group_id: Number(targetGroupId),
        use_ai: useAi,
      }
      const payload =
        metricsMode === 'existing'
          ? { ...basePayload, mode: 'existing', metric_ids: loadedMetricIds }
          : {
              ...basePayload,
              mode: 'create',
              metrics: metrics.map((m) => ({
                title: m.title.trim(),
                description: m.description.trim(),
                min_marks: Number(m.min_marks),
                max_marks: Number(m.max_marks),
              })),
            }
      const resp = await businessCaseCreatorAPI.orchestrate(payload)
      if (!resp?.success) {
        setSubmitError(resp?.message || 'Failed to start')
        return
      }
      setExecution({ executionId: resp.data.executionId, status: resp.data.status })
      startPollingExecution(resp.data.executionId)
    } catch (e) {
      setSubmitError(e.message || 'Failed to start')
    } finally {
      setSubmitting(false)
    }
  }

  const handleReset = () => {
    setProblemId('')
    setTargetGroupId('')
    setMetricsMode('create')
    setMetrics([emptyMetric()])
    setMetricIdsInput('')
    setLoadedMetricIds([])
    setPreviewMetrics([])
    setPreviewMissingIds([])
    setPreviewError(null)
    setUseAi(false)
    setFormErrors({ metrics: [{}] })
    setExecution(null)
    setSubmitError(null)
    setResult(null)
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (previewPollRef.current) {
      clearInterval(previewPollRef.current)
      previewPollRef.current = null
    }
  }

  const showForm = !execution && !result

  return (
    <div className="py-8 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Business Case Creator</h1>
        <p className="text-slate-600 mt-1">
          Create a business-case problem end-to-end. One atomic Ruby transaction handles metrics
          creation, problem association, and state transition on a single randomly-picked Rails instance.
        </p>
      </div>

      {result && (
        <Card className="p-6 space-y-3 border-green-200 bg-green-50">
          <div className="flex items-center gap-2 text-green-900">
            <CheckCircle className="h-5 w-5" />
            <h3 className="text-lg font-semibold">Business case created</h3>
          </div>
          <div className="text-sm text-green-900 space-y-1">
            <div>Problem ID: <strong>{result.problemId}</strong></div>
            <div>Evaluation: <strong>{result.useAi ? 'AI' : 'Human'}</strong></div>
            <div>Metric IDs: <strong>{(result.metricIds || []).join(', ')}</strong></div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleReset}>Create another</Button>
            <a href="/audit-log" className="inline-flex">
              <Button variant="ghost">View audit log</Button>
            </a>
          </div>
        </Card>
      )}

      {execution && !result && (
        <ProgressPanel status={execution.status} errorMessage={execution.errorMessage || submitError} />
      )}

      {showForm && (
        <Card className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Design problem ID</label>
            <Input
              type="number"
              value={problemId}
              onChange={(e) => {
                setProblemId(e.target.value)
                clearTopError('problemId')
              }}
              placeholder="e.g. 12313"
              min="1"
            />
            {formErrors.problemId && <p className="text-sm text-red-600 mt-1">{formErrors.problemId}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Target group</label>
            <select
              value={targetGroupId}
              onChange={(e) => {
                setTargetGroupId(e.target.value)
                clearTopError('targetGroupId')
              }}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- select a Rails target group --</option>
              {targetGroups.map((tg) => (
                <option key={tg.id} value={tg.id}>
                  {tg.name} ({tg.aws_tag_key}={tg.aws_tag_value}, {tg.region})
                </option>
              ))}
            </select>
            {formErrors.targetGroupId && <p className="text-sm text-red-600 mt-1">{formErrors.targetGroupId}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-700">Evaluation metrics</label>
              {metricsMode === 'create' && (
                <Button type="button" variant="outline" size="sm" onClick={addMetric}>
                  <Plus className="h-4 w-4 mr-1" /> Add metric
                </Button>
              )}
            </div>

            <div className="mb-3 flex gap-4 text-sm text-slate-700">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="metrics_mode"
                  checked={metricsMode === 'create'}
                  onChange={() => setMetricsMode('create')}
                />
                Create new metrics
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="metrics_mode"
                  checked={metricsMode === 'existing'}
                  onChange={() => setMetricsMode('existing')}
                />
                Use existing metric IDs
              </label>
            </div>

            {metricsMode === 'create' && (
              <>
                {formErrors.metricsRoot && (
                  <p className="text-sm text-red-600 mb-2">{formErrors.metricsRoot}</p>
                )}
                <div className="space-y-3">
                  {metrics.map((m, i) => {
                    const rowErr = (formErrors.metrics && formErrors.metrics[i]) || {}
                    return (
                      <div key={i} className="p-3 border border-slate-200 rounded-md bg-slate-50 space-y-2">
                        <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr_auto_auto_auto] gap-2 items-start">
                          <div>
                            <Input
                              placeholder="Title (e.g. Clarity)"
                              value={m.title}
                              onChange={(e) => updateMetric(i, 'title', e.target.value)}
                            />
                            {rowErr.title && <p className="text-xs text-red-600 mt-1">{rowErr.title}</p>}
                          </div>
                          <div>
                            <Input
                              placeholder="Description"
                              value={m.description}
                              onChange={(e) => updateMetric(i, 'description', e.target.value)}
                            />
                            {rowErr.description && <p className="text-xs text-red-600 mt-1">{rowErr.description}</p>}
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                              Min score
                            </label>
                            <Input
                              type="number"
                              placeholder="Min score"
                              value={m.min_marks}
                              min="0"
                              onChange={(e) => updateMetric(i, 'min_marks', e.target.value)}
                              className="w-20"
                            />
                            {rowErr.min_marks && <p className="text-xs text-red-600 mt-1">{rowErr.min_marks}</p>}
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                              Max score
                            </label>
                            <Input
                              type="number"
                              placeholder="Max score"
                              value={m.max_marks}
                              min="0"
                              onChange={(e) => updateMetric(i, 'max_marks', e.target.value)}
                              className="w-20"
                            />
                            {rowErr.max_marks && <p className="text-xs text-red-600 mt-1">{rowErr.max_marks}</p>}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeMetric(i)}
                            disabled={metrics.length === 1}
                            aria-label="Remove metric"
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {metricsMode === 'existing' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Metric IDs (comma- or space-separated, e.g. <code>1234, 5678, 9012</code>)
                  </label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="1234, 5678, 9012"
                      value={metricIdsInput}
                      onChange={(e) => {
                        setMetricIdsInput(e.target.value)
                        clearTopError('metricIdsRoot')
                        // Force the user to re-fetch the preview after editing.
                        if (loadedMetricIds.length > 0) {
                          setLoadedMetricIds([])
                          setPreviewMetrics([])
                          setPreviewMissingIds([])
                        }
                      }}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleLoadPreview}
                      disabled={previewLoading || !targetGroupId}
                    >
                      {previewLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Loading…
                        </>
                      ) : (
                        'Load preview'
                      )}
                    </Button>
                  </div>
                  {!targetGroupId && (
                    <p className="text-xs text-slate-500 mt-1">
                      Select a target group first — the preview runs on a Rails instance.
                    </p>
                  )}
                </div>

                {previewError && (
                  <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{previewError}</span>
                  </div>
                )}

                {formErrors.metricIdsRoot && (
                  <p className="text-sm text-red-600">{formErrors.metricIdsRoot}</p>
                )}

                {previewMetrics.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs text-slate-500">
                      Loaded {previewMetrics.length} metric{previewMetrics.length === 1 ? '' : 's'}
                      {previewMissingIds.length > 0 && (
                        <> · {previewMissingIds.length} not found: <strong>{previewMissingIds.join(', ')}</strong></>
                      )}
                    </div>
                    {previewMetrics.map((m) => (
                      <div
                        key={m.id}
                        className="p-3 border border-slate-200 rounded-md bg-white"
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-slate-900">{m.name}</div>
                          <div className="text-xs text-slate-500">
                            ID <strong>{m.id}</strong>
                            {(m.min_score != null || m.max_score != null) && (
                              <> · {m.min_score ?? '?'}–{m.max_score ?? '?'}</>
                            )}
                          </div>
                        </div>
                        {m.description && (
                          <p className="text-sm text-slate-600 mt-1">{m.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={() => setPreviewOpen((v) => !v)}
              className="flex items-center gap-1 text-sm text-blue-700 hover:text-blue-900"
            >
              {previewOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Verify preview
            </button>
            {previewOpen && (
              <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-md">
                {metricsMode === 'create' ? (
                  <>
                    <div className="text-xs text-slate-500 mb-1">
                      Metrics string that will be sent to the Ruby script:
                    </div>
                    <pre className="bg-white border border-slate-200 rounded p-2 text-xs whitespace-pre-wrap break-all">
                      {metricsPreview || '(empty)'}
                    </pre>
                    <div className="text-xs text-slate-600 mt-2">
                      Problem ID: <strong>{problemId || '(unset)'}</strong> ·{' '}
                      {metrics.length} metric{metrics.length === 1 ? '' : 's'} ·{' '}
                      Evaluated by <strong>{useAi ? 'AI' : 'Human'}</strong>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xs text-slate-500 mb-1">
                      Existing metric IDs that will be associated with the problem:
                    </div>
                    <pre className="bg-white border border-slate-200 rounded p-2 text-xs whitespace-pre-wrap break-all">
                      {loadedMetricIds.length > 0 ? loadedMetricIds.join(', ') : '(load preview first)'}
                    </pre>
                    <div className="text-xs text-slate-600 mt-2">
                      Problem ID: <strong>{problemId || '(unset)'}</strong> ·{' '}
                      {loadedMetricIds.length} metric{loadedMetricIds.length === 1 ? '' : 's'} ·{' '}
                      Evaluated by <strong>{useAi ? 'AI' : 'Human'}</strong>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <fieldset>
            <legend className="block text-sm font-medium text-slate-700 mb-2">Evaluation mode</legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="use_ai" checked={!useAi} onChange={() => setUseAi(false)} />
                Evaluated by humans
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="use_ai" checked={useAi} onChange={() => setUseAi(true)} />
                Evaluated by AI
              </label>
            </div>
          </fieldset>

          {submitError && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleStart} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Starting...
                </>
              ) : (
                'Start'
              )}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}

export default BusinessCaseCreatorPage
