'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import Navigation from '@/components/Navigation'
import { Button } from '@/components/ui/button'
import { ChannelTable } from './components/ChannelTable'
import { ChannelDialog } from './components/ChannelDialog'
import { Channel, Organization, Slate, ChannelFormData } from './components/types'
import { TableSkeleton, EmptyState } from '@/components/ui/loading-states'

export default function ChannelsPage() {
  const router = useRouter()
  const [channels, setChannels] = useState<Channel[]>([])
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [slates, setSlates] = useState<Slate[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [channelsData, orgData, slatesData] = await Promise.all([
        api.getChannels(),
        api.getOrganization(),
        api.listSlates().catch(() => ({ slates: [] }))
      ])
      setChannels(channelsData.channels)
      setOrganization(orgData.organization)
      setSlates(slatesData.slates || [])
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const loadChannels = async () => {
    try {
      const { channels: channelList } = await api.getChannels()
      setChannels(channelList)
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to load channels')
    }
  }

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const openCreateModal = () => {
    setEditingChannel(null)
    setShowModal(true)
  }

  const openEditModal = (channel: Channel) => {
    setEditingChannel(channel)
    setShowModal(true)
  }

  const handleSave = async (formData: ChannelFormData) => {
    const payload = {
      ...formData,
      scte35_enabled: formData.scte35_enabled ? 1 : 0,
      scte35_auto_insert: formData.scte35_auto_insert ? 1 : 0,
      vast_enabled: formData.vast_enabled ? 1 : 0,
      time_based_auto_insert: formData.time_based_auto_insert ? 1 : 0,
      settings: formData.settings,
      bitrate_ladder: formData.bitrate_ladder.length > 0 ? formData.bitrate_ladder : undefined,
      bitrate_ladder_source: formData.bitrate_ladder_source,
      detected_bitrates: formData.detected_bitrates.length > 0 ? formData.detected_bitrates : undefined,
      last_bitrate_detection: formData.bitrate_ladder_source === 'auto' ? Date.now() : undefined
    }

    if (editingChannel) {
      await api.updateChannel(editingChannel.id, payload)
      showMessage('success', 'Channel updated successfully')
    } else {
      await api.createChannel(payload)
      showMessage('success', 'Channel created successfully')
    }

    loadChannels()
  }

  const handleDelete = async (channel: Channel) => {
    if (!confirm(`Are you sure you want to delete "${channel.name}"?`)) return

    try {
      await api.deleteChannel(channel.id)
      showMessage('success', 'Channel deleted successfully')
      loadChannels()
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to delete channel')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Channels</h1>
              <p className="mt-2 text-gray-600">Manage your live stream channels</p>
            </div>
            <Button onClick={openCreateModal} variant="default">
              + New Channel
            </Button>
          </div>

          {/* Message banner */}
          {message && (
            <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              {message.text}
            </div>
          )}

          {/* Channels List */}
          {loading ? (
            <TableSkeleton rows={5} columns={6} />
          ) : channels.length === 0 ? (
            <EmptyState
              title="No channels yet. Create your first channel to get started."
              action={
                <Button onClick={openCreateModal} variant="default">
                  Create Channel
                </Button>
              }
            />
          ) : (
            <ChannelTable
              channels={channels}
              onEdit={openEditModal}
              onDelete={handleDelete}
            />
          )}
        </div>
      </main>

      {/* Modal */}
      <ChannelDialog
        open={showModal}
        onOpenChange={setShowModal}
        channel={editingChannel || undefined}
        organization={organization}
        slates={slates}
        onSave={handleSave}
        onShowMessage={showMessage}
      />
    </div>
  )
}
