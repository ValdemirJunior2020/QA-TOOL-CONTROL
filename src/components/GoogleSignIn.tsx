import { useEffect, useRef, useState } from 'react'
import { createDevSession, sessionFromGoogleCredential } from '../lib/auth'
import type { AuthSession } from '../types'

interface GoogleSignInProps {
  onSuccess: (session: AuthSession) => void
}

export function GoogleSignIn({ onSuccess }: GoogleSignInProps) {
  const buttonRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState('')
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()
  const devEnabled = String(import.meta.env.VITE_ENABLE_DEV_LOGIN || '').toLowerCase() === 'true'

  useEffect(() => {
    if (!clientId) return

    let attempts = 0
    const timer = window.setInterval(() => {
      attempts += 1
      if (!window.google || !buttonRef.current) {
        if (attempts > 50) {
          window.clearInterval(timer)
          setError('Google Sign-In did not load. Refresh the page and try again.')
        }
        return
      }

      window.clearInterval(timer)
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          try {
            const session = sessionFromGoogleCredential(response.credential)
            onSuccess(session)
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Google Sign-In failed.')
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      })

      buttonRef.current.innerHTML = ''
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        width: 320,
      })
    }, 100)

    return () => window.clearInterval(timer)
  }, [clientId, onSuccess])

  const devLogin = (email: string, name: string) => {
    setError('')
    onSuccess(createDevSession(email, name))
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark">QA</div>
        <p className="eyebrow">HotelPlanner Quality Team</p>
        <h1>QA Control Center</h1>
        <p className="login-copy">
          Review calls, protect scoring rules, manage evaluator access, and save directly to the existing Google Sheet.
        </p>

        {clientId ? (
          <div ref={buttonRef} className="google-button-slot" aria-label="Sign in with Google" />
        ) : (
          <div className="setup-warning">
            Add <code>VITE_GOOGLE_CLIENT_ID</code> to the environment before production deployment.
          </div>
        )}

        {devEnabled && (
          <div className="dev-login-panel">
            <p><strong>Local test login</strong></p>
            <div className="dev-login-buttons">
              <button type="button" onClick={() => devLogin('infojr.83@gmail.com', 'Junior')}>Test as Junior</button>
              <button type="button" onClick={() => devLogin('barbara.kalchik8reserve@gmail.com', 'Barbara')}>Test as Barbara</button>
              <button type="button" onClick={() => devLogin('shoultskelly22@gmail.com', 'Kelly')}>Test as Kelly</button>
            </div>
            <small>This works only with <code>netlify dev</code> and is rejected in production.</small>
          </div>
        )}

        {error && <div className="error-banner">{error}</div>}
      </section>
    </main>
  )
}
