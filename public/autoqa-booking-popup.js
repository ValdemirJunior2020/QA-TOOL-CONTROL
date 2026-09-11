(() => {
  const PANEL_ID = 'autoqa-booking-flow-modal'
  const STYLE_ID = 'autoqa-booking-flow-style'
  const TRANSCRIPT_STORAGE_KEY = 'qa-control:autoqa:last-transcript'
  const TRANSCRIPT_MODAL_ID = 'autoqa-transcript-viewer'
  let dismissedStage = ''
  let renderedStage = ''
  let latestTranscript = ''

  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()

  try {
    latestTranscript = sessionStorage.getItem(TRANSCRIPT_STORAGE_KEY) || ''
  } catch {}

  function findTranscriptInPayload(payload, depth = 0) {
    if (!payload || depth > 5) return ''
    if (typeof payload === 'string') return ''
    if (Array.isArray(payload)) {
      for (const item of payload) {
        const found = findTranscriptInPayload(item, depth + 1)
        if (found) return found
      }
      return ''
    }
    if (typeof payload !== 'object') return ''

    for (const key of ['transcript', 'fullTranscript', 'full_transcript', 'transcription', 'transcriptText', 'transcript_text']) {
      const value = payload[key]
      if (typeof value === 'string' && value.trim().length > 20) return value.trim()
    }

    for (const value of Object.values(payload)) {
      const found = findTranscriptInPayload(value, depth + 1)
      if (found) return found
    }
    return ''
  }

  function rememberTranscript(text) {
    const value = String(text || '').trim()
    if (!value) return
    latestTranscript = value
    try { sessionStorage.setItem(TRANSCRIPT_STORAGE_KEY, value) } catch {}
    window.dispatchEvent(new CustomEvent('autoqa-transcript-ready', { detail: { transcript: value } }))
    window.setTimeout(ensureTranscriptControls, 0)
  }

  if (!window.__autoQaTranscriptFetchHookInstalled) {
    window.__autoQaTranscriptFetchHookInstalled = true
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const response = await originalFetch(...args)
      try {
        const clone = response.clone()
        const contentType = clone.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          clone.json().then((payload) => {
            const transcript = findTranscriptInPayload(payload)
            if (transcript) rememberTranscript(transcript)
          }).catch(() => {})
        }
      } catch {}
      return response
    }
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      #${PANEL_ID}{position:fixed;right:18px;bottom:18px;z-index:10000;width:min(620px,calc(100vw - 36px));max-height:72vh;overflow:auto;background:#fff;border:1px solid #d8dbe7;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.28);padding:20px;color:#17124f;user-select:text;-webkit-user-select:text}
      #${PANEL_ID} *{box-sizing:border-box}
      .autoqa-flow-close{position:absolute;top:10px;right:10px;width:34px;height:34px;border:0;border-radius:999px;background:#f1f2f7;color:#252944;font-size:20px;cursor:pointer;font-weight:900}
      .autoqa-flow-eyebrow{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#6d5bd0;margin:0 0 6px}
      #${PANEL_ID} h2{margin:0 42px 8px 0;font-size:23px;line-height:1.2}
      .autoqa-flow-copy{margin:0 0 14px;color:#5f6472;line-height:1.45}
      .autoqa-flow-found{display:grid;grid-template-columns:1fr;gap:10px;margin:14px 0 18px}
      .autoqa-flow-field{display:grid;gap:5px}
      .autoqa-flow-field span{font-size:12px;font-weight:800;color:#4f5270}
      .autoqa-flow-copy-row{display:flex;gap:7px;align-items:stretch}
      .autoqa-flow-copy-row input,.autoqa-flow-field textarea{width:100%;min-width:0;border:1px solid #cfd3e2;border-radius:9px;padding:10px 11px;font:inherit;color:#161829;background:#fff;user-select:text!important;-webkit-user-select:text!important;pointer-events:auto!important}
      .autoqa-flow-field textarea{min-height:150px;resize:vertical}
      .autoqa-flow-copy-btn{border:1px solid #d7d9e4;border-radius:9px;background:#f1f2f7;color:#252944;font-weight:800;padding:0 13px;cursor:pointer;white-space:nowrap}
      .autoqa-flow-not-found{font-size:11px;color:#8b5e00}
      .autoqa-flow-question{margin:7px 0 2px;font-size:18px;font-weight:800}
      .autoqa-flow-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}
      .autoqa-flow-actions button{border:0;border-radius:9px;padding:10px 14px;font-weight:800;cursor:pointer}
      .autoqa-flow-primary{background:#ffd83d;color:#181338}
      .autoqa-flow-secondary{background:#f1f2f7;color:#252944;border:1px solid #d7d9e4!important}
      .autoqa-flow-waiting{margin-top:12px;padding:10px 12px;border-radius:9px;background:#f7f5ff;color:#4d428b;font-weight:700}
      .autoqa-transcript-controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-left:4px}
      .autoqa-transcript-button{border:1px solid #cfd3e2!important;border-radius:9px!important;background:#fff!important;color:#1d2354!important;padding:9px 12px!important;font-weight:800!important;cursor:pointer!important}
      #${TRANSCRIPT_MODAL_ID}{position:fixed;inset:0;z-index:11000;background:rgba(10,13,30,.62);display:flex;align-items:center;justify-content:center;padding:24px}
      #${TRANSCRIPT_MODAL_ID} .autoqa-transcript-card{width:min(900px,96vw);max-height:88vh;display:flex;flex-direction:column;background:#fff;border-radius:16px;box-shadow:0 28px 80px rgba(0,0,0,.35);padding:22px;position:relative;color:#17124f}
      #${TRANSCRIPT_MODAL_ID} textarea{width:100%;min-height:420px;max-height:60vh;resize:vertical;border:1px solid #cfd3e2;border-radius:10px;padding:14px;font:14px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;color:#161829;background:#fff;user-select:text!important;-webkit-user-select:text!important}
      #${TRANSCRIPT_MODAL_ID} .autoqa-transcript-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px}
      #${TRANSCRIPT_MODAL_ID} button{border:1px solid #d7d9e4;border-radius:9px;background:#f1f2f7;color:#252944;font-weight:800;padding:10px 14px;cursor:pointer}
      #${TRANSCRIPT_MODAL_ID} .primary{background:#ffd83d;color:#181338;border:0}
      @media(max-width:700px){#${PANEL_ID}{right:8px;bottom:8px;width:calc(100vw - 16px);max-height:65vh;padding:16px}#${TRANSCRIPT_MODAL_ID}{padding:8px}#${TRANSCRIPT_MODAL_ID} textarea{min-height:320px}}
    `
    document.head.appendChild(style)
  }

  function getTranscript() {
    if (latestTranscript) return latestTranscript
    try { return sessionStorage.getItem(TRANSCRIPT_STORAGE_KEY) || '' } catch { return '' }
  }

  function safeFilePart(value) {
    return String(value || '').trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'call'
  }

  function currentCallId() {
    return fieldInput('Call ID')?.value || fieldInput('Confirmation / Itinerary #')?.value || 'call'
  }

  function downloadTranscript() {
    const transcript = getTranscript()
    if (!transcript) {
      window.alert('Transcript is not available yet. Recheck the call once, then try again.')
      return
    }
    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${safeFilePart(currentCallId())}-transcript.txt`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  function copyTranscript(button) {
    const transcript = getTranscript()
    if (!transcript) return
    navigator.clipboard?.writeText(transcript).then(() => {
      if (!button) return
      const old = button.textContent
      button.textContent = 'Copied'
      setTimeout(() => { if (button.isConnected) button.textContent = old }, 900)
    }).catch(() => {})
  }

  function closeTranscriptViewer() {
    document.getElementById(TRANSCRIPT_MODAL_ID)?.remove()
  }

  function viewTranscript() {
    ensureStyles()
    const transcript = getTranscript()
    if (!transcript) {
      window.alert('Transcript is not available yet. Recheck the call once, then try again.')
      return
    }
    closeTranscriptViewer()
    const modal = document.createElement('div')
    modal.id = TRANSCRIPT_MODAL_ID
    modal.innerHTML = `
      <section class="autoqa-transcript-card" role="dialog" aria-modal="true">
        <button type="button" class="autoqa-flow-close" data-transcript-close aria-label="Close">×</button>
        <p class="autoqa-flow-eyebrow">Auto QA Transcript</p>
        <h2>Call Transcript</h2>
        <p class="autoqa-flow-copy">Select and copy anything you need, or download the full transcript as a TXT file.</p>
        <textarea readonly data-transcript-text>${escapeHtml(transcript)}</textarea>
        <div class="autoqa-transcript-actions">
          <button type="button" class="primary" data-transcript-download>Download Transcript (.txt)</button>
          <button type="button" data-transcript-copy>Copy Full Transcript</button>
          <button type="button" data-transcript-close>Close</button>
        </div>
      </section>`
    document.body.appendChild(modal)
    modal.querySelectorAll('[data-transcript-close]').forEach((button) => button.addEventListener('click', closeTranscriptViewer))
    modal.querySelector('[data-transcript-download]')?.addEventListener('click', downloadTranscript)
    modal.querySelector('[data-transcript-copy]')?.addEventListener('click', (event) => copyTranscript(event.currentTarget))
    modal.addEventListener('click', (event) => { if (event.target === modal) closeTranscriptViewer() })
    const area = modal.querySelector('[data-transcript-text]')
    area?.focus()
  }

  function ensureTranscriptControls() {
    ensureStyles()
    const pagePanel = findPanel()
    if (!pagePanel) return
    const transcriptReady = Array.from(pagePanel.querySelectorAll('span')).some((span) => normalize(span.textContent).includes('Transcript ready'))
    if (!transcriptReady && !getTranscript()) return

    const actions = pagePanel.querySelector('.autoqa-actions')
    if (!actions || actions.querySelector('[data-autoqa-transcript-controls]')) return

    const wrap = document.createElement('div')
    wrap.className = 'autoqa-transcript-controls'
    wrap.dataset.autoqaTranscriptControls = 'true'
    wrap.innerHTML = `
      <button type="button" class="autoqa-transcript-button" data-view-transcript>View Transcript</button>
      <button type="button" class="autoqa-transcript-button" data-download-transcript>Download Transcript</button>`
    actions.appendChild(wrap)
    wrap.querySelector('[data-view-transcript]')?.addEventListener('click', viewTranscript)
    wrap.querySelector('[data-download-transcript]')?.addEventListener('click', downloadTranscript)
  }

  function findField(labelText) {
    const labels = Array.from(document.querySelectorAll('.details-grid label'))
    return labels.find((label) => normalize(label.querySelector('span')?.textContent).includes(labelText)) || null
  }

  function fieldInput(labelText) {
    return findField(labelText)?.querySelector('input') || null
  }

  function setNativeValue(element, value) {
    if (!element) return
    const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function findPanel() {
    return document.querySelector('.autoqa-review-panel')
  }

  function visibleStageBanner(text) {
    const panel = findPanel()
    if (!panel) return null
    return Array.from(panel.querySelectorAll('.validation-banner')).find((banner) => normalize(banner.textContent).includes(text)) || null
  }

  function buttonIn(root, text) {
    if (!root) return null
    return Array.from(root.querySelectorAll('button')).find((button) => normalize(button.textContent).includes(text)) || null
  }

  function currentStage() {
    if (visibleStageBanner('Is the booking an HP booking?')) return 'booking'
    if (visibleStageBanner('Did you find the booking documentation / notes?')) return 'notes-choice'
    const panel = findPanel()
    if (panel?.querySelector('.autoqa-documentation-field textarea')) {
      const finish = Array.from(panel.querySelectorAll('button')).find((button) => normalize(button.textContent).includes('Finish Documentation QA') || normalize(button.textContent).includes('Reviewing Documentation'))
      if (finish) return 'paste-docs'
    }
    return ''
  }

  function removePanel(manual = false) {
    if (manual) dismissedStage = currentStage()
    document.getElementById(PANEL_ID)?.remove()
    renderedStage = ''
  }

  function makePanel(stage) {
    ensureStyles()
    removePanel(false)
    const panel = document.createElement('section')
    panel.id = PANEL_ID
    panel.dataset.stage = stage
    panel.setAttribute('aria-live', 'polite')
    document.body.appendChild(panel)
    renderedStage = stage
    return panel
  }

  function addClose(panel) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'autoqa-flow-close'
    button.textContent = '×'
    button.title = 'Close and keep working'
    button.addEventListener('click', () => removePanel(true))
    panel.appendChild(button)
  }

  function copyInput(input, button) {
    if (!input || !input.value) return
    input.focus()
    input.select()
    input.setSelectionRange?.(0, input.value.length)
    let copied = false
    try { copied = document.execCommand('copy') } catch {}
    if (!copied && navigator.clipboard?.writeText) navigator.clipboard.writeText(input.value).catch(() => {})
    if (button) {
      button.textContent = 'Copied'
      setTimeout(() => { if (button.isConnected) button.textContent = 'Copy' }, 900)
    }
  }

  function wireCopies(panel) {
    panel.querySelectorAll('[data-copy-for]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const input = panel.querySelector(`[data-field="${button.dataset.copyFor}"]`)
        copyInput(input, button)
      })
    })
  }

  function renderBooking() {
    const banner = visibleStageBanner('Is the booking an HP booking?')
    if (!banner || dismissedStage === 'booking') return false
    if (renderedStage === 'booking' && document.getElementById(PANEL_ID)) return true

    const itinerary = fieldInput('Confirmation / Itinerary #')
    const email = fieldInput('Guest Email')
    const phone = fieldInput('Guest Phone')
    const values = {
      itinerary: itinerary?.value || '',
      email: email?.value || '',
      phone: phone?.value || '',
    }

    const panel = makePanel('booking')
    panel.innerHTML = `
      <p class="autoqa-flow-eyebrow">Call QA Complete</p>
      <h2>Booking details found from the call</h2>
      <p class="autoqa-flow-copy">This panel does not block the page. Select, copy, paste, or edit any value below while you work.</p>
      <div class="autoqa-flow-found">
        ${fieldHtml('itinerary','Itinerary / Confirmation',values.itinerary)}
        ${fieldHtml('email','Guest Email',values.email)}
        ${fieldHtml('phone','Guest Phone',values.phone)}
      </div>
      <div class="autoqa-flow-question">Is the booking an HP booking?</div>
      <div class="autoqa-flow-actions">
        <button class="autoqa-flow-primary" data-action="hp-yes">Yes — HP Booking</button>
        <button class="autoqa-flow-secondary" data-action="hp-no">No — Not HP</button>
        <button class="autoqa-flow-secondary" data-action="view-transcript">View Transcript</button>
        <button class="autoqa-flow-secondary" data-action="download-transcript">Download Transcript</button>
        <button class="autoqa-flow-secondary" data-action="close">Close / Keep Working</button>
      </div>`
    addClose(panel)
    wireCopies(panel)

    panel.querySelector('[data-field="itinerary"]')?.addEventListener('input', (e) => setNativeValue(itinerary, e.target.value))
    panel.querySelector('[data-field="email"]')?.addEventListener('input', (e) => setNativeValue(email, e.target.value))
    panel.querySelector('[data-field="phone"]')?.addEventListener('input', (e) => setNativeValue(phone, e.target.value))
    panel.querySelector('[data-action="hp-yes"]')?.addEventListener('click', () => { dismissedStage = ''; buttonIn(banner, 'Yes — HP Booking')?.click(); removePanel(false) })
    panel.querySelector('[data-action="hp-no"]')?.addEventListener('click', () => { dismissedStage = ''; buttonIn(banner, 'No — Not HP')?.click(); removePanel(false) })
    panel.querySelector('[data-action="view-transcript"]')?.addEventListener('click', viewTranscript)
    panel.querySelector('[data-action="download-transcript"]')?.addEventListener('click', downloadTranscript)
    panel.querySelector('[data-action="close"]')?.addEventListener('click', () => removePanel(true))
    return true
  }

  function renderNotesChoice() {
    const banner = visibleStageBanner('Did you find the booking documentation / notes?')
    if (!banner || dismissedStage === 'notes-choice') return false
    if (renderedStage === 'notes-choice' && document.getElementById(PANEL_ID)) return true

    const originals = {
      itinerary: fieldInput('Confirmation / Itinerary #'),
      email: fieldInput('Guest Email'),
      phone: fieldInput('Guest Phone'),
    }
    const panel = makePanel('notes-choice')
    panel.innerHTML = `
      <p class="autoqa-flow-eyebrow">Booking Located</p>
      <h2>Find the booking documentation</h2>
      <p class="autoqa-flow-copy">Copy any value below while you search. The main page remains fully usable.</p>
      <div class="autoqa-flow-found">
        ${fieldHtml('itinerary','Itinerary / Confirmation',originals.itinerary?.value || '')}
        ${fieldHtml('email','Guest Email',originals.email?.value || '')}
        ${fieldHtml('phone','Guest Phone',originals.phone?.value || '')}
      </div>
      <div class="autoqa-flow-question">Did you find the booking documentation / notes?</div>
      <div class="autoqa-flow-actions">
        <button class="autoqa-flow-primary" data-action="paste">Yes — Paste Documentation</button>
        <button class="autoqa-flow-secondary" data-action="manual">I Will QA Documentation Manually</button>
        <button class="autoqa-flow-secondary" data-action="without">QA What We Have Without Notes</button>
        <button class="autoqa-flow-secondary" data-action="view-transcript">View Transcript</button>
        <button class="autoqa-flow-secondary" data-action="download-transcript">Download Transcript</button>
        <button class="autoqa-flow-secondary" data-action="close">Close / Keep Working</button>
      </div>`
    addClose(panel)
    wireCopies(panel)

    Object.entries(originals).forEach(([key, original]) => panel.querySelector(`[data-field="${key}"]`)?.addEventListener('input', (e) => setNativeValue(original, e.target.value)))
    panel.querySelector('[data-action="paste"]')?.addEventListener('click', () => { dismissedStage = ''; buttonIn(banner, 'Paste Documentation')?.click(); removePanel(false) })
    panel.querySelector('[data-action="manual"]')?.addEventListener('click', () => { dismissedStage = ''; buttonIn(banner, 'I Will QA Documentation Manually')?.click(); removePanel(false) })
    panel.querySelector('[data-action="without"]')?.addEventListener('click', () => { dismissedStage = ''; buttonIn(banner, 'QA What We Have Without Notes')?.click(); removePanel(false) })
    panel.querySelector('[data-action="view-transcript"]')?.addEventListener('click', viewTranscript)
    panel.querySelector('[data-action="download-transcript"]')?.addEventListener('click', downloadTranscript)
    panel.querySelector('[data-action="close"]')?.addEventListener('click', () => removePanel(true))
    return true
  }

  function renderPasteDocs() {
    const pagePanel = findPanel()
    const textarea = pagePanel?.querySelector('.autoqa-documentation-field textarea')
    if (!textarea || dismissedStage === 'paste-docs') return false
    const finish = Array.from(pagePanel.querySelectorAll('button')).find((button) => normalize(button.textContent).includes('Finish Documentation QA') || normalize(button.textContent).includes('Reviewing Documentation'))
    if (!finish) return false
    if (renderedStage === 'paste-docs' && document.getElementById(PANEL_ID)) return true

    const back = Array.from(pagePanel.querySelectorAll('button')).find((button) => normalize(button.textContent) === 'Back')
    const panel = makePanel('paste-docs')
    panel.innerHTML = `
      <p class="autoqa-flow-eyebrow">Documentation Step</p>
      <h2>Paste the booking documentation</h2>
      <p class="autoqa-flow-copy">Paste the full booking documentation below.</p>
      <label class="autoqa-flow-field"><span>Documentation / Itinerary Notes</span><textarea data-docs>${escapeHtml(textarea.value || '')}</textarea></label>
      <div class="autoqa-flow-actions">
        <button class="autoqa-flow-primary" data-action="finish" ${textarea.value.trim() ? '' : 'disabled'}>Finish Documentation QA</button>
        <button class="autoqa-flow-secondary" data-action="back">Back</button>
        <button class="autoqa-flow-secondary" data-action="view-transcript">View Transcript</button>
        <button class="autoqa-flow-secondary" data-action="download-transcript">Download Transcript</button>
        <button class="autoqa-flow-secondary" data-action="close">Close / Keep Working</button>
      </div>
      <div class="autoqa-flow-waiting">AI is waiting for your documentation.</div>`
    addClose(panel)

    const modalTextarea = panel.querySelector('[data-docs]')
    const finishButton = panel.querySelector('[data-action="finish"]')
    modalTextarea?.addEventListener('input', (e) => { setNativeValue(textarea, e.target.value); finishButton.disabled = !e.target.value.trim() })
    finishButton?.addEventListener('click', () => { if (!modalTextarea.value.trim()) return; setNativeValue(textarea, modalTextarea.value); finish.click(); finishButton.disabled = true; finishButton.textContent = 'Reviewing Documentation…' })
    panel.querySelector('[data-action="back"]')?.addEventListener('click', () => { dismissedStage = ''; back?.click(); removePanel(false) })
    panel.querySelector('[data-action="view-transcript"]')?.addEventListener('click', viewTranscript)
    panel.querySelector('[data-action="download-transcript"]')?.addEventListener('click', downloadTranscript)
    panel.querySelector('[data-action="close"]')?.addEventListener('click', () => removePanel(true))
    return true
  }

  function fieldHtml(key, label, value) {
    return `<label class="autoqa-flow-field"><span>${label}</span><div class="autoqa-flow-copy-row"><input data-field="${key}" value="${escapeHtml(value)}" placeholder="Not found — enter it if you find it"><button type="button" class="autoqa-flow-copy-btn" data-copy-for="${key}">Copy</button></div>${value ? '' : '<small class="autoqa-flow-not-found">Not found in transcript</small>'}</label>`
  }

  function escapeHtml(value) {
    return String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')
  }

  function syncFlow() {
    ensureTranscriptControls()
    const stage = currentStage()
    if (dismissedStage && stage !== dismissedStage) dismissedStage = ''
    if (renderBooking()) return
    if (renderNotesChoice()) return
    if (renderPasteDocs()) return
    if (!stage) removePanel(false)
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    if (document.getElementById(TRANSCRIPT_MODAL_ID)) closeTranscriptViewer()
    else if (document.getElementById(PANEL_ID)) removePanel(true)
  })

  window.addEventListener('autoqa-transcript-ready', ensureTranscriptControls)
  const observer = new MutationObserver(() => window.requestAnimationFrame(syncFlow))
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('load', syncFlow)
  window.setInterval(syncFlow, 1000)
})()