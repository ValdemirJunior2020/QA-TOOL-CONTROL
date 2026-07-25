import type {
  ApiResponse,
  AppSettings,
  AuthSession,
  BootstrapResponse,
  QaUser,
  ReviewDraft,
  ReviewRecord,
} from '../types'

const API_ENDPOINT = '/api/qa-api'

export type ApiErrorCode =
  | 'SESSION_EXPIRED'
  | 'UNAUTHORIZED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'BAD_GATEWAY'
  | 'SERVER_ERROR'
  | 'INVALID_RESPONSE'
  | 'REQUEST_FAILED'

export class QaApiError extends Error {
  readonly code: ApiErrorCode
  readonly status?: number
  readonly requiresLogin: boolean

  constructor(
    message: string,
    code: ApiErrorCode,
    options?: {
      status?: number
      requiresLogin?: boolean
    },
  ) {
    super(message)

    this.name = 'QaApiError'
    this.code = code
    this.status = options?.status
    this.requiresLogin = options?.requiresLogin ?? false
  }
}

/**
 * Checks technical server messages without displaying them to the user.
 * This prevents Google token information, emails, IDs, and payloads
 * from appearing inside the application's toast notifications.
 */
function containsExpiredTokenMessage(message: string): boolean {
  const normalized = message.toLowerCase()

  return (
    normalized.includes('token used too late') ||
    normalized.includes('token expired') ||
    normalized.includes('expired token') ||
    normalized.includes('id token has expired') ||
    normalized.includes('invalid token') ||
    normalized.includes('invalid id token') ||
    normalized.includes('jwt expired') ||
    normalized.includes('credential expired')
  )
}

function containsUnauthorizedMessage(message: string): boolean {
  const normalized = message.toLowerCase()

  return (
    normalized.includes('unauthorized') ||
    normalized.includes('not authorized') ||
    normalized.includes('authentication required') ||
    normalized.includes('invalid credential') ||
    normalized.includes('invalid authorization') ||
    normalized.includes('missing authorization')
  )
}

function containsTimeoutMessage(message: string): boolean {
  const normalized = message.toLowerCase()

  return (
    normalized.includes('timeout') ||
    normalized.includes('timed out') ||
    normalized.includes('deadline exceeded') ||
    normalized.includes('gateway timeout')
  )
}

function getFriendlyServerError(
  status: number,
  serverMessage = '',
): QaApiError {
  if (
    status === 401 ||
    containsExpiredTokenMessage(serverMessage)
  ) {
    return new QaApiError(
      'Your Google session expired. Please sign out, sign back in, and try again.',
      'SESSION_EXPIRED',
      {
        status,
        requiresLogin: true,
      },
    )
  }

  if (
    status === 403 ||
    containsUnauthorizedMessage(serverMessage)
  ) {
    return new QaApiError(
      'Your account is not authorized to complete this action. Please sign out and sign back in. If the problem continues, contact an administrator.',
      'UNAUTHORIZED',
      {
        status,
        requiresLogin: true,
      },
    )
  }

  if (
    status === 408 ||
    status === 504 ||
    containsTimeoutMessage(serverMessage)
  ) {
    return new QaApiError(
      'Google Sheets took too long to respond. Please wait a few seconds and try again.',
      'TIMEOUT',
      { status },
    )
  }

  if (status === 502 || status === 503) {
    return new QaApiError(
      'The connection to Google Sheets is temporarily unavailable. Please wait a few seconds and try again.',
      'BAD_GATEWAY',
      { status },
    )
  }

  if (status >= 500) {
    return new QaApiError(
      'The server could not complete the request. Please try again. If the problem continues, contact an administrator.',
      'SERVER_ERROR',
      { status },
    )
  }

  return new QaApiError(
    'The request could not be completed. Please check the information and try again.',
    'REQUEST_FAILED',
    { status },
  )
}

/**
 * Converts any error into a safe message that can be displayed in the UI.
 */
export function getFriendlyApiError(error: unknown): string {
  if (error instanceof QaApiError) {
    return error.message
  }

  if (error instanceof TypeError) {
    return 'The app could not reach the server. Check your internet connection and try again.'
  }

  if (error instanceof Error) {
    if (containsExpiredTokenMessage(error.message)) {
      return 'Your Google session expired. Please sign out, sign back in, and try again.'
    }

    if (containsUnauthorizedMessage(error.message)) {
      return 'Your session is no longer authorized. Please sign out and sign back in.'
    }

    if (containsTimeoutMessage(error.message)) {
      return 'Google Sheets took too long to respond. Please wait a few seconds and try again.'
    }
  }

  return 'Something went wrong. Please try again. If the problem continues, sign out and sign back in.'
}

/**
 * Returns true when the user must sign in again.
 */
export function requiresNewLogin(error: unknown): boolean {
  if (error instanceof QaApiError) {
    return error.requiresLogin
  }

  if (error instanceof Error) {
    return (
      containsExpiredTokenMessage(error.message) ||
      containsUnauthorizedMessage(error.message)
    )
  }

  return false
}

async function parseJsonResponse<T>(
  response: Response,
): Promise<T> {
  const text = await response.text()

  let data: T | null = null

  if (text.trim()) {
    try {
      data = JSON.parse(text) as T
    } catch {
      if (!response.ok) {
        throw getFriendlyServerError(response.status)
      }

      throw new QaApiError(
        'The server returned an unreadable response. Please try again.',
        'INVALID_RESPONSE',
        { status: response.status },
      )
    }
  }

  if (!response.ok) {
    const serverMessage =
      data &&
      typeof data === 'object' &&
      'message' in data &&
      typeof (data as { message?: unknown }).message === 'string'
        ? String((data as { message: string }).message)
        : ''

    throw getFriendlyServerError(
      response.status,
      serverMessage,
    )
  }

  if (data === null) {
    throw new QaApiError(
      'The server returned an empty response. Please try again.',
      'INVALID_RESPONSE',
      { status: response.status },
    )
  }

  return data
}

function authHeaders(session: AuthSession): HeadersInit {
  if (session.isDev) {
    return {
      'Content-Type': 'application/json',
      'x-dev-email': session.email,
      'x-dev-name': session.name,
    }
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.idToken}`,
  }
}

async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new QaApiError(
        'The request took too long and was stopped. Please try again.',
        'TIMEOUT',
      )
    }

    throw new QaApiError(
      'The app could not reach the server. Check your internet connection and try again.',
      'NETWORK_ERROR',
    )
  }
}

async function post<T>(
  session: AuthSession,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = await apiFetch(API_ENDPOINT, {
    method: 'POST',
    headers: authHeaders(session),
    body: JSON.stringify({
      action,
      ...payload,
    }),
  })

  return parseJsonResponse<T>(response)
}

export async function bootstrap(
  session: AuthSession,
): Promise<BootstrapResponse> {
  return post<BootstrapResponse>(session, 'bootstrap')
}

export async function fetchReviews(
  session: AuthSession,
  refresh = false,
): Promise<ReviewRecord[]> {
  const query = new URLSearchParams({
    action: 'reviews',
  })

  if (refresh) {
    query.set('refresh', '1')
  }

  const response = await apiFetch(
    `${API_ENDPOINT}?${query.toString()}`,
    {
      headers: authHeaders(session),
    },
  )

  const result = await parseJsonResponse<{
    success: boolean
    reviews?: ReviewRecord[]
    message?: string
  }>(response)

  if (!result.success) {
    if (
      result.message &&
      containsExpiredTokenMessage(result.message)
    ) {
      throw new QaApiError(
        'Your Google session expired. Please sign out, sign back in, and try again.',
        'SESSION_EXPIRED',
        {
          requiresLogin: true,
        },
      )
    }

    throw new QaApiError(
      'The reviews could not be loaded. Please try again.',
      'REQUEST_FAILED',
    )
  }

  return result.reviews || []
}

export async function saveReview(
  session: AuthSession,
  review: ReviewDraft,
): Promise<ApiResponse> {
  return post<ApiResponse>(
    session,
    'saveReview',
    { review },
  )
}

export async function saveUser(
  session: AuthSession,
  user: QaUser,
): Promise<ApiResponse<QaUser>> {
  return post<ApiResponse<QaUser>>(
    session,
    'upsertUser',
    { user },
  )
}

export async function setUserBlocked(
  session: AuthSession,
  email: string,
  blocked: boolean,
): Promise<ApiResponse> {
  return post<ApiResponse>(
    session,
    'setUserBlocked',
    {
      email,
      blocked,
    },
  )
}

export async function saveSettings(
  session: AuthSession,
  settings: AppSettings,
): Promise<ApiResponse<AppSettings>> {
  return post<ApiResponse<AppSettings>>(
    session,
    'saveSettings',
    { settings },
  )
}

export async function markReviewEmailSent(
  session: AuthSession,
  review: ReviewRecord,
  sent: boolean,
): Promise<ApiResponse<ReviewRecord>> {
  return post<ApiResponse<ReviewRecord>>(
    session,
    'markEmailSent',
    {
      rowNumber: review.rowNumber,
      reviewId: review.id,
      sent,
    },
  )
}

export async function exportReviewsWorkbook(
  session: AuthSession,
): Promise<{
  filename: string
  base64: string
}> {
  const response = await post<
    ApiResponse<{
      filename: string
      base64: string
    }>
  >(
    session,
    'exportReviews',
  )

  if (!response.success || !response.data) {
    throw new QaApiError(
      response.message
        ? getFriendlyApiError(new Error(response.message))
        : 'The review workbook could not be created. Please try again.',
      'REQUEST_FAILED',
    )
  }

  return response.data
}

export async function createQaBackup(
  session: AuthSession,
): Promise<ApiResponse> {
  return post<ApiResponse>(
    session,
    'createBackup',
  )
}

export async function restoreLatestQaBackup(
  session: AuthSession,
): Promise<ApiResponse> {
  return post<ApiResponse>(
    session,
    'restoreLatestBackup',
  )
}

export interface PresenceUser {
  email: string
  displayName: string
  role: string
  currentPage: string
  lastSeen: string
  sessionId: string
  online: boolean
}

interface PresenceListResponse {
  success: boolean
  users?: PresenceUser[]
  message?: string
}

export async function updatePresence(
  session: AuthSession,
  currentPage: string,
  sessionId: string,
): Promise<PresenceUser | null> {
  const response = await post<{
    success: boolean
    presence?: PresenceUser
    message?: string
  }>(
    session,
    'updatePresence',
    {
      currentPage,
      sessionId,
    },
  )

  if (!response.success) {
    throw new QaApiError(
      response.message || 'Live presence could not be updated.',
      'REQUEST_FAILED',
    )
  }

  return response.presence || null
}

export async function getPresence(
  session: AuthSession,
): Promise<PresenceUser[]> {
  const response = await post<PresenceListResponse>(
    session,
    'getPresence',
  )

  if (!response.success) {
    throw new QaApiError(
      response.message || 'Live users could not be loaded.',
      'REQUEST_FAILED',
    )
  }

  return response.users || []
}

export async function removePresence(
  session: AuthSession,
  sessionId: string,
): Promise<void> {
  const response = await post<{
    success: boolean
    message?: string
  }>(
    session,
    'removePresence',
    { sessionId },
  )

  if (!response.success) {
    throw new QaApiError(
      response.message || 'Live presence could not be removed.',
      'REQUEST_FAILED',
    )
  }
}

