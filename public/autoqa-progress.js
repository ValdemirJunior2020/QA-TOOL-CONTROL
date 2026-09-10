(() => {
  const STYLE_ID = 'autoqa-progress-style'
  const CARD_ID = 'autoqa-progress-card'
  let timer = null
  let startedAt = 0
  let lastMode = ''

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      #${CARD_ID} {
        margin-top: 12px;
        padding: 14px 16px;
        border: 1px solid #d9d4ff;
        border-radius: 12px;
        background: #faf9ff;
        box-shadow: 0 8px 24px rgba(38, 27, 105, 0.08);
        font-family: inherit;
      }
      #${CARD_ID} .autoqa-progress-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
        font-weight: 800;
        color: #24185f;
      }
      #${CARD_ID} .autoqa-progress-track {
        width: 100%;
        height: 14px;
        overflow: hidden;
        border-radius: 999px;
        background: #ebe8f7;
        border: 1px solid #ddd8ef;
      }
      #${CARD_ID} .autoqa-progress-fill {
        height: 100%;
        width: 0%;
        border-radius: 999px;
        background: linear-gradient(90deg, #5f35d5, #8a64ef);
        transition: width .7s ease;
      }
      #${CARD_ID} .autoqa-progress-status {
        margin-top: 8px;
        font-size: 13px;
        font-weight: 700;
        color: #4f4670;
      }
      #${CARD_ID} .autoqa-progress-note {
        margin-top: 4px;
        font-size: 12px;
        color: #77708c;
      }
    `
    document.head.appendChild(style)
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  const currentBusyButton = () => {
    const buttons = [...document.querySelectorAll('button')]
    return buttons.find((button) => {
      const text = (button.textContent || '').trim()
      return text.includes('Reviewing Call') || text.includes('Reviewing Documentation')
    }) || null
  }

  const statusFor = (elapsed, mode) => {
    if (mode === 'documentation') {
      if (elapsed < 2) return ['Preparing documentation…', 10]
      if (elapsed < 6) return ['Reading documentation…', 35]
      if (elapsed < 10) return ['Reading Matrix…', 55]
      if (elapsed < 18) return ['Running documentation QA…', 72]
      return ['Finishing QA…', Math.min(95, 82 + Math.floor((elapsed - 18) / 3))]
    }

    if (elapsed < 2) return ['Uploading call…', 8]
    if (elapsed < 8) return ['Preparing audio…', 18]
    if (elapsed < 28) return ['Transcribing full call…', Math.min(48, 22 + Math.floor((elapsed - 8) * 1.3))]
    if (elapsed < 38) return ['Reading QA criteria and Matrix…', 58]
    if (elapsed < 65) return ['Running call QA…', Math.min(82, 62 + Math.floor((elapsed - 38) * 0.7))]
    return ['Finishing and validating results…', Math.min(95, 84 + Math.floor((elapsed - 65) / 5))]
  }

  const mountCard = (button) => {
    ensureStyle()
    let card = document.getElementById(CARD_ID)
    if (card) return card

    card = document.createElement('div')
    card.id = CARD_ID
    card.setAttribute('role', 'status')
    card.setAttribute('aria-live', 'polite')
    card.innerHTML = `
      <div class="autoqa-progress-top">
        <span class="autoqa-progress-title">Running Auto QA</span>
        <span class="autoqa-progress-meta">0% · 00:00</span>
      </div>
      <div class="autoqa-progress-track"><div class="autoqa-progress-fill"></div></div>
      <div class="autoqa-progress-status">Starting…</div>
      <div class="autoqa-progress-note">Progress is estimated while Whisper and Ollama process the call. 100% only appears when the QA actually finishes.</div>
    `

    const panel = button.closest('.autoqa-review-panel')
    const actions = button.closest('.autoqa-actions')
    if (actions && actions.parentNode) actions.parentNode.insertBefore(card, actions.nextSibling)
    else if (panel) panel.appendChild(card)
    else button.parentElement?.appendChild(card)
    return card
  }

  const finish = (success = true) => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    const card = document.getElementById(CARD_ID)
    if (!card) return
    const meta = card.querySelector('.autoqa-progress-meta')
    const fill = card.querySelector('.autoqa-progress-fill')
    const status = card.querySelector('.autoqa-progress-status')
    const elapsed = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0
    if (meta) meta.textContent = `${success ? '100%' : 'Stopped'} · ${formatTime(elapsed)}`
    if (fill) fill.style.width = success ? '100%' : '100%'
    if (status) status.textContent = success ? 'QA complete.' : 'QA stopped before completion.'
    setTimeout(() => card.remove(), success ? 1800 : 3500)
    startedAt = 0
    lastMode = ''
  }

  const start = (button) => {
    const mode = (button.textContent || '').includes('Documentation') ? 'documentation' : 'call'
    if (timer && lastMode === mode) return
    if (timer) clearInterval(timer)

    lastMode = mode
    startedAt = Date.now()
    const card = mountCard(button)
    const title = card.querySelector('.autoqa-progress-title')
    if (title) title.textContent = mode === 'documentation' ? 'Running Documentation QA' : 'Running Call Auto QA'

    const tick = () => {
      const busy = currentBusyButton()
      if (!busy) {
        const panelText = button.closest('.autoqa-review-panel')?.textContent || ''
        const success = /QA complete|Call QA is complete|Documentation QA complete/i.test(panelText)
        finish(success)
        return
      }
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
      const [label, percent] = statusFor(elapsed, mode)
      const meta = card.querySelector('.autoqa-progress-meta')
      const fill = card.querySelector('.autoqa-progress-fill')
      const status = card.querySelector('.autoqa-progress-status')
      if (meta) meta.textContent = `${percent}% · ${formatTime(elapsed)}`
      if (fill) fill.style.width = `${percent}%`
      if (status) status.textContent = label
    }

    tick()
    timer = setInterval(tick, 1000)
  }

  const scan = () => {
    const busy = currentBusyButton()
    if (busy) start(busy)
  }

  const observer = new MutationObserver(scan)
  const boot = () => {
    ensureStyle()
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    scan()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
