import { Fragment, useMemo, useState } from 'react'
import type { QaUser, ReviewRecord } from '../types'

interface ReviewsPageProps {
  user: QaUser
  reviews: ReviewRecord[]
  onRefresh: () => void
  refreshing: boolean
}

function formatDate(value: string): string {
  if (!value) return '—'
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

export function ReviewsPage({ user, reviews, onRefresh, refreshing }: ReviewsPageProps) {
  const [search, setSearch] = useState('')
  const [result, setResult] = useState('ALL')
  const [center, setCenter] = useState('ALL')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const centers = useMemo(
    () => Array.from(new Set(reviews.map((review) => review.callCenter).filter(Boolean))).sort(),
    [reviews],
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return reviews
      .filter((review) => user.role === 'admin' || user.permissions.canViewHistory || review.evaluator === user.displayName)
      .filter((review) => result === 'ALL' || review.result === result)
      .filter((review) => center === 'ALL' || review.callCenter === center)
      .filter((review) => {
        if (!query) return true
        return [review.agentName, review.callCenter, review.callId, review.itineraryNumber, review.evaluator]
          .join(' ')
          .toLowerCase()
          .includes(query)
      })
      .sort((a, b) => String(b.savedTimestamp).localeCompare(String(a.savedTimestamp)))
  }, [reviews, search, result, center, user])

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-heading wrap-heading">
          <div>
            <p className="eyebrow">Agents Reviewed</p>
            <h1>Review History</h1>
            <p className="muted">Search the same saved reviews used by the dashboard.</p>
          </div>
          <button type="button" className="secondary-button" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh from Sheet'}
          </button>
        </div>

        <div className="filter-grid">
          <label className="field">
            <span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Agent, Call ID, evaluator…" />
          </label>
          <label className="field">
            <span>Result</span>
            <select value={result} onChange={(event) => setResult(event.target.value)}>
              <option value="ALL">All results</option>
              <option value="PASS">PASS</option>
              <option value="FAIL">FAIL</option>
            </select>
          </label>
          <label className="field">
            <span>Call Center</span>
            <select value={center} onChange={(event) => setCenter(event.target.value)}>
              <option value="ALL">All call centers</option>
              {centers.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>

        <div className="table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Agent</th>
                <th>Center</th>
                <th>Evaluator</th>
                <th>QA Type</th>
                <th>Score</th>
                <th>Result</th>
                <th>Call ID</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((review) => (
                <Fragment key={review.id}>
                  <tr>
                    <td>{formatDate(review.reviewDate || review.savedTimestamp)}</td>
                    <td><strong>{review.agentName}</strong></td>
                    <td>{review.callCenter}</td>
                    <td>{review.evaluator}</td>
                    <td>{review.qaType}</td>
                    <td><strong>{review.finalScore}</strong> / {review.kpiTarget}</td>
                    <td><span className={`result-pill ${review.result.toLowerCase()}`}>{review.result}</span></td>
                    <td><code>{review.callId || '—'}</code></td>
                    <td>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setExpandedId(expandedId === review.id ? null : review.id)}
                      >
                        {expandedId === review.id ? 'Hide' : 'Details'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === review.id && (
                    <tr key={`${review.id}-details`} className="detail-row">
                      <td colSpan={9}>
                        <div className="review-detail-grid">
                          <div><span>Agent Start Date</span><strong>{formatDate(review.agentStartDate)}</strong></div>
                          <div><span>Confirmation / Itinerary</span><strong>{review.itineraryNumber || '—'}</strong></div>
                          <div><span>Markdowns</span><strong>{review.markdowns}</strong></div>
                          <div><span>Email Sent</span><strong>{review.emailSent ? 'Yes' : 'No'}</strong></div>
                        </div>
                        <div className="issue-box">
                          <span>Issues and custom notes</span>
                          <p>{review.issueSummary || 'No markdown or partial issue summary was returned.'}</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && <div className="empty-state">No reviews match the selected filters.</div>}
      </section>
    </div>
  )
}
