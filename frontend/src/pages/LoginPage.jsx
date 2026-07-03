import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Code, Lock, Mail, ArrowRight, Shield, Users, Zap } from 'lucide-react'

const LoginPage = () => {
  const { login, googleLogin, workspace, isWorkspaceInitialized, isAuthenticated } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('') 

  // Initialize Google Sign-In
  useEffect(() => {
    const initializeGoogleSignIn = () => {
      if (window.google && workspace?.emailDomain) {
        window.google.accounts.id.initialize({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
          callback: handleGoogleResponse,
          hd: workspace.emailDomain, // Restrict to workspace domain
        })
        
        window.google.accounts.id.renderButton(
          document.getElementById('google-signin-button'),
          {
            theme: 'outline',
            size: 'large',
            width: '100%',
            text: 'signin_with',
          }
        )
      }
    }

    // Load Google Sign-In script
    if (!window.google) {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = initializeGoogleSignIn
      document.head.appendChild(script)
    } else {
      initializeGoogleSignIn()
    }
  }, [workspace])

  const handleGoogleResponse = async (response) => {
    try {
      setLoading(true)
      setError('')
      
      const result = await googleLogin(response.credential)
      if (!result.success) {
        setError(result.message || 'Google sign-in failed')
      }
    } catch (err) {
      setError(err.message || 'Google sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const result = await login(email, password)
      if (result.success) {
        // Login successful, navigate handled by AuthContext
      } else {
        setError(result.message || 'Login failed')
      }
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const features = [
    {
      icon: Code,
      title: 'Script Management',
      description: 'Create, organize, and execute scripts across your infrastructure'
    },
    {
      icon: Shield,
      title: 'Secure Execution',
      description: 'Run scripts safely with built-in security controls and audit trails'
    },
    {
      icon: Users,
      title: 'Team Collaboration',
      description: 'Share scripts and collaborate with your team seamlessly'
    },
    {
      icon: Zap,
      title: 'Fast & Reliable',
      description: 'Lightning-fast execution with comprehensive monitoring'
    }
  ]

  // Redirect to workspace setup if not initialized
  if (!isWorkspaceInitialized) {
    return <Navigate to="/setup" replace />
  }

  if (isAuthenticated) {
    return <Navigate to="/scripts" replace />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-slate-100 flex items-center justify-center p-8">
      {/* Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-0 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-purple-500/3 rounded-full blur-3xl"></div>
      </div>

      {/* Centered Login Card */}
      <div className="relative z-10 w-full max-w-lg">
        {/* Logo */}
        <div className="flex items-center justify-center space-x-3 mb-12">
          {workspace?.logoBase64 ? (
            <div className="relative">
              <div className="absolute inset-0 bg-white/20 rounded-2xl blur-xl"></div>
              <img
                src={workspace.logoBase64}
                alt="Workspace Logo"
                className="relative h-16 w-16 object-contain rounded-2xl bg-white/10 backdrop-blur-sm p-3 border border-gray-200 shadow-xl"
              />
            </div>
          ) : (
            <div className="relative">
              <div className="absolute inset-0 bg-blue-500/30 rounded-2xl blur-xl"></div>
              <div className="relative bg-gradient-to-br from-blue-500 to-blue-600 p-4 rounded-2xl shadow-xl">
                <Code className="h-10 w-10 text-white" />
              </div>
            </div>
          )}
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
              {workspace?.name || 'Scaler'}
            </h1>
            <p className="text-gray-600 text-lg font-medium">Script Management Platform</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
          {/* Header with gradient */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-8 text-center">
            <h2 className="text-3xl font-bold text-white mb-2">Welcome Back</h2>
            <p className="text-blue-100">
              Sign in to access your {workspace?.name || 'workspace'} dashboard
            </p>
          </div>

          <div className="px-8 py-10">
            {/* Google Sign-In */}
            {workspace?.emailDomain ? (
              <div className="space-y-6">
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center space-x-3">
                    <div className="bg-red-100 rounded-full p-1">
                      <Mail className="h-4 w-4 text-red-600" />
                    </div>
                    <p className="text-red-700 text-sm font-medium">{error}</p>
                  </div>
                )}
                
                <div className="space-y-4">
                  <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                    <div className="text-center mb-4">
                      <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full mb-3">
                        <Mail className="h-6 w-6 text-white" />
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-1">Google Workspace Sign-In</h3>
                      <p className="text-sm text-gray-600">
                        Use your @{workspace.emailDomain} account
                      </p>
                    </div>
                    <div id="google-signin-button" className="w-full flex justify-center"></div>
                  </div>

                  {/* Security Notice */}
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                    <div className="flex items-start space-x-3">
                      <Shield className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <h4 className="text-sm font-semibold text-blue-900 mb-1">Secure Access</h4>
                        <p className="text-xs text-blue-700">
                          Your login is protected by Google's enterprise security and restricted to your organization's domain.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {loading && (
                  <div className="flex items-center justify-center py-6 bg-gray-50 rounded-xl border border-gray-200">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
                    <span className="text-gray-700 font-medium">Authenticating...</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-6"></div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Loading Workspace</h3>
                <p className="text-gray-600">Preparing your sign-in experience...</p>
              </div>
            )}

            {/* Email/Password fallback — always shown so the app is usable
                before Google OAuth is configured for this deployment. */}
            {true && (
              <div className="mt-8">
                <div className="border-t border-gray-200 pt-8">
                  <details className="cursor-pointer group">
                    <summary className="flex items-center justify-center space-x-2 text-sm font-medium text-amber-700 hover:text-amber-800 transition-colors">
                      <Lock className="h-4 w-4" />
                      <span>Sign in with email & password</span>
                      <ArrowRight className="h-3 w-3 group-open:rotate-90 transition-transform" />
                    </summary>
                    <div className="mt-6 p-6 bg-amber-50 rounded-xl border border-amber-200">
                      <div className="text-center mb-4">
                        <div className="inline-flex items-center justify-center w-10 h-10 bg-amber-100 rounded-full mb-2">
                          <Lock className="h-5 w-5 text-amber-600" />
                        </div>
                        <h4 className="text-sm font-semibold text-amber-900">Email & Password Sign-In</h4>
                      </div>
                      <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                          <label htmlFor="email" className="text-sm font-medium text-amber-900">
                            Email Address
                          </label>
                          <div className="relative">
                            <Mail className="absolute left-3 top-3 h-4 w-4 text-amber-500" />
                            <Input
                              id="email"
                              type="email"
                              placeholder="admin@scaler.com"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              className="pl-10 border-amber-300 focus:border-amber-500 focus:ring-amber-500 bg-white"
                              required
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label htmlFor="password" className="text-sm font-medium text-amber-900">
                            Password
                          </label>
                          <div className="relative">
                            <Lock className="absolute left-3 top-3 h-4 w-4 text-amber-500" />
                            <Input
                              id="password"
                              type="password"
                              placeholder="Enter your password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              className="pl-10 border-amber-300 focus:border-amber-500 focus:ring-amber-500 bg-white"
                              required
                            />
                          </div>
                        </div>
                        <Button 
                          type="submit" 
                          className="w-full bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 shadow-lg text-white font-medium py-2.5 rounded-lg transition-all" 
                          disabled={loading}
                        >
                          {loading ? (
                            <div className="flex items-center justify-center">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                              Signing in...
                            </div>
                          ) : (
                            'Admin Sign In'
                          )}
                        </Button>
                      </form>
                    </div>
                  </details>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-sm text-gray-500">
            @alwayswannaly
          </p>
        </div>
      </div>
    </div>
  )
}

export default LoginPage 