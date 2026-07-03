const express = require('express')
const { db } = require('../database/db')
const { authenticateToken } = require('../middleware/auth')
const AWSService = require('../services/awsService')
const { isSystemScriptName } = require('../services/systemScripts')
const {
  extractTemplateVariables,
  processTemplate,
  validateVariableNames,
  getTemplateVariableInfo
} = require('../utils/templateProcessor')

const router = express.Router()

// Get all scripts (filtered by permission level)
router.get('/', authenticateToken, (req, res) => {
  try {
    let query = `
      SELECT s.*, u.name as created_by_name, r.name as runner_name
      FROM scripts s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN runners r ON s.runner_id = r.id
      WHERE s.name NOT LIKE '__system__%'
    `

    // Non-admin users can only see member_allowed scripts
    if (req.user.role !== 'admin') {
      query += ` AND s.permission_level = 'member_allowed'`
    }

    query += ` ORDER BY s.created_at DESC`
    
    const scripts = db.prepare(query).all()

    // Parse tags JSON for each script
    const scriptsWithParsedTags = scripts.map(script => ({
      ...script,
      tags: script.tags ? JSON.parse(script.tags) : []
    }))

    res.json({
      success: true,
      data: scriptsWithParsedTags
    })
  } catch (error) {
    console.error('Error fetching scripts:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch scripts'
    })
  }
})

// Get script by ID (with permission check)
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params

    const script = db.prepare(`
      SELECT s.*, u.name as created_by_name, r.name as runner_name, r.description as runner_description
      FROM scripts s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN runners r ON s.runner_id = r.id
      WHERE s.id = ?
    `).get(id)

    if (!script) {
      return res.status(404).json({
        success: false,
        message: 'Script not found'
      })
    }

    // Check if user has permission to view this script
    if (req.user.role !== 'admin' && script.permission_level === 'admin_only') {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this script'
      })
    }

    // Extract template variables from script content
    const templateVariables = getTemplateVariableInfo(script.content)

    res.json({
      success: true,
      data: {
        ...script,
        tags: script.tags ? JSON.parse(script.tags) : [],
        templateVariables
      }
    })
  } catch (error) {
    console.error('Error fetching script:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch script'
    })
  }
})

// Get template variables for a script
router.get('/:id/template-variables', authenticateToken, (req, res) => {
  try {
    const { id } = req.params

    const script = db.prepare('SELECT content FROM scripts WHERE id = ?').get(id)
    if (!script) {
      return res.status(404).json({
        success: false,
        message: 'Script not found'
      })
    }

    const templateVariables = getTemplateVariableInfo(script.content)

    res.json({
      success: true,
      data: {
        variables: templateVariables,
        hasVariables: templateVariables.length > 0
      }
    })
  } catch (error) {
    console.error('Error fetching template variables:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch template variables'
    })
  }
})

// Create new script (admin only)
router.post('/', authenticateToken, (req, res) => {
  try {
    // Only admins can create scripts
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can create scripts'
      })
    }

    const { name, description, content, tags, runner_id, permission_level = 'member_allowed' } = req.body

    if (!name || !content) {
      return res.status(400).json({
        success: false,
        message: 'Name and content are required'
      })
    }

    if (!runner_id) {
      return res.status(400).json({
        success: false,
        message: 'Runner is required'
      })
    }

    // Validate runner exists
    const runner = db.prepare('SELECT id FROM runners WHERE id = ?').get(runner_id)
    if (!runner) {
      return res.status(400).json({
        success: false,
        message: 'Invalid runner selected'
      })
    }

    if (!['admin_only', 'member_allowed'].includes(permission_level)) {
      return res.status(400).json({
        success: false,
        message: 'Permission level must be either "admin_only" or "member_allowed"'
      })
    }

    const insertStmt = db.prepare(`
      INSERT INTO scripts (name, description, content, tags, runner_id, permission_level, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const result = insertStmt.run(
      name,
      description || null,
      content,
      JSON.stringify(tags || []),
      runner_id,
      permission_level,
      req.user.id
    )

    const newScript = db.prepare(`
      SELECT s.*, u.name as created_by_name, r.name as runner_name
      FROM scripts s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN runners r ON s.runner_id = r.id
      WHERE s.id = ?
    `).get(result.lastInsertRowid)

    res.status(201).json({
      success: true,
      message: 'Script created successfully',
      data: {
        ...newScript,
        tags: newScript.tags ? JSON.parse(newScript.tags) : []
      }
    })
  } catch (error) {
    console.error('Error creating script:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to create script'
    })
  }
})

// Update script (admin only)
router.put('/:id', authenticateToken, (req, res) => {
  try {
    // Only admins can update scripts
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can update scripts'
      })
    }

    const { id } = req.params
    const { name, description, content, tags, runner_id, permission_level = 'member_allowed' } = req.body

    const existingScript = db.prepare('SELECT created_by, name FROM scripts WHERE id = ?').get(id)
    if (!existingScript) {
      return res.status(404).json({
        success: false,
        message: 'Script not found'
      })
    }

    if (isSystemScriptName(existingScript.name)) {
      return res.status(403).json({
        success: false,
        message: 'System-owned scripts cannot be edited.'
      })
    }

    if (runner_id) {
      // Validate runner exists if provided
      const runner = db.prepare('SELECT id FROM runners WHERE id = ?').get(runner_id)
      if (!runner) {
        return res.status(400).json({
          success: false,
          message: 'Invalid runner selected'
        })
      }
    }

    if (!['admin_only', 'member_allowed'].includes(permission_level)) {
      return res.status(400).json({
        success: false,
        message: 'Permission level must be either "admin_only" or "member_allowed"'
      })
    }

    const updateStmt = db.prepare(`
      UPDATE scripts 
      SET name = ?, description = ?, content = ?, tags = ?, runner_id = ?, permission_level = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)

    updateStmt.run(name, description, content, JSON.stringify(tags || []), runner_id, permission_level, id)

    const updatedScript = db.prepare(`
      SELECT s.*, u.name as created_by_name, r.name as runner_name
      FROM scripts s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN runners r ON s.runner_id = r.id
      WHERE s.id = ?
    `).get(id)

    res.json({
      success: true,
      message: 'Script updated successfully',
      data: {
        ...updatedScript,
        tags: updatedScript.tags ? JSON.parse(updatedScript.tags) : []
      }
    })
  } catch (error) {
    console.error('Error updating script:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to update script'
    })
  }
})

// Delete script
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params

    const existingScript = db.prepare('SELECT created_by, name FROM scripts WHERE id = ?').get(id)
    if (!existingScript) {
      return res.status(404).json({
        success: false,
        message: 'Script not found'
      })
    }

    if (isSystemScriptName(existingScript.name)) {
      return res.status(403).json({
        success: false,
        message: 'System-owned scripts cannot be deleted.'
      })
    }

    if (existingScript.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Permission denied'
      })
    }

    const deleteStmt = db.prepare('DELETE FROM scripts WHERE id = ?')
    deleteStmt.run(id)

    res.json({
      success: true,
      message: 'Script deleted successfully'
    })
  } catch (error) {
    console.error('Error deleting script:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to delete script'
    })
  }
})

// Execute script
router.post('/:id/execute', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { target_group_id, execution_mode = 'random', template_variables = {} } = req.body

    if (!target_group_id) {
      return res.status(400).json({
        success: false,
        message: 'Target group ID is required'
      })
    }

    // Check if user is admin for 'all' execution mode
    if (execution_mode === 'all' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can execute scripts on all instances'
      })
    }

    // Get script
    const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(id)
    if (!script) {
      return res.status(404).json({
        success: false,
        message: 'Script not found'
      })
    }

    // Check if user has permission to execute this script
    if (req.user.role !== 'admin' && script.permission_level === 'admin_only') {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to execute this script'
      })
    }

    // Validate template variables if provided
    if (template_variables && Object.keys(template_variables).length > 0) {
      const invalidVariableNames = validateVariableNames(template_variables)
      if (invalidVariableNames.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid variable names: ${invalidVariableNames.join(', ')}. Variable names must start with a letter or underscore and contain only letters, numbers, and underscores.`
        })
      }
    }

    // Process template variables
    const { processedContent, missingVariables } = processTemplate(script.content, template_variables)
    
    if (missingVariables.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required template variables: ${missingVariables.join(', ')}`
      })
    }

    // Create processed script object
    const processedScript = {
      ...script,
      content: processedContent
    }

    // Get target group with credentials
    const targetGroup = db.prepare(`
      SELECT tg.*, ic.*
      FROM target_groups tg
      JOIN iam_credentials ic ON tg.iam_credential_id = ic.id
      WHERE tg.id = ?
    `).get(target_group_id)

    if (!targetGroup) {
      return res.status(404).json({
        success: false,
        message: 'Target group not found'
      })
    }

    // Create execution record with template variables
    const insertExecution = db.prepare(`
      INSERT INTO script_executions (script_id, target_group_id, execution_mode, template_variables, status, executed_by)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `)

    const executionResult = insertExecution.run(
      id, 
      target_group_id, 
      execution_mode, 
      JSON.stringify(template_variables),
      req.user.id
    )
    const executionId = executionResult.lastInsertRowid

    // Start async execution with processed script
    executeScriptAsync(executionId, processedScript, targetGroup, execution_mode)

    res.json({
      success: true,
      message: 'Script execution started',
      data: {
        executionId,
        status: 'pending'
      }
    })
  } catch (error) {
    console.error('Error starting script execution:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to start script execution'
    })
  }
})

// Get execution status
router.get('/:id/executions/:executionId', authenticateToken, (req, res) => {
  try {
    const { executionId } = req.params

    const execution = db.prepare(`
      SELECT se.*, s.name as script_name, tg.name as target_group_name, u.name as executed_by_name
      FROM script_executions se
      LEFT JOIN scripts s ON se.script_id = s.id
      LEFT JOIN target_groups tg ON se.target_group_id = tg.id
      LEFT JOIN users u ON se.executed_by = u.id
      WHERE se.id = ?
    `).get(executionId)

    if (!execution) {
      return res.status(404).json({
        success: false,
        message: 'Execution not found'
      })
    }

    res.json({
      success: true,
      data: {
        ...execution,
        instance_ids: execution.instance_ids ? JSON.parse(execution.instance_ids) : [],
        template_variables: execution.template_variables ? JSON.parse(execution.template_variables) : {}
      }
    })
  } catch (error) {
    console.error('Error fetching execution status:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch execution status'
    })
  }
})

// Get all executions for a script
router.get('/:id/executions', authenticateToken, (req, res) => {
  try {
    const { id } = req.params
    const { limit = 50, offset = 0 } = req.query

    const executions = db.prepare(`
      SELECT se.*, s.name as script_name, tg.name as target_group_name, u.name as executed_by_name
      FROM script_executions se
      LEFT JOIN scripts s ON se.script_id = s.id
      LEFT JOIN target_groups tg ON se.target_group_id = tg.id
      LEFT JOIN users u ON se.executed_by = u.id
      WHERE se.script_id = ?
      ORDER BY se.started_at DESC
      LIMIT ? OFFSET ?
    `).all(id, parseInt(limit), parseInt(offset))

    // Parse JSON fields and mask sensitive template variables
    const processedExecutions = executions.map(execution => ({
      ...execution,
      instance_ids: execution.instance_ids ? JSON.parse(execution.instance_ids) : [],
      template_variables: execution.template_variables ? 
        maskSensitiveVariables(JSON.parse(execution.template_variables)) : {}
    }))

    res.json({
      success: true,
      data: processedExecutions
    })
  } catch (error) {
    console.error('Error fetching script executions:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch script executions'
    })
  }
})

// Helper function to mask sensitive template variables
function maskSensitiveVariables(variables) {
  const masked = {}
  for (const [key, value] of Object.entries(variables)) {
    const isSensitive = key.toLowerCase().includes('pass') || 
                       key.toLowerCase().includes('key') || 
                       key.toLowerCase().includes('secret') ||
                       key.toLowerCase().includes('token')
    masked[key] = isSensitive ? '••••••••' : value
  }
  return masked
}

// Poll AWS SSM command execution status
async function pollCommandExecution(executionId, awsService, commandId, instanceIds, script, pollCount = 0) {
  const MAX_POLLS = 120 // 10 minutes max (5 second intervals)
  const POLL_INTERVAL = 5000 // 5 seconds

  try {
    // Check if we've exceeded max polling attempts
    if (pollCount >= MAX_POLLS) {
      console.log(`Execution ${executionId}: Max polling attempts reached, marking as timeout`)
      db.prepare(`
        UPDATE script_executions 
        SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run('Execution timeout - command took longer than 10 minutes', executionId)
      return
    }

    console.log(`Execution ${executionId}: Polling attempt ${pollCount + 1}/${MAX_POLLS}`)

    // Get status for all instances
    const instanceStatuses = []
    let allCompleted = true
    let hasFailures = false
    let combinedOutput = ''
    let combinedErrors = ''

    for (const instanceId of instanceIds) {
      const status = await awsService.getCommandStatus(commandId, instanceId)
      instanceStatuses.push({ instanceId, ...status })

      console.log(`Execution ${executionId}: Instance ${instanceId} status: ${status.status}`)

      if (status.status === 'InProgress' || status.status === 'Pending') {
        allCompleted = false
      } else if (status.status === 'Failed' || status.status === 'Cancelled' || status.status === 'TimedOut') {
        hasFailures = true
      }

      // Collect output and errors
      if (status.standardOutputContent) {
        combinedOutput += `\n=== Instance ${instanceId} Output ===\n${status.standardOutputContent}\n`
      }
      if (status.standardErrorContent) {
        combinedErrors += `\n=== Instance ${instanceId} Errors ===\n${status.standardErrorContent}\n`
      }
    }

    if (allCompleted) {
      // All instances have completed
      const finalStatus = hasFailures ? 'failed' : 'success'
      
      // Get template variables from execution record
      const execution = db.prepare('SELECT template_variables FROM script_executions WHERE id = ?').get(executionId)
      const templateVariables = execution?.template_variables ? JSON.parse(execution.template_variables) : {}
      
      const executionSummary = generateExecutionSummary(script, instanceStatuses, combinedOutput, combinedErrors, templateVariables)

      console.log(`Execution ${executionId}: All instances completed with status: ${finalStatus}`)

      if (finalStatus === 'success') {
        db.prepare(`
          UPDATE script_executions 
          SET status = 'success', output = ?, completed_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(executionSummary, executionId)
      } else {
        db.prepare(`
          UPDATE script_executions 
          SET status = 'failed', output = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(executionSummary, combinedErrors || 'Script execution failed on one or more instances', executionId)
      }
    } else {
      // Some instances still running, continue polling
      console.log(`Execution ${executionId}: Some instances still running, scheduling next poll`)
      setTimeout(() => {
        pollCommandExecution(executionId, awsService, commandId, instanceIds, script, pollCount + 1)
      }, POLL_INTERVAL)
    }

  } catch (error) {
    console.error(`Execution ${executionId}: Error during polling:`, error)
    db.prepare(`
      UPDATE script_executions 
      SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(`Polling error: ${error.message}`, executionId)
  }
}

// Generate execution summary with real AWS SSM results
function generateExecutionSummary(script, instanceStatuses, combinedOutput, combinedErrors, templateVariables = {}) {
  const totalInstances = instanceStatuses.length
  const successfulInstances = instanceStatuses.filter(s => s.status === 'Success').length
  const failedInstances = totalInstances - successfulInstances

  let summary = `Script execution completed on ${totalInstances} instance(s).

=== Execution Summary ===
Script: ${script.name}
Runner: ${script.runner_id || 'Unknown'}
Total Instances: ${totalInstances}
Successful: ${successfulInstances}
Failed: ${failedInstances}
Execution Time: ${new Date().toISOString()}`

  // Add template variables if any were used
  if (templateVariables && Object.keys(templateVariables).length > 0) {
    summary += `\n\n=== Template Variables ===`
    for (const [key, value] of Object.entries(templateVariables)) {
      // Mask sensitive values (passwords, keys, etc.)
      const isSensitive = key.toLowerCase().includes('pass') || 
                         key.toLowerCase().includes('key') || 
                         key.toLowerCase().includes('secret') ||
                         key.toLowerCase().includes('token')
      const displayValue = isSensitive ? '••••••••' : value
      summary += `\n${key}: ${displayValue}`
    }
  }

  summary += `\n\n=== Instance Results ===`

  instanceStatuses.forEach(instance => {
    const statusIcon = instance.status === 'Success' ? '✅' : '❌'
    const duration = instance.executionStartDateTime && instance.executionEndDateTime 
      ? ` (${Math.round((new Date(instance.executionEndDateTime) - new Date(instance.executionStartDateTime)) / 1000)}s)`
      : ''
    
    summary += `\n${statusIcon} ${instance.instanceId}: ${instance.status}${duration}`
  })

  if (combinedOutput.trim()) {
    summary += `\n\n=== Combined Output ===\n${combinedOutput.trim()}`
  }

  if (combinedErrors.trim()) {
    summary += `\n\n=== Combined Errors ===\n${combinedErrors.trim()}`
  }

  return summary
}

// Async script execution function
async function executeScriptAsync(executionId, script, targetGroup, executionMode) {
  try {
    // Update status to running
    db.prepare('UPDATE script_executions SET status = ?, started_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('running', executionId)

    // Create AWS service
    const awsService = new AWSService({
      access_key_id: targetGroup.access_key_id,
      secret_access_key: targetGroup.secret_access_key,
      region: targetGroup.region
    })

    // Get instances
    const instancesResult = await awsService.getInstancesByTag(
      targetGroup.aws_tag_key,
      targetGroup.aws_tag_value
    )

    if (!instancesResult.success || instancesResult.instances.length === 0) {
      throw new Error('No instances found for the target group')
    }

    const instanceIds = instancesResult.instances.map(i => i.instanceId)

    // Execute command with runner type
    const commandResult = await awsService.executeCommand(
      instanceIds, 
      script.content, 
      executionMode, 
      script.runner_id
    )

    if (!commandResult.success) {
      throw new Error(commandResult.error)
    }

    // Update execution record with command details
    db.prepare(`
      UPDATE script_executions 
      SET instance_ids = ?, command_id = ?, status = 'running' 
      WHERE id = ?
    `).run(JSON.stringify(commandResult.instanceIds), commandResult.commandId, executionId)

    console.log(`Execution ${executionId}: Command submitted to AWS SSM with ID ${commandResult.commandId} for instances: ${commandResult.instanceIds.join(', ')}`)

    // Start polling AWS SSM for real execution status
    pollCommandExecution(executionId, awsService, commandResult.commandId, commandResult.instanceIds, script)
  } catch (error) {
    console.error('Script execution error:', error)
    db.prepare(`
      UPDATE script_executions 
      SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(error.message, executionId)
  }
}

module.exports = router 