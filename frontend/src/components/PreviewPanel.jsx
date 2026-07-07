import React from 'react'

// A labeled row inside a PreviewPanel.
export const PreviewRow = ({ label, children }) => (
  <div className="flex gap-2 text-sm">
    <div className="w-44 shrink-0 text-slate-500">{label}</div>
    <div className="text-slate-900 min-w-0 break-words">{children}</div>
  </div>
)

// Consistent "review before you submit" summary panel used across tabs.
const PreviewPanel = ({ title = 'Review before submitting', children }) => (
  <div className="rounded-md border border-slate-300 bg-slate-50 p-4 space-y-2">
    <div className="text-sm font-semibold text-slate-700">{title}</div>
    <div className="space-y-1">{children}</div>
  </div>
)

export default PreviewPanel
