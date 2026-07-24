import type { AuthSession } from '../types'

const SESSION_KEY = 'qa-control-center-session'

interface JwtPayload {
  email?: string
  name?: string
  picture?: string
  exp?: number
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return decodeURIComponent(
    Array.from(atob(padded))
      .map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''),
  )
}

export function sessionFromGoogleCredential(idToken: string): AuthSession {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('Google returned an invalid sign-in token.')

  const payload = JSON.parse(decodeBase64Url(parts[1])) as JwtPayload
  if (!payload.email) throw new Error('Google did not return an email address.')

  return {
    idToken,
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email,
    picture: payload.picture,
  }
}

export function saveSession(session: AuthSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function loadSession(): AuthSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY)
  if (!raw) return null

  try {
    const session = JSON.parse(raw) as AuthSession
    if (!session.email) return null
    return session
  } catch {
    return null
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY)
}

export function createDevSession(email: string, name: string): AuthSession {
  return {
    idToken: '',
    email: email.trim().toLowerCase(),
    name: name.trim() || email,
    isDev: true,
  }
}
