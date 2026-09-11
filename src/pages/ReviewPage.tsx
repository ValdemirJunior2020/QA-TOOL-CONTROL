import { useEffect, useMemo, useState } from 'react'
import { createCriterionAnswers, createReviewDraft, localDateInput, pointsForStatus } from '../data/defaults'
import type {
  AppSettings,
  CriterionAnswer,
  CriterionStatus,
  QaType,
  QaUser,
  ReviewDraft,
  WatchListAgent,
} from '../types'
import { findActiveWatchAgent } from '../lib/watchList'
import { checkAutoQaService, runAutoQa, type AutoQaCriterionResult } from '../lib/autoQa'

interface ReviewPageProps {
  user: QaUser
  settings: AppSettings
  evaluators: QaUser[]
  watchListAgents: WatchListAgent[]
  onSave: (review: ReviewDraft) => Promise<void>
  saving: boolean
  initialQaType?: QaType
}

interface ValidationState {
  errors: string[]
  fieldErrors: Record<string, string>
}

type AutoQaStage = 'ready' | 'booking-question' | 'notes-choice' | 'paste-docs' | 'manual-docs' | 'skipped-docs' | 'complete'
type AutoQaProgressStatus = 'idle' | 'running' | 'failed' | 'complete'
type AutoQaProgressMode = 'call' | 'documentation'
type AutoQaDetailField = 'confirmationNumber' | 'guestEmail' | 'guestPhone' | 'callLength' | 'callDate'

interface AutoQaProgressState {
  status: AutoQaProgressStatus
  mode: AutoQaProgressMode
  percent: number
  elapsedSeconds: number
  stage: string
  startedAt: number | null
  error: string
}

interface StoredReviewDraftV2 {
  version: 2
  review: ReviewDraft
  manualCriterionNumbers: number[]
  manualDetailFields: AutoQaDetailField[]
}

const AUTO_QA_DETAIL_FIELDS = new Set<AutoQaDetailField>([
  'confirmationNumber',
  'guestEmail',
  'guestPhone',
  'callLength',
  'callDate',
])

function normalizeCallId(value: string): string {
  const cleaned = value.replace(/\s+/g, '')
  if (/^ca/i.test(cleaned)) return `CA${cleaned.slice(2)}`
  return cleaned
}

function isCriticalCriterion(name: string): boolean {
  const normalized = name.toLowerCase()
  return normalized.includes('matrix compliance') || normalized.includes('documentation quality')
}

function isMatrixComplianceCriterion(name: string): boolean {
  return name.toLowerCase().includes('matrix compliance')
}

function isDocumentationCriterion(name: string): boolean {
  return name.toLowerCase().includes('documentation')
}

function criticalReasonsFor(name: string): string[] {
  const normalized = name.toLowerCase()
  if (normalized.includes('documentation quality')) {
    return [
      'No Notes',
      'Voucher # in Notes / Slack / Macro',
      'Other Documentation Critical',
    ]
  }
  return [
    'Required Matrix process was not followed',
    'Required escalation path was not followed',
    'Required Matrix tool/process was used incorrectly',
    'Other Matrix Critical',
  ]
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.max(0, seconds % 60)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function estimateProgress(mode: AutoQaProgressMode, elapsedSeconds: number): { percent: number; stage: string } {
  if (mode === 'documentation') {
    if (elapsedSeconds < 3) return { percent: Math.min(10, 3 + elapsedSeconds * 2), stage: 'Preparing documentation' }
    if (elapsedSeconds < 12) return { percent: Math.min(45, 12 + (elapsedSeconds - 3) * 3.5), stage: 'Reading QA criteria' }
    if (elapsedSeconds < 22) return { percent: Math.min(60, 45 + (elapsedSeconds - 12) * 1.5), stage: 'Reading Service Matrix' }
    if (elapsedSeconds < 70) return { percent: Math.min(95, 60 + (elapsedSeconds - 22) * 0.72), stage: 'Running QA audit' }
    return { percent: Math.min(99, 95 + Math.floor((elapsedSeconds - 70) / 15)), stage: 'Final verification' }
  }

  if (elapsedSeconds < 4) return { percent: Math.min(10, 2 + elapsedSeconds * 2), stage: 'Uploading call' }
  if (elapsedSeconds < 35) return { percent: Math.min(45, 10 + (elapsedSeconds - 4) * 1.12), stage: 'Transcribing call' }
  if (elapsedSeconds < 48) return { percent: Math.min(60, 45 + (elapsedSeconds - 35) * 1.15), stage: 'Reading QA criteria' }
  if (elapsedSeconds < 62) return { percent: Math.min(75, 60 + (elapsedSeconds - 48) * 1.05), stage: 'Reading Service Matrix' }
  if (elapsedSeconds < 120) return { percent: Math.min(95, 75 + (elapsedSeconds - 62) * 0.34), stage: 'Running QA audit' }
  return { percent: Math.min(99, 95 + Math.floor((elapsedSeconds - 120) / 20)), stage: 'Final verification' }
}

function validateReview(review: ReviewDraft, user: QaUser, settings: AppSettings): ValidationState {
  const errors: string[] = []
  const fieldErrors: Record<string, string> = {}
  const add = (field: string, message: string) => {
    fieldErrors[field] = message
    errors.push(message)
  }

  const aiAgentReview = review.callCenter.trim().toLowerCase() === 'ai agents'
  if (!review.agentStartDate && !aiAgentReview) add('agentStartDate', 'Add the agent start date.')
  if (!review.todayDate) add('todayDate', 'Today’s date is missing.')
  if (!review.evaluator) add('evaluator', 'Choose an evaluator.')
  if (!review.agentName.trim()) add('agentName', 'Add the agent name.')
  if (!review.callCenter) add('callCenter', 'Choose the call center.')
  if (settings.rules.callIdRequired && !review.callId.trim()) add('callId', 'Add the Call ID.')
  if (!review.qaType) add('qaType', 'Choose CS, Groups, or Sales.')
  if (review.qaType === 'Sales' && !settings.criteria.Sales.length) add('qaType', 'Sales QA is waiting for the approved Sales scoring matrix from Ann/April.')
  if (settings.rules.confirmationRequired && review.confirmationNumber.trim().length < 2) {
    add('confirmationNumber', 'Add an itinerary, confirmation number, reservation number, or booking reference.')
  }
  if (!review.callLength.trim()) add('callLength', 'Add the call length.')
  if (!review.callDate) add('callDate', 'Add the date of the call.')

  if (user.guidedMode && review.callId.trim()) {
    try {
      const expression = new RegExp(settings.rules.guidedCallIdPattern)
      if (!expression.test(review.callId.trim())) {
        add('callId', 'The Call ID must start with CA and contain exactly 32 hexadecimal characters after CA.')
      }
    } catch {
      add('callId', 'The guided Call ID rule is not configured correctly. Ask an administrator to check Settings.')
    }
  }

  review.criteria.forEach((criterion, index) => {
    if (!criterion.status) {
      add(`criterion-${index}`, `Select a status for criterion ${criterion.number}: ${criterion.name}.`)
    }

    if (
      settings.rules.noteRequiredForMarkdownOrPartial &&
      (criterion.status === '✕ Markdown' || criterion.status === 'Partial') &&
      !criterion.customNote.trim()
    ) {
      add(`note-${index}`, `Add a clear note for criterion ${criterion.number} because ${criterion.status} was selected.`)
    }

    if (criterion.status === 'Critical') {
      if (!isCriticalCriterion(criterion.name)) {
        add(`criterion-${index}`, 'Critical can only be selected for Matrix Compliance or Documentation Quality.')
      } else if (!String(criterion.criticalReason || '').trim()) {
        add(`criterion-${index}`, `Select a Critical reason for criterion ${criterion.number}: ${criterion.name}.`)
      }
    }
  })

  return { errors, fieldErrors }
}

export function ReviewPage({ user, settings, evaluators, watchListAgents, onSave, saving, initialQaType = 'CS' }: ReviewPageProps) {
  const [review, setReview] = useState<ReviewDraft>(() => createReviewDraft(settings, user.displayName, initialQaType))
  const [validation, setValidation] = useState<ValidationState>({ errors: [], fieldErrors: {} })
  const [showChecklist, setShowChecklist] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const [criticalModal, setCriticalModal] = useState<{ index: number; reason: string; note: string } | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [documentation, setDocumentation] = useState('')
  const [autoQaBusy, setAutoQaBusy] = useState(false)
  const [autoQaMessage, setAutoQaMessage] = useState('')
  const [autoQaTranscript, setAutoQaTranscript] = useState('')
  const [autoQaEvidence, setAutoQaEvidence] = useState<Record<number, AutoQaCriterionResult>>({})
  const [autoQaServiceOnline, setAutoQaServiceOnline] = useState<boolean | null>(null)
  const [autoQaServiceMessage, setAutoQaServiceMessage] = useState('Checking Auto QA service…')
  const [autoQaLastChecked, setAutoQaLastChecked] = useState<string>('')
  const [manualOverrides, setManualOverrides] = useState<Set<number>>(() => new Set())
  const [manualDetailFields, setManualDetailFields] = useState<Set<AutoQaDetailField>>(() => new Set())
  const [autoQaStage, setAutoQaStage] = useState<AutoQaStage>('ready')
  const [autoQaProgress, setAutoQaProgress] = useState<AutoQaProgressState>({
    status: 'idle',
    mode: 'call',
    percent: 0,
    elapsedSeconds: 0,
    stage: 'Not started',
    startedAt: null,
    error: '',
  })
  const draftKey = `qa-review-draft:${user.email}:${initialQaType.toLowerCase()}`

  const refreshAutoQaService = async (showMessage = false): Promise<boolean> => {
    const result = await checkAutoQaService(settings)
    setAutoQaServiceOnline(result.ok)
    setAutoQaServiceMessage(result.message)
    setAutoQaLastChecked(result.checkedAt)
    if (showMessage) setAutoQaMessage(result.message)
    return result.ok
  }

  const startProgress = (mode: AutoQaProgressMode) => {
    setAutoQaProgress({
      status: 'running',
      mode,
      percent: 0,
      elapsedSeconds: 0,
      stage: mode === 'call' ? 'Uploading call' : 'Preparing documentation',
      startedAt: Date.now(),
      error: '',
    })
  }

  const completeProgress = () => {
    setAutoQaProgress((current) => ({
      ...current,
      status: 'complete',
      percent: 100,
      stage: 'QA complete',
      elapsedSeconds: current.startedAt ? Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000)) : current.elapsedSeconds,
      error: '',
    }))
  }

  const failProgress = (message: string) => {
    setAutoQaProgress((current) => ({
      ...current,
      status: 'failed',
      stage: 'FAILED',
      elapsedSeconds: current.startedAt ? Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000)) : current.elapsedSeconds,
      error: message,
    }))
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(draftKey)
      if (saved) {
        const parsed = JSON.parse(saved) as StoredReviewDraftV2 | ReviewDraft
        if ('version' in parsed && parsed.version === 2 && parsed.review && Array.isArray(parsed.review.criteria)) {
          setReview(parsed.review)
          setManualOverrides(new Set(parsed.manualCriterionNumbers || []))
          setManualDetailFields(new Set(parsed.manualDetailFields || []))
          setDraftRestored(true)
          return
        }

        const legacy = parsed as ReviewDraft
        if (legacy && legacy.agentName !== undefined && Array.isArray(legacy.criteria)) {
          const qaType = legacy.qaType || initialQaType
          setReview({
            ...legacy,
            qaType,
            criteria: createCriterionAnswers(settings, qaType),
            criticalErrors: { noNotes: false, voucherReference: false },
          })
          setManualOverrides(new Set())
          setManualDetailFields(new Set())
          setDraftRestored(true)
          setAutoQaMessage('Draft details restored. Old scoring was reset for safety so it cannot be mistaken for a new Auto QA result.')
          return
        }
      }
    } catch {
      window.localStorage.removeItem(draftKey)
    }

    setReview((current) => ({
      ...current,
      evaluator: user.role === 'admin' ? current.evaluator || user.displayName : user.displayName,
      todayDate: localDateInput(),
    }))
  }, [draftKey, initialQaType, settings, user.displayName, user.role])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const baseline = new Map(createCriterionAnswers(settings, review.qaType).map((criterion) => [Number(criterion.number), criterion]))
      const safeReview: ReviewDraft = {
        ...review,
        criteria: review.criteria.map((criterion) => {
          const number = Number(criterion.number)
          const wasFilledByAutoQa = Boolean(autoQaEvidence[number])
          if (wasFilledByAutoQa && !manualOverrides.has(number)) return baseline.get(number) || criterion
          return criterion
        }),
      }

      if (autoQaTranscript) {
        if (!manualDetailFields.has('confirmationNumber')) safeReview.confirmationNumber = ''
        if (!manualDetailFields.has('guestEmail')) safeReview.guestEmail = ''
        if (!manualDetailFields.has('guestPhone')) safeReview.guestPhone = ''
        if (!manualDetailFields.has('callLength')) safeReview.callLength = ''
        if (!manualDetailFields.has('callDate')) safeReview.callDate = ''
      }

      const stored: StoredReviewDraftV2 = {
        version: 2,
        review: safeReview,
        manualCriterionNumbers: [...manualOverrides],
        manualDetailFields: [...manualDetailFields],
      }
      window.localStorage.setItem(draftKey, JSON.stringify(stored))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [autoQaEvidence, autoQaTranscript, draftKey, manualDetailFields, manualOverrides, review, settings])

  useEffect(() => {
    if (!settings.autoQa?.enabled) {
      setAutoQaServiceOnline(null)
      setAutoQaServiceMessage('Auto QA is disabled in Admin settings.')
      return
    }

    let cancelled = false
    const check = async () => {
      const result = await checkAutoQaService(settings)
      if (cancelled) return
      setAutoQaServiceOnline(result.ok)
      setAutoQaServiceMessage(result.message)
      setAutoQaLastChecked(result.checkedAt)
    }
    void check()
    const interval = window.setInterval(() => void check(), 20000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [settings])

  useEffect(() => {
    if (autoQaProgress.status !== 'running' || !autoQaProgress.startedAt) return
    const timer = window.setInterval(() => {
      setAutoQaProgress((current) => {
        if (current.status !== 'running' || !current.startedAt) return current
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000))
        const estimate = estimateProgress(current.mode, elapsedSeconds)
        return {
          ...current,
          elapsedSeconds,
          percent: Math.min(99, Math.max(current.percent, estimate.percent)),
          stage: estimate.stage,
        }
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [autoQaProgress.startedAt, autoQaProgress.status])

  const applyAiCriteria = (
    current: ReviewDraft,
    results: AutoQaCriterionResult[],
    mode: 'call' | 'documentation' | 'full',
    protectManualEdits: boolean,
  ): CriterionAnswer[] => {
    const byNumber = new Map(results.map((item) => [Number(item.number), item]))
    return current.criteria.map((criterion) => {
      const documentationCriterion = isDocumentationCriterion(criterion.name)
      if (mode === 'call' && documentationCriterion) return criterion
      if (mode === 'documentation' && !documentationCriterion) return criterion

      const ai = byNumber.get(Number(criterion.number))
      if (!ai || (protectManualEdits && manualOverrides.has(Number(criterion.number)))) return criterion

      let status = ai.status
      let criticalReason = ai.criticalReason || ''
      if (status === 'Critical' && !isCriticalCriterion(criterion.name)) {
        status = '✕ Markdown'
        criticalReason = ''
      }

      return {
        ...criterion,
        status,
        customNote: ai.note || '',
        criticalReason: status === 'Critical'
          ? (criticalReason || (criterion.name.toLowerCase().includes('documentation quality') ? 'Other Documentation Critical' : 'Required Matrix process was not followed'))
          : '',
        partialPoints: criterion.points / 2,
        autoPoints: pointsForStatus(criterion.points, status),
      }
    })
  }

  const handleNewAudioFile = (file: File | null) => {
    const hasPriorAutoQaSession = Boolean(autoQaTranscript || Object.keys(autoQaEvidence).length || autoQaStage !== 'ready' || draftRestored)
    setAudioFile(file)
    setAutoQaTranscript('')
    setAutoQaEvidence({})
    setDocumentation('')
    setManualOverrides(new Set())
    setAutoQaStage('ready')
    setValidation({ errors: [], fieldErrors: {} })
    setDraftRestored(false)
    setAutoQaProgress({ status: 'idle', mode: 'call', percent: 0, elapsedSeconds: 0, stage: 'Not started', startedAt: null, error: '' })

    setReview((current) => ({
      ...current,
      confirmationNumber: hasPriorAutoQaSession || !manualDetailFields.has('confirmationNumber') ? '' : current.confirmationNumber,
      guestEmail: hasPriorAutoQaSession || !manualDetailFields.has('guestEmail') ? '' : current.guestEmail,
      guestPhone: hasPriorAutoQaSession || !manualDetailFields.has('guestPhone') ? '' : current.guestPhone,
      callLength: hasPriorAutoQaSession || !manualDetailFields.has('callLength') ? '' : current.callLength,
      callDate: hasPriorAutoQaSession || !manualDetailFields.has('callDate') ? '' : current.callDate,
      criteria: createCriterionAnswers(settings, current.qaType),
      criticalErrors: { noNotes: false, voucherReference: false },
    }))

    if (hasPriorAutoQaSession) setManualDetailFields(new Set())
    setAutoQaMessage(file
      ? `New call selected: ${file.name}. This call has NOT been QA’d yet. Previous Auto QA transcript, evidence, statuses, Criticals, and AI notes were cleared.`
      : '')
    if (file) void refreshAutoQaService(false)
  }

  const executeCallAutoQa = async (recheck = false) => {
    if (!settings.autoQa?.enabled) {
      setAutoQaMessage('Auto QA is disabled in Admin settings.')
      return
    }
    if (!recheck && !audioFile) {
      setAutoQaMessage('Choose an audio file first.')
      return
    }
    if (recheck && !autoQaTranscript) {
      setAutoQaMessage('Run the call QA first.')
      return
    }

    setAutoQaMessage('Checking Auto QA service before processing…')
    const ready = await refreshAutoQaService(false)
    if (!ready) {
      const message = autoQaServiceMessage || 'Auto QA service cannot be reached. Check START-EVERYTHING.bat and the Cloudflare tunnel.'
      setAutoQaMessage(message)
      failProgress(message)
      return
    }

    setAutoQaBusy(true)
    startProgress('call')
    setAutoQaMessage(recheck ? 'Rechecking the call QA from the existing transcript…' : 'Uploading, transcribing, and reviewing this exact call…')
    try {
      const result = await runAutoQa({
        audioFile: recheck ? undefined : (audioFile || undefined),
        transcript: recheck ? autoQaTranscript : '',
        documentation: '',
        phase: 'call',
        qaType: review.qaType,
        settings,
      })

      setReview((current) => ({
        ...current,
        confirmationNumber: current.confirmationNumber.trim() || result.detectedItinerary || '',
        guestEmail: (current.guestEmail || '').trim() || result.detectedEmail || '',
        guestPhone: (current.guestPhone || '').trim() || result.detectedPhone || '',
        callLength: current.callLength.trim() || result.detectedCallLength || current.callLength,
        callDate: current.callDate || (result.detectedCallDate && /^\d{4}-\d{2}-\d{2}$/.test(result.detectedCallDate) ? result.detectedCallDate : ''),
        criteria: applyAiCriteria(current, result.criteria, 'call', recheck),
      }))

      if (!recheck) setManualOverrides(new Set())
      setAutoQaTranscript(result.transcript)
      const callEvidence = Object.fromEntries(result.criteria.filter((item) => {
        const criterion = review.criteria.find((candidate) => Number(candidate.number) === Number(item.number))
        return criterion ? !isDocumentationCriterion(criterion.name) : true
      }).map((item) => [Number(item.number), item]))
      setAutoQaEvidence((current) => recheck ? { ...current, ...callEvidence } : callEvidence)
      setValidation({ errors: [], fieldErrors: {} })
      setAutoQaServiceOnline(true)
      setAutoQaStage('booking-question')
      setAudioFile(null)
      completeProgress()
      setAutoQaMessage(`Call QA complete for this run. Overall confidence ${Math.round(result.overallConfidence || 0)}%. Review or edit anything you want. The uploaded call audio was deleted from the Auto QA server after transcription.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Auto QA failed.'
      failProgress(message)
      setAutoQaMessage(message)
      void refreshAutoQaService(false)
    } finally {
      setAutoQaBusy(false)
    }
  }

  const executeDocumentationQa = async () => {
    if (!autoQaTranscript) {
      setAutoQaMessage('Run the call QA first.')
      return
    }
    if (!documentation.trim()) {
      setAutoQaMessage('Paste the booking documentation first.')
      return
    }

    setAutoQaMessage('Checking Auto QA service before documentation review…')
    const ready = await refreshAutoQaService(false)
    if (!ready) {
      const message = autoQaServiceMessage || 'Auto QA service cannot be reached. Check START-EVERYTHING.bat and the Cloudflare tunnel.'
      setAutoQaMessage(message)
      failProgress(message)
      return
    }

    setAutoQaBusy(true)
    startProgress('documentation')
    setAutoQaMessage('Reviewing the booking documentation and finishing the documentation QA…')
    try {
      const result = await runAutoQa({
        transcript: autoQaTranscript,
        documentation,
        phase: 'documentation',
        qaType: review.qaType,
        settings,
      })

      setReview((current) => ({
        ...current,
        confirmationNumber: current.confirmationNumber.trim() || result.detectedItinerary || '',
        guestEmail: (current.guestEmail || '').trim() || result.detectedEmail || '',
        guestPhone: (current.guestPhone || '').trim() || result.detectedPhone || '',
        criteria: applyAiCriteria(current, result.criteria, 'documentation', false),
      }))

      const documentationNumbers = new Set(review.criteria.filter((criterion) => isDocumentationCriterion(criterion.name)).map((criterion) => Number(criterion.number)))
      setAutoQaEvidence((current) => ({
        ...current,
        ...Object.fromEntries(result.criteria.filter((item) => documentationNumbers.has(Number(item.number))).map((item) => [Number(item.number), item])),
      }))
      setValidation({ errors: [], fieldErrors: {} })
      setAutoQaServiceOnline(true)
      setAutoQaStage('complete')
      completeProgress()
      setAutoQaMessage('Documentation QA complete. Review and edit every field, score, status, and note before saving.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Documentation QA failed.'
      failProgress(message)
      setAutoQaMessage(message)
      void refreshAutoQaService(false)
    } finally {
      setAutoQaBusy(false)
    }
  }

  const skipDocumentationForNonHp = () => {
    setReview((current) => ({
      ...current,
      criteria: current.criteria.map((criterion) => isDocumentationCriterion(criterion.name)
        ? {
            ...criterion,
            status: 'N/A',
            customNote: 'Documentation QA skipped because this is not an HP booking.',
            criticalReason: '',
            autoPoints: pointsForStatus(criterion.points, 'N/A'),
          }
        : criterion),
    }))
    setAutoQaStage('skipped-docs')
    setAutoQaMessage('Non-HP booking selected. Documentation QA was skipped. Review and edit everything before saving.')
  }

  const score = useMemo(
    () => review.criteria.reduce((sum, criterion) => sum + criterion.autoPoints, 0),
    [review.criteria],
  )
  const kpi = review.qaType === 'Groups' ? settings.rules.groupsKpi : review.qaType === 'Sales' ? settings.rules.salesKpi : settings.rules.csKpi
  const hasCriticalError = review.qaType !== 'Groups' && Boolean(
    review.criteria.some((criterion) => criterion.status === 'Critical') ||
    review.criticalErrors?.noNotes ||
    review.criticalErrors?.voucherReference
  )
  const displayedScore = hasCriticalError ? 0 : score
  const result = !hasCriticalError && score >= kpi ? 'PASS' : 'FAIL'
  const markdowns = review.criteria.filter((criterion) => criterion.status === '✕ Markdown').length
  const watchListMatch = useMemo(() => findActiveWatchAgent(review.agentName, watchListAgents, review.callCenter), [review.agentName, review.callCenter, watchListAgents])

  const updateField = <K extends keyof ReviewDraft>(field: K, value: ReviewDraft[K]) => {
    if (AUTO_QA_DETAIL_FIELDS.has(field as AutoQaDetailField)) {
      setManualDetailFields((current) => new Set(current).add(field as AutoQaDetailField))
    }
    setReview((current) => ({ ...current, [field]: value }))
    setValidation((current) => {
      const next = { ...current.fieldErrors }
      delete next[String(field)]
      return { errors: current.errors, fieldErrors: next }
    })
  }

  const updateQaType = (qaType: QaType) => {
    setReview((current) => ({
      ...current,
      qaType,
      criteria: createCriterionAnswers(settings, qaType),
    }))
    setValidation({ errors: [], fieldErrors: {} })
    setAutoQaEvidence({})
    setManualOverrides(new Set())
    setAutoQaTranscript('')
    setDocumentation('')
    setAutoQaStage('ready')
    setAutoQaProgress({ status: 'idle', mode: 'call', percent: 0, elapsedSeconds: 0, stage: 'Not started', startedAt: null, error: '' })
  }

  const updateCriterion = (index: number, patch: Partial<CriterionAnswer>) => {
    const criterionNumber = Number(review.criteria[index]?.number)
    if (Number.isFinite(criterionNumber)) setManualOverrides((current) => new Set(current).add(criterionNumber))
    setReview((current) => ({
      ...current,
      criteria: current.criteria.map((criterion, criterionIndex) => {
        if (criterionIndex !== index) return criterion

        const updated = { ...criterion, ...patch }

        if (patch.status !== undefined && patch.status === '') {
          updated.customNote = ''
          updated.criticalReason = ''
        }
        if (patch.status !== undefined && patch.status !== 'Critical') {
          updated.criticalReason = ''
        }

        updated.partialPoints = updated.points / 2
        updated.autoPoints = pointsForStatus(updated.points, updated.status)
        return updated
      }),
    }))

    setValidation((current) => {
      const next = { ...current.fieldErrors }
      delete next[`criterion-${index}`]

      if (
        patch.customNote !== undefined ||
        (patch.status !== undefined &&
          patch.status !== '✕ Markdown' &&
          patch.status !== 'Partial' &&
          patch.status !== 'Critical')
      ) {
        delete next[`note-${index}`]
      }

      return { errors: current.errors, fieldErrors: next }
    })
  }

  const prepareSubmit = () => {
    const nextReview = {
      ...review,
      callId: normalizeCallId(review.callId),
      todayDate: localDateInput(),
      evaluator: user.role === 'admin' ? review.evaluator : user.displayName,
    }
    setReview(nextReview)

    const nextValidation = validateReview(nextReview, user, settings)
    setValidation(nextValidation)

    if (nextValidation.errors.length) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    if (user.guidedMode) {
      setShowChecklist(true)
      return
    }

    void submit(nextReview)
  }

  const resetReviewForm = (qaType: QaType) => {
    setReview(createReviewDraft(settings, user.displayName, qaType))
    setValidation({ errors: [], fieldErrors: {} })
    setShowChecklist(false)
    setDraftRestored(false)
    setAudioFile(null)
    setDocumentation('')
    setAutoQaMessage('')
    setAutoQaTranscript('')
    setAutoQaEvidence({})
    setManualOverrides(new Set())
    setManualDetailFields(new Set())
    setAutoQaStage('ready')
    setAutoQaProgress({ status: 'idle', mode: 'call', percent: 0, elapsedSeconds: 0, stage: 'Not started', startedAt: null, error: '' })
    window.localStorage.removeItem(draftKey)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const submit = async (value = review) => {
    try {
      await onSave(value)
      resetReviewForm(value.qaType)
    } catch {
      setShowChecklist(false)
    }
  }

  if (!user.permissions.canSubmitReviews) {
    return (
      <section className="panel empty-state">
        Your account can’t submit reviews. An administrator can change this in Admin Control.
      </section>
    )
  }

  return (
    <div className="page-stack">
      {draftRestored && (
        <section className="draft-restored-banner">Draft details restored automatically. Auto QA scoring is only restored when it was manually edited; old AI-only scoring is not reused for a new call.</section>
      )}

      {user.guidedMode && (
        <section className="guided-banner">
          <div className="guided-icon">✓</div>
          <div>
            <strong>Guided Mode is on</strong>
            <p>
              This mode gives friendly reminders, keeps scoring fields locked, and asks for a final double-check before saving.
            </p>
          </div>
        </section>
      )}

      {validation.errors.length > 0 && (
        <section className="error-summary" role="alert">
          <strong>Please fix {validation.errors.length} item{validation.errors.length === 1 ? '' : 's'} before saving:</strong>
          <ul>
            {validation.errors.slice(0, 8).map((error) => <li key={error}>{error}</li>)}
          </ul>
        </section>
      )}

      {user.guidedMode && (
        <section className="guided-progress-card">
          <strong>Review progress</strong>
          <div className="guided-progress-grid">
            <span className={review.agentName && review.callCenter && review.callId ? 'complete' : ''}>Call details {review.agentName && review.callCenter && review.callId ? '✓' : '○'}</span>
            <span className={review.criteria.every((item) => item.status) ? 'complete' : ''}>Criteria selected {review.criteria.every((item) => item.status) ? '✓' : '○'}</span>
            <span className={review.criteria.every((item) => !['✕ Markdown', 'Partial'].includes(item.status) || item.customNote.trim()) ? 'complete' : ''}>Markdown / Partial notes {review.criteria.every((item) => !['✕ Markdown', 'Partial'].includes(item.status) || item.customNote.trim()) ? '✓' : '○'}</span>
            <span className={validation.errors.length === 0 ? 'complete' : ''}>Ready to save {validation.errors.length === 0 ? '✓' : '○'}</span>
          </div>
        </section>
      )}

      <section className="qa-sheet-card">
        <div className="qa-sheet-header">
          <div>
            <p>HotelPlanner Quality Assurance</p>
            <h1>QA Scorer</h1>
          </div>
          <p className="qa-instruction">Select ✓ / ✕ / N/A / Partial for every criterion. Matrix and Documentation also allow Critical.</p>
        </div>

        <div className="form-score-layout">
          <div className="details-grid">
            <label className={validation.fieldErrors.agentStartDate ? 'field invalid' : 'field'}>
              <span>Agent Start Date</span>
              <input
                type="date"
                value={review.agentStartDate}
                onChange={(event) => updateField('agentStartDate', event.target.value)}
                disabled={!user.permissions.canEditAgentDetails}
              />
              {validation.fieldErrors.agentStartDate && <small>{validation.fieldErrors.agentStartDate}</small>}
            </label>

            <label className="field locked-field">
              <span>Today’s Date</span>
              <input type="date" value={review.todayDate} readOnly />
            </label>

            <label className={validation.fieldErrors.evaluator ? 'field invalid' : 'field'}>
              <span>Evaluator</span>
              {user.role === 'admin' ? (
                <select value={review.evaluator} onChange={(event) => updateField('evaluator', event.target.value)}>
                  {evaluators.filter((evaluator) => evaluator.active).map((evaluator) => (
                    <option key={evaluator.email} value={evaluator.displayName}>{evaluator.displayName}</option>
                  ))}
                </select>
              ) : (
                <input value={user.displayName} readOnly />
              )}
            </label>

            <label className={validation.fieldErrors.agentName ? 'field invalid' : 'field'}>
              <span>Agent Name</span>
              <input
                value={review.agentName}
                onChange={(event) => updateField('agentName', event.target.value)}
                placeholder=""
                disabled={!user.permissions.canEditAgentDetails}
              />
              {validation.fieldErrors.agentName && <small>{validation.fieldErrors.agentName}</small>}
              {watchListMatch && (
                <div className="watch-agent-warning" role="status">
                  <strong>👁 WATCH LIST AGENT</strong>
                  <span>{watchListMatch.wave}{watchListMatch.trainer ? ` · Trainer: ${watchListMatch.trainer}` : ''}</span>
                </div>
              )}
            </label>

            <label className={validation.fieldErrors.callCenter ? 'field invalid' : 'field'}>
              <span>Call Center</span>
              <input
                list="qa-call-centers"
                value={review.callCenter}
                onChange={(event) => updateField('callCenter', event.target.value)}
                placeholder="Pick or type a call center"
                autoComplete="off"
                disabled={!user.permissions.canEditAgentDetails}
              />
              <datalist id="qa-call-centers">
                {settings.callCenters.map((center) => <option key={center} value={center} />)}
              </datalist>
              <em>Choose an existing call center or type a new one.</em>
              {validation.fieldErrors.callCenter && <small>{validation.fieldErrors.callCenter}</small>}
            </label>

            <label className={validation.fieldErrors.callId ? 'field invalid' : 'field'}>
              <span>Call ID</span>
              <input
                value={review.callId}
                onChange={(event) => updateField('callId', event.target.value)}
                onBlur={() => updateField('callId', normalizeCallId(review.callId))}
                placeholder=""
                disabled={!user.permissions.canEditAgentDetails}
              />
              {user.guidedMode && <em>Use CA followed by 32 hexadecimal characters.</em>}
              {validation.fieldErrors.callId && <small>{validation.fieldErrors.callId}</small>}
            </label>

            <label className={validation.fieldErrors.qaType ? 'field invalid' : 'field'}>
              <span>QA Type</span>
              <select value={review.qaType} onChange={(event) => updateQaType(event.target.value as QaType)}>
                <option value="CS">CS</option>
                <option value="Groups">Groups</option>
                <option value="Sales" disabled={!settings.criteria.Sales.length}>Sales{!settings.criteria.Sales.length ? ' — matrix pending approval' : ''}</option>
              </select>
            </label>

            <label className={validation.fieldErrors.confirmationNumber ? 'field invalid' : 'field'}>
              <span>Confirmation / Itinerary #</span>
              <input
                value={review.confirmationNumber}
                onChange={(event) => updateField('confirmationNumber', event.target.value)}
                placeholder="AI will fill this if found in the call"
                disabled={!user.permissions.canEditAgentDetails}
              />
              {validation.fieldErrors.confirmationNumber && <small>{validation.fieldErrors.confirmationNumber}</small>}
            </label>

            <label className="field">
              <span>Guest Email</span>
              <input
                type="email"
                value={review.guestEmail || ''}
                onChange={(event) => updateField('guestEmail', event.target.value)}
                placeholder="AI will fill this if found in the call"
                disabled={!user.permissions.canEditAgentDetails}
              />
            </label>

            <label className="field">
              <span>Guest Phone</span>
              <input
                value={review.guestPhone || ''}
                onChange={(event) => updateField('guestPhone', event.target.value)}
                placeholder="AI will fill this if found in the call"
                disabled={!user.permissions.canEditAgentDetails}
              />
            </label>

            <label className={validation.fieldErrors.callLength ? 'field invalid' : 'field'}>
              <span>Length of Call</span>
              <input
                value={review.callLength}
                onChange={(event) => updateField('callLength', event.target.value)}
                placeholder=""
                disabled={!user.permissions.canEditAgentDetails}
              />
              {validation.fieldErrors.callLength && <small>{validation.fieldErrors.callLength}</small>}
            </label>

            <label className={validation.fieldErrors.callDate ? 'field invalid' : 'field'}>
              <span>Date of Call</span>
              <input
                type="date"
                value={review.callDate}
                onChange={(event) => updateField('callDate', event.target.value)}
                disabled={!user.permissions.canEditAgentDetails}
              />
              {validation.fieldErrors.callDate && <small>{validation.fieldErrors.callDate}</small>}
            </label>
          </div>

          {settings.autoQa?.enabled && (
            <section className="autoqa-review-panel">
              <div className="autoqa-review-heading">
                <div>
                  <p className="eyebrow">Auto QA</p>
                  <h3>Call First → Booking → Documentation</h3>
                  <p className="muted">Upload only the call first. No itinerary or documentation is required to start. The call is transcribed and graded, then the tool tries to find the itinerary, guest email, and guest phone for you.</p>
                </div>
                <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                  <span className={`service-status ${autoQaServiceOnline === true ? 'online' : autoQaServiceOnline === false ? 'offline' : ''}`}>
                    {autoQaServiceOnline === true ? 'Auto QA ready' : autoQaServiceOnline === false ? 'Auto QA offline / not ready' : 'Checking Auto QA…'}
                  </span>
                  <button type="button" className="secondary-button compact" onClick={() => void refreshAutoQaService(true)} disabled={autoQaBusy}>
                    Retry / Recheck Connection
                  </button>
                  <small className="muted">{autoQaServiceMessage}</small>
                  <small className="muted">Last checked: {autoQaLastChecked ? new Date(autoQaLastChecked).toLocaleTimeString() : 'not yet'}</small>
                </div>
              </div>

              {autoQaStage === 'ready' && (
                <div className="autoqa-input-grid">
                  <label className="field">
                    <span>Call Audio</span>
                    <input
                      type="file"
                      accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.wma,.mp4,.webm"
                      onChange={(event) => handleNewAudioFile(event.target.files?.[0] || null)}
                      disabled={autoQaBusy}
                    />
                    <em>{audioFile ? `${audioFile.name} · NOT QA’d yet` : 'Upload the call only. WAV, MP3, M4A, AAC, OGG, FLAC, WMA, MP4 and other FFmpeg-supported formats.'}</em>
                  </label>
                </div>
              )}

              <div className="autoqa-actions">
                {autoQaStage === 'ready' && (
                  <button type="button" className="primary-button" onClick={() => void executeCallAutoQa(false)} disabled={!audioFile || autoQaBusy || autoQaServiceOnline !== true}>
                    {autoQaBusy ? 'Reviewing Call…' : 'Run Call Auto QA'}
                  </button>
                )}
                {autoQaTranscript && (
                  <button type="button" className="secondary-button" onClick={() => void executeCallAutoQa(true)} disabled={autoQaBusy || autoQaServiceOnline !== true}>
                    Recheck Call QA
                  </button>
                )}
                {autoQaTranscript && <span className="muted">Transcript ready · {autoQaTranscript.split(/\s+/).filter(Boolean).length} words{manualOverrides.size ? ` · ${manualOverrides.size} manual edit${manualOverrides.size === 1 ? '' : 's'} protected` : ''}</span>}
              </div>

              {autoQaProgress.status !== 'idle' && (
                <div className="validation-banner" role="status" aria-live="polite" style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{autoQaProgress.status === 'failed' ? 'FAILED' : autoQaProgress.mode === 'documentation' ? 'Documentation Auto QA' : 'Call Auto QA'}</strong>
                    <span>{Math.round(autoQaProgress.percent)}% · {formatElapsed(autoQaProgress.elapsedSeconds)}</span>
                  </div>
                  <progress max={100} value={autoQaProgress.percent} style={{ width: '100%', height: 16 }} />
                  <span><strong>Current stage:</strong> {autoQaProgress.stage}</span>
                  <small>{autoQaProgress.status === 'running' ? 'Progress is estimated while the backend works. It will never show 100% until a valid successful response is returned.' : autoQaProgress.status === 'complete' ? 'Validated backend response received.' : autoQaProgress.error}</small>
                </div>
              )}

              {autoQaStage === 'booking-question' && (
                <div className="validation-banner">
                  <div>
                    <strong>Call QA is complete.</strong>
                    <span>Is the booking an HP booking?</span>
                  </div>
                  <div className="autoqa-actions">
                    <button type="button" className="primary-button" onClick={() => setAutoQaStage('notes-choice')}>Yes — HP Booking</button>
                    <button type="button" className="secondary-button" onClick={skipDocumentationForNonHp}>No — Not HP</button>
                  </div>
                </div>
              )}

              {autoQaStage === 'notes-choice' && (
                <div className="validation-banner">
                  <div>
                    <strong>Did you find the booking documentation / notes?</strong>
                    <span>If you found them, paste them and the tool will finish the documentation QA. If not, you can QA documentation manually.</span>
                  </div>
                  <div className="autoqa-actions">
                    <button type="button" className="primary-button" onClick={() => setAutoQaStage('paste-docs')}>Paste Documentation</button>
                    <button type="button" className="secondary-button" onClick={() => {
                      setAutoQaStage('manual-docs')
                      setAutoQaMessage('Call QA is complete. Documentation remains Manual Review Required for you to score before saving.')
                    }}>I Will QA Documentation Manually</button>
                    <button type="button" className="secondary-button" onClick={() => {
                      setAutoQaStage('manual-docs')
                      setAutoQaMessage('QA completed from the call evidence we have. Documentation remains Manual Review Required because notes were not supplied.')
                    }}>QA What We Have Without Notes</button>
                  </div>
                </div>
              )}

              {autoQaStage === 'paste-docs' && (
                <div className="autoqa-input-grid">
                  <label className="field autoqa-documentation-field">
                    <span>Documentation / Itinerary Notes</span>
                    <textarea
                      value={documentation}
                      onChange={(event) => setDocumentation(event.target.value)}
                      placeholder="Paste the full Refunds / Notes / Zendesk / itinerary documentation here…"
                      disabled={autoQaBusy}
                    />
                  </label>
                  <div className="autoqa-actions">
                    <button type="button" className="primary-button" onClick={() => void executeDocumentationQa()} disabled={!documentation.trim() || autoQaBusy || autoQaServiceOnline !== true}>
                      {autoQaBusy ? 'Reviewing Documentation…' : 'Finish Documentation QA'}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => setAutoQaStage('notes-choice')} disabled={autoQaBusy}>Back</button>
                  </div>
                </div>
              )}

              {autoQaStage === 'manual-docs' && (
                <div className="validation-banner">
                  <strong>Documentation: Manual Review Required</strong>
                  <span>Complete the documentation-related criterion manually in the QA table below. Everything remains editable before submission.</span>
                </div>
              )}

              {autoQaStage === 'skipped-docs' && (
                <div className="validation-banner">
                  <strong>Documentation QA skipped</strong>
                  <span>This was marked as not an HP booking. Call QA results remain editable before submission.</span>
                </div>
              )}

              {autoQaStage === 'complete' && (
                <div className="validation-banner">
                  <strong>Call + Documentation QA complete</strong>
                  <span>Review every field and every QA answer. You can edit anything before saving.</span>
                </div>
              )}

              {autoQaMessage && <div className="validation-banner"><span>{autoQaMessage}</span></div>}
            </section>
          )}

          <aside className="score-panel">
            <div><span>Final Score</span><strong>{displayedScore}</strong></div>
            <div><span>KPI Target</span><strong>{kpi}</strong></div>
            <div><span>Result</span><strong className={result === 'PASS' ? 'pass-text' : 'fail-text'}>{result}</strong></div>
            <div><span>Markdowns</span><strong>{markdowns}</strong></div>
          </aside>
        </div>

        <div className="criteria-table-wrap">
          <table className="criteria-table">
            <thead>
              <tr>
                <th>#</th>
                <th>QA Criteria</th>
                <th>Max</th>
                <th>Select</th>
                <th>Partial Points</th>
                <th>Auto Points</th>
                <th>Notes / Issue Found</th>
                <th>Custom Notes</th>
              </tr>
            </thead>
            <tbody>
              {review.criteria.map((criterion, index) => (
                <tr key={`${review.qaType}-${criterion.number}`}>
                  <td data-label="#">{criterion.number}</td>
                  <td data-label="QA Criteria"><strong>{criterion.name}</strong></td>
                  <td data-label="Max">{criterion.points}</td>
                  <td data-label="Select" className={validation.fieldErrors[`criterion-${index}`] ? 'cell-invalid' : ''}>
                    <select
                      value={criterion.status}
                      onChange={(event) => {
                        const nextStatus = event.target.value as CriterionStatus
                        if (nextStatus === 'Critical') {
                          setCriticalModal({ index, reason: criterion.criticalReason || '', note: criterion.customNote || '' })
                          return
                        }
                        if (nextStatus === '✕ Markdown' && review.qaType !== 'Groups' && isMatrixComplianceCriterion(criterion.name)) {
                          updateCriterion(index, {
                            status: 'Critical',
                            criticalReason: 'Required Matrix process was not followed',
                          })
                          return
                        }
                        updateCriterion(index, { status: nextStatus })
                      }}
                      disabled={!user.permissions.canEditCriteriaSelections}
                    >
                      <option value="">Select</option>
                      {settings.statusOptions.filter((status) => status !== 'Critical').map((status) => <option key={status} value={status}>{status}</option>)}
                      {review.qaType !== 'Groups' && isCriticalCriterion(criterion.name) && <option value="Critical">Critical</option>}
                    </select>
                    {criterion.status === 'Critical' && criterion.criticalReason && (
                      <button
                        type="button"
                        className="critical-reason-button"
                        onClick={() => setCriticalModal({ index, reason: criterion.criticalReason || '', note: criterion.customNote || '' })}
                      >
                        Reason: {criterion.criticalReason}
                      </button>
                    )}
                    {validation.fieldErrors[`criterion-${index}`] && <small>{validation.fieldErrors[`criterion-${index}`]}</small>}
                  </td>
                  <td data-label="Partial Points">{criterion.status === 'Partial' ? criterion.partialPoints : ''}</td>
                  <td data-label="Auto Points"><strong>{hasCriticalError ? (criterion.status ? 0 : '') : (criterion.autoPoints || (criterion.status ? 0 : ''))}</strong></td>
                  <td data-label="Notes / Issue Found"><p>{criterion.notes}</p></td>
                  <td data-label="Custom Notes" className={validation.fieldErrors[`note-${index}`] ? 'cell-invalid' : ''}>
                    {criterion.status ? (
                      <>
                        <textarea
                          value={criterion.customNote}
                          onChange={(event) => updateCriterion(index, { customNote: event.target.value })}
                          placeholder={
                            criterion.status === '✕ Markdown' || criterion.status === 'Partial'
                              ? 'Required: explain the issue clearly…'
                              : criterion.status === 'Critical'
                                ? 'Optional coaching comments. The Critical reason is saved above…'
                              : criterion.status === '✓ Followed'
                                ? 'Optional: add a positive note or extra context…'
                                : 'Optional note…'
                          }
                          disabled={!user.permissions.canEditCustomNotes}
                        />
                        {criterion.status === '✓ Followed' && !criterion.customNote.trim() && (
                          <small className="optional-note-hint">Optional for Followed.</small>
                        )}
                        {validation.fieldErrors[`note-${index}`] && <small>{validation.fieldErrors[`note-${index}`]}</small>}
                        {autoQaEvidence[criterion.number] && (
                          <details className={`autoqa-evidence ${autoQaEvidence[criterion.number].confidence < 75 ? 'review-me' : ''}`}>
                            <summary>Confidence {Math.round(autoQaEvidence[criterion.number].confidence)}%{autoQaEvidence[criterion.number].confidence < 75 ? ' · Review Me' : ''} · View Evidence</summary>
                            <div className="autoqa-evidence-body">
                              <p><strong>Call:</strong> {autoQaEvidence[criterion.number].transcriptEvidence || 'No direct call evidence.'}</p>
                              <p><strong>Documentation:</strong> {autoQaEvidence[criterion.number].documentationEvidence || 'No direct documentation evidence.'}</p>
                              <p><strong>Matrix:</strong> {autoQaEvidence[criterion.number].matrixEvidence || 'No Matrix excerpt used.'}</p>
                            </div>
                          </details>
                        )}
                      </>
                    ) : (
                      <span className="note-not-required">{isDocumentationCriterion(criterion.name) && autoQaTranscript ? 'Manual Review Required until documentation is completed.' : 'Select a status first.'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {hasCriticalError && (
          <section className="critical-errors-panel">
            <div className="validation-banner">
              <strong>CRITICAL FAIL — Final QA is 0% / FAIL.</strong>
              <span>All other categories remain editable for scoring selections and coaching comments, but their saved points are zeroed for this QA.</span>
            </div>
          </section>
        )}

        <div className="review-additional-comments">
          <label className="field">
            <span>Additional Comments (Optional)</span>
            <textarea
              value={review.additionalComments || ''}
              onChange={(event) => updateField('additionalComments', event.target.value)}
              placeholder="Add general observations that do not affect scoring, such as line quality, background noise, customer behavior, or positive feedback about the agent…"
              disabled={!user.permissions.canEditCustomNotes}
            />
            <em>Optional. This does not affect the QA score.</em>
          </label>
        </div>

        <div className="save-bar">
          <div>
            <strong>Ready to save?</strong>
            <span>The review will be saved directly to Firebase and included in both Excel export formats.</span>
          </div>
          <button type="button" className="primary-button save-button" onClick={prepareSubmit} disabled={saving}>
            {saving ? 'Saving Review…' : 'Save Review'}
          </button>
        </div>
      </section>

      {criticalModal && review.criteria[criticalModal.index] && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card critical-modal" role="dialog" aria-modal="true" aria-labelledby="critical-title">
            <p className="eyebrow">Critical QA</p>
            <h2 id="critical-title">Select the reason for this Critical</h2>
            <p className="muted"><strong>{review.criteria[criticalModal.index].name}</strong></p>
            <p className="critical-warning-copy">Choosing Critical makes the entire QA 0% / FAIL. You can still complete every category and add coaching comments.</p>
            <label className="field">
              <span>Critical Reason</span>
              <select
                value={criticalModal.reason}
                onChange={(event) => setCriticalModal((current) => current ? { ...current, reason: event.target.value } : current)}
                autoFocus
              >
                <option value="">Select a reason</option>
                {criticalReasonsFor(review.criteria[criticalModal.index].name).map((reason) => <option key={reason} value={reason}>{reason}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Coaching Comment (Optional)</span>
              <textarea
                value={criticalModal.note}
                onChange={(event) => setCriticalModal((current) => current ? { ...current, note: event.target.value } : current)}
                placeholder="Add details the Call Center team can use for coaching…"
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setCriticalModal(null)}>Cancel</button>
              <button
                type="button"
                className="primary-button danger-button"
                onClick={() => {
                  if (!criticalModal.reason.trim()) {
                    window.alert('Please select a Critical reason.')
                    return
                  }
                  updateCriterion(criticalModal.index, {
                    status: 'Critical',
                    criticalReason: criticalModal.reason,
                    customNote: criticalModal.note,
                  })
                  setCriticalModal(null)
                }}
              >
                Apply Critical
              </button>
            </div>
          </section>
        </div>
      )}

      {showChecklist && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card checklist-modal" role="dialog" aria-modal="true" aria-labelledby="checklist-title">
            <p className="eyebrow">Friendly final check</p>
            <h2 id="checklist-title">Please confirm these details</h2>
            <div className="checklist">
              <label><input type="checkbox" required /> The Call ID belongs to this exact call.</label>
              <label><input type="checkbox" required /> The booking reference belongs to this guest.</label>
              <label><input type="checkbox" required /> The call center, QA type, call length, and call date are correct.</label>
              <label><input type="checkbox" required /> Every criterion status was checked. Followed comments are optional; Markdown / Partial notes were added where required.</label>
            </div>
            <p className="kind-note">Take your time. This extra check is here to help prevent small mistakes.</p>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setShowChecklist(false)}>Go Back</button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('.checklist input[type="checkbox"]'))
                  if (!checkboxes.every((checkbox) => checkbox.checked)) {
                    window.alert('Please check all four boxes before saving.')
                    return
                  }
                  void submit(review)
                }}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Confirm and Save'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
