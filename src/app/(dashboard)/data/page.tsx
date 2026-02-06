'use client'

/**
 * Data Dashboard
 *
 * Manage documents and data sources for the chatbot
 */

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card } from '@/components/ui/card'
import { FileText, Link as LinkIcon, Loader2 } from 'lucide-react'
import { DocumentsTab } from './components/DocumentsTab'

interface Business {
  id: string
  name: string
  slug: string
  type: string | null
}

export default function DataDashboardPage() {
  const [business, setBusiness] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchBusiness = async () => {
      try {
        const response = await fetch('/api/businesses/my')
        const data = await response.json()

        if (data.success && data.businesses.length > 0) {
          const firstBusiness = data.businesses[0]
          setBusiness({
            id: firstBusiness.business.id,
            name: firstBusiness.business.name,
            slug: firstBusiness.business.slug,
            type: firstBusiness.business.type,
          })
        }
      } catch (error) {
        console.error('Failed to fetch business:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchBusiness()
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Lädt...</span>
        </div>
      </div>
    )
  }

  if (!business) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Card className="p-8 text-center">
          <h2 className="text-lg font-semibold text-gray-900">
            Kein Unternehmen gefunden
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            Bitte erstellen Sie zuerst ein Unternehmen, um Daten zu verwalten.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Daten</h1>
        <p className="mt-2 text-gray-600">
          Verwalten Sie Dokumente und Datenquellen für Ihren Chatbot
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="documents" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 lg:w-auto lg:grid-cols-none lg:flex">
          <TabsTrigger value="documents" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span>Dokumente</span>
          </TabsTrigger>
          <TabsTrigger value="sources" disabled className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4" />
            <span>Quellen (bald)</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="documents">
          <DocumentsTab businessId={business.id} />
        </TabsContent>

        <TabsContent value="sources">
          <Card className="p-8 text-center">
            <LinkIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              Datenquellen kommen bald
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              Verbinden Sie Websites, APIs und andere Datenquellen mit Ihrem Chatbot.
            </p>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
