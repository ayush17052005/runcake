
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api'

// Token management
const getToken = () => {
  return localStorage.getItem('auth_token')
}

const setToken = (token) => {
  localStorage.setItem('auth_token', token)
}

const removeToken = () => {
  localStorage.removeItem('auth_token')
}

const getAuthHeaders = () => {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Generic API call function
const apiCall = async (endpoint, options = {}) => {
  const url = `${API_BASE_URL}${endpoint}`
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options.headers,
    },
    ...options,
  }

  if (options.body && typeof options.body === 'object') {
    config.body = JSON.stringify(options.body)
  }

  try {
    const response = await fetch(url, config)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'API request failed')
    }

    return data
  } catch (error) {
    console.error('API call failed:', error)
    throw error
  }
}

// Authentication API
export const authAPI = {
  login: async (email, password) => {
    const response = await apiCall('/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    if (response.success && response.data.token) {
      setToken(response.data.token)
    }
    return response
  },

  googleLogin: async (credential) => {
    const response = await apiCall('/auth/google', {
      method: 'POST',
      body: { credential },
    })
    if (response.success && response.data.token) {
      setToken(response.data.token)
    }
    return response
  },

  logout: async () => {
    try {
      await apiCall('/auth/logout', { method: 'POST' })
    } catch (error) {
      console.warn('Logout API call failed:', error)
    } finally {
      removeToken()
    }
  },

  getCurrentUser: async () => {
    return apiCall('/auth/me')
  },

  getAvatarUrl: (userId) => {
    return `${API_BASE_URL}/auth/avatar/${userId}`
  }
}

// Workspace API
export const workspaceAPI = {
  getStatus: async () => {
    return apiCall('/auth/workspace/status', { headers: {} }) // No auth needed for status check
  },

  initialize: async (workspaceData) => {
    const response = await apiCall('/auth/workspace/initialize', {
      method: 'POST',
      body: workspaceData,
    })
    if (response.success && response.data.token) {
      setToken(response.data.token)
    }
    return response
  },

  get: async () => {
    return apiCall('/auth/workspace')
  },

  update: async (workspaceData) => {
    return apiCall('/auth/workspace', {
      method: 'PUT',
      body: workspaceData,
    })
  },

  getUsers: async () => {
    return apiCall('/auth/workspace/users')
  },

  updateUser: async (userId, userData) => {
    return apiCall(`/auth/workspace/users/${userId}`, {
      method: 'PUT',
      body: userData,
    })
  },
}

// Scripts API
export const scriptsAPI = {
  getAll: async () => {
    return apiCall('/scripts')
  },

  getById: async (id) => {
    return apiCall(`/scripts/${id}`)
  },

  create: async (script) => {
    return apiCall('/scripts', {
      method: 'POST',
      body: script,
    })
  },

  update: async (id, script) => {
    return apiCall(`/scripts/${id}`, {
      method: 'PUT',
      body: script,
    })
  },

  delete: async (id) => {
    return apiCall(`/scripts/${id}`, {
      method: 'DELETE',
    })
  },

  execute: async (id, targetGroupId, executionMode = 'all', templateVariables = {}) => {
    return apiCall(`/scripts/${id}/execute`, {
      method: 'POST',
      body: {
        target_group_id: targetGroupId,
        execution_mode: executionMode,
        template_variables: templateVariables,
      },
    })
  },

  getTemplateVariables: async (id) => {
    return apiCall(`/scripts/${id}/template-variables`)
  },

  getExecutionStatus: async (scriptId, executionId) => {
    return apiCall(`/scripts/${scriptId}/executions/${executionId}`)
  },
}

// Target Groups API
export const targetGroupsAPI = {
  getAll: async () => {
    return apiCall('/target-groups')
  },

  getById: async (id) => {
    return apiCall(`/target-groups/${id}`)
  },

  preview: async (id) => {
    return apiCall(`/target-groups/${id}/preview`)
  },

  create: async (targetGroup) => {
    return apiCall('/target-groups', {
      method: 'POST',
      body: targetGroup,
    })
  },

  update: async (id, targetGroup) => {
    return apiCall(`/target-groups/${id}`, {
      method: 'PUT',
      body: targetGroup,
    })
  },

  delete: async (id) => {
    return apiCall(`/target-groups/${id}`, {
      method: 'DELETE',
    })
  },
}

// IAM Credentials API
export const iamCredentialsAPI = {
  getAll: async () => {
    return apiCall('/iam-credentials')
  },

  getById: async (id) => {
    return apiCall(`/iam-credentials/${id}`)
  },

  create: async (credentials) => {
    return apiCall('/iam-credentials', {
      method: 'POST',
      body: credentials,
    })
  },

  update: async (id, credentials) => {
    return apiCall(`/iam-credentials/${id}`, {
      method: 'PUT',
      body: credentials,
    })
  },

  delete: async (id) => {
    return apiCall(`/iam-credentials/${id}`, {
      method: 'DELETE',
    })
  },
}

// Audit Logs API
export const auditLogsAPI = {
  getAll: async (params = {}) => {
    const queryString = new URLSearchParams(params).toString()
    const endpoint = queryString ? `/audit-logs?${queryString}` : '/audit-logs'
    return apiCall(endpoint)
  },

  getById: async (id) => {
    return apiCall(`/audit-logs/${id}`)
  },

  getStats: async () => {
    return apiCall('/audit-logs/stats/overview')
  },
}

// Business Case Creator API
export const businessCaseCreatorAPI = {
  orchestrate: async (payload) => {
    return apiCall('/business-case-creator/orchestrate', {
      method: 'POST',
      body: payload,
    })
  },

  // Async: returns { executionId }. Poll getExecution to retrieve the
  // `parsed.metrics` / `parsed.missing` once status='success'.
  previewMetrics: async (payload) => {
    return apiCall('/business-case-creator/preview-metrics', {
      method: 'POST',
      body: payload,
    })
  },

  getExecution: async (executionId) => {
    return apiCall(`/business-case-creator/executions/${executionId}`)
  },
}

// Runners API
export const runnersAPI = {
  getAll: async () => {
    return apiCall('/runners')
  },

  getById: async (id) => {
    return apiCall(`/runners/${id}`)
  },

  create: async (runner) => {
    return apiCall('/runners', {
      method: 'POST',
      body: runner,
    })
  },

  update: async (id, runner) => {
    return apiCall(`/runners/${id}`, {
      method: 'PUT',
      body: runner,
    })
  },

  delete: async (id) => {
    return apiCall(`/runners/${id}`, {
      method: 'DELETE',
    })
  },
}

// Health check
export const healthAPI = {
  check: async () => {
    return apiCall('/health', { headers: {} }) // No auth needed for health check
  },
}

// Export token management for components
export { getToken, setToken, removeToken } 