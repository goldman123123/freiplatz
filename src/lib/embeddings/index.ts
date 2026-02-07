/**
 * Embedding Service using OpenRouter
 * Model: openai/text-embedding-3-small (1536 dimensions)
 */

function getApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY environment variable is required. ' +
        'Please add it to .env.local'
    )
  }
  return apiKey
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const OPENROUTER_SITE_URL = process.env.OPENROUTER_SITE_URL || 'https://www.hebelki.de'
  const OPENROUTER_SITE_NAME = process.env.OPENROUTER_SITE_NAME || 'Hebelki'

  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': OPENROUTER_SITE_URL,
        'X-Title': OPENROUTER_SITE_NAME,
      },
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',  // 1536 dimensions
        input: text,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`OpenRouter embeddings failed: ${JSON.stringify(error)}`)
    }

    const data = await response.json()
    return data.data[0].embedding
  } catch (error) {
    console.error('Error generating embedding:', error)
    throw error
  }
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const OPENROUTER_SITE_URL = process.env.OPENROUTER_SITE_URL || 'https://www.hebelki.de'
  const OPENROUTER_SITE_NAME = process.env.OPENROUTER_SITE_NAME || 'Hebelki'

  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': OPENROUTER_SITE_URL,
        'X-Title': OPENROUTER_SITE_NAME,
      },
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',
        input: texts,  // Batch processing
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`OpenRouter embeddings failed: ${JSON.stringify(error)}`)
    }

    const data = await response.json()
    return data.data.map((item: any) => item.embedding)
  } catch (error) {
    console.error('Error generating embeddings:', error)
    throw error
  }
}
