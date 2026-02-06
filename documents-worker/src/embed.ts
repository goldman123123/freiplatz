/**
 * Embedding generation using OpenRouter
 * Model: openai/text-embedding-3-small (1536 dimensions)
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY

if (!OPENROUTER_API_KEY) {
  throw new Error('OPENROUTER_API_KEY environment variable is required')
}

const OPENROUTER_SITE_URL = 'https://www.hebelki.de'
const OPENROUTER_SITE_NAME = 'Hebelki Documents Worker'

/**
 * Generate embeddings for multiple texts
 * Uses batch API for efficiency
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  console.log(`[Embeddings] Generating embeddings for ${texts.length} texts`)

  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': OPENROUTER_SITE_URL,
        'X-Title': OPENROUTER_SITE_NAME,
      },
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small', // 1536 dimensions
        input: texts,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`OpenRouter embeddings failed: ${JSON.stringify(error)}`)
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> }
    const embeddings = data.data.map((item) => item.embedding)

    console.log(`[Embeddings] Generated ${embeddings.length} embeddings`)

    return embeddings
  } catch (error) {
    console.error('[Embeddings] Error:', error)
    throw error
  }
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const embeddings = await generateEmbeddings([text])
  return embeddings[0]
}

/**
 * Generate embeddings in batches to avoid rate limits
 */
export async function generateEmbeddingsBatched(
  texts: string[],
  batchSize: number = 50
): Promise<number[][]> {
  const allEmbeddings: number[][] = []

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    const embeddings = await generateEmbeddings(batch)
    allEmbeddings.push(...embeddings)

    // Small delay between batches to avoid rate limits
    if (i + batchSize < texts.length) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return allEmbeddings
}
