import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import { LazyWrapper, lazyWithRetry, preloadCriticalComponents } from './components/LazyComponents'

// Lazy load all page components with retry mechanism
const LoginPage = lazyWithRetry(() => import('./pages/LoginPage'), 'LoginPage')
const WorkspaceSetupPage = lazyWithRetry(() => import('./pages/WorkspaceSetupPage'), 'WorkspaceSetupPage')
const ScriptsPage = lazyWithRetry(() => import('./pages/ScriptsPage'), 'ScriptsPage')
const NewScriptPage = lazyWithRetry(() => import('./pages/NewScriptPage'), 'NewScriptPage')
const ScriptViewPage = lazyWithRetry(() => import('./pages/ScriptViewPage'), 'ScriptViewPage')
const ScriptExecutePage = lazyWithRetry(() => import('./pages/ScriptExecutePage'), 'ScriptExecutePage')
const EditScriptPage = lazyWithRetry(() => import('./pages/EditScriptPage'), 'EditScriptPage')
const TargetGroupsPage = lazyWithRetry(() => import('./pages/TargetGroupsPage'), 'TargetGroupsPage')
const NewTargetGroupPage = lazyWithRetry(() => import('./pages/NewTargetGroupPage'), 'NewTargetGroupPage')
const TargetGroupViewPage = lazyWithRetry(() => import('./pages/TargetGroupViewPage'), 'TargetGroupViewPage')
const EditTargetGroupPage = lazyWithRetry(() => import('./pages/EditTargetGroupPage'), 'EditTargetGroupPage')
const IAMCredentialsPage = lazyWithRetry(() => import('./pages/IAMCredentialsPage'), 'IAMCredentialsPage')
const NewIAMCredentialPage = lazyWithRetry(() => import('./pages/NewIAMCredentialPage'), 'NewIAMCredentialPage')
const EditIAMCredentialPage = lazyWithRetry(() => import('./pages/EditIAMCredentialPage'), 'EditIAMCredentialPage')
const AuditLogPage = lazyWithRetry(() => import('./pages/AuditLogPage'), 'AuditLogPage')
const AdminDashboardPage = lazyWithRetry(() => import('./pages/AdminDashboardPage'), 'AdminDashboardPage')
const RunnersPage = lazyWithRetry(() => import('./pages/RunnersPage'), 'RunnersPage')
const NewRunnerPage = lazyWithRetry(() => import('./pages/NewRunnerPage'), 'NewRunnerPage')
const RunnerViewPage = lazyWithRetry(() => import('./pages/RunnerViewPage'), 'RunnerViewPage')
const EditRunnerPage = lazyWithRetry(() => import('./pages/EditRunnerPage'), 'EditRunnerPage')
const BusinessCaseCreatorPage = lazyWithRetry(() => import('./pages/BusinessCaseCreatorPage'), 'BusinessCaseCreatorPage')
const BusinessCaseUpdatePage = lazyWithRetry(() => import('./pages/BusinessCaseUpdatePage'), 'BusinessCaseUpdatePage')
const BusinessCaseReevaluatePage = lazyWithRetry(() => import('./pages/BusinessCaseReevaluatePage'), 'BusinessCaseReevaluatePage')

// Admin Route Component
const AdminRoute = ({ children }) => {
  const { user, isAuthenticated, isLoading } = useAuth()
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  
  if (user?.role !== 'admin') {
    return <Navigate to="/business-case-creator" replace />
  }
  
  return children
}

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth()
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  
  return children
}

function App() {
  // Start preloading critical components after app initialization
  useEffect(() => {
    preloadCriticalComponents()
  }, [])

  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/setup" element={
            <LazyWrapper>
              <WorkspaceSetupPage />
            </LazyWrapper>
          } />
          <Route path="/login" element={
            <LazyWrapper>
              <LoginPage />
            </LazyWrapper>
          } />
          <Route path="/" element={<Navigate to="/business-case-creator" replace />} />
          <Route 
            path="/scripts" 
            element={
              <ProtectedRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <ScriptsPage />
                  </LazyWrapper>
                </Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/scripts/new" 
            element={
              <ProtectedRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <NewScriptPage />
                  </LazyWrapper>
                </Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/scripts/:id" 
            element={
              <ProtectedRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <ScriptViewPage />
                  </LazyWrapper>
                </Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/scripts/:id/edit" 
            element={
              <ProtectedRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <EditScriptPage />
                  </LazyWrapper>
                </Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/scripts/:id/execute" 
            element={
              <ProtectedRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <ScriptExecutePage />
                  </LazyWrapper>
                </Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin" 
            element={
              <AdminRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <AdminDashboardPage />
                  </LazyWrapper>
                </Layout>
              </AdminRoute>
            } 
          />
          <Route 
            path="/targets" 
            element={
              <AdminRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <TargetGroupsPage />
                  </LazyWrapper>
                </Layout>
              </AdminRoute>
            } 
          />
          <Route 
            path="/targets/new" 
            element={
              <AdminRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <NewTargetGroupPage />
                  </LazyWrapper>
                </Layout>
              </AdminRoute>
            } 
          />
          <Route 
            path="/targets/:id" 
            element={
              <AdminRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <TargetGroupViewPage />
                  </LazyWrapper>
                </Layout>
              </AdminRoute>
            } 
          />
          <Route 
            path="/targets/:id/edit" 
            element={
              <AdminRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <EditTargetGroupPage />
                  </LazyWrapper>
                </Layout>
              </AdminRoute>
            } 
          />
          <Route 
            path="/iam-credentials" 
            element={
              <AdminRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <IAMCredentialsPage />
                  </LazyWrapper>
                </Layout>
              </AdminRoute>
            } 
          />
          <Route 
            path="/iam-credentials/new" 
            element={
              <AdminRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <NewIAMCredentialPage />
                  </LazyWrapper>
                </Layout>
              </AdminRoute>
            } 
          />
          <Route 
            path="/iam-credentials/:id/edit" 
            element={
              <AdminRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <EditIAMCredentialPage />
                  </LazyWrapper>
                </Layout>
              </AdminRoute>
            } 
          />
          <Route
            path="/audit-log"
            element={
              <ProtectedRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <AuditLogPage />
                  </LazyWrapper>
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/business-case-creator"
            element={
              <ProtectedRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <BusinessCaseCreatorPage />
                  </LazyWrapper>
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/business-case-update"
            element={
              <ProtectedRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <BusinessCaseUpdatePage />
                  </LazyWrapper>
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/business-case-reevaluate"
            element={
              <ProtectedRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <BusinessCaseReevaluatePage />
                  </LazyWrapper>
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/runners"
            element={
              <AdminRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <RunnersPage />
                  </LazyWrapper>
                </Layout>
              </AdminRoute>
            } 
          />
          <Route 
            path="/runners/new" 
            element={
              <AdminRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <NewRunnerPage />
                  </LazyWrapper>
                </Layout>
              </AdminRoute>
            } 
          />
          <Route 
            path="/runners/:id" 
            element={
              <AdminRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <RunnerViewPage />
                  </LazyWrapper>
                </Layout>
              </AdminRoute>
            } 
          />
          <Route 
            path="/runners/:id/edit" 
            element={
              <AdminRoute>
                <Layout>
                  <LazyWrapper minimal>
                    <EditRunnerPage />
                  </LazyWrapper>
                </Layout>
              </AdminRoute>
            } 
          />
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App
