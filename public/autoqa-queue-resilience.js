(() => {
  const previousFetch = window.fetch.bind(window)
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))
  const MAX_WAIT_MS = 60 * 60 * 1000
  const START_GRACE_MS = 2 * 60 * 1000
  const POLL_MS = 2000

  function requestUrl(input) {
    if (typeof input === 'string') return input
    if (input instanceof URL) return input.toString()
    if (input instanceof Request) return input.url
    return String(input || '')
  }

  function requestMethod(input, init) {
    if (init?.method) return String(init.method).toUpperCase()
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

  function emit(detail) {
    window.dispatchEvent(new CustomEvent('autoqa:job-status', { detail }))
  }

  async function monitorJob(runId, origin) {
    const startedAt = Date.now()
    let seenJob = false
    let networkFailures = 0

    while (Date.now() - startedAt < MAX_WAIT_MS) {
      await sleep(POLL_MS)
      try {
        const statusUrl = new URL('/api/auto-qa/status', origin)
        statusUrl.searchParams.set('runId', runId)
        const response = await previousFetch(statusUrl.toString(), {
          method: 'GET',
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-store' },
        })
        const payload = await response.json().catch(() => ({}))

        if (response.status === 404 && !seenJob && Date.now() - startedAt < START_GRACE_MS) {
          emit({
            runId,
            status: 'uploading',
            stage: 'Uploading call',
            position: 0,
            message: 'Uploading call safely…',
          })
          continue
        }

        if (!response.ok || payload?.success !== true || !payload?.job) {
          throw new Error(payload?.message || `Auto QA status failed with HTTP ${response.status}.`)
        }

        seenJob = true
        networkFailures = 0
        emit(payload.job)

        if (payload.job.status === 'completed') return { kind: 'completed', job: payload.job }
        if (payload.job.status === 'failed') return { kind: 'failed', job: payload.job }
      } catch (error) {
        networkFailures += 1
        emit({
          runId,
          status: 'reconnecting',
          stage: 'Reconnecting to Auto QA',
          position: null,
          message: 'Connection interrupted. Your QA may still be processing; retrying automatically.',
          networkFailures,
        })
      }
    }

    emit({
      runId,
      status: 'timeout',
      stage: 'Still processing',
      position: null,
      message: 'Auto QA has been processing for more than 60 minutes.',
    })
    return { kind: 'timeout' }
  }

  window.fetch = async function autoQaQueueResilientFetch(input, init) {
    let url
    try {
      url = new URL(requestUrl(input), window.location.href)
    } catch {
      return previousFetch(input, init)
    }

    if (requestMethod(input, init) !== 'POST' || url.pathname !== '/api/auto-qa') {
      return previousFetch(input, init)
    }

    let runId = ''
    try {
      if (typeof init?.body === 'string') runId = String(JSON.parse(init.body)?.runId || '').trim()
    } catch {}
    if (!runId) return previousFetch(input, init)

    emit({
      runId,
      status: 'uploading',
      stage: 'Uploading call',
      position: 0,
      message: 'Uploading call safely…',
    })

    const monitorPromise = monitorJob(runId, url.origin)
    const bridgeResponse = await previousFetch(input, init)

    if (bridgeResponse.ok) return bridgeResponse

    if (bridgeResponse.status === 503 || bridgeResponse.status === 504) {
      const result = await monitorPromise
      if (result.kind === 'completed') {
        return jsonResponse(200, { success: true, data: result.job.data })
      }
      if (result.kind === 'failed') {
        return jsonResponse(500, {
          success: false,
          message: result.job.message || 'Auto QA failed.',
        })
      }
    }

    return bridgeResponse
  }
})()
