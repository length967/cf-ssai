'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import Navigation from '@/components/Navigation'
import { StatusBadge } from '@/components/ui/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MetricCardsSkeleton, SpinnerLoader } from '@/components/ui/loading-states'

type BeaconEvent = {
  id: string
  event_type: string
  ad_id: string
  pod_id?: string
  channel_id?: string
  timestamp: number
  viewer_id?: string
}

export default function AnalyticsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [beaconEvents, setBeaconEvents] = useState<BeaconEvent[]>([])
  const [channels, setChannels] = useState<any[]>([])
  const [selectedChannel, setSelectedChannel] = useState<string>('all')
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d' | '30d'>('24h')

  // Calculate metrics
  const [metrics, setMetrics] = useState({
    totalImpressions: 0,
    totalStarts: 0,
    totalCompletes: 0,
    totalErrors: 0,
    completionRate: 0,
  })

  useEffect(() => {
    loadData()
  }, [selectedChannel, timeRange])

  const loadData = async () => {
    setLoading(true)
    try {
      // Load channels for filter
      const { channels: channelList } = await api.getChannels()
      setChannels(channelList)

      // Calculate time range
      const now = Date.now()
      const timeRanges = {
        '1h': 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
      }
      const startTime = now - timeRanges[timeRange]

      // Load beacon events
      const params: any = {
        limit: 1000,
      }
      if (selectedChannel !== 'all') {
        params.channel_id = selectedChannel
      }

      const { events } = await api.getBeaconEvents(params)
      
      // Filter by time range
      const filteredEvents = events.filter((e: BeaconEvent) => e.timestamp >= startTime)
      setBeaconEvents(filteredEvents)

      // Calculate metrics
      const impressions = filteredEvents.filter((e: BeaconEvent) => 
        e.event_type === 'imp' || e.event_type === 'impression'
      ).length
      
      const starts = filteredEvents.filter((e: BeaconEvent) => e.event_type === 'start').length
      const completes = filteredEvents.filter((e: BeaconEvent) => e.event_type === 'complete').length
      const errors = filteredEvents.filter((e: BeaconEvent) => e.event_type === 'error').length
      
      const completionRate = starts > 0 ? Math.round((completes / starts) * 100) : 0

      setMetrics({
        totalImpressions: impressions,
        totalStarts: starts,
        totalCompletes: completes,
        totalErrors: errors,
        completionRate,
      })
    } catch (err: any) {
      console.error('Failed to load analytics:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  const getEventStatus = (eventType: string): 'processing' | 'ready' | 'pending' | 'error' | 'inactive' => {
    const statusMap: Record<string, 'processing' | 'ready' | 'pending' | 'error' | 'inactive'> = {
      imp: 'processing',
      impression: 'processing',
      start: 'ready',
      firstQuartile: 'pending',
      midpoint: 'pending',
      thirdQuartile: 'pending',
      complete: 'ready',
      error: 'error',
    }
    return statusMap[eventType] || 'inactive'
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
            <p className="mt-2 text-gray-600">Real-time beacon tracking and performance metrics</p>
          </div>

          {/* Filters */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>Filter analytics data by channel and time range</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Channel
                  </label>
                  <select
                    value={selectedChannel}
                    onChange={(e) => setSelectedChannel(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">All Channels</option>
                    {channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Time Range
                  </label>
                  <select
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="1h">Last Hour</option>
                    <option value="24h">Last 24 Hours</option>
                    <option value="7d">Last 7 Days</option>
                    <option value="30d">Last 30 Days</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          {loading ? (
            <>
              <MetricCardsSkeleton count={5} />
              <SpinnerLoader text="Loading analytics data..." />
            </>
          ) : (
            <>
              {/* Metrics Cards */}
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5 mb-8">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Impressions</CardTitle>
                    <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{metrics.totalImpressions.toLocaleString()}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Starts</CardTitle>
                    <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{metrics.totalStarts.toLocaleString()}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Completes</CardTitle>
                    <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{metrics.totalCompletes.toLocaleString()}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Completion</CardTitle>
                    <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{metrics.completionRate}%</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Errors</CardTitle>
                    <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{metrics.totalErrors.toLocaleString()}</div>
                  </CardContent>
                </Card>
              </div>

              {/* Recent Beacon Events */}
              <Card>
                <CardHeader>
                  <CardTitle>Recent Beacon Events</CardTitle>
                  <CardDescription>
                    Showing last {beaconEvents.length} events
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {beaconEvents.length === 0 ? (
                    <div className="p-12 text-center text-muted-foreground">
                      No beacon events found for the selected filters.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Timestamp
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Event Type
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Ad ID
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Pod ID
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Viewer ID
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {beaconEvents.slice(0, 100).map((event) => (
                            <tr key={event.id}>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {formatTimestamp(event.timestamp)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <StatusBadge
                                  status={getEventStatus(event.event_type)}
                                  label={event.event_type}
                                />
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {event.ad_id}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {event.pod_id || '-'}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {event.viewer_id ? event.viewer_id.substring(0, 8) + '...' : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

