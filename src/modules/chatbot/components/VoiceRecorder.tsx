'use client'

/**
 * Voice Recorder Component
 *
 * Handles microphone recording for voice messages.
 * Uses MediaRecorder API for cross-browser compatibility.
 * Transcribes audio using OpenAI Whisper API via /api/chatbot/transcribe.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Mic, Square, Loader2 } from 'lucide-react'

interface VoiceRecorderProps {
  onTranscription: (text: string) => void
  businessId: string
  disabled?: boolean
  primaryColor?: string
}

type RecordingState = 'idle' | 'recording' | 'transcribing'

export function VoiceRecorder({
  onTranscription,
  businessId,
  disabled = false,
  primaryColor = '#3B82F6',
}: VoiceRecorderProps) {
  const [state, setState] = useState<RecordingState>('idle')
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopRecording(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [])

  /**
   * Get the best supported MIME type for recording
   */
  const getSupportedMimeType = useCallback((): string => {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ]

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type
      }
    }

    // Fallback - let browser decide
    return ''
  }, [])

  /**
   * Start recording audio from microphone
   */
  const startRecording = useCallback(async () => {
    try {
      setError(null)
      chunksRef.current = []

      // Check for MediaRecorder support
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        setError('Sprachaufnahme wird in diesem Browser nicht unterstützt')
        return
      }

      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      })

      streamRef.current = stream

      // Create MediaRecorder with best supported format
      const mimeType = getSupportedMimeType()
      const options: MediaRecorderOptions = mimeType ? { mimeType } : {}

      const mediaRecorder = new MediaRecorder(stream, options)
      mediaRecorderRef.current = mediaRecorder

      // Collect audio chunks
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      // Handle recording stop
      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop())

        if (chunksRef.current.length === 0) {
          setError('Keine Audiodaten aufgenommen')
          setState('idle')
          return
        }

        // Create audio blob
        const audioBlob = new Blob(chunksRef.current, {
          type: mimeType || 'audio/webm',
        })

        // Transcribe audio
        await transcribeAudio(audioBlob)
      }

      // Handle errors
      mediaRecorder.onerror = (event) => {
        console.error('[VoiceRecorder] Recording error:', event)
        setError('Aufnahmefehler')
        setState('idle')
      }

      // Start recording
      mediaRecorder.start(100) // Collect data every 100ms
      setState('recording')
      setDuration(0)

      // Start duration timer
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1)
      }, 1000)
    } catch (err) {
      console.error('[VoiceRecorder] Error starting recording:', err)

      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setError('Mikrofonzugriff verweigert. Bitte erlauben Sie den Zugriff in den Browsereinstellungen.')
        } else if (err.name === 'NotFoundError') {
          setError('Kein Mikrofon gefunden')
        } else {
          setError('Aufnahme konnte nicht gestartet werden')
        }
      } else {
        setError('Unbekannter Fehler')
      }

      setState('idle')
    }
  }, [getSupportedMimeType])

  /**
   * Stop recording and optionally transcribe
   */
  const stopRecording = useCallback((shouldTranscribe: boolean = true) => {
    // Clear timer
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      if (shouldTranscribe) {
        setState('transcribing')
      }
      mediaRecorderRef.current.stop()
    }

    // Stop stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (!shouldTranscribe) {
      setState('idle')
    }
  }, [])

  /**
   * Send audio to transcription API
   */
  const transcribeAudio = useCallback(
    async (audioBlob: Blob) => {
      setState('transcribing')
      setError(null)

      try {
        const formData = new FormData()
        formData.append('audio', audioBlob, 'recording.webm')
        formData.append('businessId', businessId)

        const response = await fetch('/api/chatbot/transcribe', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || 'Transkription fehlgeschlagen')
        }

        const data = await response.json()

        if (data.text && data.text.trim()) {
          onTranscription(data.text.trim())
        } else {
          setError('Keine Sprache erkannt')
        }
      } catch (err) {
        console.error('[VoiceRecorder] Transcription error:', err)
        setError(err instanceof Error ? err.message : 'Transkription fehlgeschlagen')
      } finally {
        setState('idle')
        setDuration(0)
      }
    },
    [businessId, onTranscription]
  )

  /**
   * Handle button click
   */
  const handleClick = useCallback(() => {
    if (state === 'recording') {
      stopRecording(true)
    } else if (state === 'idle') {
      startRecording()
    }
    // Don't do anything while transcribing
  }, [state, startRecording, stopRecording])

  /**
   * Format duration as mm:ss
   */
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={handleClick}
        disabled={disabled || state === 'transcribing'}
        className={`relative ${state === 'recording' ? 'ring-2 ring-offset-2 ring-red-500' : ''}`}
        style={
          state === 'recording'
            ? { borderColor: '#ef4444' }
            : {}
        }
        title={
          state === 'idle'
            ? 'Sprachnachricht aufnehmen'
            : state === 'recording'
              ? 'Aufnahme stoppen'
              : 'Transkribiere...'
        }
      >
        {state === 'idle' && (
          <Mic className="h-4 w-4" style={{ color: primaryColor }} />
        )}
        {state === 'recording' && (
          <>
            <Square className="h-4 w-4 text-red-500" />
            {/* Pulsing indicator */}
            <span className="absolute -right-1 -top-1 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
            </span>
          </>
        )}
        {state === 'transcribing' && (
          <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
        )}
      </Button>

      {/* Duration display while recording */}
      {state === 'recording' && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-red-500 px-2 py-0.5 text-xs text-white">
          {formatDuration(duration)}
        </div>
      )}

      {/* Transcribing indicator */}
      {state === 'transcribing' && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-700 px-2 py-0.5 text-xs text-white">
          Transkribiere...
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="absolute -top-12 left-1/2 max-w-48 -translate-x-1/2 whitespace-normal rounded bg-red-100 px-2 py-1 text-center text-xs text-red-600">
          {error}
        </div>
      )}
    </div>
  )
}
