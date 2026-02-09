'use client'

import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/nextjs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FormDialog } from '@/components/forms'
import { FormInput, FormTextarea, FormCheckbox } from '@/components/forms/FormField'
import {
  Building2, FileText, Phone, Mail, MapPin, Globe, Pencil, Loader2,
  Shield, Bot, AlertTriangle, CheckCircle, ExternalLink, Info, Clock, Coins,
  XCircle, Copy, Check, MessageCircle
} from 'lucide-react'
import Link from 'next/link'

interface BusinessSettings {
  privacyPolicyUrl?: string
  dataRetentionDays?: number
  dpaAcceptedAt?: string
  dpaAcceptedBy?: string
  aiLiteracyAcknowledgedAt?: string
  aiLiteracyAcknowledgedBy?: string
  aiLiteracyVersion?: string
  aiDisclosureMessage?: string
  avvAcceptedAt?: string
  avvAcceptedBy?: string
  avvVersion?: string
  // WhatsApp BYOT
  twilioAccountSid?: string
  twilioAuthToken?: string
  hasTwilioAuthToken?: boolean
  twilioWhatsappNumber?: string
  whatsappEnabled?: boolean
  twilioVerifiedAt?: string
  twilioVerifiedBy?: string
}

interface Business {
  id: string
  name: string
  slug: string
  type: string
  tagline: string | null
  description: string | null
  foundedYear: number | null
  legalName: string | null
  legalForm: string | null
  registrationNumber: string | null
  registrationCourt: string | null
  email: string | null
  phone: string | null
  address: string | null
  website: string | null
  timezone: string | null
  currency: string | null
  settings: BusinessSettings | null
}

const CURRENT_AI_LITERACY_VERSION = '1.0'
const CURRENT_AVV_VERSION = '1.0'

export default function UnternehmenPage() {
  const { user } = useUser()
  const [business, setBusiness] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)
  const [editSection, setEditSection] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [whatsappCopied, setWhatsappCopied] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const [whatsappForm, setWhatsappForm] = useState({
    twilioAccountSid: '',
    twilioAuthToken: '',
    twilioWhatsappNumber: '',
    whatsappEnabled: false,
  })

  const [profileForm, setProfileForm] = useState({
    name: '',
    slug: '',
    type: '',
    tagline: '',
    description: '',
    foundedYear: '',
    address: '',
    website: '',
    timezone: 'Europe/Berlin',
    currency: 'EUR',
  })

  const [contactForm, setContactForm] = useState({
    email: '',
    phone: '',
  })

  const [legalForm, setLegalFormState] = useState({
    legalName: '',
    legalForm: '',
    registrationNumber: '',
    registrationCourt: '',
  })

  const [dataControlForm, setDataControlForm] = useState({
    privacyPolicyUrl: '',
    dataRetentionDays: 365,
    dpaAccepted: false,
    aiLiteracyAcknowledged: false,
    aiDisclosureMessage: 'Ich bin ein KI-Assistent. Für persönliche Beratung wenden Sie sich bitte an unser Team.',
  })

  const fetchBusiness = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings')
      const data = await res.json()
      setBusiness(data.business)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBusiness()
  }, [fetchBusiness])

  useEffect(() => {
    if (business) {
      setProfileForm({
        name: business.name || '',
        slug: business.slug || '',
        type: business.type || '',
        tagline: business.tagline || '',
        description: business.description || '',
        foundedYear: business.foundedYear?.toString() || '',
        address: business.address || '',
        website: business.website || '',
        timezone: business.timezone || 'Europe/Berlin',
        currency: business.currency || 'EUR',
      })
      setContactForm({
        email: business.email || '',
        phone: business.phone || '',
      })
      setLegalFormState({
        legalName: business.legalName || '',
        legalForm: business.legalForm || '',
        registrationNumber: business.registrationNumber || '',
        registrationCourt: business.registrationCourt || '',
      })
      setDataControlForm({
        privacyPolicyUrl: business.settings?.privacyPolicyUrl || '',
        dataRetentionDays: business.settings?.dataRetentionDays || 365,
        dpaAccepted: !!business.settings?.dpaAcceptedAt,
        aiLiteracyAcknowledged: !!business.settings?.aiLiteracyAcknowledgedAt &&
          business.settings?.aiLiteracyVersion === CURRENT_AI_LITERACY_VERSION,
        aiDisclosureMessage: business.settings?.aiDisclosureMessage ||
          'Ich bin ein KI-Assistent. Für persönliche Beratung wenden Sie sich bitte an unser Team.',
      })
      setWhatsappForm({
        twilioAccountSid: business.settings?.twilioAccountSid || '',
        twilioAuthToken: '', // Never pre-fill — token is masked on server
        twilioWhatsappNumber: business.settings?.twilioWhatsappNumber || '',
        whatsappEnabled: business.settings?.whatsappEnabled || false,
      })
    }
  }, [business])

  async function handleSave(section: string, data: Record<string, unknown>) {
    setIsSaving(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, data }),
      })
      if (res.ok) {
        await fetchBusiness()
        setEditSection(null)
      }
    } finally {
      setIsSaving(false)
    }
  }

  function copyBookingUrl() {
    if (business?.slug) {
      navigator.clipboard.writeText(`https://hebelki.de/book/${business.slug}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function copyWebhookUrl() {
    navigator.clipboard.writeText('https://www.hebelki.de/api/whatsapp/webhook')
    setWhatsappCopied(true)
    setTimeout(() => setWhatsappCopied(false), 2000)
  }

  async function testWhatsAppConnection() {
    setTestingConnection(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/admin/whatsapp/test', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setTestResult({ success: true, message: `Verbunden: ${data.accountName} (${data.accountStatus})` })
        await fetchBusiness() // Refresh to show verified badge
      } else {
        setTestResult({ success: false, message: data.error || 'Verbindung fehlgeschlagen' })
      }
    } catch {
      setTestResult({ success: false, message: 'Netzwerkfehler' })
    } finally {
      setTestingConnection(false)
    }
  }

  // Business readiness checks
  const getReadinessChecks = () => {
    if (!business) return []

    const checks = []

    // Identity checks
    if (!business.description) {
      checks.push({
        status: 'warning',
        label: 'Beschreibung fehlt',
        detail: 'Kunden sehen keine Informationen auf der Buchungsseite',
        section: 'profile',
      })
    }
    if (!business.address) {
      checks.push({
        status: 'error',
        label: 'Adresse fehlt',
        detail: 'Erforderlich für Impressum und Rechnungen',
        section: 'profile',
      })
    }

    // Legal checks
    if (!business.legalName) {
      checks.push({
        status: 'error',
        label: 'Rechtliche Angaben fehlen',
        detail: 'Rechnungen können nicht erstellt werden',
        section: 'legal',
      })
    }

    // Compliance checks
    if (!business.settings?.privacyPolicyUrl) {
      checks.push({
        status: 'error',
        label: 'Datenschutzerklärung fehlt',
        detail: 'WhatsApp-Integration blockiert',
        section: 'legal',
      })
    }
    if (!business.settings?.avvAcceptedAt || business.settings?.avvVersion !== CURRENT_AVV_VERSION) {
      checks.push({
        status: 'warning',
        label: 'AVV nicht akzeptiert',
        detail: 'Auftragsverarbeitungsvertrag ausstehend',
        section: 'legal',
      })
    }
    if (!business.settings?.aiLiteracyAcknowledgedAt || business.settings?.aiLiteracyVersion !== CURRENT_AI_LITERACY_VERSION) {
      checks.push({
        status: 'warning',
        label: 'KI-Schulung nicht bestätigt',
        detail: 'Chatbot-Funktionen eingeschränkt',
        section: 'legal',
      })
    }

    // Contact checks
    if (!business.email) {
      checks.push({
        status: 'error',
        label: 'E-Mail fehlt',
        detail: 'Buchungsbestätigungen können nicht gesendet werden',
        section: 'contact',
      })
    }

    return checks
  }

  const readinessChecks = getReadinessChecks()
  const hasErrors = readinessChecks.some(c => c.status === 'error')
  const hasWarnings = readinessChecks.some(c => c.status === 'warning')
  const isReady = readinessChecks.length === 0

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!business) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-500">Kein Unternehmen konfiguriert.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Unternehmen</h1>
          <p className="text-gray-600">Wer ist dieses Unternehmen? Ist es einsatzbereit?</p>
        </div>
        <Badge className={`${isReady ? 'bg-green-500' : hasErrors ? 'bg-red-500' : 'bg-amber-500'} text-white`}>
          {isReady && <CheckCircle className="mr-1 h-3 w-3" />}
          {hasErrors && <XCircle className="mr-1 h-3 w-3" />}
          {!isReady && !hasErrors && <AlertTriangle className="mr-1 h-3 w-3" />}
          {isReady ? 'Einsatzbereit' : hasErrors ? 'Blockiert' : 'Handlungsbedarf'}
        </Badge>
      </div>

      {/* Readiness Snapshot - Only show if issues exist */}
      {readinessChecks.length > 0 && (
        <Card className="mb-6 border-amber-200 bg-amber-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Was fehlt?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {readinessChecks.map((check, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-md bg-white p-3 border"
                >
                  {check.status === 'error' ? (
                    <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{check.label}</p>
                    <p className="text-xs text-gray-500">{check.detail}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto flex-shrink-0"
                    onClick={() => setEditSection(check.section)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Business Profile - THE CORE IDENTITY */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Unternehmensprofil
              </CardTitle>
              <CardDescription>Wer ist dieses Unternehmen? Was sehen Kunden?</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditSection('profile')}>
              <Pencil className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              {/* Left column: Identity */}
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-500">Geschäftsname</label>
                  <p className="mt-1 text-lg font-semibold">{business.name}</p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500">Branche</label>
                  <p className="mt-1 capitalize">{business.type || 'Nicht angegeben'}</p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500">Tagline / Claim</label>
                  {business.tagline ? (
                    <p className="mt-1 italic text-gray-700">&quot;{business.tagline}&quot;</p>
                  ) : (
                    <p className="mt-1 text-sm text-gray-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                      Nicht angegeben (optional)
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500">Kurzbeschreibung</label>
                  {business.description ? (
                    <p className="mt-1 text-sm text-gray-600">{business.description}</p>
                  ) : (
                    <p className="mt-1 text-sm text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Fehlt - Kunden sehen keine Infos auf der Buchungsseite
                    </p>
                  )}
                </div>

                {business.foundedYear && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Gegründet</label>
                    <p className="mt-1">{business.foundedYear}</p>
                  </div>
                )}
              </div>

              {/* Right column: Location & Operations */}
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-500">Adresse</label>
                  {business.address ? (
                    <div className="mt-1 flex items-start gap-2">
                      <MapPin className="h-4 w-4 text-gray-400 mt-0.5" />
                      <span>{business.address}</span>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                      <XCircle className="h-3 w-3" />
                      Fehlt - Erforderlich für Impressum & Rechnungen
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500">Website</label>
                  {business.website ? (
                    <div className="mt-1 flex items-center gap-2">
                      <Globe className="h-4 w-4 text-gray-400" />
                      <a href={business.website} target="_blank" className="text-primary hover:underline">
                        {business.website}
                      </a>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-gray-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                      Nicht angegeben (optional)
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-500">Zeitzone</label>
                    <div className="mt-1 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-gray-400" />
                      <span className="text-sm">{business.timezone || 'Europe/Berlin'}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-500">Währung</label>
                    <div className="mt-1 flex items-center gap-2">
                      <Coins className="h-4 w-4 text-gray-400" />
                      <span className="text-sm">{business.currency || 'EUR'}</span>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <label className="text-sm font-medium text-gray-500">Buchungs-URL</label>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="flex-1 rounded bg-gray-100 px-3 py-2 text-sm">
                      hebelki.de/book/{business.slug}
                    </code>
                    <Button variant="outline" size="sm" onClick={copyBookingUrl}>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                    <Link href={`/book/${business.slug}`} target="_blank">
                      <Button variant="outline" size="sm">
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Contact Information */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5" />
                Kontaktdaten
              </CardTitle>
              <CardDescription>Für Buchungsbestätigungen und Kundenanfragen</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditSection('contact')}>
              <Pencil className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-500">E-Mail</label>
              {business.email ? (
                <div className="mt-1 flex items-center gap-2">
                  <Mail className="h-4 w-4 text-gray-400" />
                  <span>{business.email}</span>
                </div>
              ) : (
                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                  <XCircle className="h-3 w-3" />
                  Fehlt - Buchungsbestätigungen blockiert
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Telefon</label>
              {business.phone ? (
                <div className="mt-1 flex items-center gap-2">
                  <Phone className="h-4 w-4 text-gray-400" />
                  <span>{business.phone}</span>
                </div>
              ) : (
                <p className="mt-1 text-sm text-gray-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                  Nicht angegeben (empfohlen für Eskalationen)
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Legal Identity */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Rechtliche Identität
              </CardTitle>
              <CardDescription>Impressum & Handelsregister (für Rechnungen)</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditSection('legal')}>
              <Pencil className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {business.legalName ? (
              <>
                <div>
                  <label className="text-sm font-medium text-gray-500">Rechtlicher Firmenname</label>
                  <p className="mt-1 font-medium">{business.legalName}</p>
                </div>
                {business.legalForm && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Rechtsform</label>
                    <p className="mt-1">{business.legalForm}</p>
                  </div>
                )}
                {business.registrationNumber && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Handelsregisternummer</label>
                    <p className="mt-1">{business.registrationNumber}</p>
                  </div>
                )}
                {business.registrationCourt && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Registergericht</label>
                    <p className="mt-1">{business.registrationCourt}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-md bg-red-50 p-4">
                <p className="text-sm text-red-600 flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  <span>
                    <strong>Keine rechtlichen Angaben hinterlegt.</strong>
                    <br />
                    Rechnungen können nicht erstellt werden.
                  </span>
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setEditSection('legal')}
                >
                  Jetzt ergänzen
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Compliance - Full Width */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Datenschutz & Compliance
              </CardTitle>
              <CardDescription>DSGVO, EU AI Act und Auftragsverarbeitung</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditSection('compliance')}>
              <Pencil className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-3">
              {/* Datenschutz */}
              <div className="space-y-3">
                <h4 className="font-semibold text-gray-700">Datenschutz</h4>
                <div>
                  <label className="text-sm font-medium text-gray-500">Datenschutzerklärung</label>
                  {business.settings?.privacyPolicyUrl ? (
                    <p className="mt-1 flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      Hinterlegt
                    </p>
                  ) : (
                    <p className="mt-1 flex items-center gap-2 text-red-600 text-sm">
                      <XCircle className="h-4 w-4" />
                      Fehlt (WhatsApp blockiert)
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Datenaufbewahrung</label>
                  <p className="mt-1 text-sm">{business.settings?.dataRetentionDays || 365} Tage</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">DPA</label>
                  {business.settings?.dpaAcceptedAt ? (
                    <p className="mt-1 flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      Akzeptiert
                    </p>
                  ) : (
                    <p className="mt-1 flex items-center gap-2 text-amber-600 text-sm">
                      <AlertTriangle className="h-4 w-4" />
                      Ausstehend
                    </p>
                  )}
                </div>
              </div>

              {/* AVV */}
              <div className="space-y-3">
                <h4 className="font-semibold text-gray-700">AVV (Art. 28 DSGVO)</h4>
                <div>
                  <label className="text-sm font-medium text-gray-500">Vertragsstatus</label>
                  {business.settings?.avvAcceptedAt &&
                   business.settings?.avvVersion === CURRENT_AVV_VERSION ? (
                    <p className="mt-1 flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      Akzeptiert (v{CURRENT_AVV_VERSION})
                    </p>
                  ) : (
                    <div className="mt-1">
                      <p className="flex items-center gap-2 text-amber-600 text-sm">
                        <AlertTriangle className="h-4 w-4" />
                        {business.settings?.avvAcceptedAt ? 'Neue Version' : 'Nicht akzeptiert'}
                      </p>
                      <Button
                        onClick={() => handleSave('avv', { avvAccepted: true, userId: user?.id })}
                        disabled={isSaving}
                        size="sm"
                        className="mt-2"
                      >
                        AVV akzeptieren
                      </Button>
                    </div>
                  )}
                </div>
                <div className="space-y-1 text-sm">
                  <Link href="/legal/avv" className="flex items-center gap-1 text-primary hover:underline">
                    <FileText className="h-3 w-3" />
                    AVV lesen
                  </Link>
                  <Link href="/legal/unterauftragsverarbeiter" className="flex items-center gap-1 text-primary hover:underline">
                    <Shield className="h-3 w-3" />
                    Unterauftragsverarbeiter
                  </Link>
                  <Link href="/legal/toms" className="flex items-center gap-1 text-primary hover:underline">
                    <Shield className="h-3 w-3" />
                    TOMs
                  </Link>
                </div>
              </div>

              {/* EU AI Act */}
              <div className="space-y-3">
                <h4 className="font-semibold text-gray-700 flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  EU AI Act (Art. 4)
                </h4>
                <div>
                  <label className="text-sm font-medium text-gray-500">KI-Schulung</label>
                  {business.settings?.aiLiteracyAcknowledgedAt &&
                   business.settings?.aiLiteracyVersion === CURRENT_AI_LITERACY_VERSION ? (
                    <p className="mt-1 flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      Bestätigt
                    </p>
                  ) : (
                    <p className="mt-1 flex items-center gap-2 text-amber-600 text-sm">
                      <AlertTriangle className="h-4 w-4" />
                      Chatbot eingeschränkt
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">KI-Hinweis</label>
                  <p className="mt-1 text-xs italic text-gray-500 line-clamp-2">
                    &quot;{business.settings?.aiDisclosureMessage || 'Nicht konfiguriert'}&quot;
                  </p>
                </div>
                <Link href="/legal/ai-usage" className="flex items-center gap-1 text-sm text-primary hover:underline">
                  <Info className="h-3 w-3" />
                  KI-Nutzungshinweise
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* WhatsApp Integration - Full Width */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                WhatsApp-Integration
              </CardTitle>
              <CardDescription>Twilio-Zugangsdaten für WhatsApp-Chatbot und Live-Chat</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditSection('whatsapp')}>
              <Pencil className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-3">
              {/* Status */}
              <div className="space-y-3">
                <h4 className="font-semibold text-gray-700">Status</h4>
                <div>
                  <label className="text-sm font-medium text-gray-500">WhatsApp</label>
                  {business.settings?.whatsappEnabled ? (
                    <p className="mt-1 flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      Aktiviert
                    </p>
                  ) : (
                    <p className="mt-1 flex items-center gap-2 text-gray-500 text-sm">
                      <XCircle className="h-4 w-4" />
                      Deaktiviert
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Verbindung</label>
                  {business.settings?.twilioVerifiedAt ? (
                    <p className="mt-1 flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      Verifiziert
                    </p>
                  ) : business.settings?.hasTwilioAuthToken ? (
                    <p className="mt-1 flex items-center gap-2 text-amber-600 text-sm">
                      <AlertTriangle className="h-4 w-4" />
                      Nicht getestet
                    </p>
                  ) : (
                    <p className="mt-1 flex items-center gap-2 text-gray-400 text-sm">
                      <XCircle className="h-4 w-4" />
                      Nicht konfiguriert
                    </p>
                  )}
                </div>
              </div>

              {/* Credentials */}
              <div className="space-y-3">
                <h4 className="font-semibold text-gray-700">Zugangsdaten</h4>
                <div>
                  <label className="text-sm font-medium text-gray-500">Account SID</label>
                  {business.settings?.twilioAccountSid ? (
                    <p className="mt-1 font-mono text-sm">
                      {business.settings.twilioAccountSid.slice(0, 6)}...{business.settings.twilioAccountSid.slice(-4)}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-gray-400">Nicht konfiguriert</p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Auth Token</label>
                  <p className="mt-1 text-sm">
                    {business.settings?.hasTwilioAuthToken ? '••••••••' : 'Nicht konfiguriert'}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">WhatsApp-Nummer</label>
                  <p className="mt-1 text-sm">
                    {business.settings?.twilioWhatsappNumber || 'Nicht konfiguriert'}
                  </p>
                </div>
              </div>

              {/* Webhook */}
              <div className="space-y-3">
                <h4 className="font-semibold text-gray-700">Webhook</h4>
                <div>
                  <label className="text-sm font-medium text-gray-500">Webhook-URL</label>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="flex-1 rounded bg-gray-100 px-2 py-1 text-xs break-all">
                      https://www.hebelki.de/api/whatsapp/webhook
                    </code>
                    <Button variant="outline" size="sm" onClick={copyWebhookUrl}>
                      {whatsappCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">In Twilio-Konsole eintragen</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Profile Edit Dialog */}
      <FormDialog
        open={editSection === 'profile'}
        onOpenChange={(open) => !open && setEditSection(null)}
        title="Unternehmensprofil bearbeiten"
        onSubmit={async () => {
          await handleSave('profile', {
            name: profileForm.name,
            slug: profileForm.slug,
            type: profileForm.type,
            tagline: profileForm.tagline || null,
            description: profileForm.description || null,
            foundedYear: profileForm.foundedYear ? parseInt(profileForm.foundedYear) : null,
          })
          await handleSave('contact', {
            email: contactForm.email,
            phone: contactForm.phone,
            address: profileForm.address || null,
            website: profileForm.website || null,
          })
          await handleSave('regional', {
            timezone: profileForm.timezone,
            currency: profileForm.currency,
          })
        }}
        isSubmitting={isSaving}
      >
        <div className="space-y-4">
          <div className="border-b pb-4">
            <h4 className="font-medium mb-3">Identität</h4>
            <div className="space-y-4">
              <FormInput
                label="Geschäftsname"
                name="name"
                required
                value={profileForm.name}
                onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                description="Der öffentliche Name Ihres Unternehmens"
              />
              <FormInput
                label="URL-Slug"
                name="slug"
                required
                value={profileForm.slug}
                onChange={(e) => setProfileForm({ ...profileForm, slug: e.target.value })}
                description="hebelki.de/book/ihr-slug"
              />
              <div className="space-y-2">
                <label className="text-sm font-medium">Branche</label>
                <select
                  value={profileForm.type}
                  onChange={(e) => setProfileForm({ ...profileForm, type: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="clinic">Praxis / Klinik</option>
                  <option value="salon">Salon / Studio</option>
                  <option value="consultant">Beratung</option>
                  <option value="gym">Fitnessstudio</option>
                  <option value="other">Sonstiges</option>
                </select>
              </div>
              <FormInput
                label="Tagline (optional)"
                name="tagline"
                value={profileForm.tagline}
                onChange={(e) => setProfileForm({ ...profileForm, tagline: e.target.value })}
                placeholder="z.B. &quot;Ihr Partner für Gesundheit&quot;"
              />
              <FormTextarea
                label="Kurzbeschreibung"
                name="description"
                value={profileForm.description}
                onChange={(e) => setProfileForm({ ...profileForm, description: e.target.value })}
                placeholder="1-2 Sätze: Was macht Ihr Unternehmen?"
                rows={3}
                description="Wird auf der Buchungsseite und in Bestätigungen angezeigt"
              />
              <FormInput
                label="Gründungsjahr (optional)"
                name="foundedYear"
                type="number"
                value={profileForm.foundedYear}
                onChange={(e) => setProfileForm({ ...profileForm, foundedYear: e.target.value })}
                placeholder="z.B. 2020"
              />
            </div>
          </div>

          <div className="border-b pb-4">
            <h4 className="font-medium mb-3">Standort & Erreichbarkeit</h4>
            <div className="space-y-4">
              <FormTextarea
                label="Adresse"
                name="address"
                value={profileForm.address}
                onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                placeholder="Musterstraße 1&#10;12345 Berlin&#10;Deutschland"
                rows={3}
                description="Erforderlich für Impressum und Rechnungen"
              />
              <FormInput
                label="Website (optional)"
                name="website"
                type="url"
                value={profileForm.website}
                onChange={(e) => setProfileForm({ ...profileForm, website: e.target.value })}
                placeholder="https://www.beispiel.de"
              />
            </div>
          </div>

          <div>
            <h4 className="font-medium mb-3">Betrieb</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Zeitzone</label>
                <select
                  value={profileForm.timezone}
                  onChange={(e) => setProfileForm({ ...profileForm, timezone: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="Europe/Berlin">Europe/Berlin</option>
                  <option value="Europe/Vienna">Europe/Vienna</option>
                  <option value="Europe/Zurich">Europe/Zurich</option>
                  <option value="Europe/London">Europe/London</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Währung</label>
                <select
                  value={profileForm.currency}
                  onChange={(e) => setProfileForm({ ...profileForm, currency: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="EUR">EUR</option>
                  <option value="CHF">CHF</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </FormDialog>

      {/* Contact Edit Dialog */}
      <FormDialog
        open={editSection === 'contact'}
        onOpenChange={(open) => !open && setEditSection(null)}
        title="Kontaktdaten bearbeiten"
        onSubmit={() => handleSave('contact', {
          ...contactForm,
          address: business.address,
          website: business.website,
        })}
        isSubmitting={isSaving}
      >
        <FormInput
          label="E-Mail"
          name="email"
          type="email"
          required
          value={contactForm.email}
          onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
          placeholder="kontakt@beispiel.de"
          description="Für Buchungsbestätigungen und Kundenanfragen"
        />
        <FormInput
          label="Telefon (optional)"
          name="phone"
          value={contactForm.phone}
          onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
          placeholder="+49 123 456789"
          description="Für Eskalationen und dringende Anfragen"
        />
      </FormDialog>

      {/* Legal Edit Dialog */}
      <FormDialog
        open={editSection === 'legal'}
        onOpenChange={(open) => !open && setEditSection(null)}
        title="Rechtliche Angaben bearbeiten"
        onSubmit={() => handleSave('legal', legalForm)}
        isSubmitting={isSaving}
      >
        <div className="rounded-md bg-blue-50 p-3 mb-4">
          <p className="text-sm text-blue-700">
            <strong>Hinweis:</strong> Diese Angaben werden für das Impressum und auf Rechnungen verwendet.
          </p>
        </div>
        <FormInput
          label="Rechtlicher Firmenname"
          name="legalName"
          required
          value={legalForm.legalName}
          onChange={(e) => setLegalFormState({ ...legalForm, legalName: e.target.value })}
          placeholder="Muster GmbH"
          description="Offizieller Name laut Handelsregister"
        />
        <div className="space-y-2">
          <label className="text-sm font-medium">Rechtsform</label>
          <select
            value={legalForm.legalForm}
            onChange={(e) => setLegalFormState({ ...legalForm, legalForm: e.target.value })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Bitte wählen...</option>
            <option value="Einzelunternehmer">Einzelunternehmer</option>
            <option value="Freiberufler">Freiberufler</option>
            <option value="GbR">GbR</option>
            <option value="GmbH">GmbH</option>
            <option value="UG">UG (haftungsbeschränkt)</option>
            <option value="OHG">OHG</option>
            <option value="KG">KG</option>
            <option value="AG">AG</option>
            <option value="e.K.">e.K.</option>
          </select>
        </div>
        <FormInput
          label="Handelsregisternummer (falls vorhanden)"
          name="registrationNumber"
          value={legalForm.registrationNumber}
          onChange={(e) => setLegalFormState({ ...legalForm, registrationNumber: e.target.value })}
          placeholder="z.B. HRB 12345"
        />
        <FormInput
          label="Registergericht (falls vorhanden)"
          name="registrationCourt"
          value={legalForm.registrationCourt}
          onChange={(e) => setLegalFormState({ ...legalForm, registrationCourt: e.target.value })}
          placeholder="z.B. Amtsgericht Berlin-Charlottenburg"
        />
      </FormDialog>

      {/* Compliance Edit Dialog */}
      <FormDialog
        open={editSection === 'compliance'}
        onOpenChange={(open) => !open && setEditSection(null)}
        title="Datenschutz & Compliance"
        onSubmit={() => handleSave('dataControl', {
          privacyPolicyUrl: dataControlForm.privacyPolicyUrl || null,
          dataRetentionDays: dataControlForm.dataRetentionDays,
          dpaAccepted: dataControlForm.dpaAccepted,
          aiLiteracyAcknowledged: dataControlForm.aiLiteracyAcknowledged,
          aiDisclosureMessage: dataControlForm.aiDisclosureMessage,
          userId: user?.id,
        })}
        isSubmitting={isSaving}
      >
        <div className="space-y-6">
          <div className="space-y-4">
            <h4 className="font-semibold border-b pb-2">Datenschutz</h4>
            <FormInput
              label="Datenschutzerklärung URL"
              name="privacyPolicyUrl"
              type="url"
              value={dataControlForm.privacyPolicyUrl}
              onChange={(e) => setDataControlForm({ ...dataControlForm, privacyPolicyUrl: e.target.value })}
              placeholder="https://ihre-website.de/datenschutz"
              description="Erforderlich für WhatsApp Business API"
            />
            <div className="space-y-2">
              <label className="text-sm font-medium">Datenaufbewahrung</label>
              <select
                value={dataControlForm.dataRetentionDays}
                onChange={(e) => setDataControlForm({ ...dataControlForm, dataRetentionDays: parseInt(e.target.value) })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value={90}>90 Tage</option>
                <option value={180}>180 Tage</option>
                <option value={365}>365 Tage (1 Jahr)</option>
                <option value={730}>730 Tage (2 Jahre)</option>
                <option value={1095}>1095 Tage (3 Jahre)</option>
              </select>
            </div>
            <FormCheckbox
              label="Datenverarbeitungsvereinbarung akzeptieren"
              name="dpaAccepted"
              description="Für WhatsApp und KI-Services"
              checked={dataControlForm.dpaAccepted}
              onChange={(e) => setDataControlForm({ ...dataControlForm, dpaAccepted: e.target.checked })}
            />
          </div>

          <div className="space-y-4">
            <h4 className="font-semibold border-b pb-2 flex items-center gap-2">
              <Bot className="h-4 w-4" />
              EU AI Act (Art. 4)
            </h4>
            <FormTextarea
              label="KI-Hinweis für Chatbot"
              name="aiDisclosureMessage"
              value={dataControlForm.aiDisclosureMessage}
              onChange={(e) => setDataControlForm({ ...dataControlForm, aiDisclosureMessage: e.target.value })}
              placeholder="Ich bin ein KI-Assistent..."
              rows={2}
              description="Wird Kunden zu Beginn jeder Konversation angezeigt"
            />
            <div className="rounded-md border border-blue-200 bg-blue-50 p-4">
              <FormCheckbox
                label="Ich bestätige, dass alle Mitarbeitenden über die KI-Systeme informiert wurden."
                name="aiLiteracyAcknowledged"
                checked={dataControlForm.aiLiteracyAcknowledged}
                onChange={(e) => setDataControlForm({ ...dataControlForm, aiLiteracyAcknowledged: e.target.checked })}
              />
              <Link
                href="/legal/ai-usage"
                target="_blank"
                className="mt-2 text-sm text-blue-600 hover:underline flex items-center gap-1"
              >
                KI-Nutzungshinweise lesen
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </FormDialog>

      {/* WhatsApp Edit Dialog */}
      <FormDialog
        open={editSection === 'whatsapp'}
        onOpenChange={(open) => {
          if (!open) {
            setEditSection(null)
            setTestResult(null)
          }
        }}
        title="WhatsApp-Integration (Twilio)"
        onSubmit={async () => {
          const data: Record<string, unknown> = {
            whatsappEnabled: whatsappForm.whatsappEnabled,
            twilioAccountSid: whatsappForm.twilioAccountSid,
            twilioWhatsappNumber: whatsappForm.twilioWhatsappNumber,
          }
          // Only send auth token if user typed a new one
          if (whatsappForm.twilioAuthToken) {
            data.twilioAuthToken = whatsappForm.twilioAuthToken
          }
          await handleSave('whatsapp', data)
        }}
        isSubmitting={isSaving}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-md border p-3">
            <input
              type="checkbox"
              id="whatsappEnabled"
              checked={whatsappForm.whatsappEnabled}
              onChange={(e) => setWhatsappForm({ ...whatsappForm, whatsappEnabled: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="whatsappEnabled" className="text-sm font-medium">
              WhatsApp aktivieren
            </label>
          </div>

          <FormInput
            label="Twilio Account SID"
            name="twilioAccountSid"
            value={whatsappForm.twilioAccountSid}
            onChange={(e) => setWhatsappForm({ ...whatsappForm, twilioAccountSid: e.target.value })}
            placeholder="AC..."
            description="Beginnt mit AC, 34 Zeichen"
          />

          <FormInput
            label="Twilio Auth Token"
            name="twilioAuthToken"
            type="password"
            value={whatsappForm.twilioAuthToken}
            onChange={(e) => setWhatsappForm({ ...whatsappForm, twilioAuthToken: e.target.value })}
            placeholder={business.settings?.hasTwilioAuthToken ? '••••••••  (gespeichert, leer lassen um beizubehalten)' : 'Auth Token eingeben'}
            description={business.settings?.hasTwilioAuthToken
              ? 'Token ist gespeichert. Nur ausfüllen, um zu ändern.'
              : 'Aus der Twilio-Konsole kopieren'
            }
          />

          <FormInput
            label="WhatsApp-Nummer (E.164)"
            name="twilioWhatsappNumber"
            value={whatsappForm.twilioWhatsappNumber}
            onChange={(e) => setWhatsappForm({ ...whatsappForm, twilioWhatsappNumber: e.target.value })}
            placeholder="+4915123456789"
            description="Format: +Landesvorwahl Nummer (z.B. +49...)"
          />

          <div className="space-y-2">
            <label className="text-sm font-medium">Webhook-URL (nur lesen)</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-gray-100 px-3 py-2 text-sm">
                https://www.hebelki.de/api/whatsapp/webhook
              </code>
              <Button type="button" variant="outline" size="sm" onClick={copyWebhookUrl}>
                {whatsappCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
            <p className="text-sm text-blue-700 flex items-center gap-2">
              <Info className="h-4 w-4 flex-shrink-0" />
              Tragen Sie die Webhook-URL in Ihrer Twilio-Konsole unter Messaging &rarr; Sandbox Settings ein.
            </p>
          </div>

          {/* Connection test button (only if credentials are saved) */}
          {business.settings?.hasTwilioAuthToken && (
            <div className="border-t pt-4 space-y-2">
              <Button
                type="button"
                variant="outline"
                onClick={testWhatsAppConnection}
                disabled={testingConnection}
                className="w-full"
              >
                {testingConnection ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Teste Verbindung...
                  </>
                ) : (
                  'Verbindung testen'
                )}
              </Button>
              {testResult && (
                <div className={`rounded-md p-3 text-sm ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  <p className="flex items-center gap-2">
                    {testResult.success ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {testResult.message}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </FormDialog>
    </div>
  )
}
