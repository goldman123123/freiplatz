/**
 * Voice Transcription API
 *
 * POST /api/chatbot/transcribe
 *
 * Transcribes audio files using OpenAI Whisper API.
 * Used by the voice recording feature in the chat interface.
 */

import { NextRequest, NextResponse } from 'next/server'
import { chatbotLimiter } from '@/lib/rate-limit'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB (well under OpenAI's 25MB limit)

export async function POST(request: NextRequest) {
  try {
    // Check for API key
    if (!OPENAI_API_KEY) {
      console.error('[Transcribe API] OPENAI_API_KEY not configured')
      return NextResponse.json(
        { error: 'Spracherkennung ist nicht konfiguriert' },
        { status: 503 }
      )
    }

    // Rate limiting (same as message API)
    const identifier =
      request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      'unknown'

    try {
      await chatbotLimiter.check(identifier, 10) // 10 requests per minute
    } catch {
      console.warn(`[TRANSCRIBE-RATE-LIMIT] ${identifier} exceeded rate limit`)
      return NextResponse.json(
        {
          error: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.',
          retryAfter: 60,
        },
        { status: 429 }
      )
    }

    // Parse multipart form data
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File | null
    const businessId = formData.get('businessId') as string | null

    // Validate audio file
    if (!audioFile) {
      return NextResponse.json(
        { error: 'Keine Audiodatei gefunden' },
        { status: 400 }
      )
    }

    // Validate file size
    if (audioFile.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Audiodatei ist zu groß (max 10MB)' },
        { status: 400 }
      )
    }

    // Validate file type (OpenAI Whisper supports: mp3, mp4, mpeg, mpga, m4a, wav, webm)
    // Note: Browsers often include codec info like "audio/webm;codecs=opus"
    const baseType = audioFile.type.split(';')[0].trim()
    const validTypes = [
      'audio/webm',
      'audio/mp3',
      'audio/mpeg',
      'audio/mp4',
      'audio/m4a',
      'audio/wav',
      'audio/ogg',
      'video/webm', // Chrome sometimes uses video/webm for audio recordings
    ]

    if (!validTypes.includes(baseType)) {
      console.warn('[Transcribe API] Invalid audio type:', audioFile.type)
      return NextResponse.json(
        { error: `Ungültiges Audioformat: ${audioFile.type}` },
        { status: 400 }
      )
    }

    console.log('[Transcribe API] Processing audio:', {
      businessId,
      fileType: audioFile.type,
      baseType,
      fileSize: audioFile.size,
    })

    // Prepare form data for OpenAI Whisper API
    const whisperFormData = new FormData()
    whisperFormData.append('file', audioFile, `audio.${getFileExtension(baseType)}`)
    whisperFormData.append('model', 'whisper-1')
    whisperFormData.append('response_format', 'json')
    // Auto-detect language (Whisper is good at this)
    // For German-primary users, you could set: whisperFormData.append('language', 'de')

    // Call OpenAI Whisper API
    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: whisperFormData,
    })

    if (!whisperResponse.ok) {
      const errorData = await whisperResponse.json().catch(() => ({}))
      console.error('[Transcribe API] Whisper API error:', {
        status: whisperResponse.status,
        error: errorData,
      })

      if (whisperResponse.status === 401) {
        return NextResponse.json(
          { error: 'API-Authentifizierung fehlgeschlagen' },
          { status: 500 }
        )
      }

      return NextResponse.json(
        { error: 'Spracherkennung fehlgeschlagen' },
        { status: 500 }
      )
    }

    const result = await whisperResponse.json()

    console.log('[Transcribe API] Transcription successful:', {
      textLength: result.text?.length,
    })

    return NextResponse.json({
      success: true,
      text: result.text || '',
      duration: result.duration,
    })
  } catch (error) {
    console.error('[Transcribe API] Error:', error)

    return NextResponse.json(
      {
        error: 'Transkription fehlgeschlagen',
        message: error instanceof Error ? error.message : 'Unbekannter Fehler',
      },
      { status: 500 }
    )
  }
}

/**
 * Get file extension from MIME type
 */
function getFileExtension(mimeType: string): string {
  const extensions: Record<string, string> = {
    'audio/webm': 'webm',
    'video/webm': 'webm',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'mp4',
    'audio/m4a': 'm4a',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
  }
  return extensions[mimeType] || 'webm'
}
