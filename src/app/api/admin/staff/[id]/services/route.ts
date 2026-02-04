import { NextRequest, NextResponse } from 'next/server'
import { requireBusinessAuth } from '@/lib/auth'
import { updateStaffServices, getStaffWithServices, verifyStaffOwnership } from '@/lib/db/queries'
import { z } from 'zod'

const serviceIdsSchema = z.object({
  serviceIds: z.array(z.string().uuid()),
})

export async function PUT(
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

  const parsed = serviceIdsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  await updateStaffServices(id, parsed.data.serviceIds, authResult.business.id)

  const staffMember = await getStaffWithServices(id, authResult.business.id)

  return NextResponse.json({ staff: staffMember })
}
