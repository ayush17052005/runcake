// Metabase API client.
//
// Auth: API key via the `x-api-key` header (Metabase 0.49+).
// Queries: saved questions (cards) run with parameters through
//   POST /api/card/:id/query  → { data: { rows: [[...]], cols: [{name}] } }
// which we flatten into an array of row objects. (The /query/json export
// endpoint ignores JSON-body parameters, so we don't use it.)
// Config comes from env vars (see config.metabase / backend/.env.example).

const fetch = require('node-fetch')
const config = require('../../config')

class MetabaseService {
  constructor() {
    this.url = (config.metabase.url || '').replace(/\/+$/, '')
    this.apiKey = config.metabase.apiKey || ''
  }

  isConfigured() {
    return Boolean(this.url && this.apiKey)
  }

  // Run a saved card and return its rows as an array of objects. `parameters`
  // is the Metabase parameter array (see runCardBySlug, which builds it).
  async runCard(cardId, parameters = []) {
    if (!this.isConfigured()) {
      throw new Error('Metabase is not configured. Set METABASE_URL and METABASE_API_KEY.')
    }
    if (!cardId) {
      throw new Error('No Metabase card id provided.')
    }

    let response
    try {
      response = await fetch(`${this.url}/api/card/${cardId}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({ parameters }),
      })
    } catch (e) {
      throw new Error(`Could not reach Metabase at ${this.url}: ${e.message}`)
    }

    const body = await response.text()
    if (!response.ok) {
      throw new Error(`Metabase card ${cardId} query failed (HTTP ${response.status}): ${body.slice(0, 300)}`)
    }

    let payload
    try {
      payload = JSON.parse(body)
    } catch {
      throw new Error('Metabase returned a non-JSON response.')
    }
    if (payload.status === 'failed' || payload.error) {
      const msg =
        payload.error || (payload.via && payload.via[0] && payload.via[0].error) || 'query failed'
      throw new Error(`Metabase card ${cardId} query failed: ${String(msg).slice(0, 300)}`)
    }

    const data = payload.data || {}
    const cols = Array.isArray(data.cols) ? data.cols.map((col) => col.name || col.display_name) : []
    const rows = Array.isArray(data.rows) ? data.rows : []
    return rows.map((row) => {
      const obj = {}
      cols.forEach((name, i) => {
        obj[name] = row[i]
      })
      return obj
    })
  }

  // Validate connectivity + API key by fetching the current user. Throws with a
  // clear message on failure so the health endpoint can surface it.
  async ping() {
    if (!this.isConfigured()) {
      return { configured: false, ok: false }
    }
    let response
    try {
      response = await fetch(`${this.url}/api/user/current`, {
        headers: { 'x-api-key': this.apiKey },
      })
    } catch (e) {
      throw new Error(`Could not reach Metabase at ${this.url}: ${e.message}`)
    }
    const body = await response.text()
    if (!response.ok) {
      throw new Error(`Metabase auth check failed (HTTP ${response.status}): ${body.slice(0, 200)}`)
    }
    let user = null
    try {
      user = JSON.parse(body)
    } catch {
      /* ignore */
    }
    return {
      configured: true,
      ok: true,
      user: user ? user.email || user.common_name || null : null,
    }
  }

  // Fetch (and cache) a card's parameter definitions. Metabase matches
  // parameters supplied to /query by their `id`, so we reuse the card's own
  // parameter objects (correct id/type/target) rather than guessing.
  async getCardParameters(cardId) {
    if (!this._cardParams) this._cardParams = {}
    if (this._cardParams[cardId]) return this._cardParams[cardId]

    let response
    try {
      response = await fetch(`${this.url}/api/card/${cardId}`, {
        headers: { 'x-api-key': this.apiKey },
      })
    } catch (e) {
      throw new Error(`Could not reach Metabase at ${this.url}: ${e.message}`)
    }
    const body = await response.text()
    if (!response.ok) {
      throw new Error(`Could not load Metabase card ${cardId} (HTTP ${response.status}): ${body.slice(0, 200)}`)
    }
    let card
    try {
      card = JSON.parse(body)
    } catch {
      throw new Error('Metabase returned a non-JSON card definition.')
    }
    const params = Array.isArray(card.parameters) ? card.parameters : []
    this._cardParams[cardId] = params
    return params
  }

  // Run a card, supplying values by template-tag slug. Reuses each matching
  // card parameter's own definition and just sets the value.
  async runCardBySlug(cardId, slugValues) {
    if (!cardId) throw new Error('No Metabase card id provided.')
    const cardParams = await this.getCardParameters(cardId)
    const parameters = Object.entries(slugValues).map(([slug, value]) => {
      const def = cardParams.find(
        (p) =>
          p.slug === slug ||
          (Array.isArray(p.target) && Array.isArray(p.target[1]) && p.target[1][1] === slug)
      )
      if (!def) {
        throw new Error(`Metabase card ${cardId} has no parameter matching slug "${slug}".`)
      }
      // Send a target-only parameter: the /query endpoint matches by target and
      // rejects the card's display `name` ("Search") as a template-tag name.
      return { type: def.type, target: def.target, value }
    })
    return this.runCard(cardId, parameters)
  }

  // --- Row normalization helpers -------------------------------------------
  // Cards are authored by hand, so column names vary. Pull fields defensively.
  _pickKey(row, candidates, contains) {
    const keys = Object.keys(row || {})
    for (const c of candidates) {
      const hit = keys.find((k) => k.toLowerCase() === c)
      if (hit) return hit
    }
    if (contains) {
      const hit = keys.find((k) => k.toLowerCase().includes(contains))
      if (hit) return hit
    }
    return null
  }

  _idOf(row) {
    const key = this._pickKey(row, ['id', 'metric_id', 'evaluation_metric_id', 'problem_id'], 'id')
    const v = key ? Number(row[key]) : NaN
    return Number.isInteger(v) ? v : null
  }

  _normalizeMetricRow(row) {
    const nameKey = this._pickKey(row, ['name', 'title'], 'name')
    const descKey = this._pickKey(row, ['description', 'desc'], 'desc')
    const minKey = this._pickKey(row, ['min_score', 'min_marks', 'min'], 'min')
    const maxKey = this._pickKey(row, ['max_score', 'max_marks', 'max'], 'max')
    return {
      id: this._idOf(row),
      name: nameKey ? row[nameKey] : null,
      description: descKey ? row[descKey] : null,
      min_score: minKey != null ? row[minKey] : null,
      max_score: maxKey != null ? row[maxKey] : null,
    }
  }

  // --- Feature queries ------------------------------------------------------

  // Search problems by name/title. Returns [{ id, label }].
  async searchProblems(query) {
    const cardId = config.metabase.problemSearchCardId
    if (!cardId) throw new Error('METABASE_PROBLEM_SEARCH_CARD_ID is not set.')
    const rows = await this.runCardBySlug(cardId, { [config.metabase.problemSearchParam]: String(query) })
    return rows
      .map((row) => {
        if (!row || typeof row !== 'object') return null
        const labelKey = this._pickKey(row, ['title', 'name', 'problem_statement', 'statement'], 'title')
        const id = this._idOf(row)
        const label = labelKey ? row[labelKey] : null
        return id ? { id, label: label != null ? String(label) : `Problem ${id}` } : null
      })
      .filter(Boolean)
  }

  // Current evaluation-metric associations of a problem. Returns metric rows.
  async getProblemMetrics(problemId) {
    const cardId = config.metabase.problemMetricsCardId
    if (!cardId) throw new Error('METABASE_PROBLEM_METRICS_CARD_ID is not set.')
    const rows = await this.runCardBySlug(cardId, { [config.metabase.problemMetricsParam]: Number(problemId) })
    return rows.map((r) => this._normalizeMetricRow(r)).filter((m) => m.id)
  }

  // Search evaluation metrics by name. Returns metric rows.
  async searchMetrics(query) {
    const cardId = config.metabase.metricSearchCardId
    if (!cardId) throw new Error('METABASE_METRIC_SEARCH_CARD_ID is not set.')
    const rows = await this.runCardBySlug(cardId, { [config.metabase.metricSearchParam]: String(query) })
    return rows.map((r) => this._normalizeMetricRow(r)).filter((m) => m.id)
  }

  // Candidate emails for a problem — the population the Reevaluate tab targets.
  async getCandidateEmails(problemId) {
    const cardId = config.metabase.candidateEmailsCardId
    if (!cardId) {
      throw new Error('METABASE_CANDIDATE_EMAILS_CARD_ID is not set.')
    }
    const rows = await this.runCardBySlug(cardId, { [config.metabase.candidateEmailsParam]: Number(problemId) })

    // Pull the email column regardless of its exact casing/name.
    const emails = rows
      .map((row) => {
        if (!row || typeof row !== 'object') return null
        const key =
          Object.keys(row).find((k) => k.toLowerCase().includes('email')) || Object.keys(row)[0]
        return key ? row[key] : null
      })
      .filter((v) => typeof v === 'string' && v.trim())
      .map((v) => v.trim())

    return Array.from(new Set(emails))
  }
}

module.exports = new MetabaseService()
