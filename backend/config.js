const path = require('path')
// Load backend/.env first (if present), then fall back to the repo-root .env.
// dotenv does not override already-set vars, so backend/.env and the process
// environment take precedence over the root file.
require('dotenv').config()
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

module.exports = {
  server: {
    port: process.env.PORT || 3001,
    nodeEnv: process.env.NODE_ENV || 'development'
  },
  database: {
    path: process.env.DB_PATH || './data/dev.db'
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '1d'
  },
  aws: {
    defaultRegion: process.env.AWS_DEFAULT_REGION || 'us-east-1'
  },
  cors: {
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    allowedOrigins: process.env.ALLOWED_ORIGINS ? 
      process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()) : 
      ['http://localhost:5173', 'http://localhost:3000']
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || ''
  },
  metabase: {
    // Base URL of the Metabase instance, e.g. https://metabase.example.com
    url: process.env.METABASE_URL || '',
    // Metabase API key (sent as the x-api-key header). Metabase 0.49+.
    apiKey: process.env.METABASE_API_KEY || '',
    // Saved question (card) that returns candidate emails for a problem.
    candidateEmailsCardId: process.env.METABASE_CANDIDATE_EMAILS_CARD_ID
      ? Number(process.env.METABASE_CANDIDATE_EMAILS_CARD_ID)
      : null,
    // Slug of the card's problem-id template tag / parameter.
    candidateEmailsParam: process.env.METABASE_CANDIDATE_EMAILS_PARAM || 'problem_id',

    // Update tab: search problems by name/title (text param).
    problemSearchCardId: process.env.METABASE_PROBLEM_SEARCH_CARD_ID
      ? Number(process.env.METABASE_PROBLEM_SEARCH_CARD_ID)
      : null,
    problemSearchParam: process.env.METABASE_PROBLEM_SEARCH_PARAM || 'search',

    // Update tab: list a problem's current metric associations (number param).
    problemMetricsCardId: process.env.METABASE_PROBLEM_METRICS_CARD_ID
      ? Number(process.env.METABASE_PROBLEM_METRICS_CARD_ID)
      : null,
    problemMetricsParam: process.env.METABASE_PROBLEM_METRICS_PARAM || 'problem_id',

    // Update tab: search evaluation metrics by name (text param).
    metricSearchCardId: process.env.METABASE_METRIC_SEARCH_CARD_ID
      ? Number(process.env.METABASE_METRIC_SEARCH_CARD_ID)
      : null,
    metricSearchParam: process.env.METABASE_METRIC_SEARCH_PARAM || 'search'
  }
} 