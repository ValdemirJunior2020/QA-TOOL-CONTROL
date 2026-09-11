import http from 'node:http'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.AUTO_QA_PORT || 8788)
const HOST = '127.0.0.1'
const WORKER_PORT = Number(process.env.AUTO_QA_WORKER_PORT || 8789)
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`
const JOB_TTL_MS = 45 * 60 * 1000
const POLL_WORKER_DELAY_MS = 1500
const DEFAULT_ALLOWED_ORIGINS = [
  'https://qa-tool-control.netlify.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]
const ALLOWED_ORIGINS = new Set(
  String(process.env.AUTO_QA_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean),
)

const jobs = new Map()
const queue = []
let activeRunId = ''
let workerProcess = null
let workerRestartTimer = null
let shuttingDown = false

function corsOrigin(req) {
  const origin = String(req.headers.origin || '').trim().replace(/\/$/, '')
  if (!origin) return ''
  return ALLOWED_ORIGINS.has(origin) ? origin : null
}

function send(req, res, status, body) {
  const allowedOrigin = corsOrigin(req)
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Vary': 'Origin',
  }
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin
  res.writeHead(status, headers)
  res.end(JSON.stringify(body))
}

function conciseError(error) {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.replace(/\s+/g, ' ').trim().slice(0, 1000)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function startWorker() {
  if (workerProcess || shuttingDown) return
  console.log(`Starting Auto QA worker on ${WORKER_URL} ...`)
  workerProcess = spawn(process.execPath, ['autoqa/server.mjs'], {
    cwd: process.cwd(),
    windowsHide: false,
    stdio: 'inherit',
    env: {
      ...process.env,
      AUTO_QA_PORT: String(WORKER_PORT),
    },
  })
  workerProcess.on('error', (error) => {
    console.error(`Auto QA worker failed to start: ${conciseError(error)}`)
  })
  workerProcess.on('close', (code) => {
    workerProcess = null
    if (shuttingDown) return
    console.error(`Auto QA worker stopped with code ${code}. Restarting in 3 seconds...`)
    clearTimeout(workerRestartTimer)
    workerRestartTimer = setTimeout(startWorker, 3000)
  })
}

async function workerHealth(search = '') {
  try {
    const response = await fetch(`${WORKER_URL}/health${search}`, {
      headers: { 'Cache-Control': 'no-store' },
    })
    const payload = await response.json().catch(() => ({}))
    return { response, payload }
  } catch (error) {
    return {
      response: null,
      payload: { ok: false, message: `Auto QA worker is starting. ${conciseError(error)}`.trim() },
    }
  }
}

async function waitForWorkerReady() {
  for (;;) {
    if (shuttingDown) throw new Error('Auto QA gateway is shutting down.')
    const { response } = await workerHealth('')
    if (response) return
    await sleep(POLL_WORKER_DELAY_MS)
  }
}

function queuePosition(runId) {
  const index = queue.indexOf(runId)
  return index >= 0 ? index + 1 : 0
}

function publicJob(job) {
  return {
    runId: job.runId,
    status: job.status,
    stage: job.stage,
    position: job.status === 'queued' ? queuePosition(job.runId) : 0,
    createdAt: job.createdAt,
    startedAt: job.startedAt || '',
    completedAt: job.completedAt || '',
    message: job.message || '',
    data: job.status === 'completed' ? job.data : undefined,
  }
}

function cleanupJobs() {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [runId, job] of jobs.entries()) {
    if ((job.status === 'completed' || job.status === 'failed') && Number(job.finishedAt || 0) < cutoff) {
      jobs.delete(runId)
    }
  }
}
setInterval(cleanupJobs, 5 * 60 * 1000).unref()

async function processJob(job) {
  activeRunId = job.runId
  job.status = 'processing'
  job.stage = 'Transcribing and auditing call'
  job.startedAt = new Date().toISOString()
  job.message = 'Auto QA is processing this call.'

  try {
    await waitForWorkerReady()
    const response = await fetch(`${WORKER_URL}/api/auto-qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: job.requestBody,
    })
    job.requestBody = ''
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.success !== true || !payload?.data) {
      throw new Error(payload?.message || `Auto QA worker failed with HTTP ${response.status}.`)
    }
    job.status = 'completed'
    job.stage = 'QA complete'
    job.data = payload.data
    job.message = 'Auto QA completed successfully.'
    job.completedAt = new Date().toISOString()
  } catch (error) {
    job.status = 'failed'
    job.stage = 'FAILED'
    job.message = conciseError(error) || 'Auto QA failed.'
    job.completedAt = new Date().toISOString()
    job.requestBody = ''
  } finally {
    job.finishedAt = Date.now()
    activeRunId = ''
  }
}

async function processQueue() {
  if (activeRunId || !queue.length) return
  const runId = queue.shift()
  const job = jobs.get(runId)
  if (!job || job.status !== 'queued') {
    setImmediate(processQueue)
    return
  }
  await processJob(job)
  setImmediate(processQueue)
}

async function readRequestBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 300 * 1024 * 1024) throw new Error('Audio upload is too large. Maximum request size is 300 MB.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const server = http.createServer(async (req, res) => {
  const allowedOrigin = corsOrigin(req)
  if (allowedOrigin === null) return send(req, res, 403, { success: false, message: 'Origin is not allowed.' })
  if (req.method === 'OPTIONS') return send(req, res, 204, {})

  const requestUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`)

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    const { response, payload } = await workerHealth(requestUrl.search)
    const ok = Boolean(response?.ok && payload?.ok === true)
    return send(req, res, ok ? 200 : 503, {
      ...payload,
      ok,
      gateway: true,
      queue: {
        active: activeRunId || '',
        waiting: queue.length,
      },
      message: ok
        ? `${payload.message || 'Auto QA is ready.'} Async gateway is ready.`
        : payload.message || 'Auto QA worker is not ready yet.',
    })
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/auto-qa/status') {
    const runId = String(requestUrl.searchParams.get('runId') || '').trim()
    if (!runId) return send(req, res, 400, { success: false, message: 'Missing runId.' })
    const job = jobs.get(runId)
    if (!job) return send(req, res, 404, { success: false, message: 'Auto QA job was not found or has expired.' })
    return send(req, res, 200, { success: true, job: publicJob(job) })
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/auto-qa') {
    try {
      const requestBody = await readRequestBody(req)
      const input = JSON.parse(requestBody)
      const runId = String(input?.runId || '').trim()
      if (!runId) throw new Error('Auto QA request is missing its run ID. Please retry the call.')
      if (!Array.isArray(input?.criteria) || !input.criteria.length) throw new Error('No QA criteria were supplied.')

      const existing = jobs.get(runId)
      if (existing) {
        return send(req, res, 202, {
          success: true,
          accepted: true,
          runId,
          job: publicJob(existing),
        })
      }

      const now = new Date().toISOString()
      const job = {
        runId,
        status: 'queued',
        stage: activeRunId ? 'Waiting for Auto QA' : 'Starting Auto QA',
        message: activeRunId ? 'Another QA is processing. Your QA is safely queued.' : 'Your QA was accepted and is starting.',
        createdAt: now,
        startedAt: '',
        completedAt: '',
        finishedAt: 0,
        data: undefined,
        requestBody,
      }
      jobs.set(runId, job)
      queue.push(runId)
      const position = queuePosition(runId)

      send(req, res, 202, {
        success: true,
        accepted: true,
        runId,
        job: { ...publicJob(job), position },
      })
      setImmediate(processQueue)
      return
    } catch (error) {
      return send(req, res, 400, { success: false, message: conciseError(error) || 'Auto QA request could not be queued.' })
    }
  }

  return send(req, res, 404, { success: false, message: 'Not found.' })
})

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  clearTimeout(workerRestartTimer)
  try { workerProcess?.kill() } catch {}
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

server.listen(PORT, HOST, () => {
  console.log(`Auto QA async gateway running on http://${HOST}:${PORT}`)
  console.log(`Auto QA worker URL: ${WORKER_URL}`)
  console.log('Long QA work now runs behind the gateway, so Cloudflare requests can return quickly.')
  startWorker()
})
