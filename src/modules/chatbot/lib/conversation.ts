/**
 * Chatbot Conversation Handler
 *
 * Manages conversation flow, tool calling, and response generation.
 */

import { db } from '@/lib/db'
import { chatbotConversations, chatbotMessages, businesses, services, type ConversationIntent } from '@/lib/db/schema'
import { eq, and, desc, or, inArray } from 'drizzle-orm'
import {
  createChatCompletion,
  parseToolArguments,
  type ChatMessage,
  type ToolCall,
} from './openrouter'
import { tools, executeTool } from './tools'

// ============================================
// CONVERSATION MEMORY SYSTEM
// ============================================

/**
 * Configuration for conversation memory
 */
const MEMORY_CONFIG = {
  MESSAGES_BEFORE_SUMMARY: 10,  // Generate summary after this many messages
  RECENT_MESSAGES_WITH_SUMMARY: 5,  // Load this many recent messages when we have a summary
  RECENT_MESSAGES_WITHOUT_SUMMARY: 10,  // Load this many messages when no summary exists
  MAX_MESSAGES_FOR_SUMMARY: 20,  // Max messages to include in summary generation
}

/**
 * Conversation context loaded for AI
 */
interface ConversationContext {
  summary: string | null
  messages: Array<{
    role: string
    content: string
    metadata: unknown
  }>
  intent: ConversationIntent | null
  messagesSinceSummary: number
}

/**
 * Load optimized conversation context
 * Uses summary + recent messages instead of full history
 */
async function loadConversationContext(conversationId: string): Promise<ConversationContext> {
  // Get conversation with summary and intent
  const conversation = await db
    .select({
      summary: chatbotConversations.summary,
      currentIntent: chatbotConversations.currentIntent,
      messagesSinceSummary: chatbotConversations.messagesSinceSummary,
    })
    .from(chatbotConversations)
    .where(eq(chatbotConversations.id, conversationId))
    .limit(1)
    .then(rows => rows[0])

  if (!conversation) {
    return { summary: null, messages: [], intent: null, messagesSinceSummary: 0 }
  }

  const hasSummary = !!conversation.summary

  // Determine how many messages to load
  const messageLimit = hasSummary
    ? MEMORY_CONFIG.RECENT_MESSAGES_WITH_SUMMARY
    : MEMORY_CONFIG.RECENT_MESSAGES_WITHOUT_SUMMARY

  // Load recent user/assistant messages (skip tool messages for compaction)
  // But we need tool messages for proper conversation reconstruction
  const recentMessages = await db
    .select({
      role: chatbotMessages.role,
      content: chatbotMessages.content,
      metadata: chatbotMessages.metadata,
    })
    .from(chatbotMessages)
    .where(eq(chatbotMessages.conversationId, conversationId))
    .orderBy(desc(chatbotMessages.createdAt))
    .limit(messageLimit * 2)  // Get more to account for tool messages

  // Reverse to chronological order
  const chronological = recentMessages.reverse()

  // If we have a summary, we can be more aggressive about filtering
  // Keep user/assistant messages, and tool messages that are recent
  let filteredMessages = chronological
  if (hasSummary) {
    // For summarized conversations, prioritize user/assistant but keep some tool context
    const userAssistant = chronological.filter(m => m.role === 'user' || m.role === 'assistant')
    filteredMessages = userAssistant.slice(-messageLimit)
  }

  return {
    summary: conversation.summary,
    messages: filteredMessages,
    intent: conversation.currentIntent as ConversationIntent | null,
    messagesSinceSummary: conversation.messagesSinceSummary || 0,
  }
}

/**
 * Generate a conversation summary using AI
 */
async function generateConversationSummary(conversationId: string): Promise<string> {
  // Get messages to summarize
  const messages = await db
    .select({
      role: chatbotMessages.role,
      content: chatbotMessages.content,
    })
    .from(chatbotMessages)
    .where(and(
      eq(chatbotMessages.conversationId, conversationId),
      or(
        eq(chatbotMessages.role, 'user'),
        eq(chatbotMessages.role, 'assistant')
      )
    ))
    .orderBy(chatbotMessages.createdAt)
    .limit(MEMORY_CONFIG.MAX_MESSAGES_FOR_SUMMARY)

  if (messages.length === 0) {
    return ''
  }

  // Format messages for summarization
  const conversationText = messages
    .map(m => `${m.role === 'user' ? 'Kunde' : 'Assistent'}: ${m.content}`)
    .join('\n')

  // Generate summary using AI
  const summaryPrompt = `Fasse die bisherige Konversation in 2-3 Sätzen zusammen. Fokussiere auf:
- Kundenname (falls bekannt)
- Hauptanliegen/Intent
- Wichtige besprochene Fakten (Service, Termin, etc.)
- Aktueller Buchungsstatus (falls relevant)

Konversation:
${conversationText}

Zusammenfassung (auf Deutsch, max 3 Sätze):`

  try {
    const response = await createChatCompletion({
      messages: [{ role: 'user', content: summaryPrompt }],
      temperature: 0.3,
      max_tokens: 200,
    })

    const summary = response.choices[0]?.message?.content || ''
    return summary.trim()
  } catch (error) {
    console.error('[generateConversationSummary] Error:', error)
    return ''
  }
}

/**
 * Retry wrapper for DB updates — handles transient Neon HTTP connection drops.
 * 1 retry after 500ms delay is enough for intermittent socket failures.
 */
async function dbUpdateWithRetry(fn: () => Promise<void>, retries = 1): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await fn()
      return
    } catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500))
        continue
      }
      throw err
    }
  }
}

/**
 * Update conversation summary if needed
 * Called after each message exchange
 */
async function updateSummaryIfNeeded(conversationId: string, currentMessageCount: number): Promise<void> {
  // Check if we should generate a new summary
  if (currentMessageCount < MEMORY_CONFIG.MESSAGES_BEFORE_SUMMARY) {
    // Just increment the counter
    await dbUpdateWithRetry(() =>
      db
        .update(chatbotConversations)
        .set({
          messagesSinceSummary: currentMessageCount,
          updatedAt: new Date(),
        })
        .where(eq(chatbotConversations.id, conversationId))
        .then(() => {})
    )
    return
  }

  // Time to generate a summary
  console.log(`[Memory] Generating summary for conversation ${conversationId} (${currentMessageCount} messages)`)

  const summary = await generateConversationSummary(conversationId)

  if (summary) {
    await dbUpdateWithRetry(() =>
      db
        .update(chatbotConversations)
        .set({
          summary,
          summaryUpdatedAt: new Date(),
          messagesSinceSummary: 0,  // Reset counter
          updatedAt: new Date(),
        })
        .where(eq(chatbotConversations.id, conversationId))
        .then(() => {})
    )

    console.log(`[Memory] Summary generated: "${summary.substring(0, 100)}..."`)
  }
}

/**
 * Update conversation intent state
 * Called by tools when booking state changes
 */
export async function updateConversationIntent(
  conversationId: string,
  intentUpdate: Partial<ConversationIntent>
): Promise<void> {
  // Get current intent
  const conversation = await db
    .select({ currentIntent: chatbotConversations.currentIntent })
    .from(chatbotConversations)
    .where(eq(chatbotConversations.id, conversationId))
    .limit(1)
    .then(rows => rows[0])

  const currentIntent = (conversation?.currentIntent as ConversationIntent) || {
    state: 'idle',
    lastUpdated: new Date().toISOString(),
  }

  // Merge update
  const newIntent: ConversationIntent = {
    ...currentIntent,
    ...intentUpdate,
    lastUpdated: new Date().toISOString(),
  }

  await db
    .update(chatbotConversations)
    .set({
      currentIntent: newIntent,
      updatedAt: new Date(),
    })
    .where(eq(chatbotConversations.id, conversationId))

  console.log(`[Intent] Updated conversation ${conversationId}: ${currentIntent.state} -> ${newIntent.state}`)
}

/**
 * Build intent context for system prompt
 * Used when customer reconnects to resume booking flow
 */
function buildIntentContext(intent: ConversationIntent | null): string {
  if (!intent || intent.state === 'idle') {
    return ''
  }

  const parts: string[] = []

  switch (intent.state) {
    case 'browsing_services':
      parts.push('Der Kunde hat sich die Services angesehen.')
      break

    case 'checking_availability':
      if (intent.serviceName) {
        parts.push(`Der Kunde interessiert sich für: ${intent.serviceName}`)
      }
      if (intent.selectedDate) {
        parts.push(`Gewünschtes Datum: ${intent.selectedDate}`)
      }
      break

    case 'hold_active':
      parts.push('WICHTIG: Es gibt eine aktive Reservierung!')
      if (intent.holdId) parts.push(`Hold-ID: ${intent.holdId}`)
      if (intent.holdExpiresAt) {
        const expiresAt = new Date(intent.holdExpiresAt)
        const now = new Date()
        if (expiresAt > now) {
          const minutesLeft = Math.round((expiresAt.getTime() - now.getTime()) / 60000)
          parts.push(`Reservierung läuft in ${minutesLeft} Minuten ab.`)
        } else {
          parts.push('Reservierung ist möglicherweise abgelaufen.')
        }
      }
      if (intent.serviceName) parts.push(`Service: ${intent.serviceName}`)
      if (intent.selectedSlot?.staffName) parts.push(`Mitarbeiter: ${intent.selectedSlot.staffName}`)
      break

    case 'collecting_details':
      parts.push('Der Kunde gibt gerade seine Daten ein.')
      if (intent.customerData?.name) parts.push(`Name: ${intent.customerData.name}`)
      if (intent.customerData?.email) parts.push(`E-Mail: ${intent.customerData.email}`)
      break

    case 'awaiting_confirmation':
      parts.push('Warte auf finale Bestätigung des Kunden.')
      break
  }

  if (parts.length === 0) return ''

  return `\n\nKONTEXT AUS VORHERIGER SITZUNG:
${parts.join('\n')}
Setze das Gespräch fort, z.B.: "Ich sehe, Sie waren dabei einen Termin zu buchen..."
`
}

/**
 * Business context for dynamic system prompts
 */
interface BusinessContext {
  name: string
  type: string | null
  email?: string | null
  phone?: string | null
  services: Array<{ name: string; description: string | null }>
  policies?: {
    minBookingNoticeHours: number | null
    cancellationPolicyHours: number | null
  }
  customInstructions?: string
}

/**
 * Role type for prompt building
 */
type UserRole = 'customer' | 'staff' | 'owner'

/**
 * Build base prompt - shared by all roles
 */
function buildBasePrompt(
  context: BusinessContext,
  businessId: string,
  channel: string
): string {
  // Map business type to German description
  const typeDescriptions: Record<string, string> = {
    'clinic': 'eine medizinische Praxis',
    'salon': 'ein Salon',
    'consultant': 'ein Beratungsunternehmen',
    'gym': 'ein Fitnessstudio',
    'other': 'ein Unternehmen'
  }

  const businessType = typeDescriptions[context.type || 'other'] || typeDescriptions['other']

  return `Du bist der KI-Assistent für ${context.name}, ${businessType}.

${context.customInstructions || ''}

COMPLIANCE (EU AI Act):
- ERSTE NACHRICHT: Beginne JEDE Konversation mit einer klaren Offenlegung, dass du ein KI-Assistent bist. Beispiel: "Hallo! Ich bin der KI-Assistent von ${context.name}. Wie kann ich Ihnen helfen?"
- Niemals vorgeben, ein Mensch zu sein
- Bei Frage "Bist du ein Bot?": "Ja, ich bin ein automatisierter KI-Assistent für ${context.name}."
- Bei Fehlern: "Ich bin ein KI-Assistent und kann Fehler machen. Bei wichtigen Anliegen kontaktieren Sie bitte: ${context.email || context.phone || 'unser Team'}"
${channel === 'whatsapp' ? '- WhatsApp: Erwähne STOP für Opt-Out in erster Nachricht' : ''}

STRENGE REGELN - TOOLS SIND DIE EINZIGE QUELLE DER WAHRHEIT:
1. **Services & Preise**: IMMER get_available_services() aufrufen, NIE aus Gedächtnis
2. **Verfügbarkeit**: IMMER check_availability() aufrufen mit Datum
3. **Datum-Fragen**: Nutze get_current_date() für korrekte Daten
4. **Wissensbasis**: Nutze search_knowledge_base() für FAQs, Policies, Öffnungszeiten

FEHLERBEHANDLUNG:
- INVALID_TOOL_ARGS/MISSING_REQUIRED_ARGS: Sammle fehlende Daten, versuche erneut
- SLOT_UNAVAILABLE: check_availability() aufrufen, neue Slots zeigen
- HOLD_EXPIRED: "Reservierung abgelaufen, neuen Termin wählen?"
- Nach 3+ Fehlern: "Technisches Problem. Ich leite Sie an unser Team weiter."

WICHTIG: Für alle Tool-Aufrufe diese businessId verwenden: ${businessId}

Antworte IMMER auf Deutsch!`
}

/**
 * Build customer overlay - booking flow, FAQs
 */
function buildCustomerOverlay(businessId: string): string {
  return `

DEINE ROLLE FÜR KUNDEN:
- Beantworte Fragen freundlich und professionell
- Hilf bei Terminbuchungen
- Verwende ausschließlich die formelle "Sie"-Anrede

BUCHUNGSABLAUF (Reihenfolge PFLICHT):

1. Service auswählen
   → get_available_services()
   → Zeige Namen, Preis, Dauer

2. Verfügbarkeit prüfen
   → get_current_date() aufrufen
   → check_availability(date: YYYY-MM-DD) aufrufen
   → Zeige Slots: "Slot 1: 07:00 Uhr, Slot 2: 08:00 Uhr..."

3. Slot reservieren
   → Finde den Slot aus check_availability Antwort
   → Der Slot enthält: start, serviceId, staffId, staffName
   → create_hold(businessId: "${businessId}", serviceId, staffId, startsAt)
   → WICHTIG: Verwende serviceId und staffId DIREKT aus dem Slot-Objekt

4. Kundendaten sammeln
   → Name, E-Mail, Telefon

5. Buchung abschließen
   → confirm_booking()
   → Erfolgsmeldung mit allen Details

VERFÜGBARE TOOLS:
- get_current_date: Aktuelles Datum/Zeit
- get_available_services: Services mit Preisen
- get_available_staff: Verfügbare Mitarbeiter
- check_availability: Freie Termine prüfen
- create_hold: Zeitslot reservieren (5 Min.)
- confirm_booking: Buchung bestätigen
- search_knowledge_base: Wissensdatenbank durchsuchen`
}

/**
 * Build staff overlay - booking management, customer lookup
 */
function buildStaffOverlay(): string {
  return `

ADMIN-ROLLE FÜR MITARBEITER:
- Vollständiger Zugriff auf Buchungsverwaltung
- Kundendaten einsehen und bearbeiten
- E-Mails an Kunden senden

BOOKING MANAGEMENT TOOLS:
- get_todays_bookings: Heutige Termine anzeigen
- get_upcoming_bookings: Kommende Termine (7 Tage)
- create_booking_admin: Direktbuchung erstellen (ohne Hold-Flow)
- cancel_booking_with_notification: Stornieren + Kunde benachrichtigen
- search_bookings: Buchungen suchen
- update_booking_status: Status ändern
- reschedule_booking: Termin verschieben

CUSTOMER MANAGEMENT TOOLS:
- create_customer: Neuen Kunden anlegen
- search_customers: Kunden suchen
- get_customer_bookings: Kundenhistorie anzeigen

COMMUNICATION TOOLS:
- send_email_to_customer: E-Mail an Kunden senden
- resend_booking_confirmation: Bestätigung erneut senden`
}

/**
 * Build owner overlay - analytics, conversation management
 */
function buildOwnerOverlay(): string {
  return `

INHABER-ROLLE (zusätzlich zu Mitarbeiter-Tools):
- Tagesübersichten und Statistiken
- Eskalierte Gespräche verwalten
- Gesprächsverläufe durchsuchen

ANALYTICS & REPORTING TOOLS:
- get_daily_summary: Tagesstatistiken (Buchungen, Umsatz, No-Shows)

CONVERSATION MANAGEMENT TOOLS:
- get_escalated_conversations: Eskalierte Chats anzeigen
- search_customer_conversations: Vergangene Gespräche durchsuchen`
}

/**
 * Get system prompt for the chatbot based on business context and role
 *
 * Architecture: Base + Role Overlay
 * - Base prompt: Shared by all roles (business context, compliance, error handling)
 * - Customer overlay: Booking flow, FAQs
 * - Staff overlay: + Booking management, customer lookup, communication
 * - Owner overlay: + Analytics, conversation management
 */
function getSystemPrompt(
  context: BusinessContext,
  businessId: string,
  channel: string = 'web',
  role: UserRole = 'customer'
): string {
  // Build base prompt
  let prompt = buildBasePrompt(context, businessId, channel)

  // Add customer overlay (always included)
  prompt += buildCustomerOverlay(businessId)

  // Add staff overlay for staff and owner
  if (role === 'staff' || role === 'owner') {
    prompt += buildStaffOverlay()
  }

  // Add owner overlay for owner only
  if (role === 'owner') {
    prompt += buildOwnerOverlay()
  }

  return prompt
}

/**
 * Access context for search operations (Phase 1: Business Logic Separation)
 */
export interface ChatAccessContext {
  actorType: 'customer' | 'staff' | 'owner'
  actorId?: string  // customerId or clerkUserId
  customerScopeId?: string  // For staff querying about specific customer
}

/**
 * Handle an incoming chat message
 */
export async function handleChatMessage(params: {
  businessId: string
  conversationId?: string
  message: string
  channel?: string
  customerId?: string
  adminContext?: { userId: string; role: string; isAdmin: boolean }
  // Phase 1: Access context for search operations
  accessContext?: ChatAccessContext
}): Promise<{
  conversationId: string
  response: string
  metadata?: Record<string, unknown>
}> {
  const { businessId, message, channel = 'web', customerId, adminContext, accessContext } = params

  // Determine user role
  let userRole: UserRole = 'customer'
  if (adminContext?.isAdmin) {
    userRole = adminContext.role === 'owner' ? 'owner' : 'staff'
  }

  // Derive access context if not provided
  const effectiveAccessContext: ChatAccessContext = accessContext || {
    actorType: userRole,
    actorId: userRole !== 'customer' ? adminContext?.userId : customerId,
  }

  // 1. Get business info
  const business = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1)
    .then(rows => rows[0])

  if (!business) {
    throw new Error('Business not found')
  }

  // 2. Get active services for context
  const businessServices = await db
    .select({
      name: services.name,
      description: services.description,
    })
    .from(services)
    .where(and(
      eq(services.businessId, businessId),
      eq(services.isActive, true)
    ))
    .orderBy(services.sortOrder)

  // 3. Build business context for dynamic prompt
  const businessContext: BusinessContext = {
    name: business.name,
    type: business.type,
    email: business.email,
    phone: business.phone,
    services: businessServices,
    policies: {
      minBookingNoticeHours: business.minBookingNoticeHours,
      cancellationPolicyHours: business.cancellationPolicyHours,
    },
    customInstructions: typeof business.settings === 'object' && business.settings !== null
      ? (business.settings as { chatbotInstructions?: string }).chatbotInstructions
      : undefined
  }

  // 4. Get or create conversation
  let conversationId = params.conversationId

  if (!conversationId) {
    const [conversation] = await db
      .insert(chatbotConversations)
      .values({
        businessId,
        customerId,
        channel,
        status: 'active',
      })
      .returning()

    conversationId = conversation.id
  }

  // 5. Save user message
  await db.insert(chatbotMessages).values({
    conversationId,
    role: 'user',
    content: message,
  })

  // 6. Load optimized conversation context (summary + recent messages)
  const context = await loadConversationContext(conversationId)

  // Build history from context
  const history = context.messages

  // Build intent context for reconnecting customers
  const intentContext = buildIntentContext(context.intent)

  // Build summary context if available
  const summaryContext = context.summary
    ? `\n\nZUSAMMENFASSUNG BISHERIGER GESPRÄCH:\n${context.summary}\n`
    : ''

  // 7. Filter tools based on user role
  // Customer-only tools (base tools for booking flow)
  const customerTools = [
    'get_current_date',
    'get_available_services',
    'get_available_staff',
    'check_availability',
    'create_hold',
    'confirm_booking',
    'search_knowledge_base',
  ]

  // Staff tools (customer tools + booking/customer management)
  const staffTools = [
    ...customerTools,
    'search_bookings',
    'update_booking_status',
    'reschedule_booking',
    'get_todays_bookings',
    'get_upcoming_bookings',
    'create_booking_admin',
    'cancel_booking_with_notification',
    'create_customer',
    'search_customers',
    'get_customer_bookings',
    'send_email_to_customer',
    'resend_booking_confirmation',
  ]

  // Owner tools (staff tools + analytics + conversation management)
  const ownerTools = [
    ...staffTools,
    'get_daily_summary',
    'get_escalated_conversations',
    'search_customer_conversations',
  ]

  // Select tools based on role
  let allowedToolNames: string[]
  switch (userRole) {
    case 'owner':
      allowedToolNames = ownerTools
      break
    case 'staff':
      allowedToolNames = staffTools
      break
    default:
      allowedToolNames = customerTools
  }

  const availableTools = tools.filter(t => allowedToolNames.includes(t.function.name))

  // 8. Build messages for AI with dynamic system prompt
  // Include summary and intent context for better continuity
  const systemPromptContent = getSystemPrompt(businessContext, businessId, channel, userRole)
    + summaryContext
    + intentContext

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: systemPromptContent,
    },
    ...history.map((h) => {
      const baseMessage = {
        role: h.role as ChatMessage['role'],
        content: h.content,
      }

      // Reconstruct assistant messages with tool_calls
      if (h.role === 'assistant' && h.metadata && typeof h.metadata === 'object' && 'tool_calls' in h.metadata) {
        return {
          ...baseMessage,
          tool_calls: h.metadata.tool_calls as ToolCall[],
        }
      }

      // Reconstruct tool messages with tool_call_id and name
      if (h.role === 'tool' && h.metadata && typeof h.metadata === 'object') {
        const metadata = h.metadata as Record<string, unknown>
        if (metadata.tool_call_id && metadata.tool_name) {
          return {
            ...baseMessage,
            tool_call_id: metadata.tool_call_id as string,
            name: metadata.tool_name as string,
          }
        }
      }

      return baseMessage
    }),
  ]

  // 9. Call AI with tool support
  let response = await createChatCompletion({
    messages,
    tools: availableTools,
    temperature: 0.7,
    max_tokens: 1000,
  })

  // Validate response structure
  if (!response || !response.choices || !response.choices[0]) {
    console.error('[Conversation] Invalid OpenRouter response structure:', {
      hasResponse: !!response,
      hasChoices: !!response?.choices,
      choicesLength: response?.choices?.length,
      response: JSON.stringify(response).substring(0, 500),
    })
    throw new Error('Invalid response from AI model')
  }

  let assistantMessage = response.choices[0].message
  let toolCalls = assistantMessage.tool_calls
  let finalResponse = assistantMessage.content

  // 10. Handle tool calls (may require multiple rounds)
  // Increased from 5 to 10 to allow "next available" searches across multiple days
  const maxToolRounds = 10
  let toolRound = 0

  while (toolCalls && toolCalls.length > 0 && toolRound < maxToolRounds) {
    toolRound++

    // Save assistant message with tool calls
    await db.insert(chatbotMessages).values({
      conversationId,
      role: 'assistant',
      content: assistantMessage.content || '',
      metadata: { tool_calls: toolCalls },
    })

    // Execute each tool call
    const toolResults: ChatMessage[] = []

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name
      const rawArgs = toolCall.function.arguments

      // DEBUG: Log FULL tool call structure
      console.log('[TOOL CALL DEBUG]', {
        tool: toolName,
        rawArgsType: typeof rawArgs,
        rawArgsLength: typeof rawArgs === 'string' ? rawArgs.length : 'N/A',
        rawArgsPreview: typeof rawArgs === 'string' ? rawArgs.substring(0, 100) : rawArgs,
      })

      // PHASE 1 FIX A: Parse arguments with structured result
      const parseResult = parseToolArguments(rawArgs)

      if (!parseResult.success) {
        console.error(`[Chatbot] Parse failed for ${toolName}:`, parseResult.error)

        // Return error to model so it can retry
        const errorResponse = {
          success: false,
          code: 'INVALID_TOOL_ARGS',
          error: 'Tool arguments could not be parsed',
          details: {
            reason: parseResult.error,
            hint: 'Check that all required parameters are provided in correct format',
          },
        }

        toolResults.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: JSON.stringify(errorResponse),
        })

        // Save error to DB
        await db.insert(chatbotMessages).values({
          conversationId,
          role: 'tool',
          content: JSON.stringify(errorResponse),
          metadata: {
            tool_call_id: toolCall.id,
            tool_name: toolName,
          },
        })

        continue // Skip to next tool call
      }

      const toolArgs = parseResult.data!

      // PHASE 1 FIX B: Validate required fields for this tool
      const toolDef = availableTools.find(t => t.function.name === toolName)
      if (toolDef) {
        const required = toolDef.function.parameters.required || []
        const properties = (toolDef.function.parameters.properties || {}) as Record<string, { type?: string }>

        // Check for missing/invalid required fields
        const missing: string[] = []
        for (const key of required) {
          const value = toolArgs[key]
          const propType = properties[key]?.type

          // Missing if undefined or null
          if (value === undefined || value === null) {
            // Skip businessId - we inject it server-side (line 867)
            if (key !== 'businessId') {
              missing.push(key)
            }
            continue
          }

          // For strings: also treat empty string as missing
          if (propType === 'string' && value === '') {
            missing.push(key)
            continue
          }

          // For other types: 0, false, [] are VALID (not missing)
        }

        if (missing.length > 0) {
          console.error(`[Chatbot] Missing required args for ${toolName}:`, missing)

          const errorResponse = {
            success: false,
            code: 'MISSING_REQUIRED_ARGS',
            error: `Missing required parameters: ${missing.join(', ')}`,
            details: {
              required: required,
              provided: Object.keys(toolArgs),
              missing: missing,
            },
          }

          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify(errorResponse),
          })

          await db.insert(chatbotMessages).values({
            conversationId,
            role: 'tool',
            content: JSON.stringify(errorResponse),
            metadata: {
              tool_call_id: toolCall.id,
              tool_name: toolName,
            },
          })

          continue // Skip to next tool call
        }
      }

      // PHASE 1 FIX C: SERVER-SIDE INJECTION - Always override businessId
      // Also inject access context for search operations and conversationId for intent tracking
      const safeToolArgs = {
        ...toolArgs,
        businessId: businessId, // Force to conversation's businessId
        // Phase 1: Pass access context for access-controlled searches
        _accessContext: {
          actorType: effectiveAccessContext.actorType,
          actorId: effectiveAccessContext.actorId,
          customerScopeId: effectiveAccessContext.customerScopeId,
        },
        // Memory: Pass conversationId for intent tracking
        _conversationId: conversationId,
      }

      console.log(`[Chatbot] Executing tool: ${toolName}`, {
        originalBusinessId: toolArgs.businessId,
        injectedBusinessId: safeToolArgs.businessId,
        actorType: effectiveAccessContext.actorType,
        args: { ...safeToolArgs, _accessContext: '[REDACTED]' }, // Don't log full context
      })

      try {
        // Execute with safe args (businessId guaranteed correct, access context included)
        const result = await executeTool(toolName, safeToolArgs)

        toolResults.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: JSON.stringify(result),
        })

        // Save tool result
        await db.insert(chatbotMessages).values({
          conversationId,
          role: 'tool',
          content: JSON.stringify(result),
          metadata: {
            tool_call_id: toolCall.id,
            tool_name: toolName,
          },
        })
      } catch (error) {
        console.error(`[Chatbot] Tool execution error:`, error)

        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        const errorResponse = {
          success: false,
          code: 'INTERNAL_ERROR',
          error: errorMessage,
        }

        toolResults.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: JSON.stringify(errorResponse),
        })

        // Save error to DB
        await db.insert(chatbotMessages).values({
          conversationId,
          role: 'tool',
          content: JSON.stringify(errorResponse),
          metadata: {
            tool_call_id: toolCall.id,
            tool_name: toolName,
          },
        })
      }
    }

    // Get AI response with tool results
    messages.push(assistantMessage)
    messages.push(...toolResults)

    response = await createChatCompletion({
      messages,
      tools: availableTools,
      temperature: 0.7,
      max_tokens: 1000,
    })

    // Validate response structure
    if (!response || !response.choices || !response.choices[0]) {
      console.error('[Conversation] Invalid OpenRouter response structure:', {
        hasResponse: !!response,
        hasChoices: !!response?.choices,
        choicesLength: response?.choices?.length,
        response: JSON.stringify(response).substring(0, 500),
      })
      throw new Error('Invalid response from AI model')
    }

    assistantMessage = response.choices[0].message
    toolCalls = assistantMessage.tool_calls
    finalResponse = assistantMessage.content
  }

  // 10. Validate finalResponse and provide graceful fallback
  if (!finalResponse || finalResponse.trim() === '') {
    // Check if there were tool errors
    const hadToolErrors = messages.some(m => {
      if (m.role === 'tool') {
        try {
          const parsed = JSON.parse(m.content || '{}')
          return parsed.success === false
        } catch {
          return false
        }
      }
      return false
    })

    if (hadToolErrors) {
      finalResponse = 'Es gab einen technischen Fehler bei der Verarbeitung Ihrer Anfrage. Bitte versuchen Sie es erneut oder kontaktieren Sie uns direkt.'
    } else {
      finalResponse = 'Entschuldigung, ich konnte keine passende Antwort generieren. Wie kann ich Ihnen weiterhelfen?'
    }

    console.warn('[Conversation] AI failed to generate response, using fallback', {
      conversationId,
      hadToolErrors,
      toolRound,
    })
  }

  // 11. Save final assistant response
  await db.insert(chatbotMessages).values({
    conversationId,
    role: 'assistant',
    content: finalResponse || '',
    metadata: {
      model: response.model,
      usage: response.usage,
    },
  })

  // 12. Update conversation timestamp and check if summary needed
  // Increment message count (user message + assistant response = 2)
  const newMessageCount = context.messagesSinceSummary + 2

  // Update summary in background (non-blocking)
  updateSummaryIfNeeded(conversationId, newMessageCount).catch(err => {
    console.error('[Memory] Summary update failed:', err)
  })

  return {
    conversationId,
    response: finalResponse || 'Entschuldigung, ich konnte keine Antwort generieren.',
    metadata: {
      model: response.model,
      usage: response.usage,
      toolCallsExecuted: toolRound,
    },
  }
}

/**
 * Get conversation history
 */
export async function getConversationHistory(conversationId: string) {
  const messages = await db
    .select({
      id: chatbotMessages.id,
      role: chatbotMessages.role,
      content: chatbotMessages.content,
      createdAt: chatbotMessages.createdAt,
      metadata: chatbotMessages.metadata,
    })
    .from(chatbotMessages)
    .where(eq(chatbotMessages.conversationId, conversationId))
    .orderBy(chatbotMessages.createdAt)

  return messages
}

/**
 * List conversations for a business
 */
export async function listConversations(businessId: string, limit = 50) {
  const conversations = await db
    .select()
    .from(chatbotConversations)
    .where(eq(chatbotConversations.businessId, businessId))
    .orderBy(desc(chatbotConversations.updatedAt))
    .limit(limit)

  // Check which conversations have staff messages
  const conversationIds = conversations.map(c => c.id)
  let staffConversationIds: Set<string> = new Set()

  if (conversationIds.length > 0) {
    const staffMessages = await db
      .select({ conversationId: chatbotMessages.conversationId })
      .from(chatbotMessages)
      .where(and(
        inArray(chatbotMessages.conversationId, conversationIds),
        eq(chatbotMessages.role, 'staff')
      ))

    staffConversationIds = new Set(staffMessages.map(m => m.conversationId))
  }

  return conversations.map(c => ({
    ...c,
    hasStaffMessages: staffConversationIds.has(c.id),
  }))
}
