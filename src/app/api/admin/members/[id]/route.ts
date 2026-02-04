/**
 * Individual Member API
 *
 * PATCH /api/admin/members/[id] - Update member role
 * DELETE /api/admin/members/[id] - Remove member
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireBusinessAuth } from '@/lib/auth'
import { getMemberById, updateMemberRole, removeMember } from '@/lib/db/queries'
import { requirePermission, isOwner } from '@/modules/core/permissions'
import { getMembership } from '@/modules/core/auth'
import { z } from 'zod'

const updateMemberSchema = z.object({
  role: z.enum(['owner', 'admin', 'staff'], {
    message: 'Rolle muss owner, admin oder staff sein'
  }),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireBusinessAuth()
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const { id } = await params

  // Get current user's membership to check permissions
  const currentMember = await getMembership(authResult.userId, authResult.business.id)

  if (!currentMember) {
    return NextResponse.json({ error: 'Zugriff verweigert' }, { status: 403 })
  }

  try {
    // Check permission
    requirePermission(currentMember, 'members:update')

    // Get the target member
    const targetMember = await getMemberById(id)

    if (!targetMember || targetMember.businessId !== authResult.business.id) {
      return NextResponse.json({ error: 'Mitglied nicht gefunden' }, { status: 404 })
    }

    // Prevent removing the last owner (must always have at least one owner)
    if (isOwner(targetMember)) {
      return NextResponse.json(
        { error: 'Die Rolle des Besitzers kann nicht geändert werden' },
        { status: 403 }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const parsed = updateMemberSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { role } = parsed.data

    // Update member role
    const updatedMember = await updateMemberRole(id, role)

    return NextResponse.json({ member: updatedMember })
  } catch (error) {
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }

    console.error('Error updating member:', error)
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireBusinessAuth()
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const { id } = await params

  // Get current user's membership to check permissions
  const currentMember = await getMembership(authResult.userId, authResult.business.id)

  if (!currentMember) {
    return NextResponse.json({ error: 'Zugriff verweigert' }, { status: 403 })
  }

  try {
    // Check permission
    requirePermission(currentMember, 'members:remove')

    // Get the target member
    const targetMember = await getMemberById(id)

    if (!targetMember || targetMember.businessId !== authResult.business.id) {
      return NextResponse.json({ error: 'Mitglied nicht gefunden' }, { status: 404 })
    }

    // Prevent removing the last owner
    if (isOwner(targetMember)) {
      return NextResponse.json(
        { error: 'Der Besitzer kann nicht entfernt werden' },
        { status: 403 }
      )
    }

    // Remove member
    await removeMember(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }

    console.error('Error removing member:', error)
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
  }
}
