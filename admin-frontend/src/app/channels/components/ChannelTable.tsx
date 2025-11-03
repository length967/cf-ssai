'use client'

import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import { Channel } from "./types"

interface ChannelTableProps {
  channels: Channel[]
  onEdit: (channel: Channel) => void
  onDelete: (channel: Channel) => void
}

export function ChannelTable({ channels, onEdit, onDelete }: ChannelTableProps) {
  if (channels.length === 0) {
    return null
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Name
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Slug
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Mode
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Features
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {channels.map((channel) => (
            <tr key={channel.id}>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-gray-900">{channel.name}</div>
                <div className="text-sm text-gray-500">{channel.origin_url}</div>
                {channel.bitrate_ladder && (() => {
                  try {
                    const bitrates = JSON.parse(channel.bitrate_ladder)
                    return (
                      <div className="mt-1 flex items-center gap-1">
                        <span className="text-xs text-gray-400">Bitrates:</span>
                        <span className="text-xs font-mono text-gray-600">
                          {bitrates.join(', ')} kbps
                        </span>
                        {channel.bitrate_ladder_source === 'auto' && (
                          <span className="text-xs text-blue-600">✓</span>
                        )}
                      </div>
                    )
                  } catch (e) {
                    return null
                  }
                })()}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {channel.slug}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <StatusBadge status="processing" label={channel.mode.toUpperCase()} />
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <StatusBadge
                  status={channel.status === 'active' ? 'active' : (channel.status === 'paused' ? 'paused' : 'archived')}
                />
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <div className="flex gap-2">
                  {channel.scte35_enabled ? (
                    <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded">SCTE-35</span>
                  ) : null}
                  {channel.vast_enabled ? (
                    <span className="px-2 py-1 text-xs bg-indigo-100 text-indigo-800 rounded">VAST</span>
                  ) : null}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <Button
                  onClick={() => onEdit(channel)}
                  variant="ghost"
                  size="sm"
                  className="mr-2"
                >
                  Edit
                </Button>
                <Button
                  onClick={() => onDelete(channel)}
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                >
                  Delete
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
