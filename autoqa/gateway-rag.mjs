import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.AUTO_QA_PORT || 8788)
const HOST = '127.0.0.1'
const WORKER_PORT = Number(process.env.AUTO_QA_WORKER_PORT || 8789)
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`
const PYTHON = process.env.AUTO_QA_PYTHON || path.resolve('.venv-autoqa', 'Scripts', 'python.exe')
const JOB_TTL_MS = 45 * 60 * 1000
const UPLOAD_TTL_MS = 20 * 60 * 1000
const POLL_WORKER_DELAY_MS = 1500
const MAX_REQUEST_BYTES = 300 * 1024 * 1024
const MAX_UPLOAD_CHUNKS = 512
const MAX_CHUNK_CHARS = 2 * 1024 * 1024
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
const uploads = new Map()
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
    env: { ...process.env, AUTO_QA_PORT: String(WORKER_PORT) },
  })
  workerProcess.on('error', (error) => console.error(`Auto QA worker failed to start: ${conciseError(error)}`))
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
    const response = await fetch(`${WORKER_URL}/health${search}`, { headers: { 'Cache-Control': 'no-store' } })
    const payload = await response.json().catch(() => ({}))
    return { response, payload }
  } catch (error) {
    return { response: null, payload: { ok: false, message: `Auto QA worker is starting. ${conciseError(error)}`.trim() } }
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
  const jobCutoff = Date.now() - JOB_TTL_MS
  for (const [runId, job] of jobs.entries()) {
    if ((job.status === 'completed' || job.status === 'failed') && Number(job.finishedAt || 0) < jobCutoff) jobs.delete(runId)
  }
  const uploadCutoff = Date.now() - UPLOAD_TTL_MS
  for (const [runId, upload] of uploads.entries()) {
    if (Number(upload.createdAt || 0) < uploadCutoff) uploads.delete(runId)
  }
}
setInterval(cleanupJobs, 5 * 60 * 1000).unref()

function validateInput(input) {
  const runId = String(input?.runId || '').trim()
  if (!runId) throw new Error('Auto QA request is missing its run ID. Please retry the call.')
  if (!Array.isArray(input?.criteria) || !input.criteria.length) throw new Error('No QA criteria were supplied.')
  return runId
}

function enqueueInput(input) {
  const runId = validateInput(input)
  const existing = jobs.get(runId)
  if (existing) return existing
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
    requestBody: JSON.stringify(input),
  }
  jobs.set(runId, job)
  queue.push(runId)
  console.log(`[queue] accepted ${runId}; waiting=${queue.length}; active=${activeRunId || 'none'}`)
  setImmediate(processQueue)
  return job
}

function runKnowledge(input, transcript, deep) {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [path.resolve('autoqa', 'knowledge.py')], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
      resolve({ ok: false, context: '', error: 'Local knowledge retrieval timed out.' })
    }, deep ? 8 * 60 * 1000 : 90 * 1000)

    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, context: '', error: conciseError(error) })
    })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
        resolve(line ? JSON.parse(line) : { ok: false, context: '', error: conciseError(stderr) })
      } catch {
        resolve({ ok: false, context: '', error: conciseError(stderr || stdout) })
      }
    })

    const query = [transcript, input.documentation || ''].filter(Boolean).join('\n').slice(0, 30000)
    child.stdin.end(JSON.stringify({
      action: 'retrieve',
      matrixText: String(input.matrixText || '').slice(0, 180000),
      query,
      deep,
    }))
  })
}

async function callWorker(input) {
  const response = await fetch(`${WORKER_URL}/api/auto-qa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(input),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.success !== true || !payload?.data) {
    throw new Error(payload?.message || `Auto QA worker failed with HTTP ${response.status}.`)
  }
  return payload
}

async function processJob(job) {
  activeRunId = job.runId
  job.status = 'processing'
  job.stage = 'Transcribing and auditing call'
  job.startedAt = new Date().toISOString()
  job.message = 'Auto QA is processing this call.'
  console.log(`[queue] processing ${job.runId}`)

  try {
    await waitForWorkerReady()
    const originalInput = JSON.parse(job.requestBody)
    let payload = await callWorker(originalInput)
    const transcript = String(payload?.data?.transcript || '')

    if (transcript && String(originalInput.matrixText || '').trim()) {
      job.stage = 'Local knowledge retrieval'
      job.message = 'Auto QA is checking the local QA knowledge base.'
      const deep = Number(payload?.data?.overallConfidence || 0) < 80
      const knowledge = await runKnowledge(originalInput, transcript, deep)
      const context = String(knowledge?.context || '').trim()

      if (context) {
        job.stage = deep ? 'Deep RAG verification' : 'RAG verification'
        const enrichedInput = {
          ...originalInput,
          audioBase64: '',
          transcript,
          matrixText: `${String(originalInput.matrixText || '')}\n\n## LOCAL RETRIEVED QA KNOWLEDGE\n${context}`,
        }
        try {
          const verified = await callWorker(enrichedInput)
          payload = verified
          payload.data.localKnowledge = {
            txtai: Boolean(knowledge?.txtai),
            lightrag: Boolean(knowledge?.lightrag),
            aiMemory: Boolean(knowledge?.aiMemory),
          }
        } catch (error) {
          console.warn(`[rag] verification fallback for ${job.runId}: ${conciseError(error)}`)
          payload.data.localKnowledge = {
            txtai: Boolean(knowledge?.txtai),
            lightrag: Boolean(knowledge?.lightrag),
            aiMemory: Boolean(knowledge?.aiMemory),
            fallback: true,
          }
        }
      }
    }

    job.requestBody = ''
    job.status = 'completed'
    job.stage = 'QA complete'
    job.data = payload.data
    job.message = 'Auto QA completed successfully.'
    job.completedAt = new Date().toISOString()
    console.log(`[queue] completed ${job.runId}`)
  } catch (error) {
    job.status = 'failed'
    job.stage = 'FAILED'
    job.message = conciseError(error) || 'Auto QA failed.'
    job.completedAt = new Date().toISOString()
    job.requestBody = ''
    console.error(`[queue] failed ${job.runId}: ${job.message}`)
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

async function readRequestBody(req, maxBytes = MAX_REQUEST_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error(`Request is too large. Maximum size is ${Math.floor(maxBytes / (1024 * 1024))} MB.`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function acceptedResponse(job) {
  return { success: true, accepted: true, runId: job.runId, job: publicJob(job) }
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
      localKnowledge: {
        txtai: true,
        lightrag: true,
        aiMemory: true,
      },
      queue: { active: activeRunId || '', waiting: queue.length },
      uploads: uploads.size,
      message: ok
        ? `${payload.message || 'Auto QA is ready.'} Async gateway + local RAG is ready.`
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

  if (req.method === 'POST' && requestUrl.pathname === '/api/auto-qa/upload/start') {
    try {
      const body = JSON.parse(await readRequestBody(req, 8 * 1024 * 1024))
      const runId = String(body?.runId || '').trim()
      const input = body?.request
      const totalChunks = Number(body?.totalChunks)
      if (!runId || !input || typeof input !== 'object') throw new Error('Invalid chunked upload start request.')
      if (String(input.runId || '').trim() !== runId) throw new Error('Chunked upload run ID mismatch.')
      validateInput(input)
      if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_UPLOAD_CHUNKS) throw new Error(`Invalid chunk count. Maximum is ${MAX_UPLOAD_CHUNKS}.`)
      if (input.audioBase64) throw new Error('Chunked upload metadata must not include the full audio payload.')
      uploads.set(runId, { runId, input, totalChunks, chunks: new Array(totalChunks), received: 0, createdAt: Date.now() })
      console.log(`[upload] started ${runId}; chunks=${totalChunks}`)
      return send(req, res, 200, { success: true, runId, totalChunks })
    } catch (error) {
      return send(req, res, 400, { success: false, message: conciseError(error) || 'Could not start chunked upload.' })
    }
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/auto-qa/upload/chunk') {
    try {
      const runId = String(requestUrl.searchParams.get('runId') || '').trim()
      const index = Number(requestUrl.searchParams.get('index'))
      const upload = uploads.get(runId)
      if (!upload) throw new Error('Chunked upload session was not found or expired.')
      if (!Number.isInteger(index) || index < 0 || index >= upload.totalChunks) throw new Error('Invalid upload chunk index.')
      const body = JSON.parse(await readRequestBody(req, MAX_CHUNK_CHARS + 128 * 1024))
      const chunk = String(body?.chunk || '')
      if (!chunk) throw new Error('Upload chunk is empty.')
      if (chunk.length > MAX_CHUNK_CHARS) throw new Error('Upload chunk is too large.')
      if (upload.chunks[index] == null) {
        upload.chunks[index] = chunk
        upload.received += 1
      }
      return send(req, res, 200, { success: true, runId, index, received: upload.received, totalChunks: upload.totalChunks })
    } catch (error) {
      return send(req, res, 400, { success: false, message: conciseError(error) || 'Could not receive upload chunk.' })
    }
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/auto-qa/upload/complete') {
    try {
      const body = JSON.parse(await readRequestBody(req, 1024 * 1024))
      const runId = String(body?.runId || '').trim()
      const upload = uploads.get(runId)
      if (!upload) throw new Error('Chunked upload session was not found or expired.')
      if (upload.received !== upload.totalChunks || upload.chunks.some((chunk) => typeof chunk !== 'string')) {
        throw new Error(`Audio upload is incomplete: received ${upload.received} of ${upload.totalChunks} chunks.`)
      }
      const input = upload.input
      input.audioBase64 = upload.chunks.join('')
      uploads.delete(runId)
      const job = enqueueInput(input)
      console.log(`[upload] completed ${runId}; queued`)
      return send(req, res, 202, acceptedResponse(job))
    } catch (error) {
      return send(req, res, 400, { success: false, message: conciseError(error) || 'Could not complete chunked upload.' })
    }
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/auto-qa') {
    try {
      const input = JSON.parse(await readRequestBody(req))
      const job = enqueueInput(input)
      return send(req, res, 202, acceptedResponse(job))
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
  console.log(`Auto QA local-RAG gateway running on http://${HOST}:${PORT}`)
  console.log(`Auto QA worker URL: ${WORKER_URL}`)
  console.log('txtai is the fast local retrieval layer; LightRAG is used only for low-confidence deep verification.')
  console.log('ai-memory recall is local-only and optional; no paid API key is required.')
  startWorker()
})
