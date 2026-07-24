import type { ReactNode } from 'react'
import type { QaUser } from '../types'

export type AppPage = 'dashboard' | 'review' | 'history' | 'admin'

interface ShellProps {
  user: QaUser
  activePage: AppPage
  onNavigate: (page: AppPage) => void
  onLogout: () => void
  children: ReactNode
}

export function Shell({ user, activePage, onNavigate, onLogout, children }: ShellProps) {
  const items: Array<{ id: AppPage; label: string; adminOnly?: boolean }> = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'review', label: 'New Review' },
    { id: 'history', label: 'Review History' },
    { id: 'admin', label: 'Admin Control', adminOnly: true },
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark small">QA</div>
          <div>
            <strong>QA Control Center</strong>
            <span>HotelPlanner</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {items
            .filter((item) => !item.adminOnly || user.role === 'admin')
            .map((item) => (
              <button
                key={item.id}
                type="button"
                className={activePage === item.id ? 'active' : ''}
                onClick={() => onNavigate(item.id)}
              >
                {item.label}
              </button>
            ))}
        </nav>

        <div className="sidebar-user">
          <div className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</div>
          <div className="sidebar-user-copy">
            <strong>{user.displayName}</strong>
            <span>{user.role === 'admin' ? 'Administrator' : user.guidedMode ? 'Evaluator · Guided Mode' : 'Evaluator'}</span>
          </div>
          <button type="button" className="text-button" onClick={onLogout}>Sign out</button>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div>
            <p className="eyebrow">Quality Assurance</p>
            <h2>{items.find((item) => item.id === activePage)?.label}</h2>
          </div>
          <div className="topbar-badges">
            {user.guidedMode && <span className="badge guided">Guided Mode</span>}
            <span className={`badge ${user.active ? 'active' : 'blocked'}`}>{user.active ? 'Active' : 'Blocked'}</span>
          </div>
        </header>
        <main className="content-area">{children}</main>
      </div>
    </div>
  )
}
