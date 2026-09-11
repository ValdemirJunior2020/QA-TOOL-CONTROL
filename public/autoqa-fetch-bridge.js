(() => {
  const nativeFetch = window.fetch.bind(window)
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))
  const AUDIO_CHUNK_CHARS = 2 * 1024 * 1024

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

  async function fetchJsonChecked(url, init, attempts = 3) {
    let lastError = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await nativeFetch(url, init)
        const payload = await response.clone().json().catch(() => ({}))
        if (!response.ok || payload?.success === false) {
          throw new Error(payload?.message || `HTTP ${response.status}`)
        }
        return { response, payload }
      } catch (error) {
        lastError = error
        if (attempt < attempts) await sleep(700 * attempt)
      }
    }
    throw lastError || new Error('Network request failed.')
  }

  async function uploadAudioInChunks(originalUrl, init) {
    if (typeof init?.body !== 'string') return null

    let requestBody
    try {
      requestBody = JSON.parse(init.body)
    } catch {
      return null
    }

    const audioBase64 = String(requestBody?.audioBase64 || '')
    if (!audioBase64 || audioBase64.length <= AUDIO_CHUNK_CHARS) return null

    const runId = String(requestBody?.runId || '').trim()
    if (!runId) throw new Error('Auto QA upload is missing its run ID.')

    const requestWithoutAudio = { ...requestBody }
    delete requestWithoutAudio.audioBase64

    const totalChunks = Math.ceil(audioBase64.length / AUDIO_CHUNK_CHARS)
    const startUrl = new URL('/api/auto-qa/upload/start', originalUrl.origin)
    const completeUrl = new URL('/api/auto-qa/upload/complete', originalUrl.origin)

    await fetchJsonChecked(startUrl.toString(), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ runId, totalChunks, request: requestWithoutAudio }),
    })

    for (let index = 0; index < totalChunks; index += 1) {
      const chunkUrl = new URL('/api/auto-qa/upload/chunk', originalUrl.origin)
      chunkUrl.searchParams.set('runId', runId)
      chunkUrl.searchParams.set('index', String(index))
      const start = index * AUDIO_CHUNK_CHARS
      const chunk = audioBase64.slice(start, start + AUDIO_CHUNK_CHARS)

      await fetchJsonChecked(chunkUrl.toString(), {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ chunk }),
      })
    }

    const { response } = await fetchJsonChecked(completeUrl.toString(), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ runId }),
    })
    return response
  }

  async function waitForJob(initial, originalUrl) {
    if (initial.status !== 202) return initial

    const accepted = await initial.clone().json().catch(() => ({}))
    if (accepted?.success !== true || accepted?.accepted !== true || !accepted?.runId) return initial

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

  window.fetch = async function autoQaSafeFetch(input, init) {
    if (!isAutoQaPost(input, init)) return nativeFetch(input, init)

    const originalUrl = new URL(requestUrl(input), window.location.href)
    try {
      const chunkedResponse = await uploadAudioInChunks(originalUrl, init)
      const initial = chunkedResponse || await nativeFetch(input, init)
      return await waitForJob(initial, originalUrl)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Auto QA upload failed.'
      return jsonResponse(503, {
        success: false,
        message: `Auto QA could not upload the call safely: ${message}`,
      })
    }
  }
})()
