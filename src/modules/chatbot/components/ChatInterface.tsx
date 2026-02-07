'use client'

/**
 * Reusable Chat Interface Component
 *
 * Used for public chat pages and embedded widgets
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Loader2, Send, Bot, User } from 'lucide-react'
import { VoiceRecorder } from './VoiceRecorder'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface ChatInterfaceProps {
  businessId: string
  businessName: string
  primaryColor?: string
  welcomeMessage?: string
}

export function ChatInterface({
  businessId,
  businessName,
  primaryColor = '#3B82F6',
  welcomeMessage = 'Willkommen! Wie kann ich Ihnen helfen?',
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [isEscalated, setIsEscalated] = useState(false)
  const [awaitingContact, setAwaitingContact] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim()) return

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/chatbot/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          conversationId,
          message: input,
          channel: 'web',
        }),
      })

      if (!response.ok) {
        // Extract error details from response
        let errorMessage = 'API request failed'
        try {
          const errorData = await response.json()
          errorMessage = errorData.error || errorMessage
          console.error('[ChatInterface] API error:', {
            status: response.status,
            error: errorData,
          })
        } catch (e) {
          console.error('[ChatInterface] Failed to parse error response')
        }

        throw new Error(errorMessage)
      }

      const data = await response.json()

      if (!conversationId) {
        setConversationId(data.conversationId)
      }

      // Check if escalation was completed
      if (data.metadata?.escalated) {
        setIsEscalated(true)
        setAwaitingContact(false)
      }

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error('Chat error:', error)

      const errorMessage: Message = {
        role: 'assistant',
        content: 'Entschuldigung, es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.',
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Handle transcription from voice recorder
  const handleTranscription = useCallback((text: string) => {
    setInput(text)
  }, [])

  const handleEscalate = async () => {
    if (!conversationId) {
      alert('Bitte senden Sie zuerst eine Nachricht.')
      return
    }

    try {
      const response = await fetch('/api/chatbot/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      })

      const data = await response.json()

      if (response.ok) {
        // Add the "please provide contact info" message
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
        }])

        // Track that we're awaiting contact
        if (data.awaitingContactInfo) {
          setAwaitingContact(true)
        }
      } else {
        console.error('Escalation failed:', data.error)
        alert('Fehler beim Weiterleiten. Bitte versuchen Sie es erneut.')
      }
    } catch (error) {
      console.error('Escalation error:', error)
      alert('Fehler beim Weiterleiten. Bitte versuchen Sie es erneut.')
    }
  }

  return (
    <Card className="flex h-[600px] flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <Bot
                className="mx-auto mb-4 h-12 w-12"
                style={{ color: primaryColor }}
              />
              <h3 className="text-lg font-medium text-gray-900">
                {welcomeMessage}
              </h3>
              <p className="mt-2 text-sm text-gray-500">
                Stellen Sie eine Frage oder bitten Sie um einen Termin.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex gap-3 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {message.role === 'assistant' && (
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${primaryColor}20` }}
                  >
                    <Bot className="h-5 w-5" style={{ color: primaryColor }} />
                  </div>
                )}

                <div
                  className={`max-w-[70%] rounded-lg px-4 py-2 ${
                    message.role === 'user'
                      ? 'text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                  style={message.role === 'user' ? { backgroundColor: primaryColor } : {}}
                >
                  <p className="whitespace-pre-wrap text-sm">
                    {message.content}
                  </p>
                  <p
                    className={`mt-1 text-xs ${
                      message.role === 'user'
                        ? 'opacity-80'
                        : 'text-gray-500'
                    }`}
                  >
                    {message.timestamp.toLocaleTimeString('de-DE', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>

                {message.role === 'user' && (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200">
                    <User className="h-5 w-5 text-gray-600" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${primaryColor}20` }}
                >
                  <Bot className="h-5 w-5" style={{ color: primaryColor }} />
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-gray-600" />
                  <span className="text-sm text-gray-600">
                    Denkt nach...
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-4 space-y-3">
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder="Nachricht eingeben..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isLoading}
          />
          <VoiceRecorder
            businessId={businessId}
            onTranscription={handleTranscription}
            disabled={isLoading}
            primaryColor={primaryColor}
          />
          <Button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            style={{ backgroundColor: primaryColor }}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Escalation Button */}
        {!isEscalated && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleEscalate}
            className="w-full text-xs"
            disabled={!conversationId}
          >
            <User className="h-3 w-3 mr-2" />
            Mit einem Menschen sprechen
          </Button>
        )}

        {isEscalated && (
          <div className="text-xs text-center text-green-600">
            ✓ An Team weitergeleitet
          </div>
        )}
      </div>
    </Card>
  )
}
