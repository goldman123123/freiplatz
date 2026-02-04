import { NextRequest, NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { createBusinessForUser, getBusinessForUser, getBusinessBySlug } from '@/lib/db/queries'
import { z } from 'zod'

const onboardingSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  slug: z.string().min(2, 'URL must be at least 2 characters').max(50).regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens'),
  type: z.enum(['clinic', 'salon', 'consultant', 'gym', 'other']),
  timezone: z.string().default('Europe/Berlin'),
  email: z.string().email().optional().or(z.literal('')),
})

export async function POST(request: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if user already has a business
  const existingBusiness = await getBusinessForUser(userId)
  if (existingBusiness) {
    return NextResponse.json({ error: 'You already have a business' }, { status: 400 })
  }

  const body = await request.json()

  const parsed = onboardingSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  // Check if slug is already taken
  const existingSlug = await getBusinessBySlug(parsed.data.slug)
  if (existingSlug) {
    return NextResponse.json({ error: 'This booking URL is already taken' }, { status: 400 })
  }

  // Get Clerk user's email as fallback if no business email provided
  let businessEmail = parsed.data.email
  if (!businessEmail) {
    const client = await clerkClient()
    const user = await client.users.getUser(userId)
    businessEmail = user.primaryEmailAddress?.emailAddress
  }

  const business = await createBusinessForUser({
    clerkUserId: userId,
    name: parsed.data.name,
    slug: parsed.data.slug,
    type: parsed.data.type,
    timezone: parsed.data.timezone,
    email: businessEmail || undefined,
  })

  return NextResponse.json({ business }, { status: 201 })
}
