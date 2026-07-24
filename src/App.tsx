import { useCallback, useEffect, useState } from 'react'
import { GoogleSignIn } from './components/GoogleSignIn'
import { Shell, type AppPage } from './components/Shell'
import { DEFAULT_SETTINGS } from './data/defaults'
import { bootstrap, fetchReviews, saveReview, saveSettings, saveUser, setUserBlocked } from './lib/api'
import { clearSession, loadSession, saveSession } from './lib/auth'
import { AdminPage } from './pages/AdminPage'
import { DashboardPage } from './pages/DashboardPage'
import { ReviewPage } from './pages/ReviewPage'
import { ReviewsPage } from './pages/ReviewsPage'
import type { AppSettings, AuthSession, QaUser, ReviewDraft, ReviewRecord } from './types'

interface ToastState {
  type: 'success' | 'error' | 'info'
  message: string
}

const LOADING_MESSAGES = [
  'Finding the agent who said “please hold” and disappeared…',
  'Checking whether the Call ID belongs to this exact call…',
  'Counting how many times the guest repeated the confirmation number…',
  'Making sure nobody promised a refund without checking the matrix…',
  'Looking for the agent who forgot to document the notes…',
  'Checking whether the guest was placed on hold without an update…',
  'Verifying whether the agent remembered the closing recap…',
  'Searching for mysterious dead air in the call…',
  'Making sure “I understand” was followed by an actual solution…',
  'Checking whether the correct hotel was booked this time…',
  'Reviewing whether the guest’s email was verified correctly…',
  'Investigating why the call lasted 37 minutes…',
  'Checking whether the agent followed the process or invented one…',
  'Preparing the QA score while protecting everyone’s feelings…',
  'Connecting to Google Sheets before another call needs reviewing…',
]

function LoadingScreen() {
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setMessageIndex((currentIndex) => (currentIndex + 1) % LOADING_MESSAGES.length)
    }, 3000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  return (
    <main className="loading-screen">
      <div className="loading-content">
        <div className="spinner" aria-hidden="true" />

        <h1>Loading QA Control Center…</h1>

        <p
          key={messageIndex}
          className="loading-funny-message"
          aria-live="polite"
        >
          {LOADING_MESSAGES[messageIndex]}
        </p>

        <span className="loading-message-counter">
          QA check {messageIndex + 1} of {LOADING_MESSAGES.length}
        </span>
      </div>
    </main>
  )
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(() => loadSession())
  const [currentUser, setCurrentUser] = useState<QaUser | null>(null)
  const [users, setUsers] = useState<QaUser[]>([])
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [reviews, setReviews] = useState<ReviewRecord[]>([])
  const [activePage, setActivePage] = useState<AppPage>('dashboard')
  const [loading, setLoading] = useState(Boolean(session))
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback((message: string, type: ToastState['type'] = 'info') => {
    setToast({ message, type })
    window.setTimeout(() => setToast(null), 5000)
  }, [])

  const loadApp = useCallback(async (activeSession: AuthSession) => {
    setLoading(true)
    setAuthError('')
    try {
      const [boot, reviewRows] = await Promise.all([
        bootstrap(activeSession),
        fetchReviews(activeSession),
      ])
      if (!boot.success || !boot.user) throw new Error(boot.message || 'Your account could not be loaded.')
      if (!boot.user.active) throw new Error('Your QA app account is blocked. Contact Junior or Barbara.')

      setCurrentUser(boot.user)
      setUsers(boot.users || [boot.user])
      setSettings(boot.settings || DEFAULT_SETTINGS)
      setReviews(reviewRows)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The app could not be loaded.'
      setAuthError(message)
      setCurrentUser(null)
      clearSession()
      setSession(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session) void loadApp(session)
  }, [loadApp, session])

  const handleLogin = (nextSession: AuthSession) => {
    saveSession(nextSession)
    setSession(nextSession)
  }

  const handleLogout = () => {
    clearSession()
    if (window.google) window.google.accounts.id.disableAutoSelect()
    setSession(null)
    setCurrentUser(null)
    setUsers([])
    setReviews([])
    setActivePage('dashboard')
  }

  const refreshReviews = async (force = true) => {
    if (!session) return
    setRefreshing(true)
    try {
      setReviews(await fetchReviews(session, force))
      showToast('Review data refreshed from the Google Sheet.', 'success')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Refresh failed.', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const handleSaveReview = async (review: ReviewDraft) => {
    if (!session) return
    setBusy(true)
    try {
      const response = await saveReview(session, review)
      if (!response.success) throw new Error(response.message || 'The review was not saved.')
      showToast(response.message || 'Review saved to Agents Reviewed.', 'success')
      await refreshReviews(true)
      setActivePage('dashboard')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The review was not saved.'
      showToast(message, 'error')
      throw caught
    } finally {
      setBusy(false)
    }
  }

  const handleSaveUser = async (user: QaUser) => {
    if (!session) return
    setBusy(true)
    try {
      const response = await saveUser(session, user)
      if (!response.success) throw new Error(response.message || 'The person was not saved.')
      const saved = response.user || user
      setUsers((current) => {
        const exists = current.some((item) => item.email.toLowerCase() === saved.email.toLowerCase())
        if (!exists) return [...current, saved]
        return current.map((item) => item.email.toLowerCase() === saved.email.toLowerCase() ? saved : item)
      })
      showToast(response.message || `${saved.displayName} was saved.`, 'success')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'The person was not saved.', 'error')
      throw caught
    } finally {
      setBusy(false)
    }
  }

  const handleSetBlocked = async (email: string, blocked: boolean) => {
    if (!session) return
    const action = blocked ? 'block' : 'unblock'
    if (!window.confirm(`Are you sure you want to ${action} this account?`)) return
    setBusy(true)
    try {
      const response = await setUserBlocked(session, email, blocked)
      if (!response.success) throw new Error(response.message || `The account could not be ${blocked ? 'blocked' : 'unblocked'}.`)
      setUsers((current) => current.map((item) => item.email.toLowerCase() === email.toLowerCase() ? { ...item, active: !blocked } : item))
      showToast(response.message || `Account ${blocked ? 'blocked' : 'unblocked'}.`, 'success')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'The account status was not changed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleSaveSettings = async (nextSettings: AppSettings) => {
    if (!session) return
    setBusy(true)
    try {
      const response = await saveSettings(session, nextSettings)
      if (!response.success) throw new Error(response.message || 'Settings were not saved.')
      setSettings(response.settings || nextSettings)
      showToast(response.message || 'QA settings were saved.', 'success')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Settings were not saved.', 'error')
      throw caught
    } finally {
      setBusy(false)
    }
  }

  if (session && loading) {
    return <LoadingScreen />
  }

  if (!session || !currentUser) {
    return (
      <>
        <GoogleSignIn onSuccess={handleLogin} />
        {authError && <div className="floating-auth-error">{authError}</div>}
      </>
    )
  }

  const activeEvaluators = users.filter((user) => user.active && user.role !== 'viewer')

  return (
    <Shell user={currentUser} activePage={activePage} onNavigate={setActivePage} onLogout={handleLogout}>
      {activePage === 'dashboard' && (
        <DashboardPage
          user={currentUser}
          users={users}
          reviews={reviews}
          onNewReview={() => setActivePage('review')}
          onRefresh={() => void refreshReviews(true)}
          refreshing={refreshing}
        />
      )}

      {activePage === 'review' && (
        <ReviewPage
          user={currentUser}
          settings={settings}
          evaluators={activeEvaluators}
          onSave={handleSaveReview}
          saving={busy}
        />
      )}

      {activePage === 'history' && (
        <ReviewsPage
          user={currentUser}
          reviews={reviews}
          onRefresh={() => void refreshReviews(true)}
          refreshing={refreshing}
        />
      )}

      {activePage === 'admin' && currentUser.role === 'admin' && (
        <AdminPage
          currentUser={currentUser}
          users={users}
          settings={settings}
          onSaveUser={handleSaveUser}
          onSetBlocked={handleSetBlocked}
          onSaveSettings={handleSaveSettings}
          busy={busy}
        />
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </Shell>
  )
}