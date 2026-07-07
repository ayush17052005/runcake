import React, { useState, useEffect, useMemo } from 'react'
import { businessCaseCreatorAPI, targetGroupsAPI } from '../lib/api'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import ProblemSearchSelect from '../components/ProblemSearchSelect'
import PreviewPanel, { PreviewRow } from '../components/PreviewPanel'
import { CheckCircle, Loader2, AlertCircle, Info } from 'lucide-react'

const BATCH_SIZE = 200
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
    if (!EMAIL_RE.test(t)) invalid.push(t)
    else if (!seen.has(t)) {
      seen.add(t)
      emails.push(t)
    }
  }
  return { emails, invalid }
}

const BusinessCaseReevaluatePage = () => {
  const [selectedProblem, setSelectedProblem] = useState(null)
  const [targetGroups, setTargetGroups] = useState([])
  const [targetGroupId, setTargetGroupId] = useState('')
  const [emailsInput, setEmailsInput] = useState('')

  // "Fetch emails for problem" (Metabase)
  const [fetchLoading, setFetchLoading] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [fetchInfo, setFetchInfo] = useState(null)

  const [formErrors, setFormErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [result, setResult] = useState(null)

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
    }
  }, [])

  const { emails, invalid } = useMemo(() => parseEmails(emailsInput), [emailsInput])
  const batchCount = Math.max(1, Math.ceil(emails.length / BATCH_SIZE))

  const handleFetchEmails = async () => {
    setFetchError(null)
    setFetchInfo(null)
    if (!selectedProblem) {
      setFetchError('Search and select a problem first')
      return
    }
    setFetchLoading(true)
    try {
      const resp = await businessCaseCreatorAPI.fetchCandidateEmails({ problem_id: selectedProblem.id })
      if (!resp?.success) {
        setFetchError(resp?.message || 'Failed to fetch emails')
        return
      }
      const all = resp.data?.emails || []
      setEmailsInput(all.join('\n'))
      setFormErrors((p) => ({ ...p, emails: undefined }))
      setFetchInfo(
        all.length === 0
          ? 'No candidate emails found for this problem'
          : `Loaded ${all.length} candidate email${all.length === 1 ? '' : 's'} from Metabase`
      )
    } catch (e) {
      setFetchError(e.message || 'Failed to fetch emails')
    } finally {
      setFetchLoading(false)
    }
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    const errors = {}

    if (!selectedProblem) errors.problem = 'Search and select a problem'
    if (!targetGroupId) errors.targetGroupId = 'Select a target group'
    if (invalid.length > 0) {
      errors.emails = `Invalid email${invalid.length === 1 ? '' : 's'}: ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? '…' : ''}`
    } else if (emails.length === 0) {
      errors.emails = 'Enter at least one candidate email'
    }

    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      const resp = await businessCaseCreatorAPI.reevaluate({
        problem_id: selectedProblem.id,
        target_group_id: Number(targetGroupId),
        emails,
      })
      if (!resp?.success) {
        setSubmitError(resp?.message || 'Failed to start')
        return
      }
      // Fire-and-forget — no polling. Reevaluations run as background jobs.
      setResult({
        problemLabel: selectedProblem.label,
        problemId: selectedProblem.id,
        count: resp.data?.emailCount ?? emails.length,
      })
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
    setFetchError(null)
    setFetchInfo(null)
    setFetchLoading(false)
    setFormErrors({})
    setSubmitError(null)
    setResult(null)
  }

  const showForm = !result

  return (
    <div className="py-8 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Reevaluate Responses</h1>
        <p className="text-slate-600 mt-1">
          Queue the SmartJudge AI reevaluation for a problem's candidate responses. Emails are split
          across all instances in the target group and enqueued as background jobs — scores update
          as they run. Large lists are auto-batched in groups of {BATCH_SIZE}.
        </p>
      </div>

      {result && (
        <Card className="p-6 space-y-3 border-green-200 bg-green-50">
          <div className="flex items-center gap-2 text-green-900">
            <CheckCircle className="h-5 w-5" />
            <h3 className="text-lg font-semibold">Reevaluation submitted</h3>
          </div>
          <div className="text-sm text-green-900 space-y-1">
            <div>Problem: <strong>{result.problemLabel}</strong> (ID {result.problemId})</div>
            <div>Responses queued: <strong>{result.count}</strong></div>
          </div>
          <p className="text-sm text-green-900">
            The emails were split across all instances in the target group (in batches of {BATCH_SIZE})
            and dispatched to run in the background — this can take a while, and scores update as each
            job completes. You can safely leave this page.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleReset}>Reevaluate another</Button>
            <a href="/audit-log" className="inline-flex">
              <Button variant="ghost">View audit log</Button>
            </a>
          </div>
        </Card>
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
                title="Fetch emails of users with responses for this problem"
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
            {fetchInfo && !fetchError && <p className="mb-2 text-xs text-green-700">{fetchInfo}</p>}
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
            {formErrors.emails ? (
              <p className="text-sm text-red-600 mt-1">{formErrors.emails}</p>
            ) : (
              <p className="text-xs mt-1 text-slate-500">
                Comma-, space- or newline-separated.{' '}
                <span className="text-slate-700">
                  {emails.length} email{emails.length === 1 ? '' : 's'}
                  {emails.length > BATCH_SIZE && ` · ${batchCount} batches of ${BATCH_SIZE}`}
                </span>
                {invalid.length > 0 && <span className="text-red-600"> · {invalid.length} invalid</span>}
              </p>
            )}
            <div className="mt-2 flex items-start gap-2 text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-md p-2">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Use “Fetch emails for problem” to pull the candidate list from Metabase. Any number is
                accepted — lists over {BATCH_SIZE} are auto-batched and fanned out across the instances.
              </span>
            </div>
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
                {emails.length > BATCH_SIZE && ` · ${batchCount} batches of ${BATCH_SIZE}`}
                {invalid.length > 0 && <span className="text-red-600"> · {invalid.length} invalid</span>}
              </PreviewRow>
              <PreviewRow label="Action">
                Splits the emails across all instances in the target group and enqueues a background
                SmartJudge reevaluation per email; scores update as jobs run.
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
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Submitting...
                </>
              ) : (
                'Reevaluate responses'
              )}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}

export default BusinessCaseReevaluatePage
