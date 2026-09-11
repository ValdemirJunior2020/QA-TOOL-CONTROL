(() => {
  const ROOT_ID = 'autoqa-status-visual'
  const STYLE_ID = 'autoqa-status-visual-style'
  const AVG_QA_MS = 8 * 60 * 1000
  const POLL_SECONDS = 2
  let liveJob = null
  let lastStatus = ''
  let lastPosition = null
  let etaDeadline = 0
  let notificationEnabled = false
  let tipIndex = 0

  const tips = [
    'Your queue position refreshes automatically. No manual reload is needed.',
    'You can keep working in another tab while your QA stays in line.',
    'If the connection briefly drops, the page keeps watching the same QA job.',
    'The estimate is approximate and adjusts as the queue moves.',
  ]

  const images = {
    uploading: '/autoqa-status/uploading-call.png',
    transcribing: '/autoqa-status/transcribing.png',
    matrix: '/autoqa-status/reading-matrix.png',
    sales: '/autoqa-status/reading-sales-qa-form.png',
    grading: '/autoqa-status/grading-qa-call.png',
    booking: '/autoqa-status/finding-booking-details.png',
    waitingDocs: '/autoqa-status/waiting-for-documentation.png',
    callComplete: '/autoqa-status/call-qa-completed.png',
    allComplete: '/autoqa-status/call-+-qa-documentation-completed.png',
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      .autoqa-status-visual {
        display: grid;
        grid-template-columns: 118px minmax(0,1fr);
        gap: 14px;
        margin: 8px 0 2px;
        padding: 12px;
        border-radius: 14px;
        background: rgba(23,18,79,.035);
        border: 1px solid rgba(23,18,79,.08);
      }
      .autoqa-status-visual-media {
        position: relative;
        width: 118px;
        height: 118px;
        display: grid;
        place-items: center;
      }
      .autoqa-status-visual img {
        display: block;
        width: 118px;
        height: 118px;
        object-fit: contain;
        user-select: none;
        -webkit-user-drag: none;
      }
      .autoqa-status-spinner {
        position: absolute;
        top: 6px;
        right: 6px;
        width: 20px;
        height: 20px;
        border: 3px solid rgba(255,255,255,.82);
        border-top-color: #22d3ee;
        border-right-color: #6d5bd0;
        border-radius: 50%;
        box-shadow: 0 2px 10px rgba(23,18,79,.16);
        animation: autoqaStatusSpin .75s linear infinite;
      }
      .autoqa-status-visual-copy {
        min-width: 0;
        display: grid;
        gap: 7px;
      }
      .autoqa-status-title {
        color: #17124f;
        font-size: 15px;
        font-weight: 900;
      }
      .autoqa-status-subtitle {
        color: #687086;
        font-size: 12px;
        line-height: 1.35;
      }
      .autoqa-queue-line {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        width: fit-content;
        max-width: 100%;
        padding: 5px 9px;
        border-radius: 999px;
        background: #fff7d6;
        border: 1px solid #f2cf48;
        color: #6e5200;
        font-size: 12px;
        font-weight: 800;
      }
      .autoqa-queue-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #f4b400;
        flex: 0 0 8px;
      }
      .autoqa-queue-line.processing {
        background: #eafaf6;
        border-color: #75d8bd;
        color: #14644f;
      }
      .autoqa-queue-line.processing .autoqa-queue-dot { background: #10b981; }
      .autoqa-queue-line.reconnecting {
        background: #fff0ec;
        border-color: #f0a58f;
        color: #8c341f;
      }
      .autoqa-queue-line.reconnecting .autoqa-queue-dot { background: #f97316; }
      .autoqa-waiting-card {
        display: grid;
        gap: 9px;
        padding: 11px 12px;
        border-radius: 12px;
        background: #fff;
        border: 1px solid rgba(23,18,79,.09);
      }
      .autoqa-waiting-grid {
        display: grid;
        grid-template-columns: repeat(3,minmax(0,1fr));
        gap: 8px;
      }
      .autoqa-waiting-stat {
        padding: 8px 9px;
        border-radius: 10px;
        background: #f7f8fc;
        min-width: 0;
      }
      .autoqa-waiting-stat span {
        display: block;
        color: #70768a;
        font-size: 10px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .04em;
      }
      .autoqa-waiting-stat strong {
        display: block;
        margin-top: 2px;
        color: #17124f;
        font-size: 14px;
        overflow-wrap: anywhere;
      }
      .autoqa-waiting-tip {
        color: #61687a;
        font-size: 11px;
        line-height: 1.35;
      }
      .autoqa-notify-button {
        justify-self: start;
        border: 1px solid #cfd4e3;
        border-radius: 9px;
        background: #fff;
        color: #292653;
        padding: 7px 10px;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
      }
      .autoqa-notify-button.enabled {
        background: #eafaf6;
        border-color: #75d8bd;
        color: #14644f;
      }
      @keyframes autoqaStatusSpin { to { transform: rotate(360deg); } }
      @media (max-width: 760px) {
        .autoqa-status-visual { grid-template-columns: 92px minmax(0,1fr); }
        .autoqa-status-visual-media,
        .autoqa-status-visual img { width: 92px; height: 92px; }
        .autoqa-waiting-grid { grid-template-columns: 1fr; }
      }
    `
    document.head.appendChild(style)
  }

  function text(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function isSales() {
    const labels = Array.from(document.querySelectorAll('label'))
    const qaType = labels.find((label) => text(label.querySelector('span')?.textContent) === 'QA Type')
    return qaType?.querySelector('select')?.value === 'Sales'
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '< 1 min'
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60)
      const rem = minutes % 60
      return `${hours}h ${rem}m`
    }
    return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`
  }

  function statusLower() {
    return text(liveJob?.status).toLowerCase()
  }

  function updateEtaForJob() {
    if (!liveJob) return
    const status = statusLower()
    if (status === 'queued') {
      const position = Math.max(1, Number(liveJob.position || 1))
      if (lastStatus !== 'queued' || lastPosition !== position || !etaDeadline) {
        etaDeadline = Date.now() + position * AVG_QA_MS
      }
      lastPosition = position
    } else if (status === 'processing') {
      if (lastStatus !== 'processing' || !etaDeadline) {
        const started = Date.parse(liveJob.startedAt || '')
        etaDeadline = Number.isFinite(started) ? started + AVG_QA_MS : Date.now() + AVG_QA_MS
      }
      lastPosition = 0
    } else if (status === 'uploading' || status === 'reconnecting') {
      if (!etaDeadline) etaDeadline = Date.now() + AVG_QA_MS
    } else if (status === 'completed' || status === 'failed' || status === 'timeout') {
      etaDeadline = 0
      lastPosition = null
    }
    lastStatus = status
  }

  function infoFromLiveJob() {
    if (!liveJob) return null
    const status = statusLower()
    const stage = text(liveJob.stage).toLowerCase()

    if (status === 'queued') return { image: images.uploading, title: 'Waiting in Auto QA Queue', done: false }
    if (status === 'uploading') return { image: images.uploading, title: 'Uploading Call', done: false }
    if (status === 'reconnecting') return { image: images.uploading, title: 'Reconnecting to Auto QA', done: false }
    if (status === 'completed') return { image: images.callComplete, title: 'Call QA Complete', done: true }
    if (status === 'failed' || status === 'timeout') return null

    if (stage.includes('transcribing')) return { image: images.transcribing, title: 'Transcribing & Grading Call', done: false }
    if (stage.includes('local knowledge') || stage.includes('service matrix')) return { image: images.matrix, title: 'Reading Local QA Knowledge', done: false }
    if (stage.includes('rag verification') || stage.includes('verification')) return { image: images.grading, title: 'Verifying QA Result', done: false }
    if (status === 'processing') return { image: images.grading, title: text(liveJob.stage) || 'Grading Call QA', done: false }
    return null
  }

  function stageInfo(stageText, panelText) {
    const live = infoFromLiveJob()
    if (live) return live

    const stage = text(stageText).toLowerCase()
    const panel = text(panelText).toLowerCase()

    if (panel.includes('call + documentation qa complete')) return { image: images.allComplete, title: 'Call + Documentation QA Complete', done: true }
    if (panel.includes('did you find the booking documentation / notes')) return { image: images.waitingDocs, title: 'Waiting for Documentation', done: false }
    if (panel.includes('is the booking an hp booking')) return { image: images.booking, title: 'Finding Booking Details', done: false }
    if (panel.includes('call qa is complete')) return { image: images.callComplete, title: 'Call QA Complete', done: true }

    if (stage.includes('upload')) return { image: images.uploading, title: 'Uploading Call', done: false }
    if (stage.includes('transcrib')) return { image: images.transcribing, title: 'Transcribing Call', done: false }
    if (stage.includes('service matrix')) return { image: images.matrix, title: 'Reading Service Matrix', done: false }
    if (stage.includes('qa criteria')) {
      return isSales()
        ? { image: images.sales, title: 'Reading Sales QA Form', done: false }
        : { image: images.grading, title: 'Reading QA Criteria', done: false }
    }
    if (stage.includes('preparing documentation')) return { image: images.waitingDocs, title: 'Preparing Documentation', done: false }
    if (stage.includes('running qa audit')) return { image: images.grading, title: 'Grading Call QA', done: false }
    if (stage.includes('final verification')) return { image: images.grading, title: 'Final Verification', done: false }
    if (stage === 'qa complete' || stage.includes('complete')) return { image: images.callComplete, title: 'Call QA Complete', done: true }
    if (stage.includes('failed')) return null
    return stage ? { image: images.grading, title: text(stageText), done: false } : null
  }

  function queueInfo() {
    if (!liveJob) return { text: '', className: '' }
    const status = statusLower()
    if (status === 'queued') {
      const position = Number(liveJob.position || 0)
      return {
        text: position > 0 ? `You are #${position} in the waiting line` : 'Waiting for the Auto QA server',
        className: '',
      }
    }
    if (status === 'processing') return { text: 'Your QA is processing now', className: 'processing' }
    if (status === 'reconnecting') return { text: 'Connection interrupted — retrying automatically', className: 'reconnecting' }
    if (status === 'uploading') return { text: 'Uploading your call safely', className: 'processing' }
    return { text: '', className: '' }
  }

  function waitingCardHtml() {
    if (!liveJob) return ''
    const status = statusLower()
    if (!['queued', 'processing', 'reconnecting', 'uploading'].includes(status)) return ''

    const position = Number(liveJob.position || 0)
    const remaining = etaDeadline ? formatDuration(etaDeadline - Date.now()) : 'Calculating…'
    const place = status === 'queued' && position > 0 ? `#${position}` : status === 'processing' ? 'Now' : '—'
    const stateLabel = status === 'queued' ? 'Waiting' : status === 'processing' ? 'Processing' : status === 'uploading' ? 'Uploading' : 'Reconnecting'
    const notifySupported = 'Notification' in window
    const notifyText = notificationEnabled ? 'Browser alert enabled' : 'Notify me when ready'
    const tip = tips[tipIndex % tips.length]

    return `
      <div class="autoqa-waiting-card">
        <div class="autoqa-waiting-grid">
          <div class="autoqa-waiting-stat"><span>Place in line</span><strong>${place}</strong></div>
          <div class="autoqa-waiting-stat"><span>Estimated time</span><strong>${remaining}</strong></div>
          <div class="autoqa-waiting-stat"><span>Auto refresh</span><strong>Every ${POLL_SECONDS}s</strong></div>
        </div>
        <div class="autoqa-waiting-tip"><strong>${stateLabel}:</strong> ${tip}</div>
        ${notifySupported ? `<button type="button" class="autoqa-notify-button ${notificationEnabled ? 'enabled' : ''}" data-autoqa-notify>${notifyText}</button>` : ''}
      </div>
    `
  }

  function removeVisual() {
    document.getElementById(ROOT_ID)?.remove()
  }

  function findProgressBanner(panel) {
    return Array.from(panel.querySelectorAll('.validation-banner')).find((banner) => text(banner.textContent).includes('Current stage:')) || null
  }

  function currentStageText(progressBanner) {
    if (!progressBanner) return ''
    const candidates = Array.from(progressBanner.querySelectorAll('span'))
    const row = candidates.find((node) => text(node.textContent).startsWith('Current stage:'))
    return row ? text(row.textContent).replace(/^Current stage:\s*/i, '') : ''
  }

  async function enableNotification(button) {
    if (!('Notification' in window)) return
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      notificationEnabled = permission === 'granted'
      if (button) {
        button.textContent = notificationEnabled ? 'Browser alert enabled' : 'Notification blocked'
        button.classList.toggle('enabled', notificationEnabled)
      }
    } catch {}
  }

  function notifyComplete() {
    if (!notificationEnabled || !('Notification' in window) || Notification.permission !== 'granted') return
    try {
      new Notification('QA Control Center', {
        body: 'Your Auto QA review is ready.',
        icon: '/autoqa-status/call-qa-completed.png',
      })
    } catch {}
  }

  function wireActions(root) {
    const button = root.querySelector('[data-autoqa-notify]')
    if (button && !button.dataset.wired) {
      button.dataset.wired = '1'
      button.addEventListener('click', () => void enableNotification(button))
    }
  }

  function render() {
    ensureStyles()
    const panel = document.querySelector('.autoqa-review-panel')
    if (!panel) {
      removeVisual()
      return
    }

    updateEtaForJob()
    const progressBanner = findProgressBanner(panel)
    const stage = currentStageText(progressBanner)
    const info = stageInfo(stage, panel.textContent)
    if (!info) {
      removeVisual()
      return
    }

    const queue = queueInfo()
    let root = document.getElementById(ROOT_ID)
    if (!root) {
      root = document.createElement('div')
      root.id = ROOT_ID
      root.className = 'autoqa-status-visual'
    }

    root.innerHTML = `
      <div class="autoqa-status-visual-media">
        <img src="${info.image}" alt="${info.title}">
        ${info.done ? '' : '<span class="autoqa-status-spinner" aria-hidden="true"></span>'}
      </div>
      <div class="autoqa-status-visual-copy">
        <div class="autoqa-status-title">${info.title}</div>
        <div class="autoqa-status-subtitle">${info.done ? 'This stage is complete.' : 'Auto QA is working on this stage now.'}</div>
        ${queue.text ? `<div class="autoqa-queue-line ${queue.className}"><span class="autoqa-queue-dot"></span><span>${queue.text}</span></div>` : ''}
        ${waitingCardHtml()}
      </div>
    `
    wireActions(root)

    const target = progressBanner || panel.querySelector('.autoqa-actions') || panel.firstElementChild
    if (target && root.parentElement !== panel) target.insertAdjacentElement('afterend', root)
    else if (target && root.previousElementSibling !== target) target.insertAdjacentElement('afterend', root)
  }

  window.addEventListener('autoqa:job-status', (event) => {
    const previous = statusLower()
    liveJob = event.detail || null
    updateEtaForJob()
    if (previous !== 'completed' && statusLower() === 'completed') notifyComplete()
    window.requestAnimationFrame(render)
  })

  const observer = new MutationObserver(() => window.requestAnimationFrame(render))
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  window.addEventListener('load', render)
  window.setInterval(render, 1000)
  window.setInterval(() => {
    tipIndex = (tipIndex + 1) % tips.length
    if (liveJob) render()
  }, 8000)
})()
