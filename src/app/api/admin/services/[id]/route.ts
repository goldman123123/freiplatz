import { NextRequest, NextResponse } from 'next/server'
import { requireBusinessAuth } from '@/lib/auth'
import { getServiceById, updateService, deleteService, verifyServiceOwnership } from '@/lib/db/queries'
import { serviceSchema } from '@/lib/validations/schemas'

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
  const isOwner = await verifyServiceOwnership(id, authResult.business.id)
  if (!isOwner) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  const service = await getServiceById(id, authResult.business.id)

  if (!service) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  return NextResponse.json({ service })
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
  const isOwner = await verifyServiceOwnership(id, authResult.business.id)
  if (!isOwner) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  const body = await request.json()

  const parsed = serviceSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const service = await updateService(id, parsed.data)

  if (!service) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  return NextResponse.json({ service })
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
  const isOwner = await verifyServiceOwnership(id, authResult.business.id)
  if (!isOwner) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  const service = await deleteService(id)

  if (!service) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  return NextResponse.json({ service })
}
