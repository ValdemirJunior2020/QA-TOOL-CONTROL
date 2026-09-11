(() => {
  const TOAST_ID = 'autoqa-connection-toast'
  let observer = null
  let timeout = null

  const removeToast = () => {
    document.getElementById(TOAST_ID)?.remove()
    observer?.disconnect()
    observer = null
    if (timeout) window.clearTimeout(timeout)
    timeout = null
  }

  const showToast = (message, state = 'testing') => {
    let toast = document.getElementById(TOAST_ID)
    if (!toast) {
      toast = document.createElement('div')
      toast.id = TOAST_ID
      toast.setAttribute('role', 'status')
      toast.setAttribute('aria-live', 'polite')
      Object.assign(toast.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: '99999',
        maxWidth: '520px',
        padding: '16px 18px',
        borderRadius: '14px',
        boxShadow: '0 14px 40px rgba(24, 18, 79, 0.22)',
        fontFamily: 'inherit',
        fontSize: '14px',
        fontWeight: '700',
        lineHeight: '1.45',
        border: '1px solid #d8d2f1',
        background: '#ffffff',
        color: '#24185f',
      })
      document.body.appendChild(toast)
    }
    toast.textContent = message
    if (state === 'ready') {
      toast.style.borderColor = '#9fd5b0'
      toast.style.background = '#f3fff7'
      toast.style.color = '#176b35'
    } else if (state === 'error') {
      toast.style.borderColor = '#e8aaa7'
      toast.style.background = '#fff6f5'
      toast.style.color = '#9f2620'
    } else {
      toast.style.borderColor = '#d8d2f1'
      toast.style.background = '#ffffff'
      toast.style.color = '#24185f'
    }
  }

  const findResultText = () => {
    const panel = document.querySelector('.autoqa-admin-panel')
    if (!panel) return ''
    const banners = [...panel.querySelectorAll('.validation-banner')]
    return (banners.at(-1)?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  const beginWatching = () => {
    removeToast()
    showToast('Testing Auto QA connection…')
    const panel = document.querySelector('.autoqa-admin-panel')
    if (!panel) return

    observer = new MutationObserver(() => {
      const text = findResultText()
      if (!text || /^Testing Auto QA/i.test(text)) return
      const ready = /^READY\b/i.test(text)
      showToast(text, ready ? 'ready' : 'error')
      observer?.disconnect()
      observer = null
      timeout = window.setTimeout(removeToast, ready ? 7000 : 12000)
    })
    observer.observe(panel, { childList: true, subtree: true, characterData: true })
  }

  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('button')
    if (!button) return
    if (!/Test Auto QA Connection|Testing Connection/i.test(button.textContent || '')) return
    window.setTimeout(beginWatching, 0)
  }, true)
})()
