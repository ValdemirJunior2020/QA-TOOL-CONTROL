import { useState } from 'react'
import { signInWithGoogle } from '../lib/auth'
import type { AuthSession } from '../types'

interface GoogleSignInProps {
  onSuccess: (session: AuthSession) => void
}

export function GoogleSignIn({ onSuccess }: GoogleSignInProps) {
  const [error, setError] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  const login = async () => {
    if (signingIn) return
    setError('')
    setSigningIn(true)
    try {
      onSuccess(await signInWithGoogle())
    } catch (caught: any) {
      const code = String(caught?.code || '')
      if (code.includes('popup-closed')) setError('Google sign-in was closed before it finished.')
      else if (code.includes('unauthorized-domain')) setError('This Netlify domain must be added to Firebase Authentication → Authorized domains.')
      else setError(caught instanceof Error ? caught.message : 'Google sign-in failed.')
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark">QA</div>
        <p className="eyebrow">HotelPlanner Quality Team</p>
        <h1>QA Control Center</h1>
        <p className="login-copy">Sign in with any Google account. Evaluator and admin permissions are controlled inside the QA app.</p>
        <button type="button" className="primary-button google-login-button" onClick={() => void login()} disabled={signingIn}>
          {signingIn ? 'Signing in…' : 'Continue with Google'}
        </button>
        {error && <div className="error-banner">{error}</div>}
      </section>
    </main>
  )
}
