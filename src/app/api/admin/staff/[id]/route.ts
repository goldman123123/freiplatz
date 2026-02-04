import { NextRequest, NextResponse } from 'next/server'
import { requireBusinessAuth } from '@/lib/auth'
import { getStaffWithServices, updateStaff, deleteStaff, verifyStaffOwnership } from '@/lib/db/queries'
import { staffSchema } from '@/lib/validations/schemas'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireBusinessAuth()
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const { id } = await params

  // Verify ownership
  const isOwner = await verifyStaffOwnership(id, authResult.business.id)
  if (!isOwner) {
    return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
  }

  const staffMember = await getStaffWithServices(id, authResult.business.id)

  if (!staffMember) {
    return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
  }

  return NextResponse.json({ staff: staffMember })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireBusinessAuth()
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const { id } = await params

  // Verify ownership
  const isOwner = await verifyStaffOwnership(id, authResult.business.id)
  if (!isOwner) {
    return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
  }

  const body = await request.json()

  const parsed = staffSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { email, avatarUrl, serviceIds, ...rest } = parsed.data

  const staffMember = await updateStaff(id, {
    email: email || null,
    avatarUrl: avatarUrl || null,
    ...rest,
  })

  if (!staffMember) {
    return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
  }

  return NextResponse.json({ staff: staffMember })
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

  // Verify ownership
  const isOwner = await verifyStaffOwnership(id, authResult.business.id)
  if (!isOwner) {
    return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
  }

  const staffMember = await deleteStaff(id)

  if (!staffMember) {
    return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
  }

  return NextResponse.json({ staff: staffMember })
}
