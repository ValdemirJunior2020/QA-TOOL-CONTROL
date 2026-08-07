import { firebaseAuth, googleProvider, normalizeEmail } from './firebase'
import type { AuthSession } from '../types'

function sessionFromFirebaseUser(user: any): AuthSession {
  if (!user?.email) throw new Error('Google did not return an email address.')
  return {
    idToken: '',
    email: normalizeEmail(user.email),
    name: user.displayName || user.email,
    picture: user.photoURL || undefined,
    uid: user.uid,
  }
}

export async function signInWithGoogle(): Promise<AuthSession> {
  const result = await firebaseAuth.signInWithPopup(googleProvider)
  return sessionFromFirebaseUser(result.user)
}

export async function waitForFirebaseSession(): Promise<AuthSession | null> {
  return new Promise((resolve) => {
    const unsubscribe = firebaseAuth.onAuthStateChanged((user: any) => {
      unsubscribe()
      resolve(user ? sessionFromFirebaseUser(user) : null)
    })
  })
}

export async function signOutFirebase(): Promise<void> {
  await firebaseAuth.signOut()
}

// Kept as no-ops so older code paths do not create fragile custom sessions.
export function saveSession(_session: AuthSession): void {}
export function loadSession(): AuthSession | null { return null }
export function clearSession(): void {}
