const express = require('express')
const { db } = require('../database/db')
const { authenticateToken } = require('../middleware/auth')
const AWSService = require('../services/awsService')
const {
  renderCombinedScript,
  renderAssociateExistingScript,
  renderPreviewMetricsScript,
  renderUpdateBusinessCaseScript,
  renderReevaluateResponsesScript,
  parseCombinedResult,
  parsePreviewResult,
  validateMetric,
} = require('../services/businessCaseScripts')
const {
  getSystemScriptIds,
  ensureSystemScripts,
} = require('../services/systemScripts')
const metabaseService = require('../services/metabaseService')
const config = require('../../config')

const router = express.Router()

// Lazy seed: ensure __system__ script row exists so the audit FK is always valid.
router.use((_req, _res, next) => {
  ensureSystemScripts()
  next()
})

// --- validation -------------------------------------------------------------

// Business Case Creator always runs on a single random instance — metric
// creation + problem mutation is not idempotent across instances, so running
// on "all" would double-create rows. Mode is fixed to 'random'.
const EXECUTION_MODE = 'random'

// Coerce + dedupe + sort an array of metric ids. Returns null if anything is
// not a positive integer, so the caller can surface a clear validation error.
const sanitizeMetricIds = (raw) => {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out = []
  for (const v of raw) {
    const n = Number(v)
    if (!Number.isInteger(n) || n <= 0) return null
    out.push(n)
  }
  return Array.from(new Set(out)).sort((a, b) => a - b)
}

// Dedupe + validate a list of emails. Returns null if empty or any entry isn't
// a plain email (no whitespace/brackets — they render inside a Ruby %w[] list).
const EMAIL_RE = /^[^\s@<>[\]"']+@[^\s@<>[\]"']+\.[^\s@<>[\]"']+$/
const sanitizeEmails = (raw) => {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out = []
  for (const v of raw) {
    const email = String(v || '').trim()
    if (!EMAIL_RE.test(email)) return null
    out.push(email)
  }
  return Array.from(new Set(out))
}

const validatePayload = (body) => {
  const errors = []
  const problemId = Number(body?.problem_id)
  if (!Number.isInteger(problemId) || problemId <= 0) {
    errors.push('problem_id: must be a positive integer')
  }

  const useAi = body?.use_ai
  if (typeof useAi !== 'boolean') {
    errors.push('use_ai: must be a boolean')
  }

  // Mode: 'create' (default — pass new metrics) or 'existing' (pass metric_ids
  // referring to existing EvaluationMetric rows). Fixed enum to keep the
  // contract narrow; default keeps existing clients working.
  const mode = body?.mode === 'existing' ? 'existing' : 'create'

  let metrics = null
  let metricIds = null
  if (mode === 'existing') {
    metricIds = sanitizeMetricIds(body?.metric_ids)
    if (!metricIds) {
      errors.push('metric_ids: must be a non-empty array of positive integers')
    }
  } else {
    metrics = body?.metrics
    if (!Array.isArray(metrics) || metrics.length === 0) {
      errors.push('metrics: must be a non-empty array')
    } else {
      metrics.forEach((m, i) => {
        errors.push(...validateMetric(m, i))
      })
    }
  }

  const targetGroupId = Number(body?.target_group_id)
  if (!Number.isInteger(targetGroupId) || targetGroupId <= 0) {
    errors.push('target_group_id: required')
  }

  return { errors, problemId, useAi, mode, metrics, metricIds, targetGroupId }
}

// --- SSM execution ----------------------------------------------------------

const SSM_POLL_INTERVAL_MS = 5000
const SSM_MAX_POLLS = 120 // ~10 minutes

// Fire-and-forget: sends combined Ruby to AWS SSM and polls until terminal.
// Updates the script_executions row so frontend polling sees progress.
const runSsmExecution = async ({ executionId, targetGroup, rubyContent }) => {
  try {
    db.prepare("UPDATE script_executions SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ?").run(executionId)

    const awsService = new AWSService({
      access_key_id: targetGroup.access_key_id,
      secret_access_key: targetGroup.secret_access_key,
      region: targetGroup.region,
    })

    const instancesResult = await awsService.getInstancesByTag(targetGroup.aws_tag_key, targetGroup.aws_tag_value)
    if (!instancesResult.success || instancesResult.instances.length === 0) {
      throw new Error(instancesResult.error || 'No running instances found for the target group')
    }
    const instanceIds = instancesResult.instances.map((i) => i.instanceId)

    const rails = db.prepare("SELECT id FROM runners WHERE name = 'rails'").get()
    const runnerId = rails?.id

    const commandResult = await awsService.executeCommand(instanceIds, rubyContent, EXECUTION_MODE, runnerId)
    if (!commandResult.success) throw new Error(commandResult.error || 'SSM SendCommand failed')

    db.prepare(`
      UPDATE script_executions
      SET instance_ids = ?, command_id = ?
      WHERE id = ?
    `).run(JSON.stringify(commandResult.instanceIds), commandResult.commandId, executionId)

    for (let attempt = 0; attempt < SSM_MAX_POLLS; attempt++) {
      await new Promise((r) => setTimeout(r, SSM_POLL_INTERVAL_MS))

      const statuses = await Promise.all(
        commandResult.instanceIds.map((id) => awsService.getCommandStatus(commandResult.commandId, id))
      )

      const anyInProgress = statuses.some((s) => s.status === 'InProgress' || s.status === 'Pending')
      if (anyInProgress) continue

      const anyFailed = statuses.some((s) => ['Failed', 'Cancelled', 'TimedOut'].includes(s.status))
      const combinedStdout = statuses.map((s) => s.standardOutputContent || '').join('\n')
      const combinedStderr = statuses.map((s) => s.standardErrorContent || '').join('\n')

      // Try both result markers — orchestrate emits BCC_RESULT_JSON, preview
      // emits BCC_PREVIEW_JSON. Either is a valid terminal signal.
      const parsed = parseCombinedResult(combinedStdout) || parsePreviewResult(combinedStdout)
      const scriptLevelFailure = parsed && parsed.status !== 'success'
      const finalStatus = scriptLevelFailure || anyFailed || !parsed ? 'failed' : 'success'

      const fullOutput = combinedStdout + (combinedStderr ? `\n=== STDERR ===\n${combinedStderr}` : '')
      const errorMessage =
        finalStatus === 'success'
          ? null
          : parsed?.message || (combinedStderr.trim() || 'SSM execution failed')

      db.prepare(`
        UPDATE script_executions
        SET status = ?, output = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(finalStatus, fullOutput, errorMessage, executionId)
      return
    }

    db.prepare(`
      UPDATE script_executions
      SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run('SSM polling timed out after ~10 minutes', executionId)
  } catch (err) {
    console.error('runSsmExecution error:', err)
    db.prepare(`
      UPDATE script_executions
      SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(err.message || 'Unknown SSM execution error', executionId)
  }
}

// --- endpoints --------------------------------------------------------------

// POST /api/business-case-creator/orchestrate
router.post('/orchestrate', authenticateToken, (req, res) => {
  const { errors, problemId, useAi, mode, metrics, metricIds, targetGroupId } = validatePayload(req.body)
  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors })
  }

  const targetGroup = db.prepare(`
    SELECT tg.*, ic.access_key_id, ic.secret_access_key, ic.region as credential_region
    FROM target_groups tg
    JOIN iam_credentials ic ON tg.iam_credential_id = ic.id
    WHERE tg.id = ?
  `).get(targetGroupId)
  if (!targetGroup) {
    return res.status(404).json({ success: false, message: 'Target group not found' })
  }

  let rubyContent
  try {
    rubyContent =
      mode === 'existing'
        ? renderAssociateExistingScript({ problemId, metricIds, useAi })
        : renderCombinedScript({ problemId, metrics, useAi })
  } catch (e) {
    return res.status(400).json({ success: false, message: `Failed to render Ruby: ${e.message}` })
  }

  const sys = getSystemScriptIds() || ensureSystemScripts()
  if (!sys) {
    return res.status(500).json({ success: false, message: 'System scripts not seeded yet. Try again.' })
  }

  const execResult = db.prepare(`
    INSERT INTO script_executions
      (script_id, target_group_id, execution_mode, template_variables, status, executed_by)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(
    sys.caseScriptId,
    targetGroupId,
    EXECUTION_MODE,
    JSON.stringify({
      rendered_ruby: rubyContent,
      problem_id: problemId,
      use_ai: useAi,
      mode,
      ...(mode === 'existing' ? { metric_ids: metricIds } : {}),
    }),
    req.user.id,
  )
  const executionId = execResult.lastInsertRowid

  runSsmExecution({
    executionId,
    targetGroup: {
      access_key_id: targetGroup.access_key_id,
      secret_access_key: targetGroup.secret_access_key,
      region: targetGroup.region || targetGroup.credential_region,
      aws_tag_key: targetGroup.aws_tag_key,
      aws_tag_value: targetGroup.aws_tag_value,
    },
    rubyContent,
  })

  return res.status(202).json({
    success: true,
    data: { executionId, status: 'pending' },
  })
})

// POST /api/business-case-creator/preview-metrics
// Async — returns { executionId, status: 'pending' }. Frontend polls
// GET /executions/:id and parses `parsed.preview` once status='success'.
router.post('/preview-metrics', authenticateToken, (req, res) => {
  const metricIds = sanitizeMetricIds(req.body?.metric_ids)
  if (!metricIds) {
    return res.status(400).json({
      success: false,
      message: 'metric_ids: must be a non-empty array of positive integers',
    })
  }
  const targetGroupId = Number(req.body?.target_group_id)
  if (!Number.isInteger(targetGroupId) || targetGroupId <= 0) {
    return res.status(400).json({ success: false, message: 'target_group_id: required' })
  }

  const targetGroup = db.prepare(`
    SELECT tg.*, ic.access_key_id, ic.secret_access_key, ic.region as credential_region
    FROM target_groups tg
    JOIN iam_credentials ic ON tg.iam_credential_id = ic.id
    WHERE tg.id = ?
  `).get(targetGroupId)
  if (!targetGroup) {
    return res.status(404).json({ success: false, message: 'Target group not found' })
  }

  let rubyContent
  try {
    rubyContent = renderPreviewMetricsScript({ metricIds })
  } catch (e) {
    return res.status(400).json({ success: false, message: `Failed to render Ruby: ${e.message}` })
  }

  const sys = getSystemScriptIds() || ensureSystemScripts()
  if (!sys) {
    return res.status(500).json({ success: false, message: 'System scripts not seeded yet. Try again.' })
  }

  const execResult = db.prepare(`
    INSERT INTO script_executions
      (script_id, target_group_id, execution_mode, template_variables, status, executed_by)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(
    sys.metricsScriptId,
    targetGroupId,
    EXECUTION_MODE,
    JSON.stringify({ rendered_ruby: rubyContent, metric_ids: metricIds, kind: 'preview_metrics' }),
    req.user.id,
  )
  const executionId = execResult.lastInsertRowid

  runSsmExecution({
    executionId,
    targetGroup: {
      access_key_id: targetGroup.access_key_id,
      secret_access_key: targetGroup.secret_access_key,
      region: targetGroup.region || targetGroup.credential_region,
      aws_tag_key: targetGroup.aws_tag_key,
      aws_tag_value: targetGroup.aws_tag_value,
    },
    rubyContent,
  })

  return res.status(202).json({
    success: true,
    data: { executionId, status: 'pending' },
  })
})

// POST /api/business-case-creator/update
// Atomic update — in a single transaction: removes the selected metric
// associations (+ their responses), then adds metrics — any mix of brand-new
// rows and existing ids — to the problem. Destructive: removing associations
// deletes their evaluation responses.
//   remove_metric_ids: OPTIONAL array — metrics to remove (empty removes none).
//   metrics:           OPTIONAL array — brand-new metrics to create.
//   metric_ids:        OPTIONAL array — existing metric ids to associate.
// At least one of the three must be non-empty.
// Async — returns { executionId }; frontend polls GET /executions/:id and reads
// parsed.removed_associations / parsed.removed_responses / parsed.added_metric_ids.
router.post('/update', authenticateToken, (req, res) => {
  const errors = []

  const problemId = Number(req.body?.problem_id)
  if (!Number.isInteger(problemId) || problemId <= 0) {
    errors.push('problem_id: must be a positive integer')
  }

  const targetGroupId = Number(req.body?.target_group_id)
  if (!Number.isInteger(targetGroupId) || targetGroupId <= 0) {
    errors.push('target_group_id: required')
  }

  // remove_metric_ids is optional. If supplied, every value must be a positive
  // integer. Empty/absent → remove nothing.
  let removeMetricIds = []
  const rawRemove = req.body?.remove_metric_ids
  if (Array.isArray(rawRemove) && rawRemove.length > 0) {
    const sanitized = sanitizeMetricIds(rawRemove)
    if (!sanitized) {
      errors.push('remove_metric_ids: must be positive integers')
    } else {
      removeMetricIds = sanitized
    }
  }

  // Add step — both are optional and can be combined:
  //   metrics: brand-new metrics to create.
  //   metric_ids: existing metric ids to associate (from search).
  let metrics = []
  const rawMetrics = req.body?.metrics
  if (Array.isArray(rawMetrics) && rawMetrics.length > 0) {
    rawMetrics.forEach((m, i) => errors.push(...validateMetric(m, i)))
    metrics = rawMetrics
  }

  let addMetricIds = []
  const rawAdd = req.body?.metric_ids
  if (Array.isArray(rawAdd) && rawAdd.length > 0) {
    const sanitized = sanitizeMetricIds(rawAdd)
    if (!sanitized) {
      errors.push('metric_ids: must be positive integers')
    } else {
      addMetricIds = sanitized
    }
  }

  // An update must do at least one thing.
  if (removeMetricIds.length === 0 && metrics.length === 0 && addMetricIds.length === 0) {
    errors.push('Nothing to update: select metrics to remove and/or add')
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors })
  }

  const targetGroup = db.prepare(`
    SELECT tg.*, ic.access_key_id, ic.secret_access_key, ic.region as credential_region
    FROM target_groups tg
    JOIN iam_credentials ic ON tg.iam_credential_id = ic.id
    WHERE tg.id = ?
  `).get(targetGroupId)
  if (!targetGroup) {
    return res.status(404).json({ success: false, message: 'Target group not found' })
  }

  let rubyContent
  try {
    rubyContent = renderUpdateBusinessCaseScript({
      problemId,
      removeMetricIds,
      metrics,
      addMetricIds,
    })
  } catch (e) {
    return res.status(400).json({ success: false, message: `Failed to render Ruby: ${e.message}` })
  }

  const sys = getSystemScriptIds() || ensureSystemScripts()
  if (!sys) {
    return res.status(500).json({ success: false, message: 'System scripts not seeded yet. Try again.' })
  }

  const execResult = db.prepare(`
    INSERT INTO script_executions
      (script_id, target_group_id, execution_mode, template_variables, status, executed_by)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(
    sys.updateScriptId,
    targetGroupId,
    EXECUTION_MODE,
    JSON.stringify({
      rendered_ruby: rubyContent,
      problem_id: problemId,
      remove_metric_ids: removeMetricIds,
      add_metric_ids: addMetricIds,
      new_metric_count: metrics.length,
      kind: 'update_business_case',
    }),
    req.user.id,
  )
  const executionId = execResult.lastInsertRowid

  runSsmExecution({
    executionId,
    targetGroup: {
      access_key_id: targetGroup.access_key_id,
      secret_access_key: targetGroup.secret_access_key,
      region: targetGroup.region || targetGroup.credential_region,
      aws_tag_key: targetGroup.aws_tag_key,
      aws_tag_value: targetGroup.aws_tag_value,
    },
    rubyContent,
  })

  return res.status(202).json({
    success: true,
    data: { executionId, status: 'pending' },
  })
})

// GET /api/business-case-creator/metabase/health
// Verifies Metabase connectivity + API key and reports which card ids are set.
router.get('/metabase/health', authenticateToken, async (req, res) => {
  try {
    const ping = await metabaseService.ping()
    return res.json({
      success: true,
      data: {
        ...ping,
        candidateEmailsCardId: config.metabase.candidateEmailsCardId,
        candidateEmailsParam: config.metabase.candidateEmailsParam,
      },
    })
  } catch (e) {
    return res.status(502).json({ success: false, message: e.message })
  }
})

// GET /api/business-case-creator/problems/search?q=...  (Metabase-backed)
router.get('/problems/search', authenticateToken, async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 1) {
    return res.json({ success: true, data: { results: [] } })
  }
  if (!metabaseService.isConfigured()) {
    return res.status(503).json({ success: false, message: 'Metabase is not configured.' })
  }
  try {
    const results = await metabaseService.searchProblems(q)
    return res.json({ success: true, data: { results } })
  } catch (e) {
    console.error('problems/search (metabase) error:', e)
    return res.status(502).json({ success: false, message: e.message || 'Metabase query failed' })
  }
})

// GET /api/business-case-creator/metrics/search?q=...  (Metabase-backed)
router.get('/metrics/search', authenticateToken, async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 1) {
    return res.json({ success: true, data: { results: [] } })
  }
  if (!metabaseService.isConfigured()) {
    return res.status(503).json({ success: false, message: 'Metabase is not configured.' })
  }
  try {
    const results = await metabaseService.searchMetrics(q)
    return res.json({ success: true, data: { results } })
  } catch (e) {
    console.error('metrics/search (metabase) error:', e)
    return res.status(502).json({ success: false, message: e.message || 'Metabase query failed' })
  }
})

// GET /api/business-case-creator/problems/:problemId/metrics  (Metabase-backed)
// Current evaluation-metric associations for the problem.
router.get('/problems/:problemId/metrics', authenticateToken, async (req, res) => {
  const problemId = Number(req.params.problemId)
  if (!Number.isInteger(problemId) || problemId <= 0) {
    return res.status(400).json({ success: false, message: 'problemId: must be a positive integer' })
  }
  if (!metabaseService.isConfigured()) {
    return res.status(503).json({ success: false, message: 'Metabase is not configured.' })
  }
  try {
    const metrics = await metabaseService.getProblemMetrics(problemId)
    return res.json({ success: true, data: { metrics } })
  } catch (e) {
    console.error('problems/:id/metrics (metabase) error:', e)
    return res.status(502).json({ success: false, message: e.message || 'Metabase query failed' })
  }
})

// POST /api/business-case-creator/candidate-emails
// Read-only helper for the Reevaluate tab. Fetches the distinct emails of every
// user with an evaluation response for the problem — via Metabase (a saved
// question), NOT the Rails instance. Synchronous: returns { emails, count }.
router.post('/candidate-emails', authenticateToken, async (req, res) => {
  const problemId = Number(req.body?.problem_id)
  if (!Number.isInteger(problemId) || problemId <= 0) {
    return res.status(400).json({ success: false, message: 'problem_id: must be a positive integer' })
  }

  if (!metabaseService.isConfigured()) {
    return res.status(503).json({
      success: false,
      message: 'Metabase is not configured. Set METABASE_URL and METABASE_API_KEY.',
    })
  }

  try {
    const emails = await metabaseService.getCandidateEmails(problemId)
    return res.json({ success: true, data: { emails, count: emails.length } })
  } catch (e) {
    console.error('candidate-emails (metabase) error:', e)
    return res.status(502).json({ success: false, message: e.message || 'Metabase query failed' })
  }
})

// POST /api/business-case-creator/reevaluate
// Re-runs the SmartJudge evaluation for a problem across all provided candidate
// emails, in one SSM run (chunked internally for logging). Async — returns
// { executionId }; frontend polls GET /executions/:id and reads
// parsed.total / parsed.ok_count / parsed.error_count once terminal.
router.post('/reevaluate', authenticateToken, (req, res) => {
  const problemId = Number(req.body?.problem_id)
  if (!Number.isInteger(problemId) || problemId <= 0) {
    return res.status(400).json({ success: false, message: 'problem_id: must be a positive integer' })
  }
  const targetGroupId = Number(req.body?.target_group_id)
  if (!Number.isInteger(targetGroupId) || targetGroupId <= 0) {
    return res.status(400).json({ success: false, message: 'target_group_id: required' })
  }

  const emails = sanitizeEmails(req.body?.emails)
  if (!emails) {
    return res.status(400).json({
      success: false,
      message: 'emails: must be a non-empty array of valid email addresses',
    })
  }

  // chunk_size is optional (default 5) — batches the emails for logging only.
  let chunkSize = 5
  if (req.body?.chunk_size != null) {
    const n = Number(req.body.chunk_size)
    if (!Number.isInteger(n) || n <= 0) {
      return res.status(400).json({ success: false, message: 'chunk_size: must be a positive integer' })
    }
    chunkSize = n
  }

  const targetGroup = db.prepare(`
    SELECT tg.*, ic.access_key_id, ic.secret_access_key, ic.region as credential_region
    FROM target_groups tg
    JOIN iam_credentials ic ON tg.iam_credential_id = ic.id
    WHERE tg.id = ?
  `).get(targetGroupId)
  if (!targetGroup) {
    return res.status(404).json({ success: false, message: 'Target group not found' })
  }

  let rubyContent
  try {
    rubyContent = renderReevaluateResponsesScript({ problemId, emails, chunkSize })
  } catch (e) {
    return res.status(400).json({ success: false, message: `Failed to render Ruby: ${e.message}` })
  }

  const sys = getSystemScriptIds() || ensureSystemScripts()
  if (!sys) {
    return res.status(500).json({ success: false, message: 'System scripts not seeded yet. Try again.' })
  }

  const execResult = db.prepare(`
    INSERT INTO script_executions
      (script_id, target_group_id, execution_mode, template_variables, status, executed_by)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(
    sys.reevaluateScriptId,
    targetGroupId,
    EXECUTION_MODE,
    JSON.stringify({
      rendered_ruby: rubyContent,
      problem_id: problemId,
      email_count: emails.length,
      chunk_size: chunkSize,
      kind: 'reevaluate_responses',
    }),
    req.user.id,
  )
  const executionId = execResult.lastInsertRowid

  runSsmExecution({
    executionId,
    targetGroup: {
      access_key_id: targetGroup.access_key_id,
      secret_access_key: targetGroup.secret_access_key,
      region: targetGroup.region || targetGroup.credential_region,
      aws_tag_key: targetGroup.aws_tag_key,
      aws_tag_value: targetGroup.aws_tag_value,
    },
    rubyContent,
  })

  return res.status(202).json({
    success: true,
    data: { executionId, status: 'pending' },
  })
})

// GET /api/business-case-creator/executions/:executionId — polled by frontend
router.get('/executions/:executionId', authenticateToken, (req, res) => {
  const row = db.prepare(`
    SELECT se.*, u.name as executed_by_name
    FROM script_executions se
    LEFT JOIN users u ON se.executed_by = u.id
    WHERE se.id = ?
  `).get(req.params.executionId)
  if (!row) {
    return res.status(404).json({ success: false, message: 'Execution not found' })
  }
  if (row.executed_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Permission denied' })
  }

  const isTerminal = ['success', 'failed', 'cancelled'].includes(row.status)
  // Surface whichever marker the script emitted. parsed.kind disambiguates:
  // 'orchestrate' = combined script result, 'preview' = metric preview.
  let parsed = null
  let parsedKind = null
  if (isTerminal && row.output) {
    const orchestrate = parseCombinedResult(row.output)
    if (orchestrate) {
      parsed = orchestrate
      parsedKind = 'orchestrate'
    } else {
      const preview = parsePreviewResult(row.output)
      if (preview) {
        parsed = preview
        parsedKind = 'preview'
      }
    }
  }

  return res.json({
    success: true,
    data: {
      executionId: row.id,
      status: row.status,
      isTerminal,
      output: row.output,
      errorMessage: row.error_message,
      completedAt: row.completed_at,
      parsed,
      parsedKind,
    },
  })
})

module.exports = router
