const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const config = require('../config')

// Import routes
const authRoutes = require('./routes/auth')
const scriptsRoutes = require('./routes/scripts')
const targetGroupsRoutes = require('./routes/targetGroups')
const iamCredentialsRoutes = require('./routes/iamCredentials')
const auditLogsRoutes = require('./routes/auditLogs')
const runnersRoutes = require('./routes/runners')
const businessCaseCreatorRoutes = require('./routes/businessCaseCreator')

// Initialize database
require('./database/db')

// Ensure system-owned script rows exist for features that need them as
// FK targets for audit logs (Business Case Creator). Idempotent.
const { ensureSystemScripts } = require('./services/systemScripts')
ensureSystemScripts()

// One-time bootstrap: if BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD are
// set, upsert that user as an admin with that password. Used to seed/reset an
// admin login on a fresh deploy before Google OAuth is wired up. Unset both
// env vars after first successful sign-in.
;(async () => {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD
  if (!email || !password) return
  try {
    const bcrypt = require('bcryptjs')
    const { db } = require('./database/db')
    const WorkspaceService = require('./services/workspaceService')
    const hash = await bcrypt.hash(password, 12)
    const workspace = WorkspaceService.isWorkspaceInitialized()
      ? WorkspaceService.getWorkspace()
      : null
    const workspaceId = workspace?.id || null
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
    if (existing) {
      db.prepare(`
        UPDATE users
        SET password_hash = ?, role = 'admin', is_active = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(hash, existing.id)
      console.log(`✅ Bootstrap: reset password for existing admin ${email}`)
    } else {
      const name = email.split('@')[0]
      db.prepare(`
        INSERT INTO users (email, password_hash, name, role, workspace_id, is_active)
        VALUES (?, ?, ?, 'admin', ?, 1)
      `).run(email, hash, name, workspaceId)
      console.log(`✅ Bootstrap: created admin ${email}`)
    }
  } catch (e) {
    console.error('❌ Bootstrap admin failed:', e.message)
  }
})()

const app = express()

// Security middleware with relaxed CSP for development
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", "https:", "data:"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"], // Allow all HTTPS images
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "https:", "'unsafe-inline'"],
      upgradeInsecureRequests: [],
    },
  },
}))

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true)

    // Wildcard: allow any origin
    if (config.cors.allowedOrigins.includes('*')) return callback(null, true)

    // Normalize by stripping http:// and https:// from both the incoming
    // origin and the allowed list, so entries with or without a protocol match.
    const strip = (o) => o.replace(/^https?:\/\//, '')
    const strippedOrigin = strip(origin)
    const allowed = config.cors.allowedOrigins.map(strip)

    if (allowed.indexOf(strippedOrigin) !== -1) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true
}))

// Logging middleware
if (config.server.nodeEnv === 'development') {
  app.use(morgan('dev'))
} else {
  app.use(morgan('combined'))
}

// Body parsing middleware
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Backend API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  })
})

// API routes
app.use('/api/auth', authRoutes)
app.use('/api/scripts', scriptsRoutes)
app.use('/api/target-groups', targetGroupsRoutes)
app.use('/api/iam-credentials', iamCredentialsRoutes)
app.use('/api/audit-logs', auditLogsRoutes)
app.use('/api/runners', runnersRoutes)
app.use('/api/business-case-creator', businessCaseCreatorRoutes)

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  })
})

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  
  res.status(500).json({
    success: false,
    message: config.server.nodeEnv === 'development' ? err.message : 'Internal server error'
  })
})

// Start server
const PORT = config.server.port

app.listen(PORT, () => {
  console.log(`🚀 Backend Server is running on port ${PORT}`)
  console.log(`📊 Environment: ${config.server.nodeEnv}`)
  console.log(`🔗 API Base URL: http://localhost:${PORT}`)
  console.log(`🏥 Health Check: http://localhost:${PORT}/health`)
  
  if (config.server.nodeEnv === 'development') {
    console.log('\n📚 Available API Endpoints:')
    console.log('  - POST /api/auth/login')
    console.log('  - GET  /api/auth/me')
    console.log('  - POST /api/auth/logout')
    console.log('  - GET  /api/scripts')
    console.log('  - POST /api/scripts')
    console.log('  - GET  /api/scripts/:id')
    console.log('  - PUT  /api/scripts/:id')
    console.log('  - DELETE /api/scripts/:id')
    console.log('  - POST /api/scripts/:id/execute')
    console.log('  - GET  /api/target-groups')
    console.log('  - POST /api/target-groups')
    console.log('  - GET  /api/target-groups/:id')
    console.log('  - GET  /api/target-groups/:id/preview')
    console.log('  - PUT  /api/target-groups/:id')
    console.log('  - DELETE /api/target-groups/:id')
    console.log('  - GET  /api/iam-credentials')
    console.log('  - POST /api/iam-credentials')
    console.log('  - GET  /api/iam-credentials/:id')
    console.log('  - PUT  /api/iam-credentials/:id')
    console.log('  - DELETE /api/iam-credentials/:id')
    console.log('  - GET  /api/audit-logs')
    console.log('  - GET  /api/audit-logs/:id')
    console.log('  - GET  /api/runners')
    console.log('  - POST /api/runners')
    console.log('  - GET  /api/runners/:id')
    console.log('  - PUT  /api/runners/:id')
    console.log('  - DELETE /api/runners/:id')
  }
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server gracefully...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down server gracefully...')
  process.exit(0)
})

module.exports = app 