(() => {
  const nativeFetch = window.fetch.bind(window)
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

  function requestUrl(input) {
    if (typeof input === 'string') return input
    if (input instanceof URL) return input.toString()
    if (input instanceof Request) return input.url
    return String(input || '')
  }

  function requestMethod(input, init) {
    const explicit = init?.method
    if (explicit) return String(explicit).toUpperCase()
    if (input instanceof Request) return String(input.method || 'GET').toUpperCase()
    return 'GET'
  }

  function jsonResponse(status, payload) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  }

  function isAutoQaPost(input, init) {
    if (requestMethod(input, init) !== 'POST') return false
    try {
      const url = new URL(requestUrl(input), window.location.href)
      return url.pathname === '/api/auto-qa'
    } catch {
      return false
    }
  }

  window.fetch = async function autoQaSafeFetch(input, init) {
    if (!isAutoQaPost(input, init)) return nativeFetch(input, init)

    const initial = await nativeFetch(input, init)
    if (initial.status !== 202) return initial

    const accepted = await initial.clone().json().catch(() => ({}))
    if (accepted?.success !== true || accepted?.accepted !== true || !accepted?.runId) return initial

    const originalUrl = new URL(requestUrl(input), window.location.href)
    const statusUrl = new URL('/api/auto-qa/status', originalUrl.origin)
    statusUrl.searchParams.set('runId', String(accepted.runId))

    let consecutiveNetworkFailures = 0
    const maxPolls = 900

    for (let poll = 0; poll < maxPolls; poll += 1) {
      await sleep(2000)
      try {
        const statusResponse = await nativeFetch(statusUrl.toString(), {
          method: 'GET',
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-store' },
        })
        const payload = await statusResponse.json().catch(() => ({}))
        if (!statusResponse.ok || payload?.success !== true || !payload?.job) {
          if (statusResponse.status === 404) {
            return jsonResponse(500, { success: false, message: payload?.message || 'Auto QA job was not found or has expired.' })
          }
          throw new Error(payload?.message || `Auto QA status failed with HTTP ${statusResponse.status}.`)
        }

        consecutiveNetworkFailures = 0
        const job = payload.job
        if (job.status === 'completed') {
          return jsonResponse(200, { success: true, data: job.data })
        }
        if (job.status === 'failed') {
          return jsonResponse(500, { success: false, message: job.message || 'Auto QA failed.' })
        }
      } catch (error) {
        consecutiveNetworkFailures += 1
        if (consecutiveNetworkFailures >= 8) {
          const message = error instanceof Error ? error.message : 'Auto QA status connection failed.'
          return jsonResponse(503, {
            success: false,
            message: `${message} The QA may still be processing on the Auto QA PC. Recheck the tunnel before retrying.`,
          })
        }
      }
    }

    return jsonResponse(504, {
      success: false,
      message: 'Auto QA is taking longer than 30 minutes. The server job was not cancelled, but the browser stopped waiting.',
    })
  }
})()
