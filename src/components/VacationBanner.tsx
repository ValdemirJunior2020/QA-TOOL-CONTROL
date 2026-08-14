import { useMemo } from 'react'

const VACATION_START = '2026-08-14'
const VACATION_END = '2026-08-30'

export function VacationBanner() {
  const isVacation = useMemo(() => {
    const today = new Date()

    const start = new Date(`${VACATION_START}T00:00:00`)
    const end = new Date(`${VACATION_END}T23:59:59`)

    return today >= start && today <= end
  }, [])

  if (!isVacation) {
    return null
  }

  return (
    <section className="vacation-banner">
      <div className="vacation-animation">
        🏝️
      </div>

      <div className="vacation-content">
        <div className="vacation-title">
          VACATION MODE: ACTIVE 😎
        </div>

        <div className="vacation-message">
          <strong>Junior has left the building.</strong>
          <br />
          He traded QA scores for ocean views.
          Barbara is holding down the fort. 👑
        </div>

        <div className="vacation-status">
          <span>🏖️ Junior: OFF DUTY</span>
          <span>👑 Barbara: SUPER ADMIN</span>
          <span>🤖 QA Tool: STILL WORKING</span>
        </div>

        <div className="vacation-warning">
          👀 Junior went on vacation. The QA rules didn't.
        </div>
      </div>

      <div className="vacation-animation vacation-animation-right">
        🌴
      </div>
    </section>
  )
}