/**
 * OpenRouter API Client
 *
 * Integrates with OpenRouter for AI chat completions.
 * Using Google Gemini 2.5 Flash Lite for fast, reliable responses.
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface Tool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
      additionalProperties?: boolean
    }
  }
}

export interface ChatCompletionOptions {
  model?: string
  messages: ChatMessage[]
  tools?: Tool[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
}

export interface ChatCompletionResponse {
  id: string
  model: string
  created: number
  choices: {
    index: number
    message: ChatMessage
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter'
  }[]
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/**
 * Call OpenRouter API for chat completion
 */
export async function createChatCompletion(
  options: ChatCompletionOptions
): Promise<ChatCompletionResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not configured')
  }

  const model = options.model || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-2024-08-06'

  console.log('🤖 [OPENROUTER] Making API request...')
  console.log('📊 [OPENROUTER] Model:', model)
  console.log('📝 [OPENROUTER] Messages:', options.messages.length, 'messages')
  console.log('⚙️  [OPENROUTER] Temperature:', options.temperature ?? 0.7)
  console.log('🎯 [OPENROUTER] Max tokens:', options.max_tokens ?? 1000)
  console.log('🔧 [OPENROUTER] Tools count:', options.tools?.length || 0)

  const requestBody = {
    model,
    messages: options.messages,
    tools: options.tools,
    tool_choice: 'auto', // Explicitly set tool_choice for Gemini compatibility
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 1000,
    stream: false,
  }

  // DEBUG: Log full request for tool call debugging
  if (options.tools && options.tools.length > 0) {
    console.log('[OPENROUTER DEBUG] Request body:', JSON.stringify(requestBody, null, 2))
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://www.hebelki.de',
      'X-Title': process.env.OPENROUTER_SITE_NAME || 'Hebelki',
    },
    body: JSON.stringify(requestBody),
  })

  console.log('✅ [OPENROUTER] Response status:', response.status)

  if (!response.ok) {
    const error = await response.text()
    console.error('❌ [OPENROUTER] API error:', error)
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`)
  }

  const result = await response.json()
  console.log('✅ [OPENROUTER] Response received successfully')

  // DEBUG: Log tool calls in response
  if (result.choices?.[0]?.message?.tool_calls) {
    console.log('[OPENROUTER DEBUG] Tool calls in response:', JSON.stringify(result.choices[0].message.tool_calls, null, 2))
  }

  // Validate response structure
  if (!result || typeof result !== 'object') {
    console.error('❌ [OPENROUTER] Invalid response type:', typeof result)
    throw new Error('Invalid response format from OpenRouter')
  }

  if (!result.choices || !Array.isArray(result.choices) || result.choices.length === 0) {
    console.error('❌ [OPENROUTER] Missing or empty choices array:', {
      hasChoices: !!result.choices,
      isArray: Array.isArray(result.choices),
      length: result.choices?.length,
      keys: Object.keys(result),
    })
    throw new Error('OpenRouter response missing choices array')
  }

  return result
}

/**
 * Result type for argument parsing
 */
export interface ParseResult<T> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Parse tool call arguments safely with structured error handling
 */
export function parseToolArguments<T = Record<string, unknown>>(
  args: string | undefined
): ParseResult<T> {
  // Handle undefined/null
  if (args === undefined || args === null) {
    console.error('[parseToolArguments] Tool arguments are undefined or null')
    return {
      success: false,
      error: 'Tool arguments are undefined',
    }
  }

  // Handle non-string types
  if (typeof args !== 'string') {
    console.error('[parseToolArguments] Tool arguments must be string, got:', typeof args)
    return {
      success: false,
      error: `Tool arguments must be string, got ${typeof args}`,
    }
  }

  // Handle empty strings
  if (args.trim() === '') {
    console.error('[parseToolArguments] Tool arguments are empty string')
    return {
      success: false,
      error: 'Tool arguments are empty string',
    }
  }

  // Parse JSON
  try {
    const parsed = JSON.parse(args) as T
    return {
      success: true,
      data: parsed,
    }
  } catch (error) {
    console.error('[parseToolArguments] Failed to parse tool arguments:', {
      rawArgs: args,
      argsLength: args.length,
      argsPreview: args.substring(0, 200),
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'JSON parse failed',
    }
  }
}
