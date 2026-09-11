(() => {
  const MODAL_ID = 'autoqa-booking-flow-modal'
  const STYLE_ID = 'autoqa-booking-flow-style'
  let dismissedStage = ''

  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      .autoqa-flow-backdrop{position:fixed;inset:0;z-index:10000;display:flex;align-items:flex-start;justify-content:flex-end;padding:20px;pointer-events:none;background:transparent}
      .autoqa-flow-card{width:min(760px,96vw);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 28px 80px rgba(0,0,0,.35);padding:24px;color:#17124f;border:1px solid rgba(23,18,79,.12);pointer-events:auto;position:relative;user-select:text;-webkit-user-select:text}
      .autoqa-flow-close{position:absolute;top:12px;right:12px;width:34px;height:34px;border:0;border-radius:999px;background:#f1f2f7;color:#252944;font-size:20px;line-height:1;cursor:pointer;font-weight:900}
      .autoqa-flow-eyebrow{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#6d5bd0;margin:0 0 6px}
      .autoqa-flow-card h2{margin:0 42px 8px 0;font-size:24px;line-height:1.2}
      .autoqa-flow-copy{margin:0 0 18px;color:#5f6472;line-height:1.45}
      .autoqa-flow-found{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0 20px}
      .autoqa-flow-field{display:grid;gap:6px}
      .autoqa-flow-field span{font-size:12px;font-weight:800;color:#4f5270}
      .autoqa-flow-field input,.autoqa-flow-field textarea{width:100%;box-sizing:border-box;border:1px solid #d8dbe7;border-radius:10px;padding:11px 12px;font:inherit;color:#161829;background:#fff;user-select:text;-webkit-user-select:text}
      .autoqa-flow-field textarea{min-height:180px;resize:vertical}
      .autoqa-flow-copy-row{display:flex;gap:6px}
      .autoqa-flow-copy-row input{flex:1;min-width:0}
      .autoqa-flow-copy-btn{border:1px solid #d7d9e4;border-radius:9px;background:#f7f7fb;color:#252944;font-weight:800;padding:0 10px;cursor:pointer;white-space:nowrap}
      .autoqa-flow-not-found{font-size:11px;color:#8b5e00;margin-top:-2px}
      .autoqa-flow-question{margin:8px 0 4px;font-size:18px;font-weight:800}
      .autoqa-flow-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
      .autoqa-flow-actions button{border:0;border-radius:10px;padding:11px 16px;font-weight:800;cursor:pointer}
      .autoqa-flow-primary{background:#ffd83d;color:#181338}
      .autoqa-flow-secondary{background:#f1f2f7;color:#252944;border:1px solid #d7d9e4!important}
      .autoqa-flow-waiting{display:flex;align-items:center;gap:10px;margin-top:14px;padding:12px 14px;border-radius:10px;background:#f7f5ff;color:#4d428b;font-weight:700}
      .autoqa-flow-dot{width:10px;height:10px;border-radius:50%;background:#6d5bd0;animation:autoqaPulse 1.1s infinite alternate}
      @keyframes autoqaPulse{from{opacity:.35;transform:scale(.8)}to{opacity:1;transform:scale(1.15)}}
      @media(max-width:700px){.autoqa-flow-backdrop{padding:8px}.autoqa-flow-found{grid-template-columns:1fr}.autoqa-flow-card{padding:18px}}
    `
    document.head.appendChild(style)
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
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
    descriptor?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function findPanel() {
    return document.querySelector('.autoqa-review-panel')
  }

  function visibleStageBanner(text) {
    const panel = findPanel()
    if (!panel) return null
    const banners = Array.from(panel.querySelectorAll('.validation-banner'))
    return banners.find((banner) => normalize(banner.textContent).includes(text)) || null
  }

  function buttonIn(root, text) {
    if (!root) return null
    return Array.from(root.querySelectorAll('button')).find((button) => normalize(button.textContent).includes(text)) || null
  }

  function currentStageKey() {
    if (visibleStageBanner('Is the booking an HP booking?')) return 'booking'
    if (visibleStageBanner('Did you find the booking documentation / notes?')) return 'notes-choice'
    const panel = findPanel()
    if (panel?.querySelector('.autoqa-documentation-field textarea')) {
      const finish = Array.from(panel.querySelectorAll('button')).find((button) => normalize(button.textContent).includes('Finish Documentation QA') || normalize(button.textContent).includes('Reviewing Documentation'))
      if (finish) return 'paste-docs'
    }
    return ''
  }

  function removeModal(manual = false) {
    if (manual) dismissedStage = currentStageKey()
    document.getElementById(MODAL_ID)?.remove()
  }

  async function copyText(value, button) {
    const text = String(value || '')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      if (button) {
        const old = button.textContent
        button.textContent = 'Copied'
        setTimeout(() => { button.textContent = old }, 900)
      }
    } catch {
      const temp = document.createElement('textarea')
      temp.value = text
      document.body.appendChild(temp)
      temp.select()
      document.execCommand('copy')
      temp.remove()
    }
  }

  function createShell() {
    ensureStyles()
    let backdrop = document.getElementById(MODAL_ID)
    if (!backdrop) {
      backdrop = document.createElement('div')
      backdrop.id = MODAL_ID
      backdrop.className = 'autoqa-flow-backdrop'
      backdrop.innerHTML = '<section class="autoqa-flow-card" role="dialog" aria-modal="false" aria-live="polite"></section>'
      document.body.appendChild(backdrop)
    }
    return backdrop.querySelector('.autoqa-flow-card')
  }

  function addCloseButton(card) {
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'autoqa-flow-close'
    close.setAttribute('aria-label', 'Close')
    close.textContent = '×'
    close.addEventListener('click', () => removeModal(true))
    card.appendChild(close)
  }

  function wireCopyButtons(card) {
    card.querySelectorAll('[data-copy-for]').forEach((button) => {
      button.addEventListener('click', () => {
        const field = card.querySelector(`[data-field="${button.getAttribute('data-copy-for')}"]`)
        copyText(field?.value || '', button)
      })
    })
  }

  function renderBookingStep() {
    const banner = visibleStageBanner('Is the booking an HP booking?')
    if (!banner) return false
    if (dismissedStage === 'booking') return true

    const card = createShell()
    const itinerary = fieldInput('Confirmation / Itinerary #')
    const email = fieldInput('Guest Email')
    const phone = fieldInput('Guest Phone')
    const itineraryValue = itinerary?.value || ''
    const emailValue = email?.value || ''
    const phoneValue = phone?.value || ''

    card.innerHTML = `
      <p class="autoqa-flow-eyebrow">Call QA Complete</p>
      <h2>Booking details found from the call</h2>
      <p class="autoqa-flow-copy">Use these details to find the booking. You can edit, select, copy, or paste any value before continuing. The rest of the page stays usable.</p>
      <div class="autoqa-flow-found">
        <label class="autoqa-flow-field"><span>Itinerary / Confirmation</span><div class="autoqa-flow-copy-row"><input data-field="itinerary" value="${escapeHtml(itineraryValue)}" placeholder="Not found — enter it if you find it"><button type="button" class="autoqa-flow-copy-btn" data-copy-for="itinerary">Copy</button></div>${itineraryValue ? '' : '<small class="autoqa-flow-not-found">Not found in transcript</small>'}</label>
        <label class="autoqa-flow-field"><span>Guest Email</span><div class="autoqa-flow-copy-row"><input data-field="email" value="${escapeHtml(emailValue)}" placeholder="Not found — enter it if you find it"><button type="button" class="autoqa-flow-copy-btn" data-copy-for="email">Copy</button></div>${emailValue ? '' : '<small class="autoqa-flow-not-found">Not found in transcript</small>'}</label>
        <label class="autoqa-flow-field"><span>Guest Phone</span><div class="autoqa-flow-copy-row"><input data-field="phone" value="${escapeHtml(phoneValue)}" placeholder="Not found — enter it if you find it"><button type="button" class="autoqa-flow-copy-btn" data-copy-for="phone">Copy</button></div>${phoneValue ? '' : '<small class="autoqa-flow-not-found">Not found in transcript</small>'}</label>
      </div>
      <div class="autoqa-flow-question">Is the booking an HP booking?</div>
      <div class="autoqa-flow-actions"><button class="autoqa-flow-primary" data-action="hp-yes">Yes — HP Booking</button><button class="autoqa-flow-secondary" data-action="hp-no">No — Not HP</button><button class="autoqa-flow-secondary" data-action="close">Close / Keep Working</button></div>
    `
    addCloseButton(card)
    wireCopyButtons(card)

    card.querySelector('[data-field="itinerary"]')?.addEventListener('input', (event) => setNativeValue(itinerary, event.target.value))
    card.querySelector('[data-field="email"]')?.addEventListener('input', (event) => setNativeValue(email, event.target.value))
    card.querySelector('[data-field="phone"]')?.addEventListener('input', (event) => setNativeValue(phone, event.target.value))
    card.querySelector('[data-action="hp-yes"]')?.addEventListener('click', () => { dismissedStage = ''; buttonIn(banner, 'Yes — HP Booking')?.click() })
    card.querySelector('[data-action="hp-no"]')?.addEventListener('click', () => { dismissedStage = ''; buttonIn(banner, 'No — Not HP')?.click(); window.setTimeout(() => removeModal(false), 100) })
    card.querySelector('[data-action="close"]')?.addEventListener('click', () => removeModal(true))
    return true
  }

  function renderNotesChoice() {
    const banner = visibleStageBanner('Did you find the booking documentation / notes?')
    if (!banner) return false
    if (dismissedStage === 'notes-choice') return true

    const card = createShell()
    const itinerary = fieldInput('Confirmation / Itinerary #')?.value || ''
    const email = fieldInput('Guest Email')?.value || ''
    const phone = fieldInput('Guest Phone')?.value || ''

    card.innerHTML = `
      <p class="autoqa-flow-eyebrow">Booking Located</p>
      <h2>Find the booking documentation</h2>
      <p class="autoqa-flow-copy">You can copy any value below while you search for the booking notes. The rest of the page remains usable.</p>
      <div class="autoqa-flow-found">
        <label class="autoqa-flow-field"><span>Itinerary / Confirmation</span><div class="autoqa-flow-copy-row"><input data-field="itinerary" value="${escapeHtml(itinerary)}"><button type="button" class="autoqa-flow-copy-btn" data-copy-for="itinerary">Copy</button></div></label>
        <label class="autoqa-flow-field"><span>Guest Email</span><div class="autoqa-flow-copy-row"><input data-field="email" value="${escapeHtml(email)}"><button type="button" class="autoqa-flow-copy-btn" data-copy-for="email">Copy</button></div></label>
        <label class="autoqa-flow-field"><span>Guest Phone</span><div class="autoqa-flow-copy-row"><input data-field="phone" value="${escapeHtml(phone)}"><button type="button" class="autoqa-flow-copy-btn" data-copy-for="phone">Copy</button></div></label>
      </div>
      <div class="autoqa-flow-question">Did you find the booking documentation / notes?</div>
      <div class="autoqa-flow-actions"><button class="autoqa-flow-primary" data-action="paste">Yes — Paste Documentation</button><button class="autoqa-flow-secondary" data-action="manual">I Will QA Documentation Manually</button><button class="autoqa-flow-secondary" data-action="without">QA What We Have Without Notes</button><button class="autoqa-flow-secondary" data-action="close">Close / Keep Working</button></div>
    `
    addCloseButton(card)
    wireCopyButtons(card)

    const originalItinerary = fieldInput('Confirmation / Itinerary #')
    const originalEmail = fieldInput('Guest Email')
    const originalPhone = fieldInput('Guest Phone')
    card.querySelector('[data-field="itinerary"]')?.addEventListener('input', (event) => setNativeValue(originalItinerary, event.target.value))
    card.querySelector('[data-field="email"]')?.addEventListener('input', (event) => setNativeValue(originalEmail, event.target.value))
    card.querySelector('[data-field="phone"]')?.addEventListener('input', (event) => setNativeValue(originalPhone, event.target.value))
    card.querySelector('[data-action="paste"]')?.addEventListener('click', () => { dismissedStage = ''; buttonIn(banner, 'Paste Documentation')?.click() })
    card.querySelector('[data-action="manual"]')?.addEventListener('click', () => { dismissedStage = ''; buttonIn(banner, 'I Will QA Documentation Manually')?.click(); window.setTimeout(() => removeModal(false), 100) })
    card.querySelector('[data-action="without"]')?.addEventListener('click', () => { dismissedStage = ''; buttonIn(banner, 'QA What We Have Without Notes')?.click(); window.setTimeout(() => removeModal(false), 100) })
    card.querySelector('[data-action="close"]')?.addEventListener('click', () => removeModal(true))
    return true
  }

  function renderPasteDocs() {
    const panel = findPanel()
    const textarea = panel?.querySelector('.autoqa-documentation-field textarea')
    if (!textarea) return false
    const finish = Array.from(panel.querySelectorAll('button')).find((button) => normalize(button.textContent).includes('Finish Documentation QA') || normalize(button.textContent).includes('Reviewing Documentation'))
    if (!finish) return false
    if (dismissedStage === 'paste-docs') return true

    const back = Array.from(panel.querySelectorAll('button')).find((button) => normalize(button.textContent) === 'Back')
    const card = createShell()
    card.innerHTML = `
      <p class="autoqa-flow-eyebrow">Documentation Step</p>
      <h2>Paste the booking documentation</h2>
      <p class="autoqa-flow-copy">Paste the full Refunds / Notes / Zendesk / itinerary documentation. The AI will then finish the documentation portion of the review.</p>
      <label class="autoqa-flow-field"><span>Documentation / Itinerary Notes</span><textarea data-docs placeholder="Paste the complete documentation here…">${escapeHtml(textarea.value || '')}</textarea></label>
      <div class="autoqa-flow-actions"><button class="autoqa-flow-primary" data-action="finish" ${textarea.value.trim() ? '' : 'disabled'}>Finish Documentation QA</button><button class="autoqa-flow-secondary" data-action="back">Back</button><button class="autoqa-flow-secondary" data-action="close">Close / Keep Working</button></div>
      <div class="autoqa-flow-waiting"><span class="autoqa-flow-dot"></span><span>AI is waiting for your documentation.</span></div>
    `
    addCloseButton(card)

    const modalTextarea = card.querySelector('[data-docs]')
    const finishButton = card.querySelector('[data-action="finish"]')
    modalTextarea?.addEventListener('input', (event) => { setNativeValue(textarea, event.target.value); if (finishButton) finishButton.disabled = !event.target.value.trim() })
    finishButton?.addEventListener('click', () => {
      if (!modalTextarea?.value.trim()) return
      dismissedStage = ''
      setNativeValue(textarea, modalTextarea.value)
      finish?.click()
      finishButton.disabled = true
      finishButton.textContent = 'Reviewing Documentation…'
      const waiting = card.querySelector('.autoqa-flow-waiting span:last-child')
      if (waiting) waiting.textContent = 'AI is finishing the documentation QA. Keep this window open.'
    })
    card.querySelector('[data-action="back"]')?.addEventListener('click', () => { dismissedStage = ''; back?.click() })
    card.querySelector('[data-action="close"]')?.addEventListener('click', () => removeModal(true))
    return true
  }

  function escapeHtml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
  }

  function syncFlow() {
    const stage = currentStageKey()
    if (stage && stage !== dismissedStage && dismissedStage) dismissedStage = ''
    if (renderBookingStep()) return
    if (renderNotesChoice()) return
    if (renderPasteDocs()) return
    if (visibleStageBanner('Call + Documentation QA complete') || visibleStageBanner('Documentation: Manual Review Required') || visibleStageBanner('Documentation QA skipped')) {
      dismissedStage = ''
      removeModal(false)
    }
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.getElementById(MODAL_ID)) removeModal(true)
  })

  const observer = new MutationObserver(() => window.requestAnimationFrame(syncFlow))
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: false })
  window.addEventListener('load', syncFlow)
  window.setInterval(syncFlow, 1200)
})()
