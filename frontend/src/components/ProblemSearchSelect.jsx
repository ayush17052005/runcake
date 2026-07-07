import React, { useState, useEffect } from 'react'
import { businessCaseCreatorAPI } from '../lib/api'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { Search, Loader2 } from 'lucide-react'

// Metabase-backed problem picker. Search by name/title → select one.
//   value:    the selected { id, label } (or null)
//   onChange: (problem | null) => void
//   error:    optional error string to render
const ProblemSearchSelect = ({ value, onChange, error }) => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  useEffect(() => {
    const q = query.trim()
    if (value || q.length < 1) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      try {
        const resp = await businessCaseCreatorAPI.searchProblems(q)
        setResults(resp?.data?.results || [])
      } catch (e) {
        setSearchError(e.message || 'Search failed')
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [query, value])

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
        <div className="text-sm text-blue-900">
          <span className="font-medium">{value.label}</span>{' '}
          <span className="text-blue-600">· ID {value.id}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Change</Button>
      </div>
    )
  }

  return (
    <div>
      <div className="relative">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search problem by name / title…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
          />
          {searching && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        </div>
        {results.length > 0 && (
          <div className="mt-1 border border-slate-200 rounded-md divide-y max-h-64 overflow-auto">
            {results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange(p)
                  setQuery('')
                  setResults([])
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
              >
                <span className="text-slate-900">{p.label}</span>
                <span className="text-slate-400"> · ID {p.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {searchError && <p className="text-sm text-red-600 mt-1">{searchError}</p>}
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
    </div>
  )
}

export default ProblemSearchSelect
