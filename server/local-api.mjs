import http from 'node:http'
import { OAuth2Client } from 'google-auth-library'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createVerify } from 'node:crypto'

function loadEnvFile() {
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return
  const text = readFileSync(envPath, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index < 1) continue
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvFile()

const PORT = Number(process.env.LOCAL_API_PORT || 8787)
const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Dev-Email, X-Dev-Name',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function send(res, status, body) {
  res.writeHead(status, jsonHeaders)
  res.end(JSON.stringify(body))
}

function getBearerToken(req) {
  const value = String(req.headers.authorization || '')
  const match = value.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

function decodeJwtPart(value) {
  return JSON.parse(Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
}

async function verifySignedGoogleTokenWithWorkdayGrace(idToken, googleClientId) {
  const parts = String(idToken || '').split('.')
  if (parts.length !== 3) throw new Error('Google returned an invalid sign-in token.')
  const header = decodeJwtPart(parts[0])
  const payload = decodeJwtPart(parts[1])
  if (!header.kid || header.alg !== 'RS256') throw new Error('Google returned an invalid token header.')

  const client = new OAuth2Client(googleClientId)
  const certificateResult = await client.getFederatedSignonCertsAsync()
  const certificate = certificateResult?.certs?.[header.kid]
  if (!certificate) throw new Error('Google token certificate was not found.')

  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${parts[0]}.${parts[1]}`)
  verifier.end()
  const signature = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (!verifier.verify(certificate, signature)) throw new Error('Google token signature is invalid.')

  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(String(payload.iss || ''))) throw new Error('Google token issuer is invalid.')
  if (!audience.includes(googleClientId)) throw new Error('Google token audience is invalid.')
  if (!payload.email || payload.email_verified !== true) throw new Error('Google did not verify this email address.')

  const issuedAt = Number(payload.iat || 0)
  const now = Math.floor(Date.now() / 1000)
  if (!issuedAt || issuedAt > now + 300 || now - issuedAt > 24 * 60 * 60) throw new Error('Please sign in with Google again.')
  return payload
}

async function verifyIdentity(req) {
  const googleClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim()
  const idToken = getBearerToken(req)

  if (idToken) {
    if (!googleClientId) throw new Error('GOOGLE_CLIENT_ID is not configured in .env.')
    const client = new OAuth2Client(googleClientId)
    let payload
    try {
      const ticket = await client.verifyIdToken({ idToken, audience: googleClientId })
      payload = ticket.getPayload()
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : ''
      if (!message.includes('expired') && !message.includes('used too late')) throw error
      payload = await verifySignedGoogleTokenWithWorkdayGrace(idToken, googleClientId)
    }
    if (!payload?.email || !payload.email_verified) throw new Error('Google did not verify this email address.')
    return {
      email: payload.email.toLowerCase(),
      name: payload.name || payload.email,
      picture: payload.picture || '',
    }
  }

  const allowDevBypass = String(process.env.ALLOW_DEV_BYPASS || '').toLowerCase() === 'true'
  const devEmail = String(req.headers['x-dev-email'] || '').trim().toLowerCase()
  const devName = String(req.headers['x-dev-name'] || '').trim()
  if (allowDevBypass && devEmail) return { email: devEmail, name: devName || devEmail, picture: '' }

  throw new Error('Please sign in with Google.')
}

async function readJson(upstream) {
  const text = await upstream.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Apps Script returned an unreadable response (${upstream.status}). Check APPS_SCRIPT_WEB_APP_URL and redeploy ReactQaApi.gs.`)
  }
}

async function readRequestBody(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  if (!body) return {}
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('The request body is not valid JSON.')
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {})

    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`)
    if (!requestUrl.pathname.startsWith('/api/')) return send(res, 404, { success: false, message: 'Not found.' })

    const appsScriptUrl = String(process.env.APPS_SCRIPT_WEB_APP_URL || '').trim()
    const apiKey = String(process.env.APPS_SCRIPT_API_KEY || '').trim()
    const proxySecret = String(process.env.QA_APP_PROXY_SECRET || '').trim()

    if (!appsScriptUrl || !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/i.test(appsScriptUrl)) {
      return send(res, 500, { success: false, message: 'APPS_SCRIPT_WEB_APP_URL is missing or invalid in .env.' })
    }
    if (!proxySecret) return send(res, 500, { success: false, message: 'QA_APP_PROXY_SECRET is missing in .env.' })

    const identity = await verifyIdentity(req)

    if (req.method === 'GET') {
      const authorizationRequest = await fetch(appsScriptUrl, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          action: 'authorize',
          proxySecret,
          actorEmail: identity.email,
          actorName: identity.name,
        }),
      })
      const authorization = await readJson(authorizationRequest)
      if (!authorization.success) return send(res, 403, authorization)

      const params = new URLSearchParams(requestUrl.searchParams)
      params.set('action', params.get('action') || 'reviews')
      if (apiKey) params.set('key', apiKey)

      const upstream = await fetch(`${appsScriptUrl}?${params.toString()}`, {
        method: 'GET',
        redirect: 'follow',
        headers: { Accept: 'application/json' },
      })
      const result = await readJson(upstream)

      if (Array.isArray(result.reviews) && authorization.user) {
        const canViewAll = authorization.user.role === 'admin' || authorization.user.permissions?.canViewHistory === true
        if (!canViewAll) {
          const evaluatorName = String(authorization.user.displayName || '').trim().toLowerCase()
          result.reviews = result.reviews.filter(
            (review) => String(review?.evaluator || '').trim().toLowerCase() === evaluatorName,
          )
        }
      }
      return send(res, upstream.ok ? 200 : upstream.status, result)
    }

    if (req.method !== 'POST') return send(res, 405, { success: false, message: 'Method not allowed.' })

    const requestBody = await readRequestBody(req)
    const upstream = await fetch(appsScriptUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        ...requestBody,
        proxySecret,
        actorEmail: identity.email,
        actorName: identity.name,
      }),
    })
    const result = await readJson(upstream)
    return send(res, upstream.ok ? 200 : upstream.status, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.'
    return send(res, message.includes('sign in') ? 401 : 500, { success: false, message })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Local QA API ready: http://localhost:${PORT}`)
})
