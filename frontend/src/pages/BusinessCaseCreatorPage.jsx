import React, { useState, useEffect, useMemo, useRef } from 'react'
import { businessCaseCreatorAPI, targetGroupsAPI } from '../lib/api'
import ProblemSearchSelect from '../components/ProblemSearchSelect'
import MetricSearchSelect from '../components/MetricSearchSelect'
import PreviewPanel, { PreviewRow } from '../components/PreviewPanel'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Plus, Trash2, CheckCircle, Loader2, AlertCircle } from 'lucide-react'

const emptyMetric = () => ({ title: '', description: '', min_marks: 0, max_marks: 10 })

const formatMetricsPreview = (metrics) =>
  metrics
    .filter((m) => m.title.trim() || m.description.trim())
    .map((m) => `${m.title.trim()}: ${m.description.trim()}`)
    .join('\n')

const validateClientSide = ({ selectedProblem, mode, metrics, existingCount, targetGroupId }) => {
  const errors = { metrics: (metrics || []).map(() => ({})) }
  let hasError = false

  if (!selectedProblem) {
    errors.problem = 'Search and select a problem'
    hasError = true
  }
  if (!targetGroupId) {
    errors.targetGroupId = 'Select a target group'
    hasError = true
  }

  if (mode === 'existing') {
    if (!existingCount) {
      errors.existingRoot = 'Search and add at least one metric'
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
  const [selectedProblem, setSelectedProblem] = useState(null)
  const [targetGroups, setTargetGroups] = useState([])
  const [targetGroupId, setTargetGroupId] = useState('')
  // 'create' (new metrics inline) or 'existing' (search + associate)
  const [metricsMode, setMetricsMode] = useState('create')
  const [metrics, setMetrics] = useState([emptyMetric()])
  const [selectedExisting, setSelectedExisting] = useState([]) // [{ id, name, description }]

  const [useAi, setUseAi] = useState(false)
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
    }
  }, [])

  const metricsPreview = useMemo(() => formatMetricsPreview(metrics), [metrics])

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
      selectedProblem,
      mode: metricsMode,
      metrics,
      existingCount: selectedExisting.length,
      targetGroupId,
    })
    setFormErrors(errors)
    if (hasError) return

    setSubmitting(true)
    try {
      const basePayload = {
        problem_id: selectedProblem.id,
        target_group_id: Number(targetGroupId),
        use_ai: useAi,
      }
      const payload =
        metricsMode === 'existing'
          ? { ...basePayload, mode: 'existing', metric_ids: selectedExisting.map((m) => m.id) }
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
    setSelectedProblem(null)
    setTargetGroupId('')
    setMetricsMode('create')
    setMetrics([emptyMetric()])
    setSelectedExisting([])
    setUseAi(false)
    setFormErrors({ metrics: [{}] })
    setExecution(null)
    setSubmitError(null)
    setResult(null)
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Problem</label>
            <ProblemSearchSelect
              value={selectedProblem}
              onChange={(p) => {
                setSelectedProblem(p)
                clearTopError('problem')
              }}
              error={formErrors.problem}
            />
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
                Use existing metrics
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
              <>
                {formErrors.existingRoot && (
                  <p className="text-sm text-red-600 mb-2">{formErrors.existingRoot}</p>
                )}
                <MetricSearchSelect selected={selectedExisting} onChange={setSelectedExisting} />
              </>
            )}
          </div>

          <PreviewPanel>
            <PreviewRow label="Problem">
              {selectedProblem ? (
                <>
                  {selectedProblem.label} <span className="text-slate-400">· ID {selectedProblem.id}</span>
                </>
              ) : (
                <span className="text-slate-400">(not selected)</span>
              )}
            </PreviewRow>
            <PreviewRow label="Evaluation">{useAi ? 'AI' : 'Human'}</PreviewRow>
            {metricsMode === 'create' ? (
              <PreviewRow label="New metrics">
                {metricsPreview ? (
                  <pre className="bg-white border border-slate-200 rounded p-2 text-xs whitespace-pre-wrap break-all">
                    {metricsPreview}
                  </pre>
                ) : (
                  <span className="text-slate-400">(none)</span>
                )}
              </PreviewRow>
            ) : (
              <PreviewRow label="Existing metrics">
                {selectedExisting.length > 0
                  ? selectedExisting.map((m) => `${m.name || `Metric ${m.id}`} (${m.id})`).join(', ')
                  : <span className="text-slate-400">(search and add metrics)</span>}
              </PreviewRow>
            )}
          </PreviewPanel>

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
