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

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  let data: T

  try {
    data = JSON.parse(text) as T
  } catch {
    throw new Error(`The server returned an unreadable response (${response.status}).`)
  }

  if (!response.ok) {
    const message = (data as { message?: string }).message || `Request failed (${response.status}).`
    throw new Error(message)
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

async function post<T>(session: AuthSession, action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: authHeaders(session),
    body: JSON.stringify({ action, ...payload }),
  })

  return parseJsonResponse<T>(response)
}

export async function bootstrap(session: AuthSession): Promise<BootstrapResponse> {
  return post<BootstrapResponse>(session, 'bootstrap')
}

export async function fetchReviews(session: AuthSession, refresh = false): Promise<ReviewRecord[]> {
  const response = await fetch(`${API_ENDPOINT}?action=reviews${refresh ? '&refresh=1' : ''}`, {
    headers: authHeaders(session),
  })
  const result = await parseJsonResponse<{ success: boolean; reviews?: ReviewRecord[]; message?: string }>(response)
  if (!result.success) throw new Error(result.message || 'Reviews could not be loaded.')
  return result.reviews || []
}

export async function saveReview(session: AuthSession, review: ReviewDraft): Promise<ApiResponse> {
  return post<ApiResponse>(session, 'saveReview', { review })
}

export async function saveUser(session: AuthSession, user: QaUser): Promise<ApiResponse<QaUser>> {
  return post<ApiResponse<QaUser>>(session, 'upsertUser', { user })
}

export async function setUserBlocked(session: AuthSession, email: string, blocked: boolean): Promise<ApiResponse> {
  return post<ApiResponse>(session, 'setUserBlocked', { email, blocked })
}

export async function saveSettings(session: AuthSession, settings: AppSettings): Promise<ApiResponse<AppSettings>> {
  return post<ApiResponse<AppSettings>>(session, 'saveSettings', { settings })
}

export async function markReviewEmailSent(
  session: AuthSession,
  review: ReviewRecord,
  sent: boolean,
): Promise<ApiResponse<ReviewRecord>> {
  return post<ApiResponse<ReviewRecord>>(session, 'markEmailSent', {
    rowNumber: review.rowNumber,
    reviewId: review.id,
    sent,
  })
}

export async function exportReviewsWorkbook(session: AuthSession): Promise<{ filename: string; base64: string }> {
  const response = await post<ApiResponse<{ filename: string; base64: string }>>(session, 'exportReviews')
  if (!response.success || !response.data) {
    throw new Error(response.message || 'The review workbook could not be created.')
  }
  return response.data
}

export async function createQaBackup(session: AuthSession): Promise<ApiResponse> {
  return post<ApiResponse>(session, 'createBackup')
}

export async function restoreLatestQaBackup(session: AuthSession): Promise<ApiResponse> {
  return post<ApiResponse>(session, 'restoreLatestBackup')
}
