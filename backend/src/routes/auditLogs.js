const express = require('express')
const { db } = require('../database/db')
const { authenticateToken } = require('../middleware/auth')
const { toDisplayName } = require('../services/systemScripts')

const router = express.Router()

// Rewrite internal __system__ names to user-facing display names
// for anything surfaced to the UI.
const rewriteSystemNames = (row) => {
  if (!row) return row
  const out = { ...row }
  if ('script_name' in out) out.script_name = toDisplayName(out.script_name)
  if ('target_group_name' in out) out.target_group_name = toDisplayName(out.target_group_name)
  return out
}

// Get all audit logs with pagination
router.get('/', authenticateToken, (req, res) => {
  try {
    const { limit = 20, offset = 0, status, search } = req.query
    const parsedLimit = Math.min(parseInt(limit), 100) // Cap at 100
    const parsedOffset = parseInt(offset)

    // Build the WHERE clause
    let whereClause = 'WHERE 1=1'
    const params = []

    if (status) {
      whereClause += ' AND se.status = ?'
      params.push(status)
    }

    if (search) {
      whereClause += ' AND (s.name LIKE ? OR tg.name LIKE ? OR u.name LIKE ?)'
      const searchPattern = `%${search}%`
      params.push(searchPattern, searchPattern, searchPattern)
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM script_executions se
      LEFT JOIN scripts s ON se.script_id = s.id
      LEFT JOIN target_groups tg ON se.target_group_id = tg.id
      LEFT JOIN users u ON se.executed_by = u.id
      ${whereClause}
    `
    const totalResult = db.prepare(countQuery).get(...params)
    const total = totalResult.total

    // Get paginated results
    const dataQuery = `
      SELECT se.*, s.name as script_name, tg.name as target_group_name, u.name as executed_by_name
      FROM script_executions se
      LEFT JOIN scripts s ON se.script_id = s.id
      LEFT JOIN target_groups tg ON se.target_group_id = tg.id
      LEFT JOIN users u ON se.executed_by = u.id
      ${whereClause}
      ORDER BY se.started_at DESC 
      LIMIT ? OFFSET ?
    `
    
    const auditLogs = db.prepare(dataQuery).all(...params, parsedLimit, parsedOffset)

    const logsWithParsedData = auditLogs.map(log => rewriteSystemNames({
      ...log,
      instance_ids: log.instance_ids ? JSON.parse(log.instance_ids) : [],
      template_variables: log.template_variables ? JSON.parse(log.template_variables) : {}
    }))

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / parsedLimit)
    const currentPage = Math.floor(parsedOffset / parsedLimit) + 1
    const hasNextPage = parsedOffset + parsedLimit < total
    const hasPrevPage = parsedOffset > 0

    res.json({
      success: true,
      data: logsWithParsedData,
      pagination: {
        total,
        totalPages,
        currentPage,
        limit: parsedLimit,
        offset: parsedOffset,
        hasNextPage,
        hasPrevPage
      }
    })
  } catch (error) {
    console.error('Error fetching audit logs:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit logs'
    })
  }
})

// Get audit log by ID
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params

    const auditLog = db.prepare(`
      SELECT se.*, s.name as script_name, s.content as script_content, 
             tg.name as target_group_name, u.name as executed_by_name
      FROM script_executions se
      LEFT JOIN scripts s ON se.script_id = s.id
      LEFT JOIN target_groups tg ON se.target_group_id = tg.id
      LEFT JOIN users u ON se.executed_by = u.id
      WHERE se.id = ?
    `).get(id)

    if (!auditLog) {
      return res.status(404).json({
        success: false,
        message: 'Audit log not found'
      })
    }

    res.json({
      success: true,
      data: rewriteSystemNames({
        ...auditLog,
        instance_ids: auditLog.instance_ids ? JSON.parse(auditLog.instance_ids) : []
      })
    })
  } catch (error) {
    console.error('Error fetching audit log:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit log'
    })
  }
})

// Get audit logs stats with daily trends
router.get('/stats/overview', authenticateToken, (req, res) => {
  try {
    // Get overall stats
    const overallStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM script_executions
    `).get()

    // Get daily stats for the last 7 days
    const dailyStats = db.prepare(`
      SELECT 
        DATE(started_at) as date,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM script_executions 
      WHERE started_at >= DATE('now', '-7 days')
      GROUP BY DATE(started_at)
      ORDER BY DATE(started_at) ASC
    `).all()

    // Get most executed scripts in the last 7 days
    const topScripts = db.prepare(`
      SELECT 
        s.name as script_name,
        COUNT(*) as execution_count,
        SUM(CASE WHEN se.status = 'success' THEN 1 ELSE 0 END) as successful_count
      FROM script_executions se
      LEFT JOIN scripts s ON se.script_id = s.id
      WHERE se.started_at >= DATE('now', '-7 days')
      GROUP BY se.script_id, s.name
      ORDER BY execution_count DESC
      LIMIT 5
    `).all()

    // Get top users by execution count in the last 7 days
    const topUsers = db.prepare(`
      SELECT 
        u.name as user_name,
        COUNT(*) as execution_count,
        SUM(CASE WHEN se.status = 'success' THEN 1 ELSE 0 END) as successful_count
      FROM script_executions se
      LEFT JOIN users u ON se.executed_by = u.id
      WHERE se.started_at >= DATE('now', '-7 days')
      GROUP BY se.executed_by, u.name
      ORDER BY execution_count DESC
      LIMIT 5
    `).all()

    // Get hourly distribution for today
    const hourlyStats = db.prepare(`
      SELECT 
        CAST(strftime('%H', started_at) AS INTEGER) as hour,
        COUNT(*) as total
      FROM script_executions 
      WHERE DATE(started_at) = DATE('now')
      GROUP BY CAST(strftime('%H', started_at) AS INTEGER)
      ORDER BY hour ASC
    `).all()

    // Fill in missing days with zero values
    const last7Days = []
    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      
      const dayData = dailyStats.find(d => d.date === dateStr) || {
        date: dateStr,
        total: 0,
        successful: 0,
        failed: 0,
        running: 0,
        pending: 0
      }
      
      last7Days.push({
        ...dayData,
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' })
      })
    }

    // Fill in missing hours with zero values for today
    const hourlyData = []
    for (let hour = 0; hour < 24; hour++) {
      const hourData = hourlyStats.find(h => h.hour === hour) || { hour, total: 0 }
      hourlyData.push(hourData)
    }

    res.json({
      success: true,
      data: {
        overall: {
          total: overallStats.total,
          successful: overallStats.successful,
          failed: overallStats.failed,
          running: overallStats.running,
          pending: overallStats.pending,
          successRate: overallStats.total > 0 ? 
            ((overallStats.successful / overallStats.total) * 100).toFixed(1) : 0
        },
        dailyTrends: last7Days,
        topScripts: topScripts.map(s => ({ ...s, script_name: toDisplayName(s.script_name) })),
        topUsers: topUsers,
        hourlyDistribution: hourlyData
      }
    })
  } catch (error) {
    console.error('Error fetching audit log stats:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit log stats'
    })
  }
})

module.exports = router 