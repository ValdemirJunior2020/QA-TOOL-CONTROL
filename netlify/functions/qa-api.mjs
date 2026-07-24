import { OAuth2Client } from 'google-auth-library'

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(body),
  }
}

function getBearerToken(headers = {}) {
  const value = headers.authorization || headers.Authorization || ''
  const match = String(value).match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

async function verifyIdentity(event) {
  const googleClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim()
  const idToken = getBearerToken(event.headers)

  if (idToken) {
    if (!googleClientId) throw new Error('GOOGLE_CLIENT_ID is not configured in Netlify.')
    const client = new OAuth2Client(googleClientId)
    const ticket = await client.verifyIdToken({ idToken, audience: googleClientId })
    const payload = ticket.getPayload()
    if (!payload?.email || !payload.email_verified) throw new Error('Google did not verify this email address.')
    return {
      email: payload.email.toLowerCase(),
      name: payload.name || payload.email,
      picture: payload.picture || '',
    }
  }

  const allowDevBypass = String(process.env.ALLOW_DEV_BYPASS || '').toLowerCase() === 'true'
  const isLocal = String(process.env.NETLIFY_DEV || '').toLowerCase() === 'true' || process.env.CONTEXT === 'dev'
  const devEmail = String(event.headers['x-dev-email'] || '').trim().toLowerCase()
  const devName = String(event.headers['x-dev-name'] || '').trim()

  if (allowDevBypass && isLocal && devEmail) {
    return { email: devEmail, name: devName || devEmail, picture: '' }
  }

  throw new Error('Please sign in with Google.')
}

async function readAppsScriptResponse(upstream) {
  const text = await upstream.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Apps Script returned an unreadable response (${upstream.status}).`)
  }
}

export async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') return response(204, {})

    const appsScriptUrl = String(process.env.APPS_SCRIPT_WEB_APP_URL || '').trim()
    const apiKey = String(process.env.APPS_SCRIPT_API_KEY || '').trim()
    const proxySecret = String(process.env.QA_APP_PROXY_SECRET || '').trim()

    if (!appsScriptUrl || !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/i.test(appsScriptUrl)) {
      return response(500, { success: false, message: 'APPS_SCRIPT_WEB_APP_URL is missing or invalid in Netlify.' })
    }

    const identity = await verifyIdentity(event)

    if (event.httpMethod === 'GET') {
      if (!proxySecret) {
        return response(500, { success: false, message: 'QA_APP_PROXY_SECRET is missing in Netlify.' })
      }

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
      const authorization = await readAppsScriptResponse(authorizationRequest)
      if (!authorization.success) {
        return response(403, authorization)
      }

      const params = new URLSearchParams(event.queryStringParameters || {})
      params.set('action', params.get('action') || 'reviews')
      if (apiKey) params.set('key', apiKey)
      const upstream = await fetch(`${appsScriptUrl}?${params.toString()}`, {
        method: 'GET',
        redirect: 'follow',
        headers: { Accept: 'application/json' },
      })
      const body = await readAppsScriptResponse(upstream)

      // Keep review access aligned with the account rules stored in QA App Users.
      // Administrators and people with history permission receive all rows.
      // Other evaluators receive only reviews saved under their evaluator name.
      if (Array.isArray(body.reviews) && authorization.user) {
        const canViewAll =
          authorization.user.role === 'admin' ||
          authorization.user.permissions?.canViewHistory === true

        if (!canViewAll) {
          const evaluatorName = String(authorization.user.displayName || '').trim().toLowerCase()
          body.reviews = body.reviews.filter(
            (review) => String(review?.evaluator || '').trim().toLowerCase() === evaluatorName,
          )
        }
      }

      return response(upstream.ok ? 200 : upstream.status, body)
    }

    if (event.httpMethod !== 'POST') {
      return response(405, { success: false, message: 'Method not allowed.' })
    }

    if (!proxySecret) {
      return response(500, { success: false, message: 'QA_APP_PROXY_SECRET is missing in Netlify.' })
    }

    let requestBody = {}
    try {
      requestBody = event.body ? JSON.parse(event.body) : {}
    } catch {
      return response(400, { success: false, message: 'The request body is not valid JSON.' })
    }

    const upstream = await fetch(appsScriptUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        ...requestBody,
        proxySecret,
        actorEmail: identity.email,
        actorName: identity.name,
      }),
    })

    const body = await readAppsScriptResponse(upstream)
    return response(upstream.ok ? 200 : upstream.status, body)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.'
    return response(message.includes('sign in') ? 401 : 500, { success: false, message })
  }
}
