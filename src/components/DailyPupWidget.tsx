import { useCallback, useEffect, useState } from 'react'

interface DogApiResponse {
  message?: string
  status?: string
}

const DOG_API_URL = 'https://dog.ceo/api/breeds/image/random'

function breedFromUrl(url: string): string {
  const match = url.match(/\/breeds\/([^/]+)\//i)
  if (!match?.[1]) return 'Surprise pup'

  return match[1]
    .split('-')
    .reverse()
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function DailyPupWidget() {
  const [imageUrl, setImageUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const loadPup = useCallback(async () => {
    setLoading(true)
    setError(false)

    try {
      const response = await fetch(DOG_API_URL, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Dog API request failed with ${response.status}`)

      const data = (await response.json()) as DogApiResponse
      if (data.status !== 'success' || typeof data.message !== 'string') {
        throw new Error('Dog API response was incomplete.')
      }

      setImageUrl(data.message)
    } catch (caught) {
      console.warn('Daily pup could not be loaded.', caught)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPup()
  }, [loadPup])

  if (error && !imageUrl) {
    return (
      <button className="pup-widget pup-widget--error" type="button" onClick={() => void loadPup()} title="Try Daily Pup again">
        <span className="pup-fallback" aria-hidden="true">🐶</span>
        <span className="pup-copy"><strong>Daily Pup</strong><small>Tap to retry</small></span>
      </button>
    )
  }

  return (
    <button
      className={`pup-widget ${loading ? 'pup-widget--loading' : ''}`}
      type="button"
      onClick={() => void loadPup()}
      title="Free Dog CEO API — click for another random pup"
      aria-label="Daily Pup. Click for another random dog photo."
    >
      <span className="pup-image-shell">
        {imageUrl ? <img src={imageUrl} alt="Random dog from Dog CEO API" /> : <span className="pup-fallback" aria-hidden="true">🐶</span>}
        <span className="pup-live-dot" aria-hidden="true" />
      </span>

      <span className="pup-copy">
        <strong>Daily Pup</strong>
        <small>{imageUrl ? breedFromUrl(imageUrl) : 'Fetching smile…'}</small>
      </span>

      <span className="pup-refresh" aria-hidden="true">↻</span>
    </button>
  )
}
