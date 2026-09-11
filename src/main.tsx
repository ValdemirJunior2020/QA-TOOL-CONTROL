import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

function normalizeDate(value: string): string {
  const text = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return text
    return ''
  }

  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/)
  if (!match) return ''

  const month = Number(match[1])
  const day = Number(match[2])
  const year = Number(match[3])
  const date = new Date(year, month - 1, day)

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return ''

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function displayDate(value: string): string {
  const normalized = normalizeDate(value)
  if (!normalized) return value
  const [year, month, day] = normalized.split('-')
  return `${month}/${day}/${year}`
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function proxyFor(input: HTMLInputElement): HTMLInputElement | null {
  const previous = input.previousElementSibling
  return previous instanceof HTMLInputElement && previous.dataset.dateTextProxy === 'true' ? previous : null
}

function makeDatePasteable(input: HTMLInputElement) {
  if (input.readOnly || input.disabled) return

  const existingProxy = proxyFor(input)
  if (existingProxy) {
    input.dataset.pasteableDateReady = 'true'
    input.style.display = 'none'
    if (document.activeElement !== existingProxy) existingProxy.value = displayDate(input.value)
    return
  }

  // React may replace or move a date field during Auto QA updates. If the
  // original marker survived but the text proxy did not, rebuild it.
  delete input.dataset.pasteableDateReady

  const textInput = document.createElement('input')
  textInput.type = 'text'
  textInput.inputMode = 'numeric'
  textInput.autocomplete = 'off'
  textInput.placeholder = 'MM/DD/YYYY'
  textInput.value = displayDate(input.value)
  textInput.className = input.className
  textInput.setAttribute('aria-label', input.getAttribute('aria-label') || 'Date')
  textInput.dataset.dateTextProxy = 'true'

  input.dataset.pasteableDateReady = 'true'
  input.style.display = 'none'
  input.insertAdjacentElement('beforebegin', textInput)

  const commit = () => {
    const normalized = normalizeDate(textInput.value)
    if (!normalized) return
    setReactInputValue(input, normalized)
    textInput.value = displayDate(normalized)
  }

  textInput.addEventListener('input', () => {
    const normalized = normalizeDate(textInput.value)
    if (normalized) setReactInputValue(input, normalized)
  })

  textInput.addEventListener('paste', () => {
    window.setTimeout(commit, 0)
  })

  textInput.addEventListener('blur', commit)

  input.addEventListener('input', () => {
    if (document.activeElement !== textInput) textInput.value = displayDate(input.value)
  })
}

function syncEditableDateInputs() {
  document.querySelectorAll<HTMLInputElement>('input[type="date"]:not([readonly]):not([disabled])').forEach(makeDatePasteable)
}

const observer = new MutationObserver(() => syncEditableDateInputs())
observer.observe(document.documentElement, { childList: true, subtree: true })
window.setInterval(syncEditableDateInputs, 250)
window.addEventListener('load', syncEditableDateInputs)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
