/**
 * Team Members API
 *
 * GET /api/admin/members - List all members for the business
 * POST /api/admin/members - Invite a new member
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireBusinessAuth } from '@/lib/auth'
import { getBusinessMembers, createBusinessMember } from '@/lib/db/queries'
import { requirePermission } from '@/modules/core/permissions'
import { requireSeatsAvailable } from '@/modules/core/entitlements'
import { getMembership } from '@/modules/core/auth'
import { emitEventStandalone } from '@/modules/core/events'
import { z } from 'zod'

const inviteMemberSchema = z.object({
  email: z.string().email('Ungültige E-Mail-Adresse'),
  role: z.enum(['owner', 'admin', 'staff'], {
    errorMap: () => ({ message: 'Rolle muss owner, admin oder staff sein' })
  }),
})

export async function GET(request: NextRequest) {
  const authResult = await requireBusinessAuth()
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  // Get current user's membership to check permissions
  const member = await getMembership(authResult.userId, authResult.business.id)

  if (!member) {
    return NextResponse.json({ error: 'Zugriff verweigert' }, { status: 403 })
  }

  try {
    // Check permission
    requirePermission(member, 'members:read')

    // Get all members
    const members = await getBusinessMembers(authResult.business.id)

    return NextResponse.json({ members })
  } catch (error) {
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }

    console.error('Error fetching members:', error)
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireBusinessAuth()
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  // Get current user's membership to check permissions
  const member = await getMembership(authResult.userId, authResult.business.id)

  if (!member) {
    return NextResponse.json({ error: 'Zugriff verweigert' }, { status: 403 })
  }

  try {
    // Check permission
    requirePermission(member, 'members:invite')

    // Check seat limits
    await requireSeatsAvailable(authResult.business)

    // Parse and validate request body
    const body = await request.json()
    const parsed = inviteMemberSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { email, role } = parsed.data

    // TODO: Look up Clerk user by email to get clerkUserId
    // For now, we'll use email as placeholder (will be matched when user signs up)
    const clerkUserId = `pending:${email}`

    // Create member invitation
    const newMember = await createBusinessMember({
      businessId: authResult.business.id,
      clerkUserId,
      role,
      status: 'invited',
      invitedBy: member.id,
    })

    // Emit member.invited event (send invitation email)
    await emitEventStandalone(authResult.business.id, 'member.invited', {
      memberId: newMember.id,
      businessId: authResult.business.id,
      businessName: authResult.business.name,
      inviteeEmail: email,
      inviteeName: undefined,
      inviterName: authResult.userId, // TODO: Get actual user name from Clerk
      role,
      invitationUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.freiplatz.work'}/accept-invitation/${newMember.id}`,
    })

    return NextResponse.json({ member: newMember }, { status: 201 })
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'ForbiddenError') {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
      if (error.name === 'SeatLimitError') {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
    }

    console.error('Error inviting member:', error)
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}
