import type { QaUser, ReviewRecord } from '../types'

interface DashboardPageProps {
  user: QaUser
  reviews: ReviewRecord[]
  users: QaUser[]
  onNewReview: () => void
  onRefresh: () => void
  refreshing: boolean
}

function average(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function DashboardPage({ user, reviews, users, onNewReview, onRefresh, refreshing }: DashboardPageProps) {
  const passed = reviews.filter((review) => review.result === 'PASS').length
  const failed = reviews.length - passed
  const avgScore = average(reviews.map((review) => review.finalScore))
  const guidedUsers = users.filter((item) => item.guidedMode && item.active).length
  const recent = [...reviews]
    .sort((a, b) => String(b.savedTimestamp).localeCompare(String(a.savedTimestamp)))
    .slice(0, 8)

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Welcome back, {user.displayName}</p>
          <h1>Keep every QA review accurate and under control.</h1>
          <p>
            The form follows the same scoring flow as the Google Sheet, while permissions and protected fields are controlled here.
          </p>
        </div>
        <div className="hero-actions">
          {user.permissions.canSubmitReviews && (
            <button type="button" className="primary-button" onClick={onNewReview}>Start a QA Review</button>
          )}
          <button type="button" className="secondary-button" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh Sheet Data'}
          </button>
        </div>
      </section>

      <section className="stat-grid">
        <article className="stat-card">
          <span>Total Reviews</span>
          <strong>{reviews.length}</strong>
          <small>Loaded from Agents Reviewed</small>
        </article>
        <article className="stat-card success">
          <span>Pass Rate</span>
          <strong>{reviews.length ? `${Math.round((passed / reviews.length) * 100)}%` : '0%'}</strong>
          <small>{passed} passed reviews</small>
        </article>
        <article className="stat-card danger">
          <span>Failed Reviews</span>
          <strong>{failed}</strong>
          <small>Needs coaching or correction</small>
        </article>
        <article className="stat-card">
          <span>Average Score</span>
          <strong>{avgScore.toFixed(1)}</strong>
          <small>Across loaded reviews</small>
        </article>
        {user.role === 'admin' && (
          <article className="stat-card guided-card">
            <span>Guided Evaluators</span>
            <strong>{guidedUsers}</strong>
            <small>Extra checks enabled</small>
          </article>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Latest Activity</p>
            <h2>Recent Reviews</h2>
          </div>
          <span className="muted">Showing {recent.length} most recent</span>
        </div>

        {recent.length === 0 ? (
          <div className="empty-state">No reviews were returned by the Google Sheet API.</div>
        ) : (
          <div className="review-list">
            {recent.map((review) => (
              <article key={review.id} className="review-list-row">
                <div>
                  <strong>{review.agentName}</strong>
                  <span>{review.callCenter} · {review.qaType} · Reviewed by {review.evaluator}</span>
                </div>
                <div className="review-score">
                  <strong>{review.finalScore}</strong>
                  <span className={`result-pill ${review.result.toLowerCase()}`}>{review.result}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
