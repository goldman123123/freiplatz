'use client'

/**
 * Documents Tab
 *
 * Upload and manage documents for chatbot knowledge
 * Supports: PDF, DOCX, TXT, CSV, XLSX, HTML
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  FileText,
  FileSpreadsheet,
  FileCode,
  Upload,
  Trash2,
  Loader2,
  Search,
  X,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Download,
  Eye,
  File,
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { de } from 'date-fns/locale'
import { toast } from 'sonner'

interface Document {
  id: string
  title: string
  originalFilename: string
  status: 'active' | 'deleted_pending' | 'deleted'
  uploadedBy: string | null
  labels: string[]
  createdAt: string
  updatedAt: string
  latestVersion: {
    id: string
    version: number
    fileSize: number | null
    createdAt: string
  } | null
  processingStatus: {
    id: string
    status: string
    attempts: number
    lastError: string | null
    completedAt: string | null
  } | null
}

interface DocumentsTabProps {
  businessId: string
}

// Status badge configuration
const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  queued: { label: 'Wartend', color: 'bg-gray-100 text-gray-700', icon: Clock },
  uploaded: { label: 'Hochgeladen', color: 'bg-blue-100 text-blue-700', icon: Upload },
  processing: { label: 'Verarbeitung...', color: 'bg-yellow-100 text-yellow-700', icon: RefreshCw },
  parsing: { label: 'Analysiert...', color: 'bg-yellow-100 text-yellow-700', icon: RefreshCw },
  chunking: { label: 'Aufteilen...', color: 'bg-yellow-100 text-yellow-700', icon: RefreshCw },
  embedding: { label: 'Indexieren...', color: 'bg-yellow-100 text-yellow-700', icon: RefreshCw },
  done: { label: 'Fertig', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  failed: { label: 'Fehler', color: 'bg-red-100 text-red-700', icon: AlertCircle },
  retry_ready: { label: 'Wiederholen', color: 'bg-orange-100 text-orange-700', icon: RefreshCw },
  cancelled: { label: 'Abgebrochen', color: 'bg-gray-100 text-gray-700', icon: X },
}

// Error code messages (German)
const errorMessages: Record<string, string> = {
  extraction_empty: 'Keine Textinhalte gefunden',
  extraction_low_quality: 'Textqualitat zu niedrig',
  needs_ocr: 'Gescanntes PDF - OCR erforderlich',
  parse_failed: 'Datei konnte nicht gelesen werden',
  timeout: 'Zeituberschreitung bei Verarbeitung',
  document_deleted: 'Dokument wurde geloscht',
  unsupported_format: 'Dateityp wird nicht unterstutzt',
  file_too_large: 'Datei ist zu gro\u00df',
  file_corrupted: 'Datei ist beschadigt',
}

// Supported file types
const SUPPORTED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/html': 'html',
}

// File extensions for accept attribute
const ACCEPT_EXTENSIONS = '.pdf,.docx,.doc,.txt,.csv,.xlsx,.xls,.html,.htm'

// Get file icon based on type
function getFileIcon(filename: string) {
  const ext = filename.toLowerCase().split('.').pop()
  switch (ext) {
    case 'pdf':
      return <FileText className="h-8 w-8 text-red-500" />
    case 'docx':
    case 'doc':
      return <FileText className="h-8 w-8 text-blue-500" />
    case 'xlsx':
    case 'xls':
    case 'csv':
      return <FileSpreadsheet className="h-8 w-8 text-green-500" />
    case 'html':
    case 'htm':
      return <FileCode className="h-8 w-8 text-orange-500" />
    case 'txt':
      return <FileText className="h-8 w-8 text-gray-500" />
    default:
      return <File className="h-8 w-8 text-gray-400" />
  }
}

// Get file type label
function getFileTypeLabel(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop()
  const labels: Record<string, string> = {
    pdf: 'PDF',
    docx: 'Word',
    doc: 'Word',
    txt: 'Text',
    csv: 'CSV',
    xlsx: 'Excel',
    xls: 'Excel',
    html: 'HTML',
    htm: 'HTML',
  }
  return labels[ext || ''] || 'Datei'
}

export function DocumentsTab({ businessId }: DocumentsTabProps) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteDialog, setDeleteDialog] = useState<Document | null>(null)
  const [deleting, setDeleting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollingRef = useRef<Record<string, NodeJS.Timeout>>({})

  // Fetch documents
  const fetchDocuments = useCallback(async () => {
    try {
      const response = await fetch(`/api/documents?businessId=${businessId}`)
      const data = await response.json()

      if (response.ok && data.documents) {
        setDocuments(data.documents)

        // Start polling for documents that are still processing
        data.documents.forEach((doc: Document) => {
          const status = doc.processingStatus?.status
          if (status && !['done', 'failed', 'cancelled'].includes(status)) {
            startPolling(doc.processingStatus!.id)
          }
        })
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error)
      toast.error('Fehler beim Laden der Dokumente')
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    fetchDocuments()

    // Cleanup polling on unmount
    return () => {
      Object.values(pollingRef.current).forEach(clearInterval)
    }
  }, [fetchDocuments])

  // Start polling for a job
  const startPolling = (jobId: string) => {
    // Don't start if already polling
    if (pollingRef.current[jobId]) return

    pollingRef.current[jobId] = setInterval(async () => {
      try {
        const response = await fetch(`/api/documents/pdf/jobs/${jobId}?businessId=${businessId}`)
        const job = await response.json()

        if (['done', 'failed', 'cancelled'].includes(job.status)) {
          // Stop polling
          clearInterval(pollingRef.current[jobId])
          delete pollingRef.current[jobId]

          // Refresh documents
          await fetchDocuments()

          if (job.status === 'done') {
            toast.success('Dokument erfolgreich verarbeitet')
          } else if (job.status === 'failed') {
            const errorMsg = job.errorCode ? errorMessages[job.errorCode] : job.lastError
            toast.error(`Verarbeitung fehlgeschlagen: ${errorMsg || 'Unbekannter Fehler'}`)
          }
        } else {
          // Update status in place
          setDocuments(prev => prev.map(doc => {
            if (doc.processingStatus?.id === jobId) {
              return {
                ...doc,
                processingStatus: {
                  ...doc.processingStatus,
                  status: job.status,
                  stage: job.stage,
                  errorCode: job.errorCode,
                },
              }
            }
            return doc
          }))
        }
      } catch (error) {
        console.error('Polling error:', error)
      }
    }, 2000) // Poll every 2 seconds
  }

  // Handle file selection
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    const isSupported = SUPPORTED_TYPES[file.type] ||
      ACCEPT_EXTENSIONS.split(',').some(ext => file.name.toLowerCase().endsWith(ext))

    if (!isSupported) {
      toast.error('Dateityp wird nicht unterstutzt. Unterstutzt: PDF, Word, Excel, CSV, TXT, HTML')
      return
    }

    // Validate file size (50MB max)
    const maxSize = 50 * 1024 * 1024
    if (file.size > maxSize) {
      toast.error('Datei ist zu gro\u00df (max. 50MB)')
      return
    }

    setUploading(true)

    try {
      // Remove file extension from title
      const title = file.name.replace(/\.[^.]+$/, '')

      // Step 1: Initialize upload (using new multi-format endpoint)
      const initResponse = await fetch('/api/documents/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          title,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
        }),
      })

      const initData = await initResponse.json()

      if (!initResponse.ok) {
        throw new Error(initData.error || initData.message || 'Fehler beim Initialisieren')
      }

      // Step 2: Upload to R2 using presigned URL
      const uploadResponse = await fetch(initData.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
      })

      if (!uploadResponse.ok) {
        throw new Error('Fehler beim Hochladen der Datei')
      }

      // Step 3: Mark upload as complete (using new multi-format endpoint)
      const completeResponse = await fetch('/api/documents/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          versionId: initData.versionId,
          fileSize: file.size,
        }),
      })

      const completeData = await completeResponse.json()

      if (!completeResponse.ok) {
        throw new Error(completeData.error || 'Fehler beim Abschlie\u00dfen')
      }

      const typeLabel = getFileTypeLabel(file.name)
      toast.success(`${typeLabel}-Dokument wird verarbeitet...`)

      // Refresh documents and start polling
      await fetchDocuments()
      startPolling(initData.jobId)
    } catch (error) {
      console.error('Upload error:', error)
      toast.error(error instanceof Error ? error.message : 'Fehler beim Hochladen')
    } finally {
      setUploading(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // Handle delete
  const handleDelete = async () => {
    if (!deleteDialog) return

    setDeleting(true)

    try {
      const response = await fetch(
        `/api/documents/${deleteDialog.id}?businessId=${businessId}`,
        { method: 'DELETE' }
      )

      const data = await response.json()

      if (response.ok) {
        toast.success('Dokument wird geloscht')
        setDeleteDialog(null)
        await fetchDocuments()
      } else {
        throw new Error(data.error || 'Fehler beim Loschen')
      }
    } catch (error) {
      console.error('Delete error:', error)
      toast.error(error instanceof Error ? error.message : 'Fehler beim Loschen')
    } finally {
      setDeleting(false)
    }
  }

  // Format file size
  const formatFileSize = (bytes: number | null): string => {
    if (bytes === null || bytes === 0) return '-'
    const units = ['B', 'KB', 'MB', 'GB']
    let unitIndex = 0
    let size = bytes
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`
  }

  // Filter documents
  const filteredDocuments = documents.filter(doc => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return (
      doc.title.toLowerCase().includes(query) ||
      doc.originalFilename.toLowerCase().includes(query)
    )
  })

  if (loading) {
    return (
      <Card className="p-8">
        <div className="flex items-center justify-center gap-2 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Ladt Dokumente...</span>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header with Upload button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Dokumente</h2>
          <p className="text-sm text-gray-500">
            Laden Sie Dokumente hoch (PDF, Word, Excel, CSV, TXT, HTML)
          </p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_EXTENSIONS}
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Hochladen...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Dokument hochladen
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      {documents.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            type="text"
            placeholder="Dokumente durchsuchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-10"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Results count */}
      {searchQuery && (
        <div className="text-sm text-gray-600">
          {filteredDocuments.length} {filteredDocuments.length === 1 ? 'Dokument' : 'Dokumente'} gefunden
          {filteredDocuments.length < documents.length && (
            <span className="text-gray-400"> von {documents.length} gesamt</span>
          )}
        </div>
      )}

      {/* Documents List */}
      {documents.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            Noch keine Dokumente
          </h3>
          <p className="mt-2 text-sm text-gray-500">
            Laden Sie Dokumente hoch (PDF, Word, Excel, CSV, TXT, HTML), damit Ihr Chatbot deren Inhalte nutzen kann.
          </p>
          <Button
            className="mt-4"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Hochladen...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Erstes Dokument hochladen
              </>
            )}
          </Button>
        </Card>
      ) : filteredDocuments.length === 0 ? (
        <Card className="p-12 text-center">
          <Search className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            Keine passenden Dokumente
          </h3>
          <p className="mt-2 text-sm text-gray-500">
            Versuchen Sie es mit anderen Suchbegriffen.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setSearchQuery('')}
          >
            <X className="mr-2 h-4 w-4" />
            Suche zurucksetzen
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredDocuments.map((doc) => {
            const status = doc.processingStatus?.status || 'queued'
            const config = statusConfig[status] || statusConfig.queued
            const StatusIcon = config.icon

            return (
              <Card key={doc.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="flex-shrink-0 mt-1">
                      {getFileIcon(doc.originalFilename)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-gray-900 truncate">
                          {doc.title}
                        </h3>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.color}`}>
                          <StatusIcon className={`h-3 w-3 ${status.includes('ing') || status === 'retry_ready' ? 'animate-spin' : ''}`} />
                          {config.label}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-500 truncate">
                        {doc.originalFilename}
                      </p>
                      {status === 'failed' && doc.processingStatus?.lastError && (
                        <p className="mt-1 text-sm text-red-600">
                          {doc.processingStatus.lastError}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDistanceToNow(new Date(doc.createdAt), {
                            addSuffix: true,
                            locale: de,
                          })}
                        </span>
                        {doc.latestVersion?.fileSize && (
                          <span>
                            {formatFileSize(doc.latestVersion.fileSize)}
                          </span>
                        )}
                        {doc.latestVersion && (
                          <span>
                            Version {doc.latestVersion.version}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteDialog(doc)}
                      disabled={doc.status === 'deleted_pending'}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dokument loschen</DialogTitle>
            <DialogDescription>
              Mochten Sie &quot;{deleteDialog?.title}&quot; wirklich loschen? Diese Aktion kann nicht ruckgangig gemacht werden.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialog(null)}
              disabled={deleting}
            >
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loschen...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Loschen
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
