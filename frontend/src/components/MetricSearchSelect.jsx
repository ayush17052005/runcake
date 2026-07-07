import React, { useState, useEffect } from 'react'
import { businessCaseCreatorAPI } from '../lib/api'
import { Input } from './ui/input'
import { Search, Loader2, X, Check } from 'lucide-react'

// Metabase-backed metric picker. Search by name → add to a selected list.
//   selected:    array of { id, name, description }
//   onChange:    (nextArray) => void
//   excludeIds:  ids that cannot be added (e.g. already associated) — disabled
//   excludeHint: label shown next to an excluded result
const MetricSearchSelect = ({ selected = [], onChange, excludeIds = [], excludeHint = 'already added' }) => {
  const excludeSet = new Set(excludeIds)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 1) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      try {
        const resp = await businessCaseCreatorAPI.searchMetrics(q)
        setResults(resp?.data?.results || [])
      } catch (e) {
        setSearchError(e.message || 'Search failed')
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [query])

  const add = (m) => {
    if (excludeSet.has(m.id)) return
    if (!selected.some((x) => x.id === m.id)) onChange([...selected, m])
    setQuery('')
    setResults([])
  }
  const remove = (id) => onChange(selected.filter((x) => x.id !== id))

  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search metric by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
          />
          {searching && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        </div>
        {results.length > 0 && (
          <div className="mt-1 border border-slate-200 rounded-md divide-y max-h-64 overflow-auto">
            {results.map((m) => {
              const already = selected.some((x) => x.id === m.id)
              const excluded = excludeSet.has(m.id)
              const disabled = already || excluded
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => add(m)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
                >
                  <span>
                    <span className="text-slate-900">{m.name || `Metric ${m.id}`}</span>
                    <span className="text-slate-400"> · ID {m.id}</span>
                    {m.description && <span className="block text-xs text-slate-500">{m.description}</span>}
                  </span>
                  {already ? (
                    <Check className="h-4 w-4 text-green-600 shrink-0" />
                  ) : excluded ? (
                    <span className="text-xs text-slate-400 shrink-0">{excludeHint}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {searchError && <p className="text-sm text-red-600">{searchError}</p>}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-1 text-xs text-blue-900"
            >
              {m.name || `Metric ${m.id}`} · {m.id}
              <button type="button" onClick={() => remove(m.id)} aria-label="Remove">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default MetricSearchSelect
