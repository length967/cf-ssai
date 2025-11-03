'use client'

import { useRouter, usePathname } from 'next/navigation'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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
            <nav className="ml-8 flex space-x-1">
              <a
                href="/"
                className={cn(
                  "px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  pathname === '/'
                    ? "bg-primary/10 text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                Dashboard
              </a>
              <a
                href="/channels"
                className={cn(
                  "px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive('/channels')
                    ? "bg-primary/10 text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                Channels
              </a>
              <a
                href="/ads"
                className={cn(
                  "px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive('/ads')
                    ? "bg-primary/10 text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                Ads Library
              </a>
              <a
                href="/ad-pods"
                className={cn(
                  "px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive('/ad-pods')
                    ? "bg-primary/10 text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                Ad Pods
              </a>
              <a
                href="/slates"
                className={cn(
                  "px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive('/slates')
                    ? "bg-primary/10 text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                Slates
              </a>
              <a
                href="/analytics"
                className={cn(
                  "px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive('/analytics')
                    ? "bg-primary/10 text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                Analytics
              </a>
              <a
                href="/settings"
                className={cn(
                  "px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive('/settings')
                    ? "bg-primary/10 text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                Settings
              </a>
            </nav>
          </div>
          <div className="flex items-center">
            <Button
              variant="ghost"
              onClick={() => {
                api.clearToken()
                router.push('/login')
              }}
            >
              Logout
            </Button>
          </div>
        </div>
      </div>
    </nav>
  )
}


