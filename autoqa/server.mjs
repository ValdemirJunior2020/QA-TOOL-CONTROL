import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.AUTO_QA_PORT || 8788)
const HOST = '127.0.0.1'
const PYTHON = process.env.AUTO_QA_PYTHON || path.resolve('.venv-autoqa', 'Scripts', 'python.exe')
const WHISPER_MODEL = process.env.AUTO_QA_WHISPER_MODEL || 'small.en'
const DEFAULT_OLLAMA_URL = process.env.AUTO_QA_OLLAMA_URL || 'http://127.0.0.1:11434'
const DEFAULT_OLLAMA_MODEL = process.env.AUTO_QA_OLLAMA_MODEL || 'qwen3:8b'
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

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (data) => { stdout += String(data) })
    child.stderr?.on('data', (data) => { stderr += String(data) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(stderr || stdout || `${command} exited with ${code}`))
    })
  })
}

function conciseError(error) {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.replace(/\s+/g, ' ').trim().slice(0, 800)
}

async function transcribeAudio(audioBase64, fileName) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-auto-'))
  try {
    const ext = path.extname(fileName || '') || '.audio'
    const source = path.join(tempDir, `source${ext}`)
    const wav = path.join(tempDir, 'normalized.wav')
    fs.writeFileSync(source, Buffer.from(audioBase64, 'base64'))

    try {
      await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', source, '-ac', '1', '-ar', '16000', '-vn', wav])
    } catch (error) {
      const detail = conciseError(error)
      if (/enoent|not found|cannot find/i.test(detail)) {
        throw new Error('FFmpeg is not installed or is not available in PATH. Run INSTALL-AUTO-QA.bat after installing FFmpeg.')
      }
      throw new Error(`Audio conversion failed.${detail ? ` ${detail}` : ''}`)
    }

    let result
    try {
      result = await run(PYTHON, [path.resolve('autoqa', 'transcribe.py'), wav, WHISPER_MODEL])
    } catch (error) {
      const detail = conciseError(error)
      if (/enoent|cannot find|no such file/i.test(detail)) {
        throw new Error('Auto QA Python environment is missing. Run INSTALL-AUTO-QA.bat.')
      }
      if (/faster[_-]whisper|modulenotfounderror|no module named/i.test(detail)) {
        throw new Error('Local transcription failed because faster-whisper is not installed correctly. Run INSTALL-AUTO-QA.bat.')
      }
      throw new Error(`Local transcription failed.${detail ? ` ${detail}` : ''}`)
    }

    const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
    if (!line) throw new Error('Local transcription failed because Whisper returned an empty result.')
    try {
      const parsed = JSON.parse(line)
      if (!String(parsed?.text || '').trim()) throw new Error('No speech was detected in the audio.')
      return parsed
    } catch (error) {
      if (error instanceof Error && error.message === 'No speech was detected in the audio.') throw error
      throw new Error('Local transcription failed because Whisper returned invalid output.')
    }
  } finally {
    // Call recordings are temporary. Delete source + normalized audio on every path,
    // including FFmpeg, Whisper, Ollama, validation, or client disconnect failures.
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function matrixKeywords(value) {
  const stop = new Set(['the','and','for','that','with','from','this','have','will','was','are','but','not','you','your','guest','agent','call','hotel','reservation','booking','please','into','when','then','they','their','them','our','has','had','can','could','would','should','about','only','need','needs'])
  return new Set(String(value || '').toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((word) => !stop.has(word)) || [])
}

function selectRelevantMatrix(matrixText, evidenceText) {
  const lines = String(matrixText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return ''
  const evidence = matrixKeywords(evidenceText)
  const itemsStart = lines.findIndex((line) => /^##\s+items to note/i.test(line))
  const always = itemsStart >= 0 ? lines.slice(itemsStart, Math.min(lines.length, itemsStart + 20)) : []
  const scored = lines.map((line, index) => {
    if (line.startsWith('## ')) return { line, index, score: 0 }
    const words = matrixKeywords(line)
    let score = 0
    for (const word of words) if (evidence.has(word)) score += word.length >= 8 ? 3 : 1
    if (/refund|voucher|foc|slack|ticket|supplier|payment|cancel|receipt|confirmation|rebook|supervisor|group/i.test(line)) score += 0.25
    return { line, index, score }
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score)

  const selected = new Set(always)
  for (const item of scored.slice(0, 28)) {
    selected.add(item.line)
    if (item.index > 0 && lines[item.index - 1]?.startsWith('## ')) selected.add(lines[item.index - 1])
  }
  return [...selected].join('\n').slice(0, 24000)
}

function hasRealMatrixEvidence(value) {
  const text = String(value || '').trim()
  return Boolean(text) && !/^(n\/?a|none|no matrix|not applicable|no direct matrix evidence)[.!\s]*$/i.test(text)
}

function buildPrompt(input, transcript) {
  const criteria = (input.criteria || []).map((c) => `${c.number}. ${c.name} (${c.points} points)\nDefinition: ${c.notes || ''}`).join('\n\n')
  const docs = String(input.documentation || '').slice(0, 70000)
  const phase = ['call', 'documentation', 'full'].includes(input.phase) ? input.phase : 'full'
  const matrix = selectRelevantMatrix(input.matrixText, `${transcript}\n${docs}`)
  const sales = input.qaType === 'Sales' ? String(input.salesQaFormText || '').slice(0, 24000) : ''

  const phaseInstruction = phase === 'call'
    ? 'PHASE: CALL REVIEW ONLY. Grade criteria from the call transcript only. Do not penalize Documentation Quality, Group Request Documentation Accuracy, or any criterion that requires back-office notes because documentation has not been supplied yet. Return documentation-dependent criteria as N/A with low confidence; the human workflow will leave them for the documentation step.'
    : phase === 'documentation'
      ? 'PHASE: DOCUMENTATION REVIEW. Use the transcript as context, but focus on documentation-dependent criteria and whether the notes accurately reflect the action taken. For non-documentation criteria, return the most defensible result but the frontend will preserve the prior call grading.'
      : 'PHASE: FULL REVIEW. Evaluate both the call and the supplied documentation.'

  return `You are a strict HotelPlanner Quality Assurance evaluator. Grade only from the evidence provided. Never invent facts. Use the active QA criteria and active Service Matrix as the source of truth.\n\n${phaseInstruction}\n\nIDENTIFIER EXTRACTION:\n- Extract a HotelPlanner itinerary beginning with H only if clearly present in the transcript or documentation.\n- Extract the guest email only if clearly stated.\n- Extract the guest phone number only if clearly stated.\n- If any identifier is not present, return an empty string. Never guess.\n\nMATRIX COMPLIANCE — ZERO TOLERANCE:\n- Matrix Compliance is zero tolerance whenever an applicable Matrix rule is confirmed.\n- If an applicable Matrix rule requires a process, tool, escalation, Slack action, Refund Queue action, ticket, supervisor step, hotel/supplier contact, voucher/rebooking step, FOC step, timeline, or other required action and the agent fails to follow it, Matrix Compliance MUST be Critical.\n- Do not use Partial or Markdown for a confirmed Matrix miss. Use Critical.\n- A Matrix Critical makes the entire QA 0% / FAIL.\n- For every Matrix Critical include the actual applicable Matrix requirement in matrixEvidence.\n- If you cannot identify an applicable Matrix row/rule from the supplied Matrix, do NOT invent a violation. Use N/A with low confidence and state that manual Matrix review is needed.\n\nSTATUS RULES:\n- ✓ Followed = criterion was met.\n- ✕ Markdown = criterion was not met, except Matrix Compliance where a confirmed miss is Critical.\n- Partial = criterion was partly met, except Matrix Compliance where a confirmed partial miss is Critical.\n- N/A = criterion truly does not apply or, during call-only phase, depends on documentation not yet supplied.\n- Critical may ONLY be used for Matrix Compliance or Documentation Quality when evidence supports a critical failure.\n- Do not mark a criterion down for information that cannot reasonably be observed in the current phase.\n- Notes must be short, specific, professional, and editable by a human reviewer.\n- Evidence excerpts must be concise and based on the supplied material only.\n\nQA TYPE: ${input.qaType}\n\nQA CRITERIA:\n${criteria}\n\nACTIVE SERVICE MATRIX:\n${matrix || '[No matrix loaded]'}\n\n${sales ? `ACTIVE GROUP SALES QA FORM:\n${sales}\n\n` : ''}CALL TRANSCRIPT:\n${String(transcript || '').slice(0, 70000)}\n\nDOCUMENTATION / ITINERARY NOTES:\n${docs || '[No documentation supplied in this phase]'}\n\nReturn one result for every QA criterion. Calculate confidence from 0-100. Do not mention AI, Ollama, automation, or model names in QA notes.`
}

const resultSchema = {
  type: 'object',
  properties: {
    detectedItinerary: { type: 'string' },
    detectedEmail: { type: 'string' },
    detectedPhone: { type: 'string' },
    detectedCallLength: { type: 'string' },
    detectedCallDate: { type: 'string' },
    overallConfidence: { type: 'number' },
    summary: { type: 'string' },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'number' },
          status: { type: 'string', enum: ['✓ Followed', '✕ Markdown', 'N/A', 'Partial', 'Critical'] },
          note: { type: 'string' },
          confidence: { type: 'number' },
          transcriptEvidence: { type: 'string' },
          documentationEvidence: { type: 'string' },
          matrixEvidence: { type: 'string' },
          criticalReason: { type: 'string' },
        },
        required: ['number','status','note','confidence','transcriptEvidence','documentationEvidence','matrixEvidence','criticalReason'],
      },
    },
  },
  required: ['detectedItinerary','detectedEmail','detectedPhone','detectedCallLength','detectedCallDate','overallConfidence','summary','criteria'],
}

const matrixAuditSchema = {
  type: 'object',
  properties: {
    applicable: { type: 'boolean' },
    agentFollowed: { type: 'boolean' },
    confidence: { type: 'number' },
    matrixRequirement: { type: 'string' },
    matrixEvidence: { type: 'string' },
    transcriptEvidence: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['applicable','agentFollowed','confidence','matrixRequirement','matrixEvidence','transcriptEvidence','reason'],
}

const humanRewriteSchema = {
  type: 'object',
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['number', 'note'],
      },
    },
  },
  required: ['notes'],
}

function normalizeLocalOllamaUrl(value) {
  try {
    const parsed = new URL(String(value || DEFAULT_OLLAMA_URL))
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) return null
    return parsed.origin
  } catch {
    return null
  }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const payload = await response.json().catch(() => ({}))
    return { response, payload }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Request timed out.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function callOllamaJson(input, messages, schema, generationOptions = {}) {
  const base = normalizeLocalOllamaUrl(input.ollamaUrl) || DEFAULT_OLLAMA_URL
  const model = String(input.ollamaModel || DEFAULT_OLLAMA_MODEL).trim() || DEFAULT_OLLAMA_MODEL
  const requestedTemperature = Number(generationOptions.temperature)
  const temperature = Number.isFinite(requestedTemperature) ? requestedTemperature : 0.05
  let response
  let payload
  try {
    const result = await fetchJsonWithTimeout(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: schema,
        options: { temperature, num_ctx: 32768 },
        messages,
      }),
    }, 20 * 60 * 1000)
    response = result.response
    payload = result.payload
  } catch (error) {
    throw new Error(`Ollama is unavailable at ${base}. ${conciseError(error)}`.trim())
  }

  if (!response.ok) {
    const message = String(payload?.error || `Ollama returned HTTP ${response.status}`)
    if (/model.*not found|pull model|not.*installed/i.test(message)) {
      throw new Error(`Ollama model "${model}" is not installed. Run: ollama pull ${model}`)
    }
    throw new Error(message)
  }
  const content = payload?.message?.content
  if (!content) throw new Error('Ollama returned no QA result.')
  try {
    return typeof content === 'string' ? JSON.parse(content) : content
  } catch {
    throw new Error('Ollama returned invalid JSON for the QA result.')
  }
}

async function callPrimaryQa(input, transcript) {
  return callOllamaJson(input, [
    { role: 'system', content: 'You are a precise QA auditor. Follow the supplied policy, criteria, evidence, phase instructions, and JSON schema exactly. Return structured conclusions only; do not expose private reasoning.' },
    { role: 'user', content: buildPrompt(input, transcript) },
  ], resultSchema)
}

async function auditMatrixCompliance(input, transcript) {
  if (input.phase === 'documentation') return null
  const matrixCriterion = (input.criteria || []).find((criterion) => /matrix compliance/i.test(String(criterion?.name || '')))
  if (!matrixCriterion) return null
  const matrix = selectRelevantMatrix(input.matrixText, `${transcript}\n${input.documentation || ''}`)
  if (!matrix.trim()) return null

  const prompt = `Perform an independent Service Matrix compliance audit for this call. Do not copy the first QA pass. Do not invent a rule.\n\nMATRIX CRITERION: ${matrixCriterion.number}. ${matrixCriterion.name}\n\nRELEVANT SERVICE MATRIX:\n${matrix.slice(0, 22000)}\n\nCALL TRANSCRIPT:\n${String(transcript || '').slice(0, 60000)}\n\nDOCUMENTATION:\n${String(input.documentation || '').slice(0, 30000) || '[Not supplied]'}\n\nRules:\n- applicable=true only when you can identify a specific Matrix rule that applies to the situation in the evidence.\n- If applicable=false, agentFollowed must be true and explain why the rule cannot be confidently identified.\n- If applicable=true and a required Matrix step was missed, agentFollowed=false.\n- matrixRequirement and matrixEvidence must identify the real Matrix requirement.\n- transcriptEvidence must identify the call evidence showing whether the required step was followed.\n- Use confidence 0-100. A critical miss should only be confirmed at high confidence.\n- Return structured evidence only. Do not expose private reasoning.`

  return callOllamaJson(input, [
    { role: 'system', content: 'You are an independent HotelPlanner Service Matrix compliance auditor. Be conservative. Never invent policy or evidence.' },
    { role: 'user', content: prompt },
  ], matrixAuditSchema)
}

async function rewriteHumanNotes(input, verifiedResult) {
  const definitions = new Map((input.criteria || []).map((criterion) => [Number(criterion.number), criterion]))
  const notesToRewrite = (verifiedResult.criteria || []).map((item) => {
    const definition = definitions.get(Number(item.number)) || {}
    return {
      number: Number(item.number),
      criterion: String(definition.name || ''),
      status: String(item.status || ''),
      originalNote: String(item.note || ''),
      criticalReason: String(item.criticalReason || ''),
      transcriptEvidence: String(item.transcriptEvidence || '').slice(0, 1200),
      documentationEvidence: String(item.documentationEvidence || '').slice(0, 1200),
      matrixEvidence: String(item.matrixEvidence || '').slice(0, 1200),
    }
  })

  const prompt = `Rewrite only the reviewer-facing coaching notes below so they sound like a real, busy QA manager wrote them. The QA scoring has already been verified and is LOCKED.\n\nNON-NEGOTIABLE RULES:\n- Do not change, question, reinterpret, or imply a different status, score, Critical decision, Matrix decision, confidence, or evidence.\n- Do not add facts that are not already present.\n- Do not soften a confirmed miss or make a passing item sound like a failure.\n- Keep Matrix and Critical findings faithful to the verified requirement.\n- Rewrite the wording only.\n- Return exactly one note for every criterion number supplied.\n\nHUMAN WRITING STYLE:\n- Sound like an experienced QA manager, not a compliance report or AI assistant.\n- Use simple, direct workplace language.\n- Vary sentence openings and sentence length across the notes.\n- Do not start most notes with "The agent". Use natural alternatives such as "Good verification here.", "I could not hear...", "The call does not show...", "This was handled well.", or a direct description of the issue when appropriate. Do not mechanically reuse these examples either.\n- Positive/Followed notes should usually be brief and natural. Avoid over-praising routine work.\n- Markdown/Partial/Critical notes should clearly say what was missed and, when supported by the supplied evidence, what should have happened instead.\n- Avoid repetitive corporate words such as "properly", "correctly", "demonstrated", "in accordance with", and "applicable" unless they are truly needed.\n- Avoid perfectly balanced three-part sentences when a shorter note works.\n- Do not mention AI, Ollama, automation, a model, retrieval, RAG, prompts, or internal system mechanics.\n\nVERIFIED QA ITEMS:\n${JSON.stringify(notesToRewrite, null, 2)}`

  try {
    const rewritten = await callOllamaJson(input, [
      { role: 'system', content: 'You are a HotelPlanner QA manager rewriting already-verified coaching notes into natural human workplace language. You may change wording only. Never change the underlying QA conclusion.' },
      { role: 'user', content: prompt },
    ], humanRewriteSchema, { temperature: 0.65 })

    if (!rewritten || !Array.isArray(rewritten.notes)) return verifiedResult
    const byNumber = new Map(
      rewritten.notes
        .map((item) => [Number(item?.number), String(item?.note || '').trim()])
        .filter(([number, note]) => Number.isFinite(number) && note),
    )

    for (const item of verifiedResult.criteria || []) {
      const humanNote = byNumber.get(Number(item.number))
      if (humanNote) item.note = humanNote.slice(0, 2000)
    }
  } catch (error) {
    // Human wording is optional. Never fail or alter a verified QA because the rewrite pass failed.
    console.warn(`[human-rewrite] using verified original notes: ${conciseError(error)}`)
  }

  return verifiedResult
}

function validatePrimaryShape(input, result) {
  if (!result || !Array.isArray(result.criteria)) throw new Error('Ollama QA result is missing criteria.')
  const expected = new Set((input.criteria || []).map((criterion) => Number(criterion.number)))
  const actual = new Set(result.criteria.map((criterion) => Number(criterion?.number)))
  if (expected.size !== actual.size || [...expected].some((number) => !actual.has(number))) {
    throw new Error('Ollama QA result did not return exactly one result for every criterion.')
  }
}

function finalVerification(input, primary, matrixAudit) {
  validatePrimaryShape(input, primary)
  const validStatuses = new Set(['✓ Followed', '✕ Markdown', 'N/A', 'Partial', 'Critical'])
  const definitions = new Map((input.criteria || []).map((criterion) => [Number(criterion.number), criterion]))

  for (const item of primary.criteria) {
    const definition = definitions.get(Number(item.number))
    if (!definition) throw new Error(`Ollama returned an unknown criterion number: ${item.number}`)
    if (!validStatuses.has(String(item.status))) throw new Error(`Ollama returned an invalid status for criterion ${item.number}.`)
    item.confidence = Math.max(0, Math.min(100, Number(item.confidence || 0)))
    item.note = String(item.note || '')
    item.transcriptEvidence = String(item.transcriptEvidence || '')
    item.documentationEvidence = String(item.documentationEvidence || '')
    item.matrixEvidence = String(item.matrixEvidence || '')
    item.criticalReason = String(item.criticalReason || '')

    const name = String(definition.name || '')
    const isMatrix = /matrix compliance/i.test(name)
    const isDocumentation = /documentation/i.test(name)
    if (item.status === 'Critical' && !isMatrix && !isDocumentation) {
      item.status = '✕ Markdown'
      item.criticalReason = ''
      item.note = item.note || 'Issue found. Critical is not allowed for this criterion.'
    }
  }

  const matrixDefinition = (input.criteria || []).find((criterion) => /matrix compliance/i.test(String(criterion?.name || '')))
  if (matrixDefinition) {
    const item = primary.criteria.find((criterion) => Number(criterion.number) === Number(matrixDefinition.number))
    if (item) {
      const independentMiss = Boolean(
        matrixAudit &&
        matrixAudit.applicable === true &&
        matrixAudit.agentFollowed === false &&
        Number(matrixAudit.confidence || 0) >= 70 &&
        hasRealMatrixEvidence(matrixAudit.matrixEvidence || matrixAudit.matrixRequirement),
      )

      if (independentMiss) {
        item.status = 'Critical'
        item.confidence = Math.max(Number(item.confidence || 0), Number(matrixAudit.confidence || 0))
        item.matrixEvidence = [matrixAudit.matrixRequirement, matrixAudit.matrixEvidence].filter(Boolean).join(' — ').slice(0, 3000)
        item.transcriptEvidence = String(matrixAudit.transcriptEvidence || item.transcriptEvidence || '').slice(0, 3000)
        item.criticalReason = 'Required Matrix process was not followed'
        item.note = String(matrixAudit.reason || item.note || 'Required Matrix process was not followed.').slice(0, 2000)
      } else if (item.status === 'Critical') {
        // The independent Matrix audit did not confirm the miss at high confidence.
        // Fail closed to manual review instead of creating an unsupported zero-score QA.
        item.status = 'N/A'
        item.criticalReason = ''
        item.confidence = Math.min(Number(item.confidence || 0), 55)
        item.note = 'Matrix result needs manual review because the independent audit did not confirm a Critical with enough evidence.'
      } else if ((item.status === '✕ Markdown' || item.status === 'Partial') && hasRealMatrixEvidence(item.matrixEvidence)) {
        // Matrix misses are zero tolerance, but only upgrade when the independent audit confirms them.
        item.status = 'N/A'
        item.criticalReason = ''
        item.confidence = Math.min(Number(item.confidence || 0), 55)
        item.note = 'Possible Matrix issue found, but the independent audit did not confirm a Critical with enough evidence. Manual review required.'
      }
    }
  }

  primary.detectedItinerary = String(primary.detectedItinerary || '')
  primary.detectedEmail = String(primary.detectedEmail || '')
  primary.detectedPhone = String(primary.detectedPhone || '')
  primary.detectedCallLength = String(primary.detectedCallLength || '')
  primary.detectedCallDate = String(primary.detectedCallDate || '')
  primary.summary = String(primary.summary || '')
  primary.overallConfidence = Math.max(0, Math.min(100, Number(primary.overallConfidence || 0)))
  return primary
}

async function runQaPipeline(input, transcript) {
  const primary = await callPrimaryQa(input, transcript)
  const matrixAudit = await auditMatrixCompliance(input, transcript)
  const verified = finalVerification(input, primary, matrixAudit)
  return rewriteHumanNotes(input, verified)
}

async function getHealth(ollamaUrl, ollamaModel) {
  const checks = {
    server: true,
    python: fs.existsSync(PYTHON),
    ollama: false,
    model: false,
  }
  const base = normalizeLocalOllamaUrl(ollamaUrl)
  const model = String(ollamaModel || DEFAULT_OLLAMA_MODEL).trim() || DEFAULT_OLLAMA_MODEL

  if (!base) {
    return { ok: false, checks, message: 'Ollama URL must point to localhost or 127.0.0.1 on the Auto QA PC.' }
  }

  try {
    const { response, payload } = await fetchJsonWithTimeout(`${base}/api/tags`, { headers: { 'Cache-Control': 'no-store' } }, 4000)
    checks.ollama = response.ok
    const names = Array.isArray(payload?.models)
      ? payload.models.flatMap((item) => [String(item?.name || ''), String(item?.model || '')]).filter(Boolean)
      : []
    checks.model = checks.ollama && names.some((name) => name === model || name.startsWith(`${model}:`))
  } catch {
    checks.ollama = false
  }

  if (!checks.python) return { ok: false, checks, message: 'Auto QA Python environment is missing. Run INSTALL-AUTO-QA.bat.' }
  if (!checks.ollama) return { ok: false, checks, message: 'Ollama is unavailable. Start Ollama or run START-EVERYTHING.bat.' }
  if (!checks.model) return { ok: false, checks, message: `Ollama model "${model}" is not installed. Run: ollama pull ${model}` }
  return { ok: true, checks, message: `Auto QA backend, Ollama, and ${model} are ready.` }
}

const server = http.createServer(async (req, res) => {
  const allowedOrigin = corsOrigin(req)
  if (allowedOrigin === null) return send(req, res, 403, { success: false, message: 'Origin is not allowed.' })
  if (req.method === 'OPTIONS') return send(req, res, 204, {})

  const requestUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`)
  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    const health = await getHealth(
      requestUrl.searchParams.get('ollamaUrl') || DEFAULT_OLLAMA_URL,
      requestUrl.searchParams.get('ollamaModel') || DEFAULT_OLLAMA_MODEL,
    )
    return send(req, res, health.ok ? 200 : 503, health)
  }
  if (req.method !== 'POST' || requestUrl.pathname !== '/api/auto-qa') {
    return send(req, res, 404, { success: false, message: 'Not found.' })
  }

  try {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 300 * 1024 * 1024) throw new Error('Audio upload is too large. Maximum request size is 300 MB.')
      chunks.push(chunk)
    }

    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const runId = String(input.runId || '').trim()
    if (!runId) throw new Error('Auto QA request is missing its run ID. Please retry the call.')
    if (!Array.isArray(input.criteria) || !input.criteria.length) throw new Error('No QA criteria were supplied.')

    const localOllamaUrl = normalizeLocalOllamaUrl(input.ollamaUrl)
    if (!localOllamaUrl) throw new Error('Ollama URL must point to localhost or 127.0.0.1 on the Auto QA PC.')
    input.ollamaUrl = localOllamaUrl

    let transcript = String(input.transcript || '').trim()
    if (!transcript) {
      if (!input.audioBase64) throw new Error('Choose an audio file first.')
      const transcription = await transcribeAudio(input.audioBase64, input.audioFileName)
      transcript = String(transcription.text || '').trim()
      input.transcribedDurationSeconds = Array.isArray(transcription.segments) && transcription.segments.length
        ? Number(transcription.segments.at(-1)?.end || 0)
        : 0
    }
    if (!transcript) throw new Error('No speech was detected in the audio.')

    const result = await runQaPipeline(input, transcript)
    if (!result.detectedCallLength && input.transcribedDurationSeconds) {
      const seconds = Math.max(0, Math.round(Number(input.transcribedDurationSeconds)))
      result.detectedCallLength = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    }

    send(req, res, 200, {
      success: true,
      data: {
        ...result,
        runId,
        transcript,
      },
    })
  } catch (error) {
    send(req, res, 500, { success: false, message: error instanceof Error ? error.message : 'Auto QA failed.' })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Auto QA service running on http://${HOST}:${PORT}`)
  console.log(`Whisper model: ${WHISPER_MODEL}`)
  console.log(`Python: ${PYTHON}`)
})