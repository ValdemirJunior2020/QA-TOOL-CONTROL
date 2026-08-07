import type { ApiResponse, AppSettings, AuthSession, BootstrapResponse, CriterionAnswer, QaUser, ReviewDraft, ReviewRecord } from '../types'
import { DEFAULT_SETTINGS } from '../data/defaults'
import { ADMIN_EMAILS, BARBARA_EMAIL, OWNER_EMAIL, firestore, normalizeEmail, realtimeDb } from './firebase'

export interface PresenceUser {
  email: string
  displayName: string
  role: string
  currentPage: string
  lastSeen: string
  sessionId: string
  online: boolean
}

const viewerPermissions = {
  canSubmitReviews: false,
  canViewHistory: true,
  canEditAgentDetails: false,
  canEditCriteriaSelections: false,
  canEditCustomNotes: false,
}

function viewerFromSession(session: AuthSession): QaUser {
  return {
    email: normalizeEmail(session.email),
    displayName: session.name || session.email,
    role: 'viewer',
    active: true,
    guidedMode: false,
    notes: 'Viewer access. An administrator must add this account before it can submit reviews.',
    permissions: { ...viewerPermissions },
  }
}

function sanitizeUser(raw: any, fallback?: QaUser): QaUser {
  const base = fallback || viewerFromSession({ idToken: '', email: raw?.email || '', name: raw?.displayName || raw?.email || '' })
  return {
    ...base,
    ...raw,
    email: normalizeEmail(raw?.email || base.email),
    displayName: String(raw?.displayName || base.displayName || raw?.email || '').trim(),
    permissions: { ...base.permissions, ...(raw?.permissions || {}) },
  }
}

function dateOnly(value: unknown): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function friendlyFirebaseError(error: any): Error {
  const code = String(error?.code || '')
  if (code.includes('permission-denied')) return new Error('Firebase blocked this action because your account does not have permission.')
  if (code.includes('unavailable')) return new Error('Firebase is temporarily unavailable. Check your internet connection and try again.')
  if (code.includes('failed-precondition')) return new Error('Firebase needs an index or setup change for this action. Contact Junior.')
  return error instanceof Error ? error : new Error('The Firebase request could not be completed.')
}

export function getFriendlyApiError(error: unknown): string {
  return friendlyFirebaseError(error).message
}

export function requiresNewLogin(_error: unknown): boolean { return false }

export async function bootstrap(session: AuthSession): Promise<BootstrapResponse> {
  try {
    const email = normalizeEmail(session.email)
    const userSnap = await firestore.collection('users').doc(email).get()
    const fallback = viewerFromSession(session)
    const storedUser = userSnap.exists ? sanitizeUser(userSnap.data(), fallback) : fallback

    // Junior is always the owner, even if a document was accidentally damaged.
    const user: QaUser = email === OWNER_EMAIL
      ? { ...storedUser, email, displayName: storedUser.displayName || 'Junior', role: 'admin', active: true, guidedMode: false, permissions: { canSubmitReviews: true, canViewHistory: true, canEditAgentDetails: true, canEditCriteriaSelections: true, canEditCustomNotes: true } }
      : storedUser

    if (!user.active) throw new Error('This QA app account is blocked. Contact Junior or Barbara.')

    const settingsSnap = await firestore.collection('settings').doc('main').get()
    const settings = settingsSnap.exists ? { ...DEFAULT_SETTINGS, ...settingsSnap.data() } as AppSettings : DEFAULT_SETTINGS

    let users: QaUser[] = [user]
    if (user.role === 'admin' && ADMIN_EMAILS.has(email)) {
      const usersSnap = await firestore.collection('users').get()
      users = usersSnap.docs.map((doc: any) => sanitizeUser(doc.data())).filter((item: QaUser) => Boolean(item.email))
      if (!users.some((item) => normalizeEmail(item.email) === OWNER_EMAIL)) users.unshift(user)
    }

    return { success: true, user, users, settings }
  } catch (error) {
    throw friendlyFirebaseError(error)
  }
}

export async function fetchReviews(_session: AuthSession, _refresh = false): Promise<ReviewRecord[]> {
  try {
    const snapshot = await firestore.collection('reviews').orderBy('savedTimestamp', 'desc').get()
    return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as ReviewRecord))
  } catch (error: any) {
    // During first setup, an empty collection can be read without an index issue.
    throw friendlyFirebaseError(error)
  }
}

function calculateReview(review: ReviewDraft, settings: AppSettings, actor: QaUser): ReviewRecord {
  if (!actor.permissions.canSubmitReviews) throw new Error('Your account cannot submit QA reviews.')
  if (!review.agentStartDate) throw new Error('Add the agent start date.')
  if (!review.agentName.trim()) throw new Error('Add the agent name.')
  if (!settings.callCenters.includes(review.callCenter)) throw new Error('Select a valid call center.')
  if (settings.rules.callIdRequired && !review.callId.trim()) throw new Error('Add the Call ID.')
  if (settings.rules.confirmationRequired && review.confirmationNumber.trim().length < 2) throw new Error('Add an itinerary, confirmation number, reservation number, or booking reference.')
  if (!review.callLength.trim()) throw new Error('Add the call length.')
  if (!review.callDate) throw new Error('Add the date of the call.')
  if (actor.guidedMode && !(new RegExp(settings.rules.guidedCallIdPattern)).test(review.callId.trim())) throw new Error('The Call ID does not match the Guided Mode format.')

  let finalScore = 0
  let markdowns = 0
  const criteria: CriterionAnswer[] = settings.criteria[review.qaType].map((definition, index) => {
    const answer = review.criteria.find((item) => Number(item.number) === Number(definition.number)) || review.criteria[index]
    const status = answer?.status || ''
    if (!settings.statusOptions.includes(status as any)) throw new Error(`Select a status for criterion ${definition.number}: ${definition.name}.`)
    const customNote = String(answer?.customNote || '').trim()
    if (settings.rules.noteRequiredForMarkdownOrPartial && (status === '✕ Markdown' || status === 'Partial') && !customNote) throw new Error(`Add a clear note for criterion ${definition.number} because ${status} was selected.`)
    if (!actor.permissions.canEditCustomNotes && customNote) throw new Error('Your account cannot add custom notes.')
    const autoPoints = status === '✓ Followed' || status === 'N/A' ? definition.points : status === 'Partial' ? definition.points / 2 : 0
    if (status === '✕ Markdown') markdowns += 1
    finalScore += autoPoints
    return { ...definition, status, partialPoints: status === 'Partial' ? definition.points / 2 : 0, autoPoints, customNote }
  })

  const kpiTarget = review.qaType === 'Groups' ? settings.rules.groupsKpi : settings.rules.csKpi
  const result = finalScore >= kpiTarget ? 'PASS' : 'FAIL'
  const now = new Date().toISOString()
  return {
    id: review.requestId || `review-${Date.now()}`,
    rowNumber: 0,
    savedTimestamp: now,
    agentStartDate: dateOnly(review.agentStartDate),
    reviewDate: dateOnly(review.todayDate || now),
    evaluator: actor.role === 'admin' ? review.evaluator : actor.displayName,
    agentName: review.agentName.trim(),
    callCenter: review.callCenter,
    callId: review.callId.trim().replace(/\s+/g, ''),
    itineraryNumber: review.confirmationNumber.trim(),
    emailSent: false,
    qaType: review.qaType,
    finalScore,
    kpiTarget,
    result,
    markdowns,
    issueSummary: criteria.filter((item) => item.customNote).map((item) => `${item.name} - ${item.status} - ${item.customNote}`).join(' | '),
    callLength: review.callLength.trim(),
    callDate: dateOnly(review.callDate),
    criteria,
  }
}

async function nextRowNumber(): Promise<number> {
  const counterRef = firestore.collection('meta').doc('reviews')
  return firestore.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(counterRef)
    const next = Math.max(2, Number(snap.data()?.nextRowNumber || 2))
    transaction.set(counterRef, { nextRowNumber: next + 1, updatedAt: new Date().toISOString() }, { merge: true })
    return next
  })
}

export async function saveReview(session: AuthSession, review: ReviewDraft): Promise<ApiResponse> {
  try {
    const boot = await bootstrap(session)
    const record = calculateReview(review, boot.settings, boot.user)
    record.rowNumber = await nextRowNumber()
    const docId = review.requestId || `review-${record.rowNumber}-${Date.now()}`
    record.id = docId
    await firestore.collection('reviews').doc(docId).set({ ...record, createdByEmail: normalizeEmail(session.email), createdByUid: session.uid || '' })
    await addAudit('REVIEW SAVED', session, '', { reviewId: docId, rowNumber: record.rowNumber, evaluator: record.evaluator, agentName: record.agentName, finalScore: record.finalScore })
    return { success: true, message: `Review saved to Firebase (review row ${record.rowNumber}).`, review: record }
  } catch (error) { throw friendlyFirebaseError(error) }
}

function normalizeSavedUser(user: QaUser, actorEmail: string): QaUser {
  const email = normalizeEmail(user.email)
  if (email === OWNER_EMAIL) {
    return { ...user, email, role: 'admin', active: true, guidedMode: false, permissions: { canSubmitReviews: true, canViewHistory: true, canEditAgentDetails: true, canEditCriteriaSelections: true, canEditCustomNotes: true } }
  }
  if (email === BARBARA_EMAIL && actorEmail === BARBARA_EMAIL) {
    return { ...user, email, role: 'admin', active: true, guidedMode: false, permissions: { canSubmitReviews: true, canViewHistory: true, canEditAgentDetails: true, canEditCriteriaSelections: true, canEditCustomNotes: true } }
  }
  if (user.role === 'admin' && email !== BARBARA_EMAIL) throw new Error('Only Junior and Barbara can be administrators.')
  return { ...user, email }
}

export async function saveUser(session: AuthSession, user: QaUser): Promise<ApiResponse<QaUser>> {
  try {
    const actor = normalizeEmail(session.email)
    const target = normalizeEmail(user.email)
    if (!ADMIN_EMAILS.has(actor)) throw new Error('Only Junior or Barbara can perform this admin action.')
    if (actor === BARBARA_EMAIL && target === OWNER_EMAIL) throw new Error("Junior is the owner account. Barbara can't edit, block, demote, delete, or change Junior's permissions.")
    const saved = normalizeSavedUser({ ...user, email: target, updatedAt: new Date().toISOString(), updatedBy: actor }, actor)
    if (target === OWNER_EMAIL && actor !== OWNER_EMAIL) throw new Error("Junior is the owner account. This account can't be changed by Barbara.")
    await firestore.collection('users').doc(target).set(saved, { merge: true })
    await addAudit('USER UPSERTED', session, target, saved)
    return { success: true, message: `${saved.displayName} was saved.`, user: saved }
  } catch (error) { throw friendlyFirebaseError(error) }
}

export async function setUserBlocked(session: AuthSession, email: string, blocked: boolean): Promise<ApiResponse> {
  try {
    const actor = normalizeEmail(session.email)
    const target = normalizeEmail(email)
    if (!ADMIN_EMAILS.has(actor)) throw new Error('Only Junior or Barbara can perform this admin action.')
    if (target === OWNER_EMAIL && actor !== OWNER_EMAIL) throw new Error("Junior is the owner account. Barbara can't block, delete, or disable Junior.")
    if (target === OWNER_EMAIL) throw new Error("Junior is the owner account and can't be blocked.")
    if (target === BARBARA_EMAIL && actor !== OWNER_EMAIL) throw new Error('Only Junior can block or change Barbara’s administrator account.')
    await firestore.collection('users').doc(target).set({ active: !blocked, updatedAt: new Date().toISOString(), updatedBy: actor }, { merge: true })
    await addAudit(blocked ? 'USER BLOCKED' : 'USER UNBLOCKED', session, target, {})
    return { success: true, message: `Account ${blocked ? 'blocked' : 'unblocked'}.` }
  } catch (error) { throw friendlyFirebaseError(error) }
}

export async function saveSettings(session: AuthSession, settings: AppSettings): Promise<ApiResponse<AppSettings>> {
  try {
    if (!ADMIN_EMAILS.has(normalizeEmail(session.email))) throw new Error('Only Junior or Barbara can change QA settings.')
    await firestore.collection('settings').doc('main').set({ ...settings, updatedAt: new Date().toISOString(), updatedBy: normalizeEmail(session.email) })
    await addAudit('SETTINGS UPDATED', session, '', {})
    return { success: true, message: 'QA settings were saved to Firebase.', settings }
  } catch (error) { throw friendlyFirebaseError(error) }
}

export async function markReviewEmailSent(session: AuthSession, review: ReviewRecord, sent: boolean): Promise<ApiResponse<ReviewRecord>> {
  try {
    if (!ADMIN_EMAILS.has(normalizeEmail(session.email))) throw new Error('Only Junior or Barbara can change the email-sent status.')
    const patch = { emailSent: sent, emailSentAt: sent ? new Date().toISOString() : '', emailSentBy: sent ? session.name : '', updatedAt: new Date().toISOString() }
    await firestore.collection('reviews').doc(review.id).update(patch)
    return { success: true, message: `Email marked ${sent ? 'sent' : 'not sent'}.`, review: { ...review, ...patch } }
  } catch (error) { throw friendlyFirebaseError(error) }
}

async function addAudit(action: string, session: AuthSession, targetEmail: string, details: unknown) {
  try {
    await firestore.collection('auditLogs').add({ action, actorEmail: normalizeEmail(session.email), actorName: session.name, targetEmail: normalizeEmail(targetEmail), details, createdAt: new Date().toISOString() })
  } catch (error) { console.warn('Audit log write failed.', error) }
}

export async function updatePresence(session: AuthSession, currentPage: string, sessionId: string): Promise<PresenceUser | null> {
  if (!session.uid) return null
  const userSnap = await firestore.collection('users').doc(normalizeEmail(session.email)).get().catch(() => null)
  const role = userSnap?.exists ? String(userSnap.data()?.role || 'viewer') : 'viewer'
  const presence: PresenceUser = { email: normalizeEmail(session.email), displayName: session.name || session.email, role, currentPage, lastSeen: new Date().toISOString(), sessionId, online: true }
  await realtimeDb.ref(`presence/${session.uid}`).set(presence)
  realtimeDb.ref(`presence/${session.uid}`).onDisconnect().remove().catch(() => undefined)
  return presence
}

export async function getPresence(_session: AuthSession): Promise<PresenceUser[]> {
  const snapshot = await realtimeDb.ref('presence').once('value')
  const values = snapshot.val() || {}
  const cutoff = Date.now() - 120000
  return Object.values(values).map((item: any) => ({ ...item, online: new Date(item.lastSeen || 0).getTime() >= cutoff })) as PresenceUser[]
}

export async function removePresence(session: AuthSession, _sessionId: string): Promise<void> {
  if (session.uid) await realtimeDb.ref(`presence/${session.uid}`).remove()
}

export async function createQaBackup(_session: AuthSession): Promise<ApiResponse> {
  return { success: true, message: 'Use “Download Full Google-Sheet Style” in Review History for a complete offline backup.' }
}

export async function restoreLatestQaBackup(_session: AuthSession): Promise<ApiResponse> {
  return { success: false, message: 'Automatic Google Sheet restore was removed. Use the Legacy Firebase Import in Admin Control to restore/import an Excel workbook safely.' }
}

// Kept for compatibility with old imports. Client-side Excel export no longer calls a backend.
export async function exportReviewsWorkbook(): Promise<{ filename: string; base64: string }> {
  throw new Error('Server-side export was removed. Use the browser Excel export buttons.')
}
