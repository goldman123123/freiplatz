/**
 * WhatsApp Phone Number Formatting
 *
 * Normalizes phone numbers to E.164 format for consistent storage
 * Example: "+5926964488", "592-696-4488", "0696-4488" → "+5926964488"
 */

export function formatE164Phone(phone: string): string {
  // Remove all non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, '')

  // Remove whatsapp: prefix if present
  if (phone.toLowerCase().startsWith('whatsapp:')) {
    cleaned = phone.replace(/^whatsapp:/i, '').replace(/[^\d+]/g, '')
  }

  // If starts with 00, replace with +
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2)
  }

  // Guyana-specific: if starts with 0 and is 7 digits, prepend country code
  if (cleaned.startsWith('0') && cleaned.length === 7) {
    cleaned = '+592' + cleaned.slice(1)
  }

  // Add + prefix if missing and looks like international number
  if (!cleaned.startsWith('+') && cleaned.length > 10) {
    cleaned = '+' + cleaned
  }

  return cleaned
}

export function isValidWhatsAppPhone(phone: string): boolean {
  const cleaned = formatE164Phone(phone)

  // E.164 format: +[country code][number]
  // Length: 8-15 digits (excluding +)
  return /^\+[1-9]\d{7,14}$/.test(cleaned)
}

/**
 * Format phone number for Twilio (with whatsapp: prefix)
 */
export function formatTwilioWhatsAppNumber(phone: string): string {
  const e164 = formatE164Phone(phone)
  return `whatsapp:${e164}`
}
