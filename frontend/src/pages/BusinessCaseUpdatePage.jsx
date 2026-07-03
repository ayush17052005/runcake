import React, { useState, useEffect } from 'react'
import { targetGroupsAPI } from '../lib/api'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Info } from 'lucide-react'

// Update Business Case
// -------------------------------------------------------------------
// Scaffold shell. The exact behaviour (what fields are editable, which
// Ruby transaction runs) will be provided later. For now this collects the
// two inputs every business-case action needs — the problem ID and the
// Rails target group — so the real form can be dropped in on top.
const BusinessCaseUpdatePage = () => {
  const [problemId, setProblemId] = useState('')
  const [targetGroups, setTargetGroups] = useState([])
  const [targetGroupId, setTargetGroupId] = useState('')

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

  return (
    <div className="py-8 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Update Business Case</h1>
        <p className="text-slate-600 mt-1">
          Update an existing business-case problem on a Rails instance.
        </p>
      </div>

      <div className="flex items-start gap-2 text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-md p-3">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          This section is being set up. The exact update behaviour will be added once the
          requirements are finalised.
        </span>
      </div>

      <Card className="p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Design problem ID</label>
          <Input
            type="number"
            value={problemId}
            onChange={(e) => setProblemId(e.target.value)}
            placeholder="e.g. 12313"
            min="1"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Target group</label>
          <select
            value={targetGroupId}
            onChange={(e) => setTargetGroupId(e.target.value)}
            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">-- select a Rails target group --</option>
            {targetGroups.map((tg) => (
              <option key={tg.id} value={tg.id}>
                {tg.name} ({tg.aws_tag_key}={tg.aws_tag_value}, {tg.region})
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-end">
          <Button disabled title="Update behaviour to be defined">
            Update
          </Button>
        </div>
      </Card>
    </div>
  )
}

export default BusinessCaseUpdatePage
