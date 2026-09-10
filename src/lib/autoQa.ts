import ExcelJS from 'exceljs'
import type { AppSettings, CriterionStatus, QaType } from '../types'

export interface AutoQaCriterionResult {
  number: number
  status: CriterionStatus
  note: string
  confidence: number
  transcriptEvidence: string
  documentationEvidence: string
  matrixEvidence: string
  criticalReason?: string
}

export interface AutoQaResult {
  runId: string
  transcript: string
  detectedItinerary: string
  detectedEmail: string
  detectedPhone: string
  detectedCallLength: string
  detectedCallDate: string
  overallConfidence: number
  summary: string
  criteria: AutoQaCriterionResult[]
}

export interface AutoQaHealth {
  ok: boolean
  message: string
  checkedAt: string
  checks?: {
    server?: boolean
    ollama?: boolean
    model?: boolean
    python?: boolean
  }
}

export interface ImportedWorkbookText {
  fileName: string
  text: string
  sheets: string[]
}

const VALID_STATUSES = new Set<CriterionStatus>(['✓ Followed', '✕ Markdown', 'N/A', 'Partial', 'Critical'])

export async function workbookToQaText(file: File): Promise<ImportedWorkbookText> {
  const bytes = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes as any)
  const chunks: string[] = []
  const sheets: string[] = []

  workbook.eachSheet((sheet) => {
    sheets.push(sheet.name)
    chunks.push(`## ${sheet.name}`)
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as unknown[]
      const clean = values
        .slice(1)
        .map((value) => {
          if (value == null) return ''
          if (typeof value === 'object') {
            const rich = value as any
            if (Array.isArray(rich.richText)) return rich.richText.map((part: any) => String(part.text || '')).join('')
            if (rich.text) return String(rich.text)
            if (rich.result != null) return String(rich.result)
          }
          return String(value).replace(/\s+/g, ' ').trim()
        })
      if (clean.some(Boolean)) chunks.push(clean.join(' | '))
    })
    chunks.push('')
  })

  return { fileName: file.name, text: chunks.join('\n').trim(), sheets }
}

export function tryExtractSalesCriteria(text: string) {
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const parsed: Array<{ number: number; name: string; points: number; notes: string }> = []

  for (const row of rows) {
    if (row.startsWith('## ')) continue
    const cols = row.split('|').map((part) => part.trim()).filter((part, index, arr) => part || index < arr.length - 1)
    if (cols.length < 2) continue
    const number = Number(cols[0])
    const pointCandidates = cols.map((value) => Number(String(value).replace('%', '').trim()))
    const pointIndex = pointCandidates.findIndex((value, index) => index > 0 && Number.isFinite(value) && value >= 0 && value <= 100)
    if (!Number.isFinite(number) || number < 1 || pointIndex < 0) continue
    const name = cols[1] || ''
    const points = pointCandidates[pointIndex]
    if (!name || !Number.isFinite(points)) continue
    const notes = cols.slice(pointIndex + 1).join(' | ')
    parsed.push({ number, name, points, notes })
  }

  const unique = parsed
    .filter((item, index, items) => items.findIndex((other) => other.number === item.number) === index)
    .sort((a, b) => a.number - b.number)
  const total = unique.reduce((sum, item) => sum + item.points, 0)
  return unique.length >= 3 && total > 0 ? unique : []
}

function resolveAutoQaEndpoint(settings: AppSettings): string {
  const configured = String(settings.autoQa?.serviceUrl || '').trim().replace(/\/$/, '')
  const isBrowser = typeof window !== 'undefined'
  const host = isBrowser ? window.location.hostname.toLowerCase() : ''
  const isLocalFrontend = host === 'localhost' || host === '127.0.0.1' || host === ''

  if (configured) {
    const configuredIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured)
    if (!isLocalFrontend && configuredIsLocal) {
      throw new Error('Auto QA is still configured for localhost. In Admin > Auto QA, paste your Cloudflare Tunnel HTTPS URL and save it.')
    }
    return configured
  }

  if (isLocalFrontend) return 'http://127.0.0.1:8788'
  throw new Error('Auto QA Cloudflare URL is not configured. In Admin > Auto QA, paste the HTTPS tunnel URL and save it.')
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('Could not read the audio file.'))
    reader.onload = () => {
      const value = String(reader.result || '')
      resolve(value.includes(',') ? value.slice(value.indexOf(',') + 1) : value)
    }
    reader.readAsDataURL(file)
  })
}

function friendlyConnectionError(error: unknown): Error {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new Error('Auto QA service timed out. Check START-EVERYTHING.bat and the Cloudflare tunnel.')
  }
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return new Error('Auto QA service cannot be reached. Check START-EVERYTHING.bat and the Cloudflare tunnel. If you use a Quick Tunnel, its URL may have changed in Admin > Auto QA Service URL.')
  }
  return error instanceof Error ? error : new Error('Auto QA failed.')
}

function isAutoQaCriterionResult(value: unknown): value is AutoQaCriterionResult {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return Number.isFinite(Number(item.number)) &&
    VALID_STATUSES.has(item.status as CriterionStatus) &&
    typeof item.note === 'string' &&
    Number.isFinite(Number(item.confidence)) &&
    typeof item.transcriptEvidence === 'string' &&
    typeof item.documentationEvidence === 'string' &&
    typeof item.matrixEvidence === 'string'
}

function validateAutoQaResult(value: unknown, expectedRunId: string, expectedCriteriaNumbers: number[]): AutoQaResult {
  if (!value || typeof value !== 'object') throw new Error('Auto QA returned an invalid result. Nothing was applied to the QA form.')
  const result = value as Record<string, unknown>
  if (result.runId !== expectedRunId) throw new Error('Auto QA returned a result from a different run. Nothing was applied to the QA form.')
  if (typeof result.transcript !== 'string' || !result.transcript.trim()) throw new Error('Auto QA returned no transcript. Nothing was applied to the QA form.')
  if (!Array.isArray(result.criteria) || !result.criteria.every(isAutoQaCriterionResult)) {
    throw new Error('Auto QA returned invalid criterion results. Nothing was applied to the QA form.')
  }

  const expected = new Set(expectedCriteriaNumbers.map(Number))
  const actual = new Set(result.criteria.map((item) => Number(item.number)))
  if (expected.size !== actual.size || [...expected].some((number) => !actual.has(number))) {
    throw new Error('Auto QA did not return exactly one result for every criterion. Nothing was applied to the QA form.')
  }

  const stringFields = ['detectedItinerary', 'detectedEmail', 'detectedPhone', 'detectedCallLength', 'detectedCallDate', 'summary'] as const
  for (const field of stringFields) {
    if (typeof result[field] !== 'string') throw new Error(`Auto QA returned an invalid ${field}. Nothing was applied to the QA form.`)
  }
  if (!Number.isFinite(Number(result.overallConfidence))) throw new Error('Auto QA returned an invalid confidence value. Nothing was applied to the QA form.')

  return result as unknown as AutoQaResult
}

export async function runAutoQa(options: {
  audioFile?: File
  transcript?: string
  documentation?: string
  phase?: 'call' | 'documentation' | 'full'
  qaType: QaType
  settings: AppSettings
}): Promise<AutoQaResult> {
  const endpoint = resolveAutoQaEndpoint(options.settings)
  const criteria = options.settings.criteria[options.qaType]
  const runId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `autoqa-${Date.now()}-${Math.random().toString(16).slice(2)}`

  try {
    const audioBase64 = options.audioFile ? await fileToBase64(options.audioFile) : undefined
    const controller = new AbortController()
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/api/auto-qa`, {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        runId,
        audioBase64,
        audioFileName: options.audioFile?.name || '',
        audioIdentity: options.audioFile ? `${options.audioFile.name}|${options.audioFile.size}|${options.audioFile.lastModified}|${options.audioFile.type}` : '',
        transcript: options.transcript || '',
        documentation: options.documentation || '',
        phase: options.phase || 'full',
        qaType: options.qaType,
        criteria,
        matrixText: options.settings.autoQa?.matrixText || '',
        salesQaFormText: options.settings.autoQa?.salesQaFormText || '',
        ollamaUrl: options.settings.autoQa?.ollamaUrl || 'http://127.0.0.1:11434',
        ollamaModel: options.settings.autoQa?.ollamaModel || 'qwen3:8b',
      }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.success !== true) {
      throw new Error(payload?.message || `Auto QA failed with HTTP ${response.status}.`)
    }
    return validateAutoQaResult(payload.data, runId, criteria.map((criterion) => Number(criterion.number)))
  } catch (error) {
    throw friendlyConnectionError(error)
  }
}

export async function checkAutoQaService(settings: AppSettings): Promise<AutoQaHealth> {
  const checkedAt = new Date().toISOString()
  try {
    const endpoint = resolveAutoQaEndpoint(settings)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    try {
      const params = new URLSearchParams({
        ollamaUrl: settings.autoQa?.ollamaUrl || 'http://127.0.0.1:11434',
        ollamaModel: settings.autoQa?.ollamaModel || 'qwen3:8b',
      })
      const response = await fetch(`${endpoint.replace(/\/$/, '')}/health?${params.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-store' },
      })
      const payload = await response.json().catch(() => ({}))
      return {
        ok: response.ok && payload?.ok === true,
        message: payload?.message || (response.ok ? 'Auto QA service is online.' : 'Auto QA service is offline.'),
        checkedAt,
        checks: payload?.checks,
      }
    } finally {
      window.clearTimeout(timeout)
    }
  } catch (error) {
    const friendly = friendlyConnectionError(error)
    return { ok: false, message: friendly.message, checkedAt }
  }
}
