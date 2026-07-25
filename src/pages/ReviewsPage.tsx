import { Fragment, useMemo, useState } from 'react'
import type { QaUser, ReviewRecord } from '../types'

interface ReviewsPageProps {
  user: QaUser
  reviews: ReviewRecord[]
  onRefresh: () => void
  refreshing: boolean
  onMarkEmailSent: (review: ReviewRecord, sent: boolean) => Promise<void>
  onDownloadWorkbook: () => Promise<void>
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

export function ReviewsPage({ user, reviews, onRefresh, refreshing, onMarkEmailSent, onDownloadWorkbook }: ReviewsPageProps) {
  const [search, setSearch] = useState('')
  const [result, setResult] = useState('ALL')
  const [center, setCenter] = useState('ALL')
  const [qaType, setQaType] = useState('ALL')
  const [evaluator, setEvaluator] = useState('ALL')
  const [emailStatus, setEmailStatus] = useState('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingRow, setUpdatingRow] = useState<number | null>(null)

  const centers = useMemo(() => Array.from(new Set(reviews.map((r) => r.callCenter).filter(Boolean))).sort(), [reviews])
  const evaluators = useMemo(() => Array.from(new Set(reviews.map((r) => r.evaluator).filter(Boolean))).sort(), [reviews])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return reviews
      .filter((review) => user.role === 'admin' || user.permissions.canViewHistory || review.evaluator === user.displayName)
      .filter((review) => result === 'ALL' || review.result === result)
      .filter((review) => center === 'ALL' || review.callCenter === center)
      .filter((review) => qaType === 'ALL' || review.qaType === qaType)
      .filter((review) => evaluator === 'ALL' || review.evaluator === evaluator)
      .filter((review) => emailStatus === 'ALL' || (emailStatus === 'SENT' ? review.emailSent : !review.emailSent))
      .filter((review) => !dateFrom || String(review.reviewDate || review.savedTimestamp).slice(0, 10) >= dateFrom)
      .filter((review) => !dateTo || String(review.reviewDate || review.savedTimestamp).slice(0, 10) <= dateTo)
      .filter((review) => !query || [review.agentName, review.callCenter, review.callId, review.itineraryNumber, review.evaluator].join(' ').toLowerCase().includes(query))
      .sort((a, b) => String(b.savedTimestamp).localeCompare(String(a.savedTimestamp)))
  }, [reviews, search, result, center, qaType, evaluator, emailStatus, dateFrom, dateTo, user])

  const downloadFilteredCsv = () => {
    const headers = ['Review Date', 'Agent', 'Call Center', 'Evaluator', 'QA Type', 'Score', 'KPI', 'Result', 'Call ID', 'Itinerary', 'Email Sent', 'Email Sent At', 'Email Sent By', 'Issues']
    const rows = filtered.map((r) => [r.reviewDate, r.agentName, r.callCenter, r.evaluator, r.qaType, r.finalScore, r.kpiTarget, r.result, r.callId, r.itineraryNumber, r.emailSent ? 'Yes' : 'No', r.emailSentAt || '', r.emailSentBy || '', r.issueSummary])
    const blob = new Blob([[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `qa-reviews-filtered-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const toggleEmail = async (review: ReviewRecord) => {
    setUpdatingRow(review.rowNumber)
    try { await onMarkEmailSent(review, !review.emailSent) } finally { setUpdatingRow(null) }
  }

  return <div className="page-stack"><section className="panel">
    <div className="panel-heading wrap-heading"><div><p className="eyebrow">Agents Reviewed</p><h1>Review History</h1><p className="muted">Filter reviews, track which QA emails were sent, and export reports.</p></div><div className="history-actions"><button className="secondary-button" onClick={downloadFilteredCsv}>Download Filtered CSV</button><button className="secondary-button" onClick={() => void onDownloadWorkbook()}>Download Agents Reviewed (.xlsx)</button><button className="secondary-button" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh from Sheet'}</button></div></div>
    <div className="filter-grid advanced-filters">
      <label className="field"><span>Search</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Agent, Call ID, itinerary…" /></label>
      <label className="field"><span>Result</span><select value={result} onChange={(e) => setResult(e.target.value)}><option value="ALL">All</option><option>PASS</option><option>FAIL</option></select></label>
      <label className="field"><span>Call Center</span><select value={center} onChange={(e) => setCenter(e.target.value)}><option value="ALL">All</option>{centers.map((x) => <option key={x}>{x}</option>)}</select></label>
      <label className="field"><span>QA Type</span><select value={qaType} onChange={(e) => setQaType(e.target.value)}><option value="ALL">All</option><option>CS</option><option>Groups</option></select></label>
      <label className="field"><span>Evaluator</span><select value={evaluator} onChange={(e) => setEvaluator(e.target.value)}><option value="ALL">All</option>{evaluators.map((x) => <option key={x}>{x}</option>)}</select></label>
      <label className="field"><span>Email Status</span><select value={emailStatus} onChange={(e) => setEmailStatus(e.target.value)}><option value="ALL">All</option><option value="SENT">Sent</option><option value="NOT_SENT">Not sent</option></select></label>
      <label className="field"><span>From</span><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
      <label className="field"><span>To</span><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
    </div>
    <p className="muted">Showing {filtered.length} of {reviews.length} reviews.</p>
    <div className="table-wrap"><table className="history-table"><thead><tr><th>Date</th><th>Agent</th><th>Center</th><th>Evaluator</th><th>Type</th><th>Score</th><th>Result</th><th>Email Sent</th><th></th></tr></thead><tbody>
      {filtered.map((review) => <Fragment key={review.id}><tr><td>{formatDate(review.reviewDate || review.savedTimestamp)}</td><td><strong>{review.agentName}</strong></td><td>{review.callCenter}</td><td>{review.evaluator}</td><td>{review.qaType}</td><td><strong>{review.finalScore}</strong> / {review.kpiTarget}</td><td><span className={`result-pill ${review.result.toLowerCase()}`}>{review.result}</span></td><td><button type="button" className={`email-status-button ${review.emailSent ? 'sent' : 'pending'}`} disabled={updatingRow === review.rowNumber || user.role === 'viewer'} onClick={() => void toggleEmail(review)}>{updatingRow === review.rowNumber ? 'Saving…' : review.emailSent ? '✓ Sent' : '○ Not Sent'}</button></td><td><button className="text-button" onClick={() => setExpandedId(expandedId === review.id ? null : review.id)}>{expandedId === review.id ? 'Hide' : 'Details'}</button></td></tr>
      {expandedId === review.id && <tr className="detail-row"><td colSpan={9}><div className="review-detail-grid"><div><span>Agent Start Date</span><strong>{formatDate(review.agentStartDate)}</strong></div><div><span>Confirmation / Itinerary</span><strong>{review.itineraryNumber || '—'}</strong></div><div><span>Call ID</span><strong>{review.callId || '—'}</strong></div><div><span>Markdowns</span><strong>{review.markdowns}</strong></div><div><span>Email Sent At</span><strong>{review.emailSentAt ? new Date(review.emailSentAt).toLocaleString() : '—'}</strong></div><div><span>Email Sent By</span><strong>{review.emailSentBy || '—'}</strong></div></div><div className="issue-box"><span>Issues and custom notes</span><p>{review.issueSummary || 'No issue summary was returned.'}</p></div></td></tr>}</Fragment>)}
    </tbody></table></div>{filtered.length === 0 && <div className="empty-state">No reviews match the selected filters.</div>}
  </section></div>
}
