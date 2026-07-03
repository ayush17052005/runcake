import React, { useState, useEffect } from 'react'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { 
  ChevronDown, 
  ChevronRight, 
  Calendar, 
  User, 
  Server, 
  Activity, 
  CheckCircle, 
  XCircle, 
  Clock,
  Search,
  Filter,
  ChevronLeft,
  ChevronRightIcon
} from 'lucide-react'
import { auditLogsAPI } from '../lib/api'

// Pull the last JSON result emitted by a BCC Ruby script. The combined script
// ends with `BCC_RESULT_JSON={...}`; the read-only preview ends with
// `BCC_PREVIEW_JSON={...}`. Returns { kind, data } or null.
const extractBccResult = (output) => {
  if (typeof output !== 'string') return null
  const result = output.match(/BCC_RESULT_JSON=(\{[\s\S]*?\})\s*$/m)
  if (result) {
    try { return { kind: 'orchestrate', data: JSON.parse(result[1]) } } catch { /* fall through */ }
  }
  const preview = output.match(/BCC_PREVIEW_JSON=(\{[\s\S]*?\})\s*$/m)
  if (preview) {
    try { return { kind: 'preview', data: JSON.parse(preview[1]) } } catch { /* fall through */ }
  }
  return null
}

// Decide what type of BCC entry this is, based on the template_variables blob
// that the backend stored when it kicked off the SSM run.
const classifyBccEntry = (tv) => {
  if (!tv || typeof tv !== 'object') return null
  if (tv.kind === 'preview_metrics') return 'preview'
  if ('problem_id' in tv) return tv.mode === 'existing' ? 'associate-existing' : 'create'
  return null
}

const AuditLogPage = () => {
  const [auditLogs, setAuditLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedLogs, setExpandedLogs] = useState(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [pagination, setPagination] = useState({
    currentPage: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false
  })
  const [stats, setStats] = useState({
    overall: {
      total: 0,
      successful: 0,
      failed: 0,
      running: 0,
      pending: 0,
      successRate: 0
    },
    dailyTrends: [],
    topScripts: [],
    topUsers: [],
    hourlyDistribution: []
  })
  const [statsLoading, setStatsLoading] = useState(true)

  useEffect(() => {
    fetchAuditLogs()
  }, [pagination.currentPage])

  useEffect(() => {
    // Reset to first page when search or filter changes
    if (pagination.currentPage !== 1) {
      setPagination(prev => ({ ...prev, currentPage: 1 }))
    } else {
      fetchAuditLogs()
    }
  }, [searchTerm, statusFilter])

  const fetchAuditLogs = async () => {
    try {
      setLoading(true)
      const params = {
        limit: pagination.limit,
        offset: (pagination.currentPage - 1) * pagination.limit
      }
      
      if (searchTerm) {
        params.search = searchTerm
      }
      
      if (statusFilter) {
        params.status = statusFilter
      }
      
      const response = await auditLogsAPI.getAll(params)
      if (response.success) {
        setAuditLogs(response.data)
        setPagination(prev => ({
          ...prev,
          total: response.pagination.total,
          totalPages: response.pagination.totalPages,
          hasNextPage: response.pagination.hasNextPage,
          hasPrevPage: response.pagination.hasPrevPage
        }))
        
        // Fetch overall stats separately for the dashboard
        await fetchStats()
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      setStatsLoading(true)
      const response = await auditLogsAPI.getStats()
      if (response.success) {
        setStats(response.data)
      }
    } catch (error) {
      console.error('Error fetching stats:', error)
    } finally {
      setStatsLoading(false)
    }
  }

  const toggleExpanded = (logId) => {
    setExpandedLogs(prev => {
      const newSet = new Set(prev)
      if (newSet.has(logId)) {
        newSet.delete(logId)
      } else {
        newSet.add(logId)
      }
      return newSet
    })
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-600" />
      case 'running':
        return <Activity className="h-4 w-4 text-blue-600 animate-spin" />
      default:
        return <Clock className="h-4 w-4 text-yellow-600" />
    }
  }

  const getStatusBadge = (status) => {
    const variants = {
      success: 'bg-green-100 text-green-800 border-green-200',
      failed: 'bg-red-100 text-red-800 border-red-200',
      running: 'bg-blue-100 text-blue-800 border-blue-200',
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-200'
    }
    
    return (
      <Badge className={`${variants[status] || variants.pending} border text-xs font-medium`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setPagination(prev => ({ ...prev, currentPage: newPage }))
    }
  }

  const handleSearchChange = (value) => {
    setSearchTerm(value)
  }

  const handleStatusFilterChange = (value) => {
    setStatusFilter(value)
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent">
          Audit Logs
        </h1>
        <p className="text-gray-600 mt-1">Track script execution history and performance metrics</p>
      </div>

      {/* Stats Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-blue-600">Total Executions</p>
              <p className="text-2xl font-bold text-blue-900">{stats.overall.total}</p>
            </div>
            <div className="h-12 w-12 bg-blue-200 rounded-lg flex items-center justify-center">
              <Activity className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-600">Successful</p>
              <p className="text-2xl font-bold text-green-900">{stats.overall.successful}</p>
            </div>
            <div className="h-12 w-12 bg-green-200 rounded-lg flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-red-50 to-red-100 border-red-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-red-600">Failed</p>
              <p className="text-2xl font-bold text-red-900">{stats.overall.failed}</p>
            </div>
            <div className="h-12 w-12 bg-red-200 rounded-lg flex items-center justify-center">
              <XCircle className="h-6 w-6 text-red-600" />
            </div>
          </div>
        </Card>
      </div>

      {/* Charts and Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Execution Trends - Trendline Chart */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Execution Trends (Last 7 Days)</h3>
          {statsLoading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : stats.dailyTrends.length === 0 ? (
            <div className="h-64 flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                  <Activity className="h-8 w-8 text-gray-400" />
                </div>
                <p className="text-gray-500">No execution data available</p>
              </div>
            </div>
          ) : (
            <div className="h-64 relative">
              <svg className="w-full h-48" viewBox="0 0 400 180">
                {/* Simple grid lines */}
                {[0, 1, 2, 3, 4].map((i) => (
                  <line
                    key={i}
                    x1="50"
                    y1={30 + i * 30}
                    x2="370"
                    y2={30 + i * 30}
                    stroke="#f3f4f6"
                    strokeWidth="1"
                  />
                ))}
                
                {/* Y-axis labels */}
                {(() => {
                  const maxValue = Math.max(...stats.dailyTrends.map(d => d.total), 1)
                  return [0, 1, 2, 3, 4].map((i) => (
                    <text
                      key={i}
                      x="45"
                      y={35 + i * 30}
                      textAnchor="end"
                      className="text-xs fill-gray-500"
                    >
                      {Math.round(maxValue - (i * maxValue / 4))}
                    </text>
                  ))
                })()}

                {/* Chart lines and points */}
                {(() => {
                  const maxValue = Math.max(...stats.dailyTrends.map(d => d.total), 1)
                  const points = stats.dailyTrends.map((day, index) => ({
                    x: 70 + (index * 280 / (stats.dailyTrends.length - 1)),
                    y: 150 - ((day.total / maxValue) * 120),
                    total: day.total,
                    successful: day.successful,
                    failed: day.failed,
                    dayName: day.dayName
                  }))

                  const successPoints = stats.dailyTrends.map((day, index) => ({
                    x: 70 + (index * 280 / (stats.dailyTrends.length - 1)),
                    y: 150 - ((day.successful / maxValue) * 120),
                    value: day.successful
                  }))

                  // Simple line paths
                  const totalPath = points.map((point, index) => 
                    `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
                  ).join(' ')

                  const successPath = successPoints.map((point, index) => 
                    `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
                  ).join(' ')

                  return (
                    <g>
                      {/* Total executions line */}
                      <path
                        d={totalPath}
                        fill="none"
                        stroke="#3b82f6"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      
                      {/* Successful executions line */}
                      <path
                        d={successPath}
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />

                      {/* Simple points without hover tooltips */}
                      {points.map((point, index) => (
                        <g key={index}>
                          {/* Total point */}
                          <circle
                            cx={point.x}
                            cy={point.y}
                            r="4"
                            fill="#3b82f6"
                          />
                          
                          {/* Success point */}
                          <circle
                            cx={successPoints[index].x}
                            cy={successPoints[index].y}
                            r="3"
                            fill="#10b981"
                          />
                        </g>
                      ))}
                    </g>
                  )
                })()}

                {/* X-axis labels */}
                {stats.dailyTrends.map((day, index) => (
                  <text
                    key={index}
                    x={70 + (index * 280 / (stats.dailyTrends.length - 1))}
                    y="170"
                    textAnchor="middle"
                    className="text-sm fill-gray-600"
                  >
                    {day.dayName}
                  </text>
                ))}
              </svg>
              
              {/* Simple legend */}
              <div className="flex items-center justify-center space-x-6 mt-4">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                  <span className="text-sm text-gray-600">Total Executions</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span className="text-sm text-gray-600">Successful</span>
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Top Scripts and Users */}
        <div className="space-y-6">
          {/* Top Scripts */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Most Executed Scripts</h3>
            {statsLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </div>
                ))}
              </div>
            ) : stats.topScripts.length === 0 ? (
              <div className="text-center py-6">
                <div className="w-10 h-10 mx-auto mb-2 bg-gray-100 rounded-lg flex items-center justify-center">
                  <Activity className="h-5 w-5 text-gray-400" />
                </div>
                <p className="text-sm text-gray-500">No executions yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {stats.topScripts.slice(0, 3).map((script, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <div className="w-5 h-5 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-semibold">
                          {index + 1}
                        </div>
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {script.script_name}
                        </p>
                      </div>
                      <div className="flex items-center space-x-3 mt-1 text-xs text-gray-500 ml-7">
                        <span>{script.execution_count} runs</span>
                        <span className="text-green-600">
                          {((script.successful_count / script.execution_count) * 100).toFixed(0)}% success
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Top Users */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Most Active Users</h3>
            {statsLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </div>
                ))}
              </div>
            ) : stats.topUsers.length === 0 ? (
              <div className="text-center py-6">
                <div className="w-10 h-10 mx-auto mb-2 bg-gray-100 rounded-lg flex items-center justify-center">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <p className="text-sm text-gray-500">No user activity yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {stats.topUsers.slice(0, 3).map((user, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <div className="w-5 h-5 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-semibold">
                          {index + 1}
                        </div>
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {user.user_name}
                        </p>
                      </div>
                      <div className="flex items-center space-x-3 mt-1 text-xs text-gray-500 ml-7">
                        <span>{user.execution_count} executions</span>
                        <span className="text-green-600">
                          {((user.successful_count / user.execution_count) * 100).toFixed(0)}% success
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Search and Filter */}
      <Card className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Search by script name, target group, or user..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-10 bg-white"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <select
              value={statusFilter}
              onChange={(e) => handleStatusFilterChange(e.target.value)}
              className="pl-10 pr-8 py-2 border border-gray-300 rounded-md bg-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Status</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="running">Running</option>
              <option value="pending">Pending</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Audit Logs */}
      {auditLogs.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="max-w-md mx-auto">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <Activity className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {searchTerm || statusFilter ? 'No logs found' : 'No execution logs yet'}
            </h3>
            <p className="text-gray-600">
              {searchTerm || statusFilter 
                ? 'Try adjusting your search or filters to find what you\'re looking for.'
                : 'Script execution logs will appear here once you start running scripts.'
              }
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {auditLogs.map((log) => (
            <Card key={log.id} className="overflow-hidden hover:shadow-md transition-shadow">
              <div className="p-6">
                {/* Main Log Entry */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4 flex-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleExpanded(log.id)}
                      className="p-1 h-8 w-8"
                    >
                      {expandedLogs.has(log.id) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                    
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(log.status)}
                      <div>
                        <h3 className="font-semibold text-gray-900">{log.script_name}</h3>
                        <p className="text-sm text-gray-600">on {log.target_group_name}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <div className="flex items-center text-sm text-gray-600">
                        <Calendar className="h-3 w-3 mr-1" />
                        {formatDate(log.started_at)}
                      </div>
                      <div className="flex items-center text-sm text-gray-600">
                        <User className="h-3 w-3 mr-1" />
                        {log.executed_by_name}
                      </div>
                    </div>
                    {getStatusBadge(log.status)}
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedLogs.has(log.id) && (
                  <div className="mt-6 pt-6 border-t border-gray-200 space-y-4">
                    {/* Execution Details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <h4 className="font-medium text-gray-900">Execution Details</h4>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Execution Mode:</span>
                            <span className="font-medium">{log.execution_mode || 'all'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Started:</span>
                            <span className="font-medium">{formatDate(log.started_at)}</span>
                          </div>
                          {log.completed_at && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Completed:</span>
                              <span className="font-medium">{formatDate(log.completed_at)}</span>
                            </div>
                          )}
                          {log.command_id && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Command ID:</span>
                              <span className="font-mono text-xs">{log.command_id}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h4 className="font-medium text-gray-900">Target Information</h4>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Target Group:</span>
                            <span className="font-medium">{log.target_group_name}</span>
                          </div>
                          {log.instance_ids && log.instance_ids.length > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Instances:</span>
                              <span className="font-medium">{log.instance_ids.length}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* BCC-specific structured details. Falls back silently
                        for regular script executions. */}
                    {(() => {
                      const tv = log.template_variables || {}
                      const kind = classifyBccEntry(tv)
                      if (!kind) return null
                      const bccResult = extractBccResult(log.output)
                      return (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <h4 className="font-medium text-gray-900">
                              {kind === 'preview'
                                ? 'Preview inputs (Business Case Creator)'
                                : 'Inputs (Business Case Creator)'}
                            </h4>
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm space-y-1">
                              {kind !== 'preview' && (
                                <>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-gray-600">Problem ID</span>
                                    <span className="font-medium">{tv.problem_id ?? '—'}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-gray-600">Evaluation</span>
                                    <span className="font-medium">{tv.use_ai ? 'AI' : 'Human'}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-gray-600">Mode</span>
                                    <span className="font-medium">
                                      {tv.mode === 'existing' ? 'Use existing metric IDs' : 'Create new metrics'}
                                    </span>
                                  </div>
                                </>
                              )}
                              {Array.isArray(tv.metric_ids) && tv.metric_ids.length > 0 && (
                                <div className="flex justify-between gap-4">
                                  <span className="text-gray-600">Metric IDs</span>
                                  <span className="font-mono text-xs break-all text-right">
                                    {tv.metric_ids.join(', ')}
                                  </span>
                                </div>
                              )}
                            </div>
                            {tv.rendered_ruby && (
                              <details className="text-sm">
                                <summary className="cursor-pointer text-blue-700 hover:text-blue-900">
                                  Show rendered Ruby
                                </summary>
                                <pre className="mt-2 bg-white border border-slate-200 rounded p-2 text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">
                                  {tv.rendered_ruby}
                                </pre>
                              </details>
                            )}
                          </div>

                          {bccResult && (
                            <div className="space-y-2">
                              <h4 className="font-medium text-gray-900">
                                {bccResult.kind === 'preview' ? 'Loaded metrics' : 'Result'}
                              </h4>
                              {bccResult.kind === 'orchestrate' && (
                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm space-y-1">
                                  <div className="flex justify-between gap-4">
                                    <span className="text-gray-600">Status</span>
                                    <span className="font-medium">{bccResult.data.status}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-gray-600">Metric IDs</span>
                                    <span className="font-mono text-xs break-all text-right">
                                      {(bccResult.data.metric_ids || []).join(', ') || '—'}
                                    </span>
                                  </div>
                                  {bccResult.data.message && (
                                    <div className="flex justify-between gap-4">
                                      <span className="text-gray-600">Message</span>
                                      <span className="text-right">{bccResult.data.message}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                              {bccResult.kind === 'preview' && (
                                <div className="space-y-2">
                                  {(bccResult.data.metrics || []).map((m) => (
                                    <div key={m.id} className="bg-white border border-slate-200 rounded p-2 text-sm">
                                      <div className="flex justify-between">
                                        <span className="font-medium">{m.name}</span>
                                        <span className="text-xs text-gray-500">
                                          ID <strong>{m.id}</strong>
                                          {(m.min_score != null || m.max_score != null) && (
                                            <> · {m.min_score ?? '?'}–{m.max_score ?? '?'}</>
                                          )}
                                        </span>
                                      </div>
                                      {m.description && (
                                        <p className="text-gray-600 mt-1 text-xs">{m.description}</p>
                                      )}
                                    </div>
                                  ))}
                                  {(bccResult.data.missing || []).length > 0 && (
                                    <div className="text-xs text-red-700">
                                      Not found: {(bccResult.data.missing).join(', ')}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })()}

                    {/* Output */}
                    {log.output && (
                      <div className="space-y-2">
                        <h4 className="font-medium text-gray-900">Output</h4>
                        <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm overflow-x-auto">
                          <pre className="whitespace-pre-wrap">{log.output}</pre>
                        </div>
                      </div>
                    )}

                    {/* Error Message */}
                    {log.error_message && (
                      <div className="space-y-2">
                        <h4 className="font-medium text-red-900">Error</h4>
                        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-lg text-sm">
                          {log.error_message}
                        </div>
                      </div>
                    )}

                    {/* Instance IDs */}
                    {log.instance_ids && log.instance_ids.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="font-medium text-gray-900">Target Instances</h4>
                        <div className="flex flex-wrap gap-2">
                          {log.instance_ids.map((instanceId, index) => (
                            <Badge key={index} variant="outline" className="font-mono text-xs">
                              {instanceId}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination Controls */}
      {pagination.totalPages > 1 && (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Showing {Math.min((pagination.currentPage - 1) * pagination.limit + 1, pagination.total)} to{' '}
              {Math.min(pagination.currentPage * pagination.limit, pagination.total)} of {pagination.total} results
            </div>
            
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(pagination.currentPage - 1)}
                disabled={!pagination.hasPrevPage}
                className="flex items-center"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              
              <div className="flex items-center space-x-1">
                {/* Show page numbers */}
                {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                  let pageNum
                  if (pagination.totalPages <= 5) {
                    pageNum = i + 1
                  } else if (pagination.currentPage <= 3) {
                    pageNum = i + 1
                  } else if (pagination.currentPage >= pagination.totalPages - 2) {
                    pageNum = pagination.totalPages - 4 + i
                  } else {
                    pageNum = pagination.currentPage - 2 + i
                  }
                  
                  return (
                    <Button
                      key={pageNum}
                      variant={pageNum === pagination.currentPage ? "default" : "outline"}
                      size="sm"
                      onClick={() => handlePageChange(pageNum)}
                      className="w-8 h-8 p-0"
                    >
                      {pageNum}
                    </Button>
                  )
                })}
              </div>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(pagination.currentPage + 1)}
                disabled={!pagination.hasNextPage}
                className="flex items-center"
              >
                Next
                <ChevronRightIcon className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

export default AuditLogPage 