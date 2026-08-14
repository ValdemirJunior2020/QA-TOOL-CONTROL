import { FormEvent, useState } from 'react'
import {
  createApprovedAdminAccount,
  sendAdminPasswordReset,
  signInWithEmail,
  signInWithGoogle,
} from '../lib/auth'
import type { AuthSession } from '../types'

interface GoogleSignInProps {
  onSuccess: (session: AuthSession) => void
}

type LoginMode = 'signin' | 'setup'

export function GoogleSignIn({ onSuccess }: GoogleSignInProps) {
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [mode, setMode] = useState<LoginMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const clearMessages = () => {
    setError('')
    setNotice('')
  }

  const loginGoogle = async () => {
    if (signingIn) return

    clearMessages()
    setSigningIn(true)

    try {
      onSuccess(await signInWithGoogle())
    } catch (caught: any) {
      const code = String(caught?.code || '')

      if (code.includes('popup-closed')) {
        setError('Google sign-in was closed before it finished.')
      } else if (code.includes('unauthorized-domain')) {
        setError(
          'This Netlify domain must be added to Firebase Authentication → Authorized domains.',
        )
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Google sign-in failed.',
        )
      }
    } finally {
      setSigningIn(false)
    }
  }

  const loginEmail = async (event: FormEvent) => {
    event.preventDefault()

    if (signingIn) return

    clearMessages()
    setSigningIn(true)

    try {
      onSuccess(await signInWithEmail(email, password))
    } catch (caught: any) {
      const code = String(caught?.code || '')

      if (
        code.includes('invalid-credential') ||
        code.includes('wrong-password') ||
        code.includes('user-not-found')
      ) {
        setError('Email or password is incorrect.')
      } else if (code.includes('too-many-requests')) {
        setError('Too many login attempts. Please try again later.')
      } else if (code.includes('user-disabled')) {
        setError('This Firebase login has been disabled.')
      } else if (code.includes('operation-not-allowed')) {
        setError(
          'Email/Password sign-in still needs to be enabled in Firebase Authentication.',
        )
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Email sign-in failed.',
        )
      }
    } finally {
      setSigningIn(false)
    }
  }

  const setupAccount = async (event: FormEvent) => {
    event.preventDefault()

    if (signingIn) return

    clearMessages()

    if (password !== confirmPassword) {
      setError('The two passwords do not match.')
      return
    }

    if (password.length < 8) {
      setError('Use a password with at least 8 characters.')
      return
    }

    setSigningIn(true)

    try {
      const session = await createApprovedAdminAccount(
        email,
        password,
      )

      // Account is created and the user is immediately signed in.
      // No setup or verification email is sent.
      onSuccess(session)
    } catch (caught: any) {
      const code = String(caught?.code || '')

      if (code.includes('email-already-in-use')) {
        setError(
          'That Firebase account already exists. Use Sign in or Forgot password.',
        )
      } else if (code.includes('weak-password')) {
        setError(
          'Use a stronger password with at least 8 characters.',
        )
      } else if (code.includes('invalid-email')) {
        setError('Enter a valid email address.')
      } else if (code.includes('operation-not-allowed')) {
        setError(
          'Email/Password sign-in still needs to be enabled in Firebase Authentication.',
        )
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : 'The account could not be created.',
        )
      }
    } finally {
      setSigningIn(false)
    }
  }

  const resetPassword = async () => {
    if (signingIn) return

    clearMessages()
    setSigningIn(true)

    try {
      setNotice(await sendAdminPasswordReset(email))
    } catch (caught: any) {
      const code = String(caught?.code || '')

      if (code.includes('user-not-found')) {
        setError(
          'No Firebase account exists for that email yet. Use First-time setup.',
        )
      } else if (code.includes('operation-not-allowed')) {
        setError(
          'Email/Password sign-in still needs to be enabled in Firebase Authentication.',
        )
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Password reset could not be sent.',
        )
      }
    } finally {
      setSigningIn(false)
    }
  }

  const switchMode = (nextMode: LoginMode) => {
    clearMessages()
    setMode(nextMode)
    setPassword('')
    setConfirmPassword('')
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark">QA</div>

        <p className="eyebrow">
          HotelPlanner Quality Team
        </p>

        <h1>QA Control Center</h1>

        <p className="login-copy">
          Use Google, or sign in with an approved HotelPlanner
          admin email and password.
        </p>

        <button
          type="button"
          className="secondary-button google-login-button"
          onClick={() => void loginGoogle()}
          disabled={signingIn}
        >
          Continue with Google
        </button>

        <div className="login-divider">
          <span>OR</span>
        </div>

        <form
          className="email-login-form"
          onSubmit={
            mode === 'signin'
              ? loginEmail
              : setupAccount
          }
        >
          <div
            className="login-mode-switch"
            role="group"
            aria-label="Email login mode"
          >
            <button
              type="button"
              className={
                mode === 'signin'
                  ? 'active'
                  : ''
              }
              onClick={() => switchMode('signin')}
              disabled={signingIn}
            >
              Sign in
            </button>

            <button
              type="button"
              className={
                mode === 'setup'
                  ? 'active'
                  : ''
              }
              onClick={() => switchMode('setup')}
              disabled={signingIn}
            >
              First-time setup
            </button>
          </div>

          <label className="field login-field">
            <span>HotelPlanner email</span>

            <input
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder="name@hotelplanner.com"
              autoComplete="email"
              disabled={signingIn}
              required
            />
          </label>

          <label className="field login-field">
            <span>
              {mode === 'setup'
                ? 'Create password'
                : 'Password'}
            </span>

            <input
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              placeholder={
                mode === 'setup'
                  ? 'At least 8 characters'
                  : 'Password'
              }
              autoComplete={
                mode === 'setup'
                  ? 'new-password'
                  : 'current-password'
              }
              disabled={signingIn}
              minLength={
                mode === 'setup'
                  ? 8
                  : undefined
              }
              required
            />
          </label>

          {mode === 'setup' && (
            <label className="field login-field">
              <span>Confirm password</span>

              <input
                type="password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(
                    event.target.value,
                  )
                }
                placeholder="Type the password again"
                autoComplete="new-password"
                disabled={signingIn}
                minLength={8}
                required
              />
            </label>
          )}

          <button
            type="submit"
            className="primary-button email-login-button"
            disabled={signingIn}
          >
            {signingIn
              ? 'Please wait…'
              : mode === 'setup'
                ? 'Create Admin Login'
                : 'Sign in with Email'}
          </button>

          {mode === 'signin' && (
            <button
              type="button"
              className="text-button login-reset-button"
              onClick={() =>
                void resetPassword()
              }
              disabled={
                signingIn ||
                !email.trim()
              }
            >
              Forgot password?
            </button>
          )}

          {mode === 'setup' && (
            <p className="login-help">
              First-time setup is available only for
              April Grantham, Jim Fryer, and Karen Caldas.
              Enter your approved HotelPlanner email and
              create your own password. You'll be signed in
              immediately. No setup email will be sent.
            </p>
          )}
        </form>

        {notice && (
          <div className="success-banner login-message">
            {notice}
          </div>
        )}

        {error && (
          <div className="error-banner login-message">
            {error}
          </div>
        )}
      </section>
    </main>
  )
}