import { useEffect, useMemo, useState } from 'react'

interface WeatherWidgetProps {
  city?: string
  latitude?: number
  longitude?: number
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number
    apparent_temperature?: number
    relative_humidity_2m?: number
    weather_code?: number
    is_day?: number
  }
  daily?: {
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
    uv_index_max?: number[]
    sunrise?: string[]
    sunset?: string[]
  }
}

interface WeatherState {
  temperature: number
  apparentTemperature: number
  humidity: number
  high: number
  low: number
  uvIndex: number
  sunrise: string
  sunset: string
  weatherCode: number
  isDay: boolean
}

type WeatherKind = 'sun' | 'moon' | 'partly' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm'

const DEFAULT_CITY = 'West Palm Beach'
const DEFAULT_LATITUDE = 26.7153
const DEFAULT_LONGITUDE = -80.0534

function weatherDescription(code: number): string {
  if (code === 0) return 'Sunny'
  if (code === 1) return 'Mostly Sunny'
  if (code === 2) return 'Partly Cloudy'
  if (code === 3) return 'Cloudy'
  if (code === 45 || code === 48) return 'Foggy'
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow'
  if ([95, 96, 99].includes(code)) return 'Thunderstorms'
  return 'Weather'
}

function weatherKind(code: number, isDay: boolean): WeatherKind {
  if (code === 0) return isDay ? 'sun' : 'moon'
  if (code === 1 || code === 2) return 'partly'
  if (code === 3) return 'cloud'
  if (code === 45 || code === 48) return 'fog'
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow'
  if ([95, 96, 99].includes(code)) return 'storm'
  return 'partly'
}

function formatClock(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return '--'

  return parsed.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function AnimatedWeatherIcon({ kind }: { kind: WeatherKind }) {
  if (kind === 'sun') {
    return (
      <span className="weather-scene weather-scene--sun" aria-hidden="true">
        <span className="weather-sun-rays">
          {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
        </span>
        <span className="weather-sun-core" />
      </span>
    )
  }

  if (kind === 'moon') {
    return (
      <span className="weather-scene weather-scene--moon" aria-hidden="true">
        <span className="weather-moon" />
        <span className="weather-star weather-star--one">✦</span>
        <span className="weather-star weather-star--two">✦</span>
      </span>
    )
  }

  if (kind === 'partly') {
    return (
      <span className="weather-scene weather-scene--partly" aria-hidden="true">
        <span className="weather-mini-sun" />
        <span className="weather-cloud weather-cloud--front" />
      </span>
    )
  }

  if (kind === 'cloud') {
    return (
      <span className="weather-scene weather-scene--cloud" aria-hidden="true">
        <span className="weather-cloud weather-cloud--solo" />
      </span>
    )
  }

  if (kind === 'fog') {
    return (
      <span className="weather-scene weather-scene--fog" aria-hidden="true">
        <span className="weather-cloud weather-cloud--fog" />
        <i className="weather-fog-line weather-fog-line--one" />
        <i className="weather-fog-line weather-fog-line--two" />
      </span>
    )
  }

  if (kind === 'snow') {
    return (
      <span className="weather-scene weather-scene--snow" aria-hidden="true">
        <span className="weather-cloud weather-cloud--precip" />
        <i className="weather-snowflake weather-snowflake--one">✦</i>
        <i className="weather-snowflake weather-snowflake--two">✦</i>
        <i className="weather-snowflake weather-snowflake--three">✦</i>
      </span>
    )
  }

  if (kind === 'storm') {
    return (
      <span className="weather-scene weather-scene--storm" aria-hidden="true">
        <span className="weather-cloud weather-cloud--precip" />
        <i className="weather-lightning">ϟ</i>
      </span>
    )
  }

  return (
    <span className="weather-scene weather-scene--rain" aria-hidden="true">
      <span className="weather-cloud weather-cloud--precip" />
      <i className="weather-raindrop weather-raindrop--one" />
      <i className="weather-raindrop weather-raindrop--two" />
      <i className="weather-raindrop weather-raindrop--three" />
    </span>
  )
}

export function WeatherWidget({
  city = DEFAULT_CITY,
  latitude = DEFAULT_LATITUDE,
  longitude = DEFAULT_LONGITUDE,
}: WeatherWidgetProps) {
  const [weather, setWeather] = useState<WeatherState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const endpoint = useMemo(() => {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day',
      daily: 'temperature_2m_max,temperature_2m_min,uv_index_max,sunrise,sunset',
      temperature_unit: 'fahrenheit',
      timezone: 'America/New_York',
      forecast_days: '1',
    })

    return `https://api.open-meteo.com/v1/forecast?${params.toString()}`
  }, [latitude, longitude])

  useEffect(() => {
    const controller = new AbortController()

    const loadWeather = async () => {
      setLoading(true)
      setError(false)

      try {
        const response = await fetch(endpoint, { signal: controller.signal })
        if (!response.ok) throw new Error(`Weather request failed with ${response.status}`)

        const data = (await response.json()) as OpenMeteoResponse
        const current = data.current
        const high = data.daily?.temperature_2m_max?.[0]
        const low = data.daily?.temperature_2m_min?.[0]
        const uvIndex = data.daily?.uv_index_max?.[0]
        const sunrise = data.daily?.sunrise?.[0]
        const sunset = data.daily?.sunset?.[0]

        if (
          typeof current?.temperature_2m !== 'number' ||
          typeof current.apparent_temperature !== 'number' ||
          typeof current.relative_humidity_2m !== 'number' ||
          typeof current.weather_code !== 'number' ||
          typeof high !== 'number' ||
          typeof low !== 'number' ||
          typeof uvIndex !== 'number' ||
          typeof sunrise !== 'string' ||
          typeof sunset !== 'string'
        ) {
          throw new Error('Weather response was incomplete.')
        }

        setWeather({
          temperature: current.temperature_2m,
          apparentTemperature: current.apparent_temperature,
          humidity: current.relative_humidity_2m,
          high,
          low,
          uvIndex,
          sunrise,
          sunset,
          weatherCode: current.weather_code,
          isDay: current.is_day !== 0,
        })
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return
        console.warn('Weather could not be loaded.', caught)
        setError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadWeather()
    const refresh = window.setInterval(loadWeather, 15 * 60 * 1000)

    return () => {
      window.clearInterval(refresh)
      controller.abort()
    }
  }, [endpoint])

  if (loading) {
    return (
      <div className="weather-widget weather-widget--loading" aria-label="Loading West Palm Beach weather">
        <span className="weather-loading-orb" aria-hidden="true" />
        <div className="weather-loading-lines" aria-hidden="true">
          <span />
          <span />
        </div>
      </div>
    )
  }

  if (error || !weather) {
    return (
      <div className="weather-widget weather-widget--error" role="status">
        <span aria-hidden="true">🌤️</span>
        <span>{city} weather unavailable</span>
      </div>
    )
  }

  const description = weatherDescription(weather.weatherCode)
  const kind = weatherKind(weather.weatherCode, weather.isDay)

  return (
    <section className="weather-widget" aria-label={`Current weather in ${city}`}>
      <AnimatedWeatherIcon kind={kind} />

      <div className="weather-copy">
        <div className="weather-primary-line">
          <strong>{Math.round(weather.temperature)}°F</strong>
          <span className="weather-divider" aria-hidden="true">·</span>
          <span>{description}</span>
        </div>

        <div className="weather-secondary-line">
          <span>{city}</span>
          <span className="weather-divider" aria-hidden="true">·</span>
          <span>H {Math.round(weather.high)}° / L {Math.round(weather.low)}°</span>
        </div>

        <div className="weather-extra-line">
          <span>Feels {Math.round(weather.apparentTemperature)}°</span>
          <span>💧 {Math.round(weather.humidity)}%</span>
          <span>UV {Math.round(weather.uvIndex)}</span>
          <span title={`Sunrise ${formatClock(weather.sunrise)}`}>🌇 {formatClock(weather.sunset)}</span>
        </div>
      </div>
    </section>
  )
}
