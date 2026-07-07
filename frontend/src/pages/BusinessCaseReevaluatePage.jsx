import React, { useState, useEffect, useMemo, useRef } from 'react'
import { businessCaseCreatorAPI, targetGroupsAPI } from '../lib/api'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import ProblemSearchSelect from '../components/ProblemSearchSelect'
import PreviewPanel, { PreviewRow } from '../components/PreviewPanel'
import { CheckCircle, Loader2, AlertCircle, ChevronDown, ChevronUp, Info } from 'lucide-react'

const EMAIL_RE = /^[^\s@<>[\]"']+@[^\s@<>[\]"']+\.[^\s@<>[\]"']+$/

// Parse a comma/space/newline-separated blob of emails into { emails, invalid }.
const parseEmails = (raw) => {
  const tokens = String(raw || '')
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  const emails = []
  const invalid = []
  const seen = new Set()
  for (const t of tokens) {
    if (!EMAIL_RE.test(t)) {
      invalid.push(t)
    } else if (!seen.has(t)) {
      seen.add(t)
      emails.push(t)
    }
  }
  return { emails, invalid }
}

const ProgressPanel = ({ status, errorMessage }) => (
  <Card className="p-6 space-y-3">
    <div className="flex items-center gap-3">
      <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Reevaluating on EC2 via SSM</h3>
        <p className="text-sm text-slate-600">
          Status: <strong>{status}</strong>. Reevaluation runs the AI judge per response — this can
          take several minutes. Don't close the tab.
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

const BusinessCaseReevaluatePage = () => {
  const [selectedProblem, setSelectedProblem] = useState(null)
  const [targetGroups, setTargetGroups] = useState([])
  const [targetGroupId, setTargetGroupId] = useState('')
  const [emailsInput, setEmailsInput] = useState('')
  const [chunkSize, setChunkSize] = useState(5)

  // "Fetch emails for problem" (runs the candidate-emails SQL on Rails).
  const [fetchLoading, setFetchLoading] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [fetchInfo, setFetchInfo] = useState(null)

  const [formErrors, setFormErrors] = useState({})
  const [execution, setExecution] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [result, setResult] = useState(null)
  const [outputOpen, setOutputOpen] = useState(false)

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

  const { emails, invalid } = useMemo(() => parseEmails(emailsInput), [emailsInput])

  // Fetch candidate emails for the problem from Metabase and drop them into the
  // textarea. Only needs a problem id — the query runs against Metabase, not Rails.
  const handleFetchEmails = async () => {
    setFetchError(null)
    setFetchInfo(null)
    if (!selectedProblem) {
      setFetchError('Search and select a problem first')
      return
    }

    setFetchLoading(true)
    try {
      const resp = await businessCaseCreatorAPI.fetchCandidateEmails({
        problem_id: selectedProblem.id,
      })
      if (!resp?.success) {
        setFetchError(resp?.message || 'Failed to fetch emails')
        return
      }
      const fetched = resp.data?.emails || []
      setEmailsInput(fetched.join('\n'))
      setFormErrors((p) => ({ ...p, emails: undefined }))
      setFetchInfo(
        fetched.length > 0
          ? `Loaded ${fetched.length} candidate email${fetched.length === 1 ? '' : 's'} from Metabase`
          : 'No candidate emails found for this problem'
      )
    } catch (e) {
      setFetchError(e.message || 'Failed to fetch emails')
    } finally {
      setFetchLoading(false)
    }
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
          const parsed = resp.data.parsed
          if (resp.data.status === 'success' && parsed && parsed.status === 'success') {
            setResult({
              problemId: parsed.problem_id,
              total: parsed.total ?? 0,
              okCount: parsed.ok_count ?? 0,
              errorCount: parsed.error_count ?? 0,
              output: resp.data.output || '',
            })
            setExecution(null)
          } else {
            setSubmitError(resp.data.errorMessage || parsed?.message || 'Reevaluation failed')
          }
        }
      } catch (e) {
        console.error('Polling error:', e)
      }
    }
    poll()
    pollRef.current = setInterval(poll, 3000)
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    const errors = {}

    if (!selectedProblem) {
      errors.problem = 'Search and select a problem'
    }
    if (!targetGroupId) {
      errors.targetGroupId = 'Select a target group'
    }
    if (invalid.length > 0) {
      errors.emails = `Invalid email${invalid.length === 1 ? '' : 's'}: ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? '…' : ''}`
    } else if (emails.length === 0) {
      errors.emails = 'Enter at least one candidate email'
    }
    const cs = Number(chunkSize)
    if (!Number.isInteger(cs) || cs <= 0) {
      errors.chunkSize = 'Must be a positive integer'
    }

    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      const resp = await businessCaseCreatorAPI.reevaluate({
        problem_id: selectedProblem.id,
        target_group_id: Number(targetGroupId),
        emails,
        chunk_size: cs,
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
    setSelectedProblem(null)
    setTargetGroupId('')
    setEmailsInput('')
    setChunkSize(5)
    setFetchError(null)
    setFetchInfo(null)
    setFetchLoading(false)
    setFormErrors({})
    setExecution(null)
    setSubmitError(null)
    setResult(null)
    setOutputOpen(false)
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const showForm = !execution && !result

  return (
    <div className="py-8 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Reevaluate Responses</h1>
        <p className="text-slate-600 mt-1">
          Re-run the SmartJudge AI evaluation for every candidate response of a business-case
          problem. Emails are processed in batches on a randomly-picked Rails instance; scores are
          recomputed per response.
        </p>
      </div>

      {result && (
        <Card className="p-6 space-y-3 border-green-200 bg-green-50">
          <div className="flex items-center gap-2 text-green-900">
            <CheckCircle className="h-5 w-5" />
            <h3 className="text-lg font-semibold">Reevaluation complete</h3>
          </div>
          <div className="text-sm text-green-900 space-y-1">
            <div>Problem ID: <strong>{result.problemId}</strong></div>
            <div>Total processed: <strong>{result.total}</strong></div>
            <div>Succeeded: <strong>{result.okCount}</strong></div>
            <div>Failed: <strong>{result.errorCount}</strong></div>
          </div>
          {result.output && (
            <div>
              <button
                type="button"
                onClick={() => setOutputOpen((v) => !v)}
                className="flex items-center gap-1 text-sm text-green-800 hover:text-green-950"
              >
                {outputOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                Per-email details
              </button>
              {outputOpen && (
                <pre className="mt-2 bg-white border border-green-200 rounded p-2 text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto">
                  {result.output}
                </pre>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleReset}>Reevaluate another</Button>
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
                setFormErrors((f) => ({ ...f, problem: undefined }))
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
                setFormErrors((p) => ({ ...p, targetGroupId: undefined }))
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
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-slate-700">Candidate emails</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFetchEmails}
                disabled={fetchLoading || !selectedProblem}
                title="Fetch emails of users with evaluation responses for this problem"
              >
                {fetchLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Fetching…
                  </>
                ) : (
                  'Fetch emails for problem'
                )}
              </Button>
            </div>
            {fetchError && (
              <div className="mb-2 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{fetchError}</span>
              </div>
            )}
            {fetchInfo && !fetchError && (
              <p className="mb-2 text-xs text-green-700">{fetchInfo}</p>
            )}
            <textarea
              value={emailsInput}
              onChange={(e) => {
                setEmailsInput(e.target.value)
                setFormErrors((p) => ({ ...p, emails: undefined }))
              }}
              placeholder={'jane@example.com, john@example.com\nor one per line'}
              rows={6}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex items-center justify-between mt-1">
              {formErrors.emails ? (
                <p className="text-sm text-red-600">{formErrors.emails}</p>
              ) : (
                <p className="text-xs text-slate-500">
                  Comma-, space- or newline-separated.{' '}
                  {emails.length > 0 && (
                    <span className="text-slate-700">{emails.length} valid email{emails.length === 1 ? '' : 's'}</span>
                  )}
                  {invalid.length > 0 && (
                    <span className="text-red-600"> · {invalid.length} invalid</span>
                  )}
                </p>
              )}
            </div>
            <div className="mt-2 flex items-start gap-2 text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-md p-2">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Interim input — this list will be auto-populated from Metabase (users with evaluation
                responses for the problem) once that integration lands.
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Batch size</label>
            <Input
              type="number"
              value={chunkSize}
              onChange={(e) => {
                setChunkSize(e.target.value)
                setFormErrors((p) => ({ ...p, chunkSize: undefined }))
              }}
              min="1"
              className="w-28"
            />
            {formErrors.chunkSize ? (
              <p className="text-sm text-red-600 mt-1">{formErrors.chunkSize}</p>
            ) : (
              <p className="text-xs text-slate-500 mt-1">
                How many emails to log per batch (default 5). All emails are processed in one run.
              </p>
            )}
          </div>

          {(selectedProblem || emails.length > 0) && (
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
              <PreviewRow label="Responses to reevaluate">
                {emails.length} candidate email{emails.length === 1 ? '' : 's'}
                {invalid.length > 0 && <span className="text-red-600"> · {invalid.length} invalid (fix before submit)</span>}
              </PreviewRow>
              <PreviewRow label="Batch size">{chunkSize}</PreviewRow>
              <PreviewRow label="Action">
                Re-runs the SmartJudge AI evaluation for every email and recomputes scores.
              </PreviewRow>
            </PreviewPanel>
          )}

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
                'Reevaluate all responses'
              )}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}

export default BusinessCaseReevaluatePage
