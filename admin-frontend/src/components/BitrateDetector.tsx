'use client'

import { useState } from 'react'
import { api } from '@/lib/api'

type BitrateDetectorProps = {
  originUrl: string
  bitrateLadder: number[]
  bitrateSource: 'auto' | 'manual' | null
  onBitratesDetected: (bitrates: number[], source: 'auto') => void
  onBitratesChanged: (bitrates: number[], source: 'manual') => void
}

export function BitrateDetector({
  originUrl,
  bitrateLadder,
  bitrateSource,
  onBitratesDetected,
  onBitratesChanged
}: BitrateDetectorProps) {
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawData, setRawData] = useState<any>(null)
  const [showRawData, setShowRawData] = useState(false)

  const handleDetect = async () => {
    if (!originUrl) {
      setError('Please enter an origin URL first')
      return
    }

    setDetecting(true)
    setError(null)

    try {
      const result = await api.detectBitrates(originUrl)
      setRawData(result) // Store raw API response

      if (result.success && result.bitrates && result.bitrates.length > 0) {
        onBitratesDetected(result.bitrates, 'auto')
        setError(null)
      } else {
        setError(result.error || 'No bitrates detected')
      }
    } catch (err: any) {
      setError(err.message || 'Detection failed')
    } finally {
      setDetecting(false)
    }
  }

  const handleBitrateChange = (index: number, value: string) => {
    const newBitrate = parseInt(value) || 0
    if (newBitrate < 0) return

    const newLadder = [...bitrateLadder]
    newLadder[index] = newBitrate
    // Sort ascending
    newLadder.sort((a, b) => a - b)
    onBitratesChanged(newLadder, 'manual')
  }

  const handleAddBitrate = () => {
    const newLadder = [...bitrateLadder, 0].sort((a, b) => a - b)
    onBitratesChanged(newLadder, 'manual')
  }

  const handleRemoveBitrate = (index: number) => {
    if (bitrateLadder.length <= 1) {
      setError('At least one bitrate is required')
      return
    }
    const newLadder = bitrateLadder.filter((_, i) => i !== index)
    onBitratesChanged(newLadder, 'manual')
  }

  return (
    <div className="space-y-4">
      {/* Detection Button */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleDetect}
          disabled={detecting || !originUrl}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {detecting ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              Detecting...
            </>
          ) : (
            <>
              🔍 Detect Bitrates
            </>
          )}
        </button>
        {bitrateLadder.length > 0 && bitrateSource && (
          <span className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium ${
            bitrateSource === 'auto' 
              ? 'bg-blue-100 text-blue-800' 
              : 'bg-orange-100 text-orange-800'
          }`}>
            {bitrateSource === 'auto' ? '✅ Auto-detected' : '✏️ Manual'}
          </span>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-800 text-sm">
          ❌ {error}
        </div>
      )}

      {/* Bitrate Ladder Editor */}
      {bitrateLadder.length > 0 && (
        <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-sm font-semibold text-gray-700">
              Bitrate Ladder Configuration
            </h4>
            <button
              type="button"
              onClick={handleAddBitrate}
              className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
            >
              + Add Bitrate
            </button>
          </div>

          <div className="space-y-2">
            {bitrateLadder.map((bitrate, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="text-sm text-gray-600 w-6">{index + 1}.</span>
                <input
                  type="number"
                  value={bitrate}
                  onChange={(e) => handleBitrateChange(index, e.target.value)}
                  min="0"
                  step="1"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-600 w-16">kbps</span>
                <button
                  type="button"
                  onClick={() => handleRemoveBitrate(index)}
                  disabled={bitrateLadder.length <= 1}
                  className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Remove bitrate"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs text-gray-500">
            💡 Tip: Bitrates are sorted automatically. All ads uploaded for this channel will transcode to these exact bitrates.
          </p>
        </div>
      )}

      {/* Raw Data Debug View */}
      {rawData && (
        <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
          <button
            type="button"
            onClick={() => setShowRawData(!showRawData)}
            className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            {showRawData ? '▼' : '▶'} Show Raw Detection Data
          </button>
          {showRawData && (
            <pre className="mt-2 p-3 bg-white border border-gray-200 rounded text-xs overflow-x-auto">
              {JSON.stringify(rawData, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
