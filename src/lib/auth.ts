import {
  EMAIL_PASSWORD_ADMIN_EMAILS,
  firebaseAuth,
  googleProvider,
  normalizeEmail,
} from './firebase'
import type { AuthSession } from '../types'

function sessionFromFirebaseUser(user: any): AuthSession {
  if (!user?.email) {
    throw new Error('Firebase did not return an email address.')
  }

  return {
    idToken: '',
    email: normalizeEmail(user.email),
    name: user.displayName || user.email,
    picture: user.photoURL || undefined,
    uid: user.uid,
  }
}

function assertApprovedEmailPasswordAdmin(email: string) {
  if (!EMAIL_PASSWORD_ADMIN_EMAILS.has(email)) {
    throw new Error(
      'Email/password setup is only enabled for approved HotelPlanner admin accounts.',
    )
  }
}

export async function signInWithGoogle(): Promise<AuthSession> {
  const result = await firebaseAuth.signInWithPopup(googleProvider)
  return sessionFromFirebaseUser(result.user)
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<AuthSession> {
  const cleanEmail = normalizeEmail(email)

  if (!cleanEmail) {
    throw new Error('Enter your email address.')
  }

  if (!password) {
    throw new Error('Enter your password.')
  }

  const result = await firebaseAuth.signInWithEmailAndPassword(
    cleanEmail,
    password,
  )

  return sessionFromFirebaseUser(result.user)
}

export async function createApprovedAdminAccount(
  email: string,
  password: string,
): Promise<AuthSession> {
  const cleanEmail = normalizeEmail(email)

  assertApprovedEmailPasswordAdmin(cleanEmail)

  if (password.length < 8) {
    throw new Error(
      'Create a password with at least 8 characters.',
    )
  }

  const result =
    await firebaseAuth.createUserWithEmailAndPassword(
      cleanEmail,
      password,
    )

  // NO EMAIL IS SENT.
  // Account is created and immediately logged in.
  return sessionFromFirebaseUser(result.user)
}

export async function sendAdminPasswordReset(
  email: string,
): Promise<string> {
  const cleanEmail = normalizeEmail(email)

  assertApprovedEmailPasswordAdmin(cleanEmail)

  await firebaseAuth.sendPasswordResetEmail(cleanEmail)

  return `Password reset email sent to ${cleanEmail}.`
}

export async function waitForFirebaseSession():
  Promise<AuthSession | null> {
  return new Promise((resolve) => {
    const unsubscribe =
      firebaseAuth.onAuthStateChanged((user: any) => {
        unsubscribe()

        resolve(
          user
            ? sessionFromFirebaseUser(user)
            : null,
        )
      })
  })
}

export async function signOutFirebase(): Promise<void> {
  await firebaseAuth.signOut()
}

export function saveSession(_session: AuthSession): void {}

export function loadSession(): AuthSession | null {
  return null
}

export function clearSession(): void {}