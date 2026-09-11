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

function makeDatePasteable(input: HTMLInputElement) {
  if (input.dataset.pasteableDateReady === 'true' || input.readOnly || input.disabled) return
  input.dataset.pasteableDateReady = 'true'

  const textInput = document.createElement('input')
  textInput.type = 'text'
  textInput.inputMode = 'numeric'
  textInput.autocomplete = 'off'
  textInput.placeholder = 'MM/DD/YYYY'
  textInput.value = displayDate(input.value)
  textInput.className = input.className
  textInput.setAttribute('aria-label', input.getAttribute('aria-label') || 'Date')
  textInput.dataset.dateTextProxy = 'true'

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

  document.querySelectorAll<HTMLInputElement>('input[data-pasteable-date-ready="true"]').forEach((input) => {
    const proxy = input.previousElementSibling
    if (!(proxy instanceof HTMLInputElement) || proxy.dataset.dateTextProxy !== 'true') return
    if (document.activeElement !== proxy) proxy.value = displayDate(input.value)
  })
}

const observer = new MutationObserver(() => syncEditableDateInputs())
observer.observe(document.documentElement, { childList: true, subtree: true })
window.setInterval(syncEditableDateInputs, 500)
window.addEventListener('load', syncEditableDateInputs)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
