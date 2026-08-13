import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { agentNamesMatch, getWatchListMetrics, normalizeAgentName, watchListFirstTwoNamesMatch } from '../lib/watchList'
import type { QaUser, ReviewRecord, WatchListAgent } from '../types'

interface AnalyticsPageProps {
  user: QaUser
  reviews: ReviewRecord[]
  watchListAgents: WatchListAgent[]
  initialAgent?: string
}

function clean(value: unknown): string {
  return String(value ?? '').trim()
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function scoreOf(review: ReviewRecord): number {
  const score = Number(review.finalScore)
  return Number.isFinite(score) ? score : 0
}

function scoreTone(score: number, kpi = 90): string {
  if (score >= Math.max(95, kpi)) return 'strong'
  if (score >= kpi) return 'watch'
  return 'risk'
}

export function AnalyticsPage({ reviews, watchListAgents, initialAgent = '' }: AnalyticsPageProps) {
  const [agentQuery, setAgentQuery] = useState(initialAgent)
  const [selectedAgent, setSelectedAgent] = useState(initialAgent)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'reviewDate', desc: true }])
  const [historySearch, setHistorySearch] = useState('')
  const [callCenterFilter, setCallCenterFilter] = useState('all')
  const [scoreFilter, setScoreFilter] = useState('all')
  const [watchFilter, setWatchFilter] = useState('all')

  useEffect(() => {
    if (initialAgent) {
      setAgentQuery(initialAgent)
      setSelectedAgent(initialAgent)
    }
  }, [initialAgent])

  const agentNames = useMemo(() => {
    const names = new Map<string, string>()
    reviews.forEach((review) => {
      const name = clean(review.agentName)
      const key = normalizeAgentName(name)
      if (name && !names.has(key)) names.set(key, name)
    })
    watchListAgents.forEach((agent) => {
      const name = clean(agent.agentName)
      const key = normalizeAgentName(name)
      if (name && !names.has(key)) names.set(key, name)
    })
    return Array.from(names.values()).sort((a, b) => a.localeCompare(b))
  }, [reviews, watchListAgents])

  const callCenters = useMemo(() => {
    const values = new Set<string>()
    reviews.forEach((review) => {
      const value = clean(review.callCenter)
      if (value) values.add(value)
    })
    watchListAgents.forEach((agent) => {
      const value = clean(agent.callCenter)
      if (value) values.add(value)
    })
    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }, [reviews, watchListAgents])

  const agentSummaries = useMemo(() => {
    return agentNames.map((name) => {
      const exactWatch = watchListAgents.find((agent) => normalizeAgentName(agent.agentName) === normalizeAgentName(name))
      const firstTwo = exactWatch ? [] : watchListAgents.filter((agent) => watchListFirstTwoNamesMatch(agent.agentName, name))
      const watchAgent = exactWatch || (firstTwo.length === 1 ? firstTwo[0] : null)
      const matchedReviews = watchAgent
        ? getWatchListMetrics(watchAgent, reviews, watchListAgents).matchedReviews
        : reviews.filter((review) => agentNamesMatch(review.agentName, name))
      const chronological = [...matchedReviews].sort((a, b) =>
        String(a.reviewDate || a.savedTimestamp).localeCompare(String(b.reviewDate || b.savedTimestamp)),
      )
      const latestReview = chronological.at(-1)
      const latestScore = latestReview ? scoreOf(latestReview) : null
      const kpi = Number(latestReview?.kpiTarget || 90)
      const callCenter = clean(latestReview?.callCenter || watchAgent?.callCenter)
      return { name, callCenter, latestScore, kpi, isWatchList: Boolean(watchAgent), reviewCount: chronological.length }
    })
  }, [agentNames, reviews, watchListAgents])

  const filtersActive = callCenterFilter !== 'all' || scoreFilter !== 'all' || watchFilter !== 'all'

  const matchingAgents = useMemo(() => {
    const query = normalizeAgentName(agentQuery)
    return agentSummaries
      .filter((agent) => !query || normalizeAgentName(agent.name).includes(query))
      .filter((agent) => callCenterFilter === 'all' || normalizeAgentName(agent.callCenter) === normalizeAgentName(callCenterFilter))
      .filter((agent) => {
        if (scoreFilter === 'all') return true
        if (scoreFilter === 'no-reviews') return agent.latestScore === null
        if (agent.latestScore === null) return false
        if (scoreFilter === 'under-kpi') return agent.latestScore < agent.kpi
        if (scoreFilter === '90-94') return agent.latestScore >= 90 && agent.latestScore < 95
        if (scoreFilter === '95-plus') return agent.latestScore >= 95
        return true
      })
      .filter((agent) => watchFilter === 'all' || (watchFilter === 'watch' ? agent.isWatchList : !agent.isWatchList))
      .slice(0, 40)
  }, [agentQuery, agentSummaries, callCenterFilter, scoreFilter, watchFilter])

  const selectedWatchAgent = useMemo(() => {
    const exact = watchListAgents.find((agent) => normalizeAgentName(agent.agentName) === normalizeAgentName(selectedAgent))
    if (exact) return exact
    const firstTwoMatches = watchListAgents.filter((agent) => watchListFirstTwoNamesMatch(agent.agentName, selectedAgent))
    return firstTwoMatches.length === 1 ? firstTwoMatches[0] : null
  }, [selectedAgent, watchListAgents])

  const selectedReviews = useMemo(() => {
    if (!selectedAgent) return []
    const matched = selectedWatchAgent
      ? getWatchListMetrics(selectedWatchAgent, reviews, watchListAgents).matchedReviews
      : reviews.filter((review) => agentNamesMatch(review.agentName, selectedAgent))

    return [...matched].sort((a, b) =>
      String(a.reviewDate || a.savedTimestamp).localeCompare(String(b.reviewDate || b.savedTimestamp)),
    )
  }, [reviews, selectedAgent, selectedWatchAgent, watchListAgents])

  const scores = selectedReviews.map(scoreOf)
  const latest = scores.at(-1) ?? 0
  const earliest = scores[0] ?? 0
  const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0
  const highest = scores.length ? Math.max(...scores) : 0
  const lowest = scores.length ? Math.min(...scores) : 0
  const improvement = scores.length > 1 ? latest - earliest : 0
  const currentKpi = Number(selectedReviews.at(-1)?.kpiTarget || 90)

  const chartData = selectedReviews.map((review) => ({
    date: formatDate(review.reviewDate || review.savedTimestamp),
    score: scoreOf(review),
    kpi: Number(review.kpiTarget || 90),
    row: review.rowNumber,
  }))

  const columns = useMemo<ColumnDef<ReviewRecord>[]>(() => [
    { accessorKey: 'reviewDate', header: 'Review Date', cell: ({ row }) => formatDate(row.original.reviewDate || row.original.savedTimestamp) },
    { accessorKey: 'finalScore', header: 'QA Score', cell: ({ row }) => <span className={`analytics-score-badge ${scoreTone(scoreOf(row.original), Number(row.original.kpiTarget || 90))}`}>{scoreOf(row.original).toFixed(1)}%</span> },
    { accessorKey: 'kpiTarget', header: 'KPI', cell: ({ row }) => `${Number(row.original.kpiTarget || 90)}%` },
    { accessorKey: 'result', header: 'Result' },
    { accessorKey: 'callCenter', header: 'Call Center' },
    { accessorKey: 'evaluator', header: 'Evaluator' },
    { accessorKey: 'callId', header: 'Call ID' },
    { accessorKey: 'itineraryNumber', header: 'Itinerary' },
  ], [])

  const table = useReactTable({
    data: selectedReviews,
    columns,
    state: { sorting, globalFilter: historySearch },
    onSortingChange: setSorting,
    onGlobalFilterChange: setHistorySearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  })

  return (
    <div className="page-stack analytics-page">
      <section className="panel analytics-hero">
        <div>
          <p className="eyebrow">Management View</p>
          <h1>Agent Performance</h1>
          <p className="muted">Search an agent to see every QA score in date order and quickly tell whether performance is improving.</p>
        </div>
      </section>

      <section className="panel analytics-agent-panel">
        <div className="panel-heading wrap-heading">
          <div><p className="eyebrow">Agent Search</p><h2>Choose an agent</h2></div>
          {selectedWatchAgent && <span className="watch-status-pill watch-status-pill--active">Watch List</span>}
        </div>
        <div className="analytics-agent-filters">
          <label className="field analytics-agent-search-field">
            <span>Agent Name</span>
            <input
              aria-label="Search agents"
              value={agentQuery}
              onChange={(event) => setAgentQuery(event.target.value)}
              placeholder="Search agent name..."
            />
          </label>
          <label className="field">
            <span>Call Center</span>
            <select aria-label="Filter agents by call center" value={callCenterFilter} onChange={(event) => setCallCenterFilter(event.target.value)}>
              <option value="all">All call centers</option>
              {callCenters.map((center) => <option key={center} value={center}>{center}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Latest QA Score</span>
            <select aria-label="Filter agents by QA score" value={scoreFilter} onChange={(event) => setScoreFilter(event.target.value)}>
              <option value="all">All scores</option>
              <option value="under-kpi">Below KPI</option>
              <option value="90-94">90% to 94.9%</option>
              <option value="95-plus">95% and above</option>
              <option value="no-reviews">No QA reviews</option>
            </select>
          </label>
          <label className="field">
            <span>Watch List</span>
            <select aria-label="Filter agents by Watch List status" value={watchFilter} onChange={(event) => setWatchFilter(event.target.value)}>
              <option value="all">All agents</option>
              <option value="watch">Watch List only</option>
              <option value="not-watch">Not on Watch List</option>
            </select>
          </label>
        </div>
        <div className="analytics-agent-filter-actions">
          <span>{matchingAgents.length}{matchingAgents.length === 40 ? '+' : ''} matching agent{matchingAgents.length === 1 ? '' : 's'}</span>
          <div>
            {(agentQuery || filtersActive) && <button className="secondary-button" type="button" onClick={() => { setAgentQuery(''); setCallCenterFilter('all'); setScoreFilter('all'); setWatchFilter('all') }}>Clear search filters</button>}
            {selectedAgent && <button className="secondary-button" type="button" onClick={() => { setSelectedAgent(''); setAgentQuery('') }}>Close agent</button>}
          </div>
        </div>
        {(agentQuery || filtersActive) && matchingAgents.length > 0 && normalizeAgentName(selectedAgent) !== normalizeAgentName(agentQuery) && (
          <div className="analytics-agent-results analytics-agent-results--filtered">
            {matchingAgents.map((agent) => (
              <button key={agent.name} type="button" onClick={() => { setSelectedAgent(agent.name); setAgentQuery(agent.name); setHistorySearch('') }}>
                <strong>{agent.name}</strong>
                <span>{agent.callCenter || 'No call center'} · {agent.latestScore === null ? 'No QA yet' : `${agent.latestScore.toFixed(1)}% latest`} · {agent.reviewCount} review{agent.reviewCount === 1 ? '' : 's'}{agent.isWatchList ? ' · Watch List' : ''}</span>
              </button>
            ))}
          </div>
        )}
        {(agentQuery || filtersActive) && matchingAgents.length === 0 && (
          <div className="analytics-filter-empty">No agents match the current search and filters.</div>
        )}
      </section>

      {!selectedAgent ? (
        <section className="panel analytics-select-agent-empty"><strong>Select an agent</strong><p>Search above to open the full QA score history.</p></section>
      ) : selectedReviews.length === 0 ? (
        <section className="panel empty-state"><strong>No reviews found</strong><p>There are no QA reviews matched to {selectedAgent} yet.</p></section>
      ) : (
        <>
          <section className="analytics-selected-agent-heading panel">
            <div><span>Viewing</span><h3>{selectedAgent}</h3></div>
            <span className={`analytics-improvement-pill ${improvement > 0 ? 'up' : improvement < 0 ? 'down' : 'flat'}`}>
              {improvement > 0 ? '+' : ''}{improvement.toFixed(1)} pts from first to latest
            </span>
          </section>

          <section className="analytics-agent-stat-grid">
            <div className="panel"><span>Latest Score</span><strong>{latest.toFixed(1)}%</strong><small>KPI {currentKpi}%</small></div>
            <div className="panel"><span>Average Score</span><strong>{average.toFixed(1)}%</strong></div>
            <div className="panel"><span>Highest Score</span><strong>{highest.toFixed(1)}%</strong></div>
            <div className="panel"><span>Lowest Score</span><strong>{lowest.toFixed(1)}%</strong></div>
            <div className="panel"><span>Reviews</span><strong>{selectedReviews.length}</strong></div>
            <div className="panel"><span>Trend</span><strong>{improvement > 0 ? 'Improving' : improvement < 0 ? 'Declining' : 'Flat'}</strong></div>
          </section>

          <section className="panel analytics-chart-wrap">
            <div className="panel-heading"><div><p className="eyebrow">Score Trend</p><h2>QA improvement over time</h2></div></div>
            <div style={{ width: '100%', height: 340 }}>
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 12, right: 24, bottom: 18, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" minTickGap={24} />
                  <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                  <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, 'QA Score']} />
                  <ReferenceLine y={currentKpi} strokeDasharray="5 5" label={{ value: `KPI ${currentKpi}%`, position: 'insideTopRight' }} />
                  <Line type="monotone" dataKey="score" stroke="currentColor" strokeWidth={3} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading wrap-heading">
              <div><p className="eyebrow">Complete History</p><h2>All matched QA reviews</h2></div>
              <div className="analytics-history-actions">
                <input aria-label="Filter agent review history" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Filter history..." />
                <button className="secondary-button" type="button" onClick={() => setHistorySearch('')} disabled={!historySearch}>Clear filters</button>
              </div>
            </div>
            <div className="analytics-history-table-wrap">
              <table className="analytics-history-table">
                <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id}><button className="table-sort-button" type="button" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() === 'asc' ? ' ↑' : header.column.getIsSorted() === 'desc' ? ' ↓' : ''}</button></th>)}</tr>)}</thead>
                <tbody>{table.getRowModel().rows.map((row) => <tr key={row.id}>{row.getVisibleCells().map((cell) => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span>Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())} · {table.getFilteredRowModel().rows.length} reviews</span>
              <div><button className="secondary-button" type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</button><button className="secondary-button" type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</button></div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
