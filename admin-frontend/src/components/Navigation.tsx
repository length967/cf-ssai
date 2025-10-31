'use client'

import { useRouter, usePathname } from 'next/navigation'
import { api } from '@/lib/api'

export default function Navigation() {
  const router = useRouter()
  const pathname = usePathname()

  const isActive = (path: string) => {
    return pathname === path || pathname?.startsWith(path + '/')
  }

  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <button
              onClick={() => router.push('/')}
              className="text-xl font-bold text-blue-600 hover:text-blue-800"
            >
              SSAI Admin
            </button>
            <nav className="ml-8 flex space-x-4">
              <a
                href="/"
                className={`px-3 py-2 ${
                  pathname === '/'
                    ? 'text-blue-600 font-medium'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Dashboard
              </a>
              <a
                href="/channels"
                className={`px-3 py-2 ${
                  isActive('/channels')
                    ? 'text-blue-600 font-medium'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Channels
              </a>
              <a
                href="/ad-pods"
                className={`px-3 py-2 ${
                  isActive('/ad-pods')
                    ? 'text-blue-600 font-medium'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Ad Pods
              </a>
              <a
                href="/analytics"
                className={`px-3 py-2 ${
                  isActive('/analytics')
                    ? 'text-blue-600 font-medium'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Analytics
              </a>
              <a
                href="/settings"
                className={`px-3 py-2 ${
                  isActive('/settings')
                    ? 'text-blue-600 font-medium'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Settings
              </a>
            </nav>
          </div>
          <div className="flex items-center">
            <button
              onClick={() => {
                api.clearToken()
                router.push('/login')
              }}
              className="text-sm text-gray-700 hover:text-gray-900"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}


