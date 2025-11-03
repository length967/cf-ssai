'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SpinnerLoader } from '@/components/ui/loading-states'

export default function Home() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = api.getToken()
    if (!token) {
      router.push('/login')
    } else {
      setLoading(false)
    }
  }, [router])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <SpinnerLoader />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-xl font-bold text-primary">SSAI Admin</h1>
              </div>
            </div>
            <div className="flex items-center space-x-4">
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

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-gray-900">Dashboard</h2>
            <p className="mt-2 text-gray-600">Welcome to the SSAI Admin Platform</p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Card
              onClick={() => router.push('/channels')}
              className="cursor-pointer hover:shadow-lg transition-shadow"
            >
              <CardHeader className="flex flex-row items-center space-y-0 space-x-4 pb-2">
                <div className="flex-shrink-0">
                  <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <CardTitle>Channels</CardTitle>
                  <CardDescription>Manage live streams</CardDescription>
                </div>
              </CardHeader>
            </Card>

            <Card
              onClick={() => router.push('/ads')}
              className="cursor-pointer hover:shadow-lg transition-shadow"
            >
              <CardHeader className="flex flex-row items-center space-y-0 space-x-4 pb-2">
                <div className="flex-shrink-0">
                  <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <CardTitle>Ads Library</CardTitle>
                  <CardDescription>Upload commercials</CardDescription>
                </div>
              </CardHeader>
            </Card>

            <Card
              onClick={() => router.push('/ad-pods')}
              className="cursor-pointer hover:shadow-lg transition-shadow"
            >
              <CardHeader className="flex flex-row items-center space-y-0 space-x-4 pb-2">
                <div className="flex-shrink-0">
                  <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                  </svg>
                </div>
                <div>
                  <CardTitle>Ad Pods</CardTitle>
                  <CardDescription>Manage ad assets</CardDescription>
                </div>
              </CardHeader>
            </Card>

            <Card
              onClick={() => router.push('/slates')}
              className="cursor-pointer hover:shadow-lg transition-shadow"
            >
              <CardHeader className="flex flex-row items-center space-y-0 space-x-4 pb-2">
                <div className="flex-shrink-0">
                  <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <CardTitle>Slates</CardTitle>
                  <CardDescription>Ad break placeholders</CardDescription>
                </div>
              </CardHeader>
            </Card>

            <Card
              onClick={() => router.push('/analytics')}
              className="cursor-pointer hover:shadow-lg transition-shadow"
            >
              <CardHeader className="flex flex-row items-center space-y-0 space-x-4 pb-2">
                <div className="flex-shrink-0">
                  <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <div>
                  <CardTitle>Analytics</CardTitle>
                  <CardDescription>View metrics</CardDescription>
                </div>
              </CardHeader>
            </Card>

            <Card
              onClick={() => router.push('/settings')}
              className="cursor-pointer hover:shadow-lg transition-shadow"
            >
              <CardHeader className="flex flex-row items-center space-y-0 space-x-4 pb-2">
                <div className="flex-shrink-0">
                  <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <CardTitle>Settings</CardTitle>
                  <CardDescription>Configuration</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </div>

          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="text-blue-900">Getting Started</CardTitle>
              <CardDescription>
                This is the SSAI Admin Platform. Use the cards above to navigate to different sections.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                <li><strong>Channels:</strong> Create and manage your live stream channels with SCTE-35 and VAST configuration</li>
                <li><strong>Ads Library:</strong> Upload video commercials and manage transcoded ad variants</li>
                <li><strong>Ad Pods:</strong> Create ad pods from transcoded assets with multi-bitrate support</li>
                <li><strong>Slates:</strong> Generate or upload "We'll Be Right Back" videos for ad break padding</li>
                <li><strong>Analytics:</strong> View beacon tracking and performance metrics</li>
                <li><strong>Settings:</strong> Configure organization, workers, users, and API keys</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}

