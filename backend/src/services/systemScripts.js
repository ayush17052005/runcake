const { db } = require('../database/db')

// Two system-owned rows in the `scripts` table exist purely as FK targets
// for `script_executions.script_id` when the Business Case Creator writes
// audit rows. The actual Ruby logic for this feature lives in
// `backend/src/services/businessCaseScripts.js` (not in these rows).
//
// The rows are hidden from the normal Scripts list and guarded against
// edit/delete via the `__system__` name prefix in backend/src/routes/scripts.js.

const SYSTEM_SCRIPT_NAMES = {
  METRICS: '__system__create_evaluation_metrics',
  BUSINESS_CASE: '__system__business_case_creation',
}

const SYSTEM_PREFIX = '__system__'

const PLACEHOLDER_SCRIPT_CONTENT =
  '# System-owned script. Logic lives in backend/src/services/businessCaseScripts.js.\n' +
  '# This row exists only as an audit-log FK target and is never executed directly.\n'

let cached = null

const getSeederUserId = () => {
  const admin = db.prepare(
    "SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1"
  ).get()
  if (admin) return admin.id
  const anyUser = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get()
  return anyUser ? anyUser.id : null
}

const getRailsRunnerId = () => {
  const rails = db.prepare("SELECT id FROM runners WHERE name = 'rails'").get()
  if (rails) return rails.id
  const any = db.prepare('SELECT id FROM runners ORDER BY id ASC LIMIT 1').get()
  return any ? any.id : null
}

const ensureScript = (name, creatorId, runnerId) => {
  const existing = db.prepare('SELECT id FROM scripts WHERE name = ?').get(name)
  if (existing) return existing.id
  const result = db.prepare(`
    INSERT INTO scripts (name, description, content, tags, runner_id, permission_level, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    'System-owned script for the Business Case Creator feature. Do not edit via UI.',
    PLACEHOLDER_SCRIPT_CONTENT,
    JSON.stringify(['system', 'business-case-creator']),
    runnerId,
    'admin_only',
    creatorId
  )
  return result.lastInsertRowid
}

// Idempotent bootstrap. Safe to call before workspace setup — returns null
// until at least one user exists; the route-level middleware retries lazily.
const ensureSystemScripts = () => {
  const creatorId = getSeederUserId()
  if (!creatorId) {
    cached = null
    return null
  }
  const runnerId = getRailsRunnerId()
  cached = {
    metricsScriptId: ensureScript(SYSTEM_SCRIPT_NAMES.METRICS, creatorId, runnerId),
    caseScriptId: ensureScript(SYSTEM_SCRIPT_NAMES.BUSINESS_CASE, creatorId, runnerId),
  }
  return cached
}

const getSystemScriptIds = () => cached || ensureSystemScripts()

const isSystemName = (name) =>
  typeof name === 'string' && name.startsWith(SYSTEM_PREFIX)

// Map internal __system__ script names → user-facing display names in the audit log.
const SYSTEM_DISPLAY_NAMES = {
  [SYSTEM_SCRIPT_NAMES.METRICS]: 'Business case metrics creation',
  [SYSTEM_SCRIPT_NAMES.BUSINESS_CASE]: 'Business case creation',
}

const toDisplayName = (name) => {
  if (!isSystemName(name)) return name
  return SYSTEM_DISPLAY_NAMES[name] || name
}

module.exports = {
  SYSTEM_SCRIPT_NAMES,
  SYSTEM_PREFIX,
  ensureSystemScripts,
  getSystemScriptIds,
  isSystemName,
  toDisplayName,
  // back-compat for scripts.js import
  isSystemScriptName: isSystemName,
}
