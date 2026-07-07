import React, { useState, useEffect, useRef } from 'react'
import { businessCaseCreatorAPI, targetGroupsAPI } from '../lib/api'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import ProblemSearchSelect from '../components/ProblemSearchSelect'
import MetricSearchSelect from '../components/MetricSearchSelect'
import PreviewPanel, { PreviewRow } from '../components/PreviewPanel'
import { Plus, Trash2, CheckCircle, Loader2, AlertCircle } from 'lucide-react'

const emptyNewMetric = () => ({ title: '', description: '', min_marks: 0, max_marks: 10 })

const validateNewMetric = (m) => {
  const e = {}
  if (!m.title.trim()) e.title = 'Required'
  else if (m.title.includes(':')) e.title = 'No ":"'
  else if (m.title.includes('"')) e.title = 'No \'"\''
  if (!m.description.trim()) e.description = 'Required'
  else if (m.description.includes(':')) e.description = 'No ":"'
  else if (m.description.includes('"')) e.description = 'No \'"\''
  const min = Number(m.min_marks)
  const max = Number(m.max_marks)
  if (!Number.isFinite(min) || min < 0) e.min_marks = 'Must be ≥ 0'
  if (!Number.isFinite(max) || max < 0) e.max_marks = 'Must be ≥ 0'
  if (Number.isFinite(min) && Number.isFinite(max) && min > max) e.min_marks = e.min_marks || 'Min ≤ max'
  return e
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

const BusinessCaseUpdatePage = () => {
  const [targetGroups, setTargetGroups] = useState([])
  const [targetGroupId, setTargetGroupId] = useState('')

  const [selectedProblem, setSelectedProblem] = useState(null)

  // Current metric associations (for removal)
  const [currentMetrics, setCurrentMetrics] = useState([])
  const [currentLoading, setCurrentLoading] = useState(false)
  const [currentError, setCurrentError] = useState(null)
  const [removeSelected, setRemoveSelected] = useState(() => new Set())

  // Impact — how many existing responses this problem has (from Metabase)
  const [affectedCount, setAffectedCount] = useState(null)
  const [affectedLoading, setAffectedLoading] = useState(false)

  // Add existing metrics (Metabase search) + brand-new metrics
  const [selectedExisting, setSelectedExisting] = useState([])
  const [newMetrics, setNewMetrics] = useState([])

  const [confirmChecked, setConfirmChecked] = useState(false)
  const [formErrors, setFormErrors] = useState({})
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

  const loadCurrentMetrics = async (problemId) => {
    setCurrentLoading(true)
    setCurrentError(null)
    setCurrentMetrics([])
    setRemoveSelected(new Set())
    try {
      const resp = await businessCaseCreatorAPI.getProblemMetrics(problemId)
      setCurrentMetrics(resp?.data?.metrics || [])
    } catch (e) {
      setCurrentError(e.message || 'Failed to load current metrics')
    } finally {
      setCurrentLoading(false)
    }
  }

  // How many existing candidate responses this problem has — the population
  // affected by a metric change and the set that must be reevaluated after.
  const loadAffected = async (problemId) => {
    setAffectedLoading(true)
    setAffectedCount(null)
    try {
      const resp = await businessCaseCreatorAPI.fetchCandidateEmails({ problem_id: problemId })
      if (resp?.success) {
        setAffectedCount(resp.data?.count ?? (resp.data?.emails || []).length)
      }
    } catch (e) {
      console.error('affected-count error:', e)
      setAffectedCount(null)
    } finally {
      setAffectedLoading(false)
    }
  }

  const handleProblemChange = (p) => {
    setFormErrors((f) => ({ ...f, problem: undefined }))
    setConfirmChecked(false)
    if (p) {
      setSelectedProblem(p)
      loadCurrentMetrics(p.id)
      loadAffected(p.id)
    } else {
      setSelectedProblem(null)
      setCurrentMetrics([])
      setRemoveSelected(new Set())
      setCurrentError(null)
      setAffectedCount(null)
    }
  }

  const toggleRemove = (metricId) => {
    setRemoveSelected((prev) => {
      const next = new Set(prev)
      if (next.has(metricId)) next.delete(metricId)
      else next.add(metricId)
      return next
    })
    setConfirmChecked(false)
    setFormErrors((f) => ({ ...f, confirm: undefined, action: undefined }))
  }

  const addNewRow = () => setNewMetrics((prev) => [...prev, emptyNewMetric()])
  const updateNewRow = (i, field, value) =>
    setNewMetrics((prev) => prev.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)))
  const removeNewRow = (i) => setNewMetrics((prev) => prev.filter((_, idx) => idx !== i))

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
          const parsed = resp.data.parsed
          if (resp.data.status === 'success' && parsed && parsed.status === 'success') {
            setResult({
              problemId: parsed.problem_id,
              removedAssociations: parsed.removed_associations ?? 0,
              removedResponses: parsed.removed_responses ?? 0,
              addedMetricIds: parsed.added_metric_ids || [],
            })
            setExecution(null)
          } else {
            setSubmitError(resp.data.errorMessage || parsed?.message || 'Execution failed')
          }
        }
      } catch (e) {
        console.error('Polling error:', e)
      }
    }
    poll()
    pollRef.current = setInterval(poll, 3000)
  }

  const filledNewMetrics = newMetrics.filter((m) => m.title.trim() || m.description.trim())

  const handleSubmit = async () => {
    setSubmitError(null)
    const errors = {}

    if (!selectedProblem) errors.problem = 'Search and select a problem'
    if (!targetGroupId) errors.targetGroupId = 'Select a target group'

    const newMetricErrors = filledNewMetrics.map(validateNewMetric)
    if (newMetricErrors.some((e) => Object.keys(e).length > 0)) errors.newMetrics = newMetricErrors

    const removeIds = Array.from(removeSelected)
    const existingIds = selectedExisting.map((m) => m.id)
    const hasChanges = removeIds.length > 0 || existingIds.length > 0 || filledNewMetrics.length > 0
    if (!hasChanges) {
      errors.action = 'Select metrics to remove and/or add at least one metric'
    }
    // Any metric change requires acknowledging the impact + reevaluation.
    if (hasChanges && !confirmChecked) {
      errors.confirm = 'Please acknowledge the impact to continue'
    }

    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      const resp = await businessCaseCreatorAPI.update({
        problem_id: selectedProblem.id,
        target_group_id: Number(targetGroupId),
        remove_metric_ids: removeIds,
        metric_ids: existingIds,
        metrics: filledNewMetrics.map((m) => ({
          title: m.title.trim(),
          description: m.description.trim(),
          min_marks: Number(m.min_marks),
          max_marks: Number(m.max_marks),
        })),
      })
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
    setTargetGroupId('')
    setSelectedProblem(null)
    setCurrentMetrics([])
    setRemoveSelected(new Set())
    setAffectedCount(null)
    setSelectedExisting([])
    setNewMetrics([])
    setConfirmChecked(false)
    setFormErrors({})
    setExecution(null)
    setSubmitError(null)
    setResult(null)
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const removeCount = removeSelected.size
  const hasChanges = removeCount > 0 || selectedExisting.length > 0 || filledNewMetrics.length > 0
  const showForm = !execution && !result

  return (
    <div className="py-8 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Update Business Case</h1>
        <p className="text-slate-600 mt-1">
          Search a problem, remove existing evaluation metrics, and add new ones — all in one atomic
          transaction on a randomly-picked Rails instance. Problems and metrics are looked up from
          Metabase; only their IDs drive the update.
        </p>
      </div>

      {result && (
        <Card className="p-6 space-y-3 border-green-200 bg-green-50">
          <div className="flex items-center gap-2 text-green-900">
            <CheckCircle className="h-5 w-5" />
            <h3 className="text-lg font-semibold">Business case updated</h3>
          </div>
          <div className="text-sm text-green-900 space-y-1">
            <div>Problem ID: <strong>{result.problemId}</strong></div>
            <div>Associations removed: <strong>{result.removedAssociations}</strong></div>
            <div>Responses removed: <strong>{result.removedResponses}</strong></div>
            <div>Metrics added: <strong>{(result.addedMetricIds || []).join(', ') || '—'}</strong></div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleReset}>Update another</Button>
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
          {/* Target group */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Target group</label>
            <select
              value={targetGroupId}
              onChange={(e) => {
                setTargetGroupId(e.target.value)
                setFormErrors((f) => ({ ...f, targetGroupId: undefined }))
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

          {/* Step 1 — find the problem */}
          <div className="rounded-md border border-slate-200 p-4 space-y-2">
            <label className="block text-sm font-medium text-slate-700">1 · Problem</label>
            <ProblemSearchSelect
              value={selectedProblem}
              onChange={handleProblemChange}
              error={formErrors.problem}
            />
          </div>

          {/* Step 2 — current metrics to remove */}
          {selectedProblem && (
            <div className="rounded-md border border-slate-200 p-4 space-y-2">
              <label className="block text-sm font-medium text-slate-700">
                2 · Current metrics — select any to remove
              </label>
              {currentLoading && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading current metrics…
                </div>
              )}
              {currentError && (
                <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{currentError}</span>
                </div>
              )}
              {!currentLoading && !currentError && currentMetrics.length === 0 && (
                <p className="text-sm text-slate-500">This problem has no evaluation metrics yet.</p>
              )}
              {currentMetrics.length > 0 && (
                <div className="space-y-2">
                  {currentMetrics.map((m) => {
                    const checked = removeSelected.has(m.id)
                    return (
                      <label
                        key={m.id}
                        className={`flex items-start gap-2 p-3 border rounded-md cursor-pointer ${
                          checked ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={checked}
                          onChange={() => toggleRemove(m.id)}
                        />
                        <div>
                          <div className="text-sm font-medium text-slate-900">
                            {m.name || `Metric ${m.id}`}{' '}
                            <span className="text-xs text-slate-400">· ID {m.id}</span>
                          </div>
                          {m.description && <div className="text-sm text-slate-600">{m.description}</div>}
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Step 3 — add metrics */}
          <div className="rounded-md border border-slate-200 p-4 space-y-4">
            <label className="block text-sm font-medium text-slate-700">3 · Add metrics</label>

            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-600">Add existing metrics (search)</div>
              <MetricSearchSelect
                selected={selectedExisting}
                onChange={setSelectedExisting}
                excludeIds={currentMetrics.map((m) => m.id)}
                excludeHint="already on this problem"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-slate-600">Create new metrics</div>
                <Button type="button" variant="outline" size="sm" onClick={addNewRow}>
                  <Plus className="h-4 w-4 mr-1" /> Add metric
                </Button>
              </div>
              {newMetrics.length > 0 && (
                <div className="space-y-3">
                  {newMetrics.map((m, i) => {
                    const rowErr = (formErrors.newMetrics && formErrors.newMetrics[i]) || {}
                    return (
                      <div key={i} className="p-3 border border-slate-200 rounded-md bg-slate-50 space-y-2">
                        <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr_auto_auto_auto] gap-2 items-start">
                          <div>
                            <Input
                              placeholder="Title (e.g. Clarity)"
                              value={m.title}
                              onChange={(e) => updateNewRow(i, 'title', e.target.value)}
                            />
                            {rowErr.title && <p className="text-xs text-red-600 mt-1">{rowErr.title}</p>}
                          </div>
                          <div>
                            <Input
                              placeholder="Description"
                              value={m.description}
                              onChange={(e) => updateNewRow(i, 'description', e.target.value)}
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
                              onChange={(e) => updateNewRow(i, 'min_marks', e.target.value)}
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
                              onChange={(e) => updateNewRow(i, 'max_marks', e.target.value)}
                              className="w-20"
                            />
                            {rowErr.max_marks && <p className="text-xs text-red-600 mt-1">{rowErr.max_marks}</p>}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeNewRow(i)}
                            aria-label="Remove metric"
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Review before submitting */}
          {selectedProblem && (
            <PreviewPanel>
              <PreviewRow label="Problem">
                {selectedProblem.label} <span className="text-slate-400">· ID {selectedProblem.id}</span>
              </PreviewRow>
              <PreviewRow label="Remove metrics">
                {removeCount > 0
                  ? currentMetrics
                      .filter((m) => removeSelected.has(m.id))
                      .map((m) => `${m.name || `Metric ${m.id}`} (${m.id})`)
                      .join(', ')
                  : <span className="text-slate-400">none</span>}
              </PreviewRow>
              <PreviewRow label="Add existing metrics">
                {selectedExisting.length > 0
                  ? selectedExisting.map((m) => `${m.name || `Metric ${m.id}`} (${m.id})`).join(', ')
                  : <span className="text-slate-400">none</span>}
              </PreviewRow>
              <PreviewRow label="Create new metrics">
                {filledNewMetrics.length > 0
                  ? filledNewMetrics.map((m) => m.title.trim() || '(untitled)').join(', ')
                  : <span className="text-slate-400">none</span>}
              </PreviewRow>
            </PreviewPanel>
          )}

          {/* Impact + reevaluation warning (any metric change) */}
          {hasChanges && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-4 space-y-2">
              <div className="flex items-start gap-2 text-sm text-amber-900">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  {affectedLoading ? (
                    'Checking how many responses this affects…'
                  ) : affectedCount != null ? (
                    <>
                      This problem has <strong>{affectedCount}</strong> existing candidate response
                      {affectedCount === 1 ? '' : 's'}. Changing its metrics will affect{' '}
                      {affectedCount === 1 ? 'it' : 'them all'}.
                    </>
                  ) : (
                    'Changing this problem’s metrics will affect its existing responses.'
                  )}
                </div>
              </div>

              {removeCount > 0 && (
                <div className="flex items-start gap-2 text-sm text-red-800">
                  <Trash2 className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    Removing {removeCount} metric{removeCount === 1 ? '' : 's'} permanently deletes
                    their evaluation responses. This cannot be undone.
                  </div>
                </div>
              )}

              <div className="text-sm font-medium text-amber-900">
                ⚠ You must reevaluate this problem after updating (Reevaluate tab), or its scoring
                will break.
              </div>

              <label className="flex items-center gap-2 text-sm text-amber-900">
                <input
                  type="checkbox"
                  checked={confirmChecked}
                  onChange={(e) => {
                    setConfirmChecked(e.target.checked)
                    setFormErrors((f) => ({ ...f, confirm: undefined }))
                  }}
                />
                I understand — continue anyway and reevaluate this problem afterwards.
              </label>
              {formErrors.confirm && <p className="text-sm text-red-600">{formErrors.confirm}</p>}
            </div>
          )}

          {formErrors.action && <p className="text-sm text-red-600">{formErrors.action}</p>}
          {submitError && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Starting...
                </>
              ) : (
                'Update business case'
              )}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}

export default BusinessCaseUpdatePage
