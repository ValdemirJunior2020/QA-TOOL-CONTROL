(() => {
  const ROOT_ID = 'autoqa-status-visual'
  const STYLE_ID = 'autoqa-status-visual-style'

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
        display: flex;
        align-items: center;
        gap: 14px;
        margin: 8px 0 2px;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(23, 18, 79, 0.035);
        border: 1px solid rgba(23, 18, 79, 0.08);
      }
      .autoqa-status-visual-media {
        position: relative;
        flex: 0 0 118px;
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
        border: 3px solid rgba(255,255,255,.78);
        border-top-color: #22d3ee;
        border-right-color: #6d5bd0;
        border-radius: 50%;
        box-shadow: 0 2px 10px rgba(23,18,79,.16);
        animation: autoqaStatusSpin .75s linear infinite;
      }
      .autoqa-status-visual-copy {
        min-width: 0;
        display: grid;
        gap: 3px;
      }
      .autoqa-status-visual-copy strong {
        color: #17124f;
        font-size: 14px;
      }
      .autoqa-status-visual-copy span {
        color: #687086;
        font-size: 12px;
        line-height: 1.35;
      }
      @keyframes autoqaStatusSpin { to { transform: rotate(360deg); } }
      @media (max-width: 640px) {
        .autoqa-status-visual { align-items: flex-start; }
        .autoqa-status-visual-media,
        .autoqa-status-visual img { width: 92px; height: 92px; flex-basis: 92px; }
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

  function stageInfo(stageText, panelText) {
    const stage = text(stageText).toLowerCase()
    const panel = text(panelText).toLowerCase()

    if (panel.includes('call + documentation qa complete')) {
      return { image: images.allComplete, title: 'Call + Documentation QA Complete', done: true }
    }
    if (panel.includes('did you find the booking documentation / notes')) {
      return { image: images.waitingDocs, title: 'Waiting for Documentation', done: false }
    }
    if (panel.includes('is the booking an hp booking')) {
      return { image: images.booking, title: 'Finding Booking Details', done: false }
    }
    if (panel.includes('call qa is complete')) {
      return { image: images.callComplete, title: 'Call QA Complete', done: true }
    }

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
    if (stage === 'qa complete' || stage.includes('complete')) {
      return { image: images.callComplete, title: 'Call QA Complete', done: true }
    }
    if (stage.includes('failed')) return null
    return stage ? { image: images.grading, title: text(stageText), done: false } : null
  }

  function removeVisual() {
    document.getElementById(ROOT_ID)?.remove()
  }

  function findProgressBanner(panel) {
    return Array.from(panel.querySelectorAll('.validation-banner')).find((banner) =>
      text(banner.textContent).includes('Current stage:')
    ) || null
  }

  function currentStageText(progressBanner) {
    if (!progressBanner) return ''
    const candidates = Array.from(progressBanner.querySelectorAll('span'))
    const row = candidates.find((node) => text(node.textContent).startsWith('Current stage:'))
    return row ? text(row.textContent).replace(/^Current stage:\s*/i, '') : ''
  }

  function render() {
    ensureStyles()
    const panel = document.querySelector('.autoqa-review-panel')
    if (!panel) {
      removeVisual()
      return
    }

    const progressBanner = findProgressBanner(panel)
    const stage = currentStageText(progressBanner)
    const info = stageInfo(stage, panel.textContent)

    if (!info) {
      removeVisual()
      return
    }

    let root = document.getElementById(ROOT_ID)
    if (!root) {
      root = document.createElement('div')
      root.id = ROOT_ID
      root.className = 'autoqa-status-visual'
    }

    const signature = `${info.image}|${info.title}|${info.done}`
    if (root.dataset.signature !== signature) {
      root.dataset.signature = signature
      root.innerHTML = `
        <div class="autoqa-status-visual-media">
          <img src="${info.image}" alt="${info.title}">
          ${info.done ? '' : '<span class="autoqa-status-spinner" aria-hidden="true"></span>'}
        </div>
        <div class="autoqa-status-visual-copy">
          <strong>${info.title}</strong>
          <span>${info.done ? 'This stage is complete.' : 'Auto QA is working on this stage now.'}</span>
        </div>
      `
    }

    const target = progressBanner || panel.querySelector('.autoqa-actions') || panel.firstElementChild
    if (target && root.parentElement !== panel) {
      target.insertAdjacentElement('afterend', root)
    } else if (target && root.previousElementSibling !== target) {
      target.insertAdjacentElement('afterend', root)
    }
  }

  const observer = new MutationObserver(() => window.requestAnimationFrame(render))
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  window.addEventListener('load', render)
  window.setInterval(render, 1000)
})()
