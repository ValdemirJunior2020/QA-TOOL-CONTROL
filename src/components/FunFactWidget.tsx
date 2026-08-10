import { useCallback, useEffect, useState } from 'react'

type FactResponse = {
  text?: string
}

export default function FunFactWidget() {
  const [fact, setFact] = useState('Loading a fun fact...')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadFact = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      const response = await fetch(
        'https://uselessfacts.jsph.pl/api/v2/facts/random?language=en'
      )

      if (!response.ok) {
        throw new Error('Could not load fact')
      }

      const data: FactResponse = await response.json()

      setFact(data.text?.trim() || 'Honey never spoils.')
    } catch (err) {
      setError('Could not load fact right now.')
      setFact('Honey never spoils.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFact()
  }, [loadFact])

  return (
    <button
      type="button"
      className={`fact-widget ${loading ? 'fact-widget--loading' : ''} ${
        error ? 'fact-widget--error' : ''
      }`}
      onClick={loadFact}
      title="Load another fact"
    >
      <div className="fact-widget-copy">
        <div className="fact-widget-title">
          <span className="fact-widget-icon">💡</span>
          <strong>Did you know?</strong>
        </div>

        <p className="fact-widget-text">
          {loading ? 'Loading a fun fact...' : fact}
        </p>
      </div>

      <span className="fact-widget-refresh" aria-hidden="true">
        ↻
      </span>
    </button>
  )
}