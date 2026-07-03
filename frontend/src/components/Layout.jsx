import { Link, useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Button } from './ui/button'
import {
  Code,
  FileText,
  Target,
  History,
  LogOut,
  Menu,
  X,
  User,
  Key,
  Shield,
  Play,
  PencilLine,
  RefreshCw
} from 'lucide-react'
import { useState, useCallback } from 'react'
import { authAPI } from '../lib/api'

const Layout = ({ children }) => {
  const { user, workspace, logout, isAuthenticated } = useAuth()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  const navigation = [
    { name: 'Business Case Creator', href: '/business-case-creator', icon: FileText },
    { name: 'Update Business Case', href: '/business-case-update', icon: PencilLine },
    { name: 'Reevaluate Responses', href: '/business-case-reevaluate', icon: RefreshCw },
    // Admin-only configuration for the Business Case feature
    ...(user?.role === 'admin' ? [
      { name: 'Target Groups', href: '/targets', icon: Target },
      { name: 'IAM Credentials', href: '/iam-credentials', icon: Key },
    ] : []),
    { name: 'Audit Log', href: '/audit-log', icon: History },
  ]

  const handleLogout = async () => {
    await logout()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 flex z-40 md:hidden">
          <div className="fixed inset-0 bg-gray-900 bg-opacity-75 transition-opacity" onClick={() => setSidebarOpen(false)} />
          <div className="relative flex-1 flex flex-col max-w-xs w-full bg-white shadow-xl">
            <div className="absolute top-0 right-0 -mr-12 pt-2">
              <button
                className="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white text-white hover:bg-gray-600 transition-colors"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <SidebarContent navigation={navigation} location={location} user={user} workspace={workspace} onLogout={handleLogout} />
          </div>
        </div>
      )}

      {/* Static sidebar for desktop */}
      <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 z-30">
        <SidebarContent navigation={navigation} location={location} user={user} workspace={workspace} onLogout={handleLogout} />
      </div>

      {/* Main content */}
      <div className="md:pl-64 flex flex-col flex-1">
        {/* Top bar for mobile */}
        <div className="sticky top-0 z-20 md:hidden bg-white shadow-sm border-b border-gray-200">
          <div className="flex items-center justify-between px-4 py-3">
            <button
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-500 hover:text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 transition-colors"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-6 w-6" />
            </button>
            <div className="flex items-center space-x-2">
              {workspace?.logoBase64 ? (
                <img
                  src={workspace.logoBase64}
                  alt="Workspace Logo"
                  className="h-6 w-6 object-contain"
                />
              ) : (
                <Code className="h-6 w-6 text-blue-600" />
              )}
              <span className="text-lg font-semibold text-gray-900">
                {workspace?.name || 'Scaler'}
              </span>
            </div>
            <div className="w-10" /> {/* Spacer for centering */}
          </div>
        </div>

        {/* Page content */}
        <main className="flex-1">
          <div className="py-8">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

const SidebarContent = ({ navigation, location, user, workspace, onLogout }) => (
  <div className="flex-1 flex flex-col min-h-0 bg-white shadow-xl border-r border-gray-200">
    <div className="flex-1 flex flex-col pt-5 pb-4 overflow-y-auto">
      {/* Logo */}
      <div className="flex items-center flex-shrink-0 px-6 mb-8">
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-2 rounded-lg shadow-lg border border-blue-200">
            {workspace?.logoBase64 ? (
              <img
                src={workspace.logoBase64}
                alt="Workspace Logo"
                className="h-10 w-10 object-contain"
              />
            ) : (
              <Code className="h-10 w-10 text-blue-600" />
            )}
          </div>
          <div>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
              {workspace?.name || 'Scaler'}
            </span>
            <p className="text-xs text-gray-500 mt-0.5">
              Script Management
              {workspace?.emailDomain && (
                <span className="block text-xs text-blue-600 font-medium">
                  @{workspace.emailDomain}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 space-y-2">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href || 
            (item.href !== '/scripts' && location.pathname.startsWith(item.href))
          return (
            <Link
              key={item.name}
              to={item.href}
              className={`group flex items-center px-3 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                isActive
                  ? 'bg-gradient-to-r from-blue-50 to-blue-100 text-blue-700 shadow-sm border border-blue-200'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <item.icon
                className={`mr-3 flex-shrink-0 h-5 w-5 transition-colors ${
                  isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-500'
                }`}
              />
              {item.name}
              {isActive && (
                <div className="ml-auto w-2 h-2 bg-blue-600 rounded-full"></div>
              )}
            </Link>
          )
        })}
      </nav>
    </div>

    {/* User section */}
    <div className="flex-shrink-0 border-t border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0">
            <AvatarImage user={user} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex-col items-center space-x-2">
              <p className="text-sm font-semibold text-gray-900 truncate">{user?.name}</p>
              {user?.role === 'admin' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                  Admin
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500 truncate">{user?.email}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onLogout}
          className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  </div>
)

const AvatarImage = ({ user }) => {
  const [imageError, setImageError] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  
  const handleImageError = useCallback(() => {
    if (retryCount < 2) {
      // Retry loading the image up to 2 times
      setTimeout(() => {
        setRetryCount(prev => prev + 1)
        setImageError(false)
      }, 1000 * (retryCount + 1)) // Progressive delay
    } else {
      setImageError(true)
    }
  }, [retryCount])

  const handleImageLoad = useCallback(() => {
    setImageError(false)
    setRetryCount(0)
  }, [])

  if (!user?.avatar_url || imageError) {
    return (
      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
        <span className="text-sm font-semibold text-white">
          {user?.name?.[0] || user?.email?.[0] || 'U'}
        </span>
      </div>
    )
  }

  // Try proxied version first, fallback to direct Google URL
  const avatarUrl = retryCount === 0 
    ? authAPI.getAvatarUrl(user.id)
    : user.avatar_url

  return (
    <img
      src={`${avatarUrl}?t=${Date.now()}&retry=${retryCount}`}
      alt="User Avatar"
      className="h-10 w-10 rounded-full shadow-lg"
      onError={handleImageError}
      onLoad={handleImageLoad}
      loading="lazy"
      crossOrigin="anonymous"
    />
  )
}

export default Layout 