import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'

type DatamuseWord = {
  word?: string
  score?: number
  tags?: string[]
}

type Suggestion = {
  word: string
  source: 'Synonym' | 'Related'
}

const EXAMPLES = ['rude', 'unclear', 'slow', 'confusing', 'professional', 'helpful']

function cleanWord(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function uniqueSuggestions(
  synonyms: DatamuseWord[],
  related: DatamuseWord[],
  original: string,
): Suggestion[] {
  const normalizedOriginal = original.toLowerCase()
  const seen = new Set<string>([normalizedOriginal])
  const output: Suggestion[] = []

  const add = (items: DatamuseWord[], source: Suggestion['source']) => {
    for (const item of items) {
      const word = cleanWord(item.word || '')
      const key = word.toLowerCase()

      if (!word || seen.has(key)) continue

      seen.add(key)
      output.push({ word, source })

      if (output.length >= 18) return
    }
  }

  add(synonyms, 'Synonym')
  if (output.length < 18) add(related, 'Related')

  return output.slice(0, 18)
}

export function QaWordHelper() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchedWord, setSearchedWord] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copiedWord, setCopiedWord] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const canSearch = useMemo(() => cleanWord(query).length > 0 && !loading, [query, loading])

  useEffect(() => {
    if (!open) return

    const timer = window.setTimeout(() => inputRef.current?.focus(), 80)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  async function searchWord(value = query) {
    const word = cleanWord(value)
    if (!word) return

    setQuery(word)
    setSearchedWord(word)
    setLoading(true)
    setError('')
    setCopiedWord('')

    try {
      const encoded = encodeURIComponent(word)
      const [synonymResponse, relatedResponse] = await Promise.all([
        fetch(`https://api.datamuse.com/words?rel_syn=${encoded}&max=18`),
        fetch(`https://api.datamuse.com/words?ml=${encoded}&max=18`),
      ])

      if (!synonymResponse.ok || !relatedResponse.ok) {
        throw new Error('Datamuse request failed')
      }

      const [synonyms, related] = (await Promise.all([
        synonymResponse.json(),
        relatedResponse.json(),
      ])) as [DatamuseWord[], DatamuseWord[]]

      const nextSuggestions = uniqueSuggestions(synonyms, related, word)
      setSuggestions(nextSuggestions)

      if (nextSuggestions.length === 0) {
        setError(`No alternatives found for “${word}”. Try a simpler word.`)
      }
    } catch (requestError) {
      console.error('QA Word Helper request failed.', requestError)
      setSuggestions([])
      setError('Word Helper could not reach the free word service. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void searchWord()
  }

  async function copySuggestion(word: string) {
    try {
      await navigator.clipboard.writeText(word)
      setCopiedWord(word)
      window.setTimeout(() => setCopiedWord(''), 1300)
    } catch {
      setCopiedWord('')
    }
  }

  return (
    <>
      <button
        type="button"
        className="qa-word-helper-launcher"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span className="qa-word-helper-launcher-icon" aria-hidden="true">✍️</span>
        <span>
          <strong>QA Word Helper</strong>
          <small>Better wording for feedback</small>
        </span>
      </button>

      {open && (
        <div
          className="qa-word-helper-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <section
            className="qa-word-helper-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qa-word-helper-title"
          >
            <div className="qa-word-helper-heading">
              <div>
                <span className="qa-word-helper-kicker">FREE WORD TOOL</span>
                <h2 id="qa-word-helper-title">✍️ QA Word Helper</h2>
                <p>Type a word from your QA feedback and get cleaner alternatives.</p>
              </div>

              <button
                type="button"
                className="qa-word-helper-close"
                onClick={() => setOpen(false)}
                aria-label="Close QA Word Helper"
              >
                ×
              </button>
            </div>

            <form className="qa-word-helper-search" onSubmit={handleSubmit}>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Try: rude, unclear, confusing, slow..."
                aria-label="Word to improve"
              />
              <button type="submit" disabled={!canSearch}>
                {loading ? 'Searching…' : 'Find Better Words'}
              </button>
            </form>

            <div className="qa-word-helper-examples" aria-label="Example searches">
              <span>Quick examples:</span>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => void searchWord(example)}
                  disabled={loading}
                >
                  {example}
                </button>
              ))}
            </div>

            {error && <div className="qa-word-helper-error">{error}</div>}

            {!searchedWord && !loading && (
              <div className="qa-word-helper-empty">
                <span aria-hidden="true">💬</span>
                <strong>Make QA notes sound more professional</strong>
                <p>Search a word, then click any result to copy it.</p>
              </div>
            )}

            {loading && (
              <div className="qa-word-helper-loading" aria-live="polite">
                <span />
                <span />
                <span />
              </div>
            )}

            {!loading && suggestions.length > 0 && (
              <div className="qa-word-helper-results">
                <div className="qa-word-helper-results-title">
                  <div>
                    <span>Alternatives for</span>
                    <strong>“{searchedWord}”</strong>
                  </div>
                  <small>Click a word to copy</small>
                </div>

                <div className="qa-word-helper-chip-grid">
                  {suggestions.map((suggestion) => (
                    <button
                      type="button"
                      className="qa-word-helper-chip"
                      key={`${suggestion.source}-${suggestion.word}`}
                      onClick={() => void copySuggestion(suggestion.word)}
                    >
                      <span>{copiedWord === suggestion.word ? '✓ Copied' : suggestion.word}</span>
                      <small>{suggestion.source}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="qa-word-helper-footer">
              <span>Powered by Datamuse</span>
              <span>No API key required</span>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
