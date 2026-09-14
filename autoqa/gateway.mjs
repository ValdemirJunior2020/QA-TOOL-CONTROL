// Keep the original gateway path stable for launchers and frontend health checks.
// The local-RAG gateway preserves the same API while adding txtai, LightRAG,
// and optional ai-memory retrieval before final QA verification.
//
// IMPORTANT: Node's built-in fetch uses an Undici headers timeout of about 5 minutes.
// Long local Auto QA worker calls can legitimately take longer than that, which can
// surface only as `fetch failed` even while the worker is still healthy. For the
// long localhost POST only, use node:http with no socket timeout. Everything else
// continues to use the native fetch implementation.
import http from 'node:http'

const nativeFetch = globalThis.fetch.bind(globalThis)
const workerPort = Number(process.env.AUTO_QA_WORKER_PORT || 8789)
const workerOrigin = `http://127.0.0.1:${workerPort}`

function isLongWorkerRequest(input, init) {
  const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (method !== 'POST') return false
  try {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url
    const url = new URL(raw)
    return url.origin === workerOrigin && url.pathname === '/api/auto-qa'
  } catch {
    return false
  }
}

function longWorkerFetch(input, init = {}) {
  if (!isLongWorkerRequest(input, init)) return nativeFetch(input, init)

  const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url
  const url = new URL(raw)

  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: String(init.method || 'POST').toUpperCase(),
      headers: init.headers || {},
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => {
        const contentType = String(response.headers['content-type'] || 'application/json; charset=utf-8')
        resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode || 500,
          statusText: response.statusMessage || '',
          headers: { 'Content-Type': contentType },
        }))
      })
    })

    // A full local QA can take well beyond five minutes. Do not apply a socket timeout.
    request.setTimeout(0)
    request.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error || 'unknown local worker error')
      reject(new Error(`Local Auto QA worker connection failed: ${message}`))
    })

    if (init.body !== undefined && init.body !== null) request.write(init.body)
    request.end()
  })
}

globalThis.fetch = longWorkerFetch

await import('./gateway-rag.mjs')
