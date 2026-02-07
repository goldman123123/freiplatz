/**
 * Hybrid Search Implementation (2026 RAG Best Practices)
 *
 * Combines vector search (semantic) with keyword search (full-text)
 * using Reciprocal Rank Fusion (RRF) for improved accuracy.
 *
 * Now searches BOTH:
 * - chatbot_knowledge (manual entries, scraped content)
 * - document_chunks (PDF documents via chunk_embeddings)
 *
 * Phase 1 Updates (Business Logic Separation):
 * - Added AccessContext for audience/scope filtering
 * - Customer mode: only public + global documents
 * - Staff/Owner mode: public + internal, with customer-scoped access
 * - Document status filter: only 'active' documents
 *
 * Research sources:
 * - https://levelup.gitconnected.com/designing-a-production-grade-rag-architecture-bee5a4e4d9aa
 * - https://arxiv.org/abs/2501.07391
 */

import { generateEmbedding } from '@/lib/embeddings'
import { db } from '@/lib/db'
import {
  chatbotKnowledge,
  documentChunks,
  chunkEmbeddings,
  documents,
  documentVersions,
} from '@/lib/db/schema'
import { eq, and, or, ilike, isNotNull, sql, inArray } from 'drizzle-orm'
import { augmentQuery, shouldAugmentQuery } from './query-augmentation'

// ============================================
// ACCESS CONTROL TYPES
// ============================================

/**
 * Access context for search queries
 * Determines what documents/knowledge the user can access
 */
export interface AccessContext {
  businessId: string
  // Actor type determines access level
  actorType: 'customer' | 'staff' | 'owner'
  // Actor ID (customerId for customer, clerkUserId for staff/owner)
  actorId?: string
  // Optional: specific customer scope for staff queries
  customerScopeId?: string
}

/**
 * Audience values for documents and knowledge
 */
export type Audience = 'public' | 'internal'

/**
 * Scope type values
 */
export type ScopeType = 'global' | 'customer' | 'staff'

export interface SearchResult {
  id: string
  title: string
  content: string
  category: string | null
  source: string
  score: number // 0-1 (higher = more relevant)
  method: 'vector' | 'keyword' | 'hybrid'
}

// Extended result for document chunks with provenance
export interface DocumentSearchResult extends SearchResult {
  documentId: string
  documentTitle: string
  pageStart: number
  pageEnd: number
}

export interface HybridSearchOptions {
  limit?: number
  category?: string
  vectorWeight?: number // 0-1, default 0.6
  keywordWeight?: number // 0-1, default 0.4
  minScore?: number // Minimum score threshold (0-1)
  includeDocuments?: boolean // Search document chunks (default: true)
  documentsOnly?: boolean // Only search documents, not knowledge base
  // Access control (Phase 1)
  accessContext?: AccessContext // If not provided, defaults to public/global only
}

/**
 * Perform hybrid search combining vector and keyword search
 * With optional query augmentation for multilingual queries
 *
 * Access Control (Phase 1):
 * - If accessContext not provided: defaults to customer mode (public + global only)
 * - Customer mode: audience='public', scopeType='global' OR own customer-scoped docs
 * - Staff/Owner mode: audience='public' OR 'internal', with customer-scoped access
 */
export async function hybridSearch(
  businessId: string,
  query: string,
  options: HybridSearchOptions = {}
): Promise<SearchResult[]> {
  const {
    limit = 10,
    category,
    vectorWeight = 0.6,
    keywordWeight = 0.4,
    minScore = 0.5, // Default threshold for quality matches
    includeDocuments = true,
    documentsOnly = false,
    accessContext,
  } = options

  // Default access context: customer mode (safest)
  const effectiveContext: AccessContext = accessContext || {
    businessId,
    actorType: 'customer',
  }

  console.log(`\n=== HYBRID SEARCH ===`)
  console.log(`Query: "${query}"`)
  console.log(`Business ID: ${businessId}`)
  console.log(`Category: ${category || 'none'}`)
  console.log(`Min Score: ${minScore}`)
  console.log(`Include Documents: ${includeDocuments}`)
  console.log(`Actor Type: ${effectiveContext.actorType}`)

  // Check if query augmentation would help
  const useAugmentation = shouldAugmentQuery(query)
  let searchQueries = [query]

  if (useAugmentation) {
    const augmented = augmentQuery(query)
    searchQueries = augmented.augmented.slice(0, 3) // Limit to top 3 variations
    console.log(`[Hybrid Search] Augmented query with ${searchQueries.length} variations:`, searchQueries)
  }

  // Run searches for all query variations in parallel
  const allSearches = await Promise.all(
    searchQueries.map(async searchQuery => {
      const searchPromises: Promise<Array<SearchResult & { rank: number }>>[] = []

      // Knowledge base searches (unless documentsOnly)
      if (!documentsOnly) {
        searchPromises.push(
          performVectorSearch(businessId, searchQuery, category, limit * 2, effectiveContext),
          performKeywordSearch(businessId, searchQuery, category, limit * 2, effectiveContext)
        )
      }

      // Document chunk searches (if enabled)
      if (includeDocuments) {
        searchPromises.push(
          performDocumentVectorSearch(businessId, searchQuery, limit * 2, effectiveContext),
          performDocumentKeywordSearch(businessId, searchQuery, limit * 2, effectiveContext)
        )
      }

      const results = await Promise.all(searchPromises)

      // Split results based on what we searched
      if (!documentsOnly && includeDocuments) {
        return {
          vectorResults: results[0],
          keywordResults: results[1],
          docVectorResults: results[2],
          docKeywordResults: results[3],
        }
      } else if (documentsOnly) {
        return {
          vectorResults: [],
          keywordResults: [],
          docVectorResults: results[0],
          docKeywordResults: results[1],
        }
      } else {
        return {
          vectorResults: results[0],
          keywordResults: results[1],
          docVectorResults: [],
          docKeywordResults: [],
        }
      }
    })
  )

  // Merge results from all query variations
  const allVectorResults = allSearches.flatMap(s => s.vectorResults)
  const allKeywordResults = allSearches.flatMap(s => s.keywordResults)
  const allDocVectorResults = allSearches.flatMap(s => s.docVectorResults)
  const allDocKeywordResults = allSearches.flatMap(s => s.docKeywordResults)

  // Deduplicate by ID (keep highest ranked)
  const dedupeVector = deduplicateResults(allVectorResults)
  const dedupeKeyword = deduplicateResults(allKeywordResults)
  const dedupeDocVector = deduplicateResults(allDocVectorResults)
  const dedupeDocKeyword = deduplicateResults(allDocKeywordResults)

  console.log(`Knowledge base - Vector: ${dedupeVector.length}, Keyword: ${dedupeKeyword.length}`)
  console.log(`Documents - Vector: ${dedupeDocVector.length}, Keyword: ${dedupeDocKeyword.length}`)

  if (dedupeVector.length === 0 && dedupeDocVector.length === 0) {
    console.warn('⚠️ Vector search returned 0 results - possible embedding issues or low similarity')
  } else {
    const topVector = [...dedupeVector, ...dedupeDocVector].slice(0, 3)
    topVector.forEach((r, i) => {
      console.log(`  [${i}] ${r.title} - score: ${r.score.toFixed(3)} (${r.source})`)
    })
  }

  // Combine all vector and keyword results
  const combinedVector = [...dedupeVector, ...dedupeDocVector]
  const combinedKeyword = [...dedupeKeyword, ...dedupeDocKeyword]

  // Combine results using Reciprocal Rank Fusion
  const fusedResults = reciprocalRankFusion(
    combinedVector,
    combinedKeyword,
    { vectorWeight, keywordWeight }
  )

  console.log(`Fused results: ${fusedResults.length}`)

  // Filter by minimum score and limit
  const filteredResults = fusedResults.filter(r => r.score >= minScore)
  const belowThreshold = fusedResults.filter(r => r.score < minScore)

  if (belowThreshold.length > 0) {
    console.log(`Filtered out ${belowThreshold.length} results below threshold ${minScore}:`)
    belowThreshold.slice(0, 3).forEach(r => {
      console.log(`  ❌ ${r.title} - score: ${r.score.toFixed(3)}`)
    })
  }

  const finalResults = filteredResults.slice(0, limit)

  console.log(`Final results: ${finalResults.length}`)
  console.log(`=== END HYBRID SEARCH ===\n`)

  return finalResults
}

/**
 * Deduplicate search results, keeping the highest-ranked instance
 */
function deduplicateResults<T extends { id: string; rank: number }>(
  results: T[]
): T[] {
  const seen = new Map<string, T>()

  for (const result of results) {
    const existing = seen.get(result.id)
    if (!existing || result.rank < existing.rank) {
      seen.set(result.id, result)
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.rank - b.rank)
}

/**
 * Build access control conditions for knowledge base queries
 */
function buildKnowledgeAccessConditions(context: AccessContext) {
  if (context.actorType === 'customer') {
    // Customer mode: only public + global, OR customer-scoped to this customer
    const customerConditions = [
      // Public + global knowledge (always included)
      and(
        eq(chatbotKnowledge.audience, 'public'),
        eq(chatbotKnowledge.scopeType, 'global')
      )
    ]

    // Add customer-scoped condition only if actorId is provided
    if (context.actorId) {
      customerConditions.push(
        and(
          eq(chatbotKnowledge.scopeType, 'customer'),
          eq(chatbotKnowledge.scopeId, context.actorId)
        )!
      )
    }

    return or(...customerConditions)
  } else {
    // Staff/Owner mode: can access public + internal
    // AND global + customer-scoped if specified
    const audienceCondition = or(
      eq(chatbotKnowledge.audience, 'public'),
      eq(chatbotKnowledge.audience, 'internal')
    )

    const scopeConditions = [
      eq(chatbotKnowledge.scopeType, 'global'),
    ]

    // Note: We don't filter by staff-scoped here because actorId is a Clerk user ID,
    // not a UUID. Staff-scoped documents would need the staff member's UUID.

    // If querying about a specific customer, include their customer-scoped docs
    if (context.customerScopeId) {
      scopeConditions.push(
        and(
          eq(chatbotKnowledge.scopeType, 'customer'),
          eq(chatbotKnowledge.scopeId, context.customerScopeId)
        )!
      )
    }

    return and(audienceCondition, or(...scopeConditions))
  }
}

/**
 * Perform vector search using embeddings (semantic similarity)
 */
async function performVectorSearch(
  businessId: string,
  query: string,
  category: string | undefined,
  limit: number,
  context: AccessContext
): Promise<Array<SearchResult & { rank: number }>> {
  try {
    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(query)

    // Build access control condition
    const accessCondition = buildKnowledgeAccessConditions(context)

    // Search using cosine similarity (pgvector operator <=>)
    const results = await db
      .select({
        id: chatbotKnowledge.id,
        title: chatbotKnowledge.title,
        content: chatbotKnowledge.content,
        category: chatbotKnowledge.category,
        source: chatbotKnowledge.source,
        similarity: sql<number>`1 - (${chatbotKnowledge.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`,
      })
      .from(chatbotKnowledge)
      .where(
        and(
          eq(chatbotKnowledge.businessId, businessId),
          eq(chatbotKnowledge.isActive, true),
          isNotNull(chatbotKnowledge.embedding), // Skip entries without embeddings
          category ? eq(chatbotKnowledge.category, category) : undefined,
          accessCondition
        )
      )
      .orderBy(sql`${chatbotKnowledge.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
      .limit(limit)

    return results.map((result, index) => ({
      id: result.id,
      title: result.title || '',
      content: result.content,
      category: result.category,
      source: result.source,
      score: result.similarity,
      method: 'vector' as const,
      rank: index + 1,
    }))
  } catch (error) {
    console.error('[Vector Search] Error:', error)
    return []
  }
}

/**
 * Perform keyword search using PostgreSQL full-text search
 */
async function performKeywordSearch(
  businessId: string,
  query: string,
  category: string | undefined,
  limit: number,
  context: AccessContext
): Promise<Array<SearchResult & { rank: number }>> {
  try {
    // Use ILIKE for simple pattern matching (works with German text)
    const searchPattern = `%${query}%`

    // Build access control condition
    const accessCondition = buildKnowledgeAccessConditions(context)

    const results = await db
      .select({
        id: chatbotKnowledge.id,
        title: chatbotKnowledge.title,
        content: chatbotKnowledge.content,
        category: chatbotKnowledge.category,
        source: chatbotKnowledge.source,
      })
      .from(chatbotKnowledge)
      .where(
        and(
          eq(chatbotKnowledge.businessId, businessId),
          eq(chatbotKnowledge.isActive, true),
          or(
            ilike(chatbotKnowledge.title, searchPattern),
            ilike(chatbotKnowledge.content, searchPattern)
          ),
          category ? eq(chatbotKnowledge.category, category) : undefined,
          accessCondition
        )
      )
      .limit(limit)

    // Calculate simple relevance score based on match position
    return results.map((result, index) => {
      const titleMatch = result.title?.toLowerCase().includes(query.toLowerCase())
      const contentMatch = result.content.toLowerCase().includes(query.toLowerCase())

      // Higher score if query appears in title
      const baseScore = titleMatch ? 0.8 : 0.6
      // Decay score based on rank
      const rankPenalty = index * 0.05
      const score = Math.max(0.1, baseScore - rankPenalty)

      return {
        id: result.id,
        title: result.title || '',
        content: result.content,
        category: result.category,
        source: result.source,
        score,
        method: 'keyword' as const,
        rank: index + 1,
      }
    })
  } catch (error) {
    console.error('[Keyword Search] Error:', error)
    return []
  }
}

/**
 * Reciprocal Rank Fusion (RRF) algorithm
 * Combines rankings from multiple sources into a single ranked list
 *
 * RRF Score = Σ (weight / (k + rank))
 * where k is a constant (typically 60)
 */
function reciprocalRankFusion(
  vectorResults: Array<SearchResult & { rank: number }>,
  keywordResults: Array<SearchResult & { rank: number }>,
  weights: { vectorWeight: number; keywordWeight: number }
): SearchResult[] {
  const k = 60 // RRF constant (standard value from research)
  const scores = new Map<string, number>()
  const resultsMap = new Map<string, SearchResult>()

  // Calculate RRF scores for vector results
  vectorResults.forEach(result => {
    const rrfScore = weights.vectorWeight / (k + result.rank)
    scores.set(result.id, (scores.get(result.id) || 0) + rrfScore)
    resultsMap.set(result.id, result)
  })

  // Calculate RRF scores for keyword results
  keywordResults.forEach(result => {
    const rrfScore = weights.keywordWeight / (k + result.rank)
    scores.set(result.id, (scores.get(result.id) || 0) + rrfScore)

    // If not already in map from vector search, add it
    if (!resultsMap.has(result.id)) {
      resultsMap.set(result.id, result)
    }
  })

  // Normalize scores to 0-1 range
  const maxScore = Math.max(...Array.from(scores.values()))
  const normalizedScores = new Map<string, number>()
  scores.forEach((score, id) => {
    normalizedScores.set(id, maxScore > 0 ? score / maxScore : 0)
  })

  // Combine and sort by fused score
  const fusedResults = Array.from(resultsMap.values())
    .map(result => ({
      ...result,
      score: normalizedScores.get(result.id) || 0,
      method: 'hybrid' as const,
    }))
    .sort((a, b) => b.score - a.score)

  return fusedResults
}

/**
 * Search with category-specific thresholds
 * Different categories need different similarity thresholds
 */
export async function searchWithCategoryThreshold(
  businessId: string,
  query: string,
  category?: string,
  accessContext?: AccessContext
): Promise<SearchResult[]> {
  // Category-specific thresholds based on use case
  const thresholds: Record<string, number> = {
    faq: 0.5, // FAQs - balanced match
    services: 0.4, // Services can be broader
    pricing: 0.5, // Pricing needs accuracy
    policies: 0.4, // Policies can be broader
    qualifications: 0.35, // Qualifications - lowered to improve recall
    contact: 0.4, // Contact info can be broader
    hours: 0.5, // Hours need accuracy
    other: 0.35, // Other can be broader
  }

  const minScore = category ? (thresholds[category] || 0.35) : 0.35

  return hybridSearch(businessId, query, {
    category,
    minScore,
    limit: 5,
    accessContext,
  })
}

// ============================================
// DOCUMENT CHUNK SEARCH
// ============================================

/**
 * Build access control conditions for document queries
 * Documents must be:
 * 1. status = 'active' (not deleted)
 * 2. Match audience/scope based on actor type
 */
function buildDocumentAccessConditions(context: AccessContext) {
  // Always filter by active status + access control
  if (context.actorType === 'customer') {
    // Customer mode: only public + global, OR customer-scoped to this customer
    const customerConditions = [
      // Public + global documents (always included)
      and(
        eq(documents.audience, 'public'),
        eq(documents.scopeType, 'global')
      )
    ]

    // Add customer-scoped condition only if actorId is provided
    if (context.actorId) {
      customerConditions.push(
        and(
          eq(documents.scopeType, 'customer'),
          eq(documents.scopeId, context.actorId)
        )!
      )
    }

    return and(eq(documents.status, 'active'), or(...customerConditions))
  } else {
    // Staff/Owner mode: can access public + internal
    // AND global + customer-scoped if specified
    const audienceCondition = or(
      eq(documents.audience, 'public'),
      eq(documents.audience, 'internal')
    )

    const scopeConditions = [
      eq(documents.scopeType, 'global'),
    ]

    // Note: We don't filter by staff-scoped here because actorId is a Clerk user ID,
    // not a UUID. Staff-scoped documents would need the staff member's UUID.

    // If querying about a specific customer, include their customer-scoped docs
    if (context.customerScopeId) {
      scopeConditions.push(
        and(
          eq(documents.scopeType, 'customer'),
          eq(documents.scopeId, context.customerScopeId)
        )!
      )
    }

    return and(eq(documents.status, 'active'), audienceCondition, or(...scopeConditions))
  }
}

/**
 * Perform vector search on document chunks
 * Uses chunk_embeddings table for HNSW similarity search
 * Now includes access control and document status filtering
 */
async function performDocumentVectorSearch(
  businessId: string,
  query: string,
  limit: number,
  context: AccessContext
): Promise<Array<SearchResult & { rank: number }>> {
  try {
    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(query)

    // First, get accessible document IDs based on access context
    const accessCondition = buildDocumentAccessConditions(context)

    console.log(`[Doc Vector Search] Query: "${query}", Business: ${businessId}, Actor: ${context.actorType}`)

    const accessibleDocs = await db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(and(
        eq(documents.businessId, businessId),
        accessCondition
      ))

    const accessibleDocIds = accessibleDocs.map(d => d.id)

    console.log(`[Doc Vector Search] Accessible docs: ${accessibleDocIds.length}`, accessibleDocs.map(d => d.title))

    if (accessibleDocIds.length === 0) {
      console.log(`[Doc Vector Search] No accessible documents found!`)
      return [] // No accessible documents
    }

    // Get version IDs for accessible documents
    const accessibleVersions = await db
      .select({ id: documentVersions.id, documentId: documentVersions.documentId })
      .from(documentVersions)
      .where(inArray(documentVersions.documentId, accessibleDocIds))

    const versionIdToDocId = new Map(accessibleVersions.map(v => [v.id, v.documentId]))
    const accessibleVersionIds = accessibleVersions.map(v => v.id)

    if (accessibleVersionIds.length === 0) {
      return []
    }

    // Search document chunks using cosine similarity, filtered by accessible versions
    const results = await db
      .select({
        chunkId: documentChunks.id,
        content: documentChunks.content,
        pageStart: documentChunks.pageStart,
        pageEnd: documentChunks.pageEnd,
        chunkMetadata: documentChunks.metadata,
        documentVersionId: documentChunks.documentVersionId,
        similarity: sql<number>`1 - (${chunkEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`,
      })
      .from(documentChunks)
      .innerJoin(chunkEmbeddings, eq(chunkEmbeddings.chunkId, documentChunks.id))
      .where(and(
        eq(documentChunks.businessId, businessId),
        inArray(documentChunks.documentVersionId, accessibleVersionIds)
      ))
      .orderBy(sql`${chunkEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
      .limit(limit)

    // Get document info for each chunk (cached via versionIdToDocId)
    const docCache = new Map<string, { id: string; title: string }>()

    const enrichedResults = await Promise.all(
      results.map(async (result, index) => {
        const docId = versionIdToDocId.get(result.documentVersionId)
        let documentTitle = 'Document'
        let documentId = ''

        if (docId) {
          // Check cache first
          if (docCache.has(docId)) {
            const cached = docCache.get(docId)!
            documentTitle = cached.title
            documentId = cached.id
          } else {
            const doc = await db
              .select({
                id: documents.id,
                title: documents.title,
              })
              .from(documents)
              .where(eq(documents.id, docId))
              .limit(1)
              .then(rows => rows[0])

            if (doc) {
              documentTitle = doc.title
              documentId = doc.id
              docCache.set(docId, { id: doc.id, title: doc.title })
            }
          }
        }

        // Create title from document title + page reference
        const pageRef = result.pageStart === result.pageEnd
          ? `p.${result.pageStart}`
          : `pp.${result.pageStart}-${result.pageEnd}`

        return {
          id: result.chunkId,
          title: `${documentTitle} (${pageRef})`,
          content: result.content,
          category: 'document' as string | null,
          source: 'document',
          score: result.similarity,
          method: 'vector' as const,
          rank: index + 1,
          // Extended document info
          documentId,
          documentTitle,
          pageStart: result.pageStart,
          pageEnd: result.pageEnd,
        }
      })
    )

    return enrichedResults
  } catch (error) {
    console.error('[Document Vector Search] Error:', error)
    return []
  }
}

/**
 * Perform keyword search on document chunks
 * Now includes access control and document status filtering
 */
async function performDocumentKeywordSearch(
  businessId: string,
  query: string,
  limit: number,
  context: AccessContext
): Promise<Array<SearchResult & { rank: number }>> {
  try {
    const searchPattern = `%${query}%`

    // First, get accessible document IDs based on access context
    const accessCondition = buildDocumentAccessConditions(context)

    console.log(`[Doc Keyword Search] Query: "${query}", Business: ${businessId}, Actor: ${context.actorType}`)

    const accessibleDocs = await db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(and(
        eq(documents.businessId, businessId),
        accessCondition
      ))

    const accessibleDocIds = accessibleDocs.map(d => d.id)

    console.log(`[Doc Keyword Search] Accessible docs: ${accessibleDocIds.length}`, accessibleDocs.map(d => d.title))

    if (accessibleDocIds.length === 0) {
      console.log(`[Doc Keyword Search] No accessible documents found!`)
      return [] // No accessible documents
    }

    // Get version IDs for accessible documents
    const accessibleVersions = await db
      .select({ id: documentVersions.id, documentId: documentVersions.documentId })
      .from(documentVersions)
      .where(inArray(documentVersions.documentId, accessibleDocIds))

    const versionIdToDocId = new Map(accessibleVersions.map(v => [v.id, v.documentId]))
    const accessibleVersionIds = accessibleVersions.map(v => v.id)

    if (accessibleVersionIds.length === 0) {
      return []
    }

    const results = await db
      .select({
        chunkId: documentChunks.id,
        content: documentChunks.content,
        pageStart: documentChunks.pageStart,
        pageEnd: documentChunks.pageEnd,
        documentVersionId: documentChunks.documentVersionId,
      })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.businessId, businessId),
          inArray(documentChunks.documentVersionId, accessibleVersionIds),
          ilike(documentChunks.content, searchPattern)
        )
      )
      .limit(limit)

    // Get document info for each chunk (cached via versionIdToDocId)
    const docCache = new Map<string, { id: string; title: string }>()

    const enrichedResults = await Promise.all(
      results.map(async (result, index) => {
        const docId = versionIdToDocId.get(result.documentVersionId)
        let documentTitle = 'Document'
        let documentId = ''

        if (docId) {
          // Check cache first
          if (docCache.has(docId)) {
            const cached = docCache.get(docId)!
            documentTitle = cached.title
            documentId = cached.id
          } else {
            const doc = await db
              .select({
                id: documents.id,
                title: documents.title,
              })
              .from(documents)
              .where(eq(documents.id, docId))
              .limit(1)
              .then(rows => rows[0])

            if (doc) {
              documentTitle = doc.title
              documentId = doc.id
              docCache.set(docId, { id: doc.id, title: doc.title })
            }
          }
        }

        // Create title from document title + page reference
        const pageRef = result.pageStart === result.pageEnd
          ? `p.${result.pageStart}`
          : `pp.${result.pageStart}-${result.pageEnd}`

        // Calculate score based on match
        const contentMatch = result.content.toLowerCase().includes(query.toLowerCase())
        const baseScore = contentMatch ? 0.7 : 0.5
        const rankPenalty = index * 0.05
        const score = Math.max(0.1, baseScore - rankPenalty)

        return {
          id: result.chunkId,
          title: `${documentTitle} (${pageRef})`,
          content: result.content,
          category: 'document' as string | null,
          source: 'document',
          score,
          method: 'keyword' as const,
          rank: index + 1,
          // Extended document info
          documentId,
          documentTitle,
          pageStart: result.pageStart,
          pageEnd: result.pageEnd,
        }
      })
    )

    return enrichedResults
  } catch (error) {
    console.error('[Document Keyword Search] Error:', error)
    return []
  }
}

/**
 * Search only document chunks (not knowledge base)
 * Returns DocumentSearchResult with full provenance info
 */
export async function searchDocuments(
  businessId: string,
  query: string,
  options: { limit?: number; minScore?: number; accessContext?: AccessContext } = {}
): Promise<DocumentSearchResult[]> {
  const { limit = 10, minScore = 0.35, accessContext } = options

  const results = await hybridSearch(businessId, query, {
    limit,
    minScore,
    documentsOnly: true,
    includeDocuments: true,
    accessContext,
  })

  // Filter to only document results and cast to DocumentSearchResult
  return results
    .filter(r => r.source === 'document')
    .map(r => r as DocumentSearchResult)
}
