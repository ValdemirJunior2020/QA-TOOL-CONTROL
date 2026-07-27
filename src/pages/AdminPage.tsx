import { useMemo, useState } from 'react'
import type { AppSettings, CriterionDefinition, QaType, QaUser, UserRole } from '../types'

const SUPER_ADMIN_EMAIL = 'infojr.83@gmail.com'
const RETIRED_USER_EMAILS = new Set(['barbara.kalchik@hotelplanner.com'])

interface AdminPageProps {
  currentUser: QaUser
  users: QaUser[]
  settings: AppSettings
  onSaveUser: (user: QaUser) => Promise<void>
  onSetBlocked: (email: string, blocked: boolean) => Promise<void>
  onSaveSettings: (settings: AppSettings) => Promise<void>
  busy: boolean
}

const emptyPermissions = {
  canSubmitReviews: true,
  canViewHistory: true,
  canEditAgentDetails: true,
  canEditCriteriaSelections: true,
  canEditCustomNotes: true,
}

function newUser(): QaUser {
  return {
    email: '',
    displayName: '',
    role: 'evaluator',
    active: true,
    guidedMode: false,
    notes: '',
    permissions: { ...emptyPermissions },
  }
}

export function AdminPage({
  currentUser,
  users,
  settings,
  onSaveUser,
  onSetBlocked,
  onSaveSettings,
  busy,
}: AdminPageProps) {
  const [section, setSection] = useState<'team' | 'criteria' | 'rules'>('team')
  const [editingUser, setEditingUser] = useState<QaUser | null>(null)
  const [draftSettings, setDraftSettings] = useState<AppSettings>(() => structuredClone(settings))
  const [newCenter, setNewCenter] = useState('')

  const visibleUsers = useMemo(() => {
    const seen = new Set<string>()

    return users.filter((user) => {
      const email = user.email.trim().toLowerCase()

      if (!email || RETIRED_USER_EMAILS.has(email) || seen.has(email)) {
        return false
      }

      seen.add(email)
      return true
    })
  }, [users])

  const admins = useMemo(
    () => visibleUsers.filter((user) => user.role === 'admin'),
    [visibleUsers],
  )

  const currentUserEmail = currentUser.email.trim().toLowerCase()
  const isSuperAdmin = currentUserEmail === SUPER_ADMIN_EMAIL

  const saveUser = async () => {
    if (!editingUser) return
    if (!editingUser.displayName.trim() || !editingUser.email.trim()) {
      window.alert('Name and email are required.')
      return
    }
    await onSaveUser({
      ...editingUser,
      email: editingUser.email.trim().toLowerCase(),
      displayName: editingUser.displayName.trim(),
    })
    setEditingUser(null)
  }

  const updateCriterion = (qaType: QaType, index: number, patch: Partial<CriterionDefinition>) => {
    setDraftSettings((current) => ({
      ...current,
      criteria: {
        ...current.criteria,
        [qaType]: current.criteria[qaType].map((criterion, criterionIndex) =>
          criterionIndex === index ? { ...criterion, ...patch } : criterion,
        ),
      },
    }))
  }

  const addCenter = () => {
    const center = newCenter.trim()
    if (!center) return
    if (draftSettings.callCenters.some((item) => item.toLowerCase() === center.toLowerCase())) {
      window.alert('That call center is already in the list.')
      return
    }
    setDraftSettings((current) => ({ ...current, callCenters: [...current.callCenters, center] }))
    setNewCenter('')
  }

  const saveSettings = async () => {
    const csTotal = draftSettings.criteria.CS.reduce((sum, criterion) => sum + Number(criterion.points || 0), 0)
    const groupsTotal = draftSettings.criteria.Groups.reduce((sum, criterion) => sum + Number(criterion.points || 0), 0)
    if (csTotal !== 100 || groupsTotal !== 100) {
      const proceed = window.confirm(`CS totals ${csTotal} points and Groups totals ${groupsTotal} points. Save anyway?`)
      if (!proceed) return
    }
    await onSaveSettings(draftSettings)
  }

  return (
    <div className="page-stack">
      <section className="admin-intro">
        <div>
          <p className="eyebrow">Administrator access</p>
          <h1>Control who can use and change the QA app.</h1>
          <p>
            Only Junior and Barbara can be administrators. Other people can be added as evaluators or viewers, blocked, placed in Guided Mode, or limited to specific actions.
          </p>
        </div>
        <div className="admin-summary">
          <span>{admins.length} administrator accounts</span>
          <strong>Junior + Barbara only</strong>
        </div>
      </section>

      <div className="segmented-control" role="tablist">
        <button type="button" className={section === 'team' ? 'active' : ''} onClick={() => setSection('team')}>Team & Access</button>
        <button type="button" className={section === 'criteria' ? 'active' : ''} onClick={() => setSection('criteria')}>Criteria</button>
        <button type="button" className={section === 'rules' ? 'active' : ''} onClick={() => setSection('rules')}>Rules & Centers</button>
      </div>

      {section === 'team' && (
        <section className="panel">
          <div className="panel-heading wrap-heading">
            <div>
              <p className="eyebrow">People</p>
              <h2>Evaluator Access</h2>
            </div>
            <button type="button" className="primary-button" onClick={() => setEditingUser(newUser())}>Add Person</button>
          </div>

          <div className="team-grid">
            {visibleUsers.map((user) => {
              const userEmail = user.email.trim().toLowerCase()
              const isTargetSuperAdmin = userEmail === SUPER_ADMIN_EMAIL
              const isCurrentUser = userEmail === currentUserEmail
              const canManageTarget =
                isSuperAdmin
                  ? !isTargetSuperAdmin || isCurrentUser
                  : user.role !== 'admin' || isCurrentUser
              const canBlockTarget =
                !isTargetSuperAdmin && (user.role !== 'admin' || isSuperAdmin)

              return (
                <article key={user.email} className={`team-card ${!user.active ? 'disabled' : ''}`}>
                  <div className="team-card-heading">
                    <div className="avatar large">{user.displayName.slice(0, 1).toUpperCase()}</div>
                    <div>
                      <h3>{user.displayName}</h3>
                      <p>{user.email}</p>
                    </div>
                    <span className={`role-pill ${user.role}`}>{user.role}</span>
                  </div>

                  <div className="permission-chips">
                    <span>{user.active ? 'Active' : 'Blocked'}</span>
                    <span>{user.permissions.canSubmitReviews ? 'Can submit' : 'No submissions'}</span>
                    {user.guidedMode && <span className="guided-chip">Guided Mode</span>}
                  </div>

                  {user.notes && <p className="team-note">{user.notes}</p>}

                  <div className="team-actions">
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={() => setEditingUser(structuredClone(user))}
                      disabled={!canManageTarget}
                      title={!canManageTarget ? 'Only Junior can edit another administrator.' : undefined}
                    >
                      Edit
                    </button>
                    {canBlockTarget && (
                      <button
                        type="button"
                        className={user.active ? 'danger-button compact' : 'success-button compact'}
                        onClick={() => onSetBlocked(user.email, user.active)}
                        disabled={busy}
                      >
                        {user.active ? 'Block' : 'Unblock'}
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {section === 'criteria' && (
        <section className="panel">
          <div className="panel-heading wrap-heading">
            <div>
              <p className="eyebrow">Scoring content</p>
              <h2>Edit Criteria and Points</h2>
              <p className="muted">Changes apply to new reviews. Existing saved reviews stay unchanged.</p>
            </div>
            <button type="button" className="primary-button" onClick={saveSettings} disabled={busy}>Save Criteria</button>
          </div>

          {(['CS', 'Groups'] as QaType[]).map((qaType) => (
            <div key={qaType} className="criteria-editor-section">
              <div className="criteria-editor-heading">
                <h3>{qaType} Criteria</h3>
                <span>{draftSettings.criteria[qaType].reduce((sum, item) => sum + Number(item.points || 0), 0)} total points</span>
              </div>
              <div className="criteria-editor-list">
                {draftSettings.criteria[qaType].map((criterion, index) => (
                  <article key={`${qaType}-${criterion.number}`} className="criteria-editor-card">
                    <div className="criterion-number">{criterion.number}</div>
                    <label className="field">
                      <span>Criteria name</span>
                      <input value={criterion.name} onChange={(event) => updateCriterion(qaType, index, { name: event.target.value })} />
                    </label>
                    <label className="field points-field">
                      <span>Points</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={criterion.points}
                        onChange={(event) => updateCriterion(qaType, index, { points: Number(event.target.value) })}
                      />
                    </label>
                    <label className="field wide-field">
                      <span>Notes / Issue Found description</span>
                      <textarea value={criterion.notes} onChange={(event) => updateCriterion(qaType, index, { notes: event.target.value })} />
                    </label>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {section === 'rules' && (
        <section className="panel">
          <div className="panel-heading wrap-heading">
            <div>
              <p className="eyebrow">Form rules</p>
              <h2>Required Fields and Call Centers</h2>
            </div>
            <button type="button" className="primary-button" onClick={saveSettings} disabled={busy}>Save Rules</button>
          </div>

          <div className="rule-grid">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draftSettings.rules.callIdRequired}
                onChange={(event) => setDraftSettings((current) => ({ ...current, rules: { ...current.rules, callIdRequired: event.target.checked } }))}
              />
              <span><strong>Call ID required</strong><small>Every review must include a Call ID.</small></span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draftSettings.rules.confirmationRequired}
                onChange={(event) => setDraftSettings((current) => ({ ...current, rules: { ...current.rules, confirmationRequired: event.target.checked } }))}
              />
              <span><strong>Confirmation required</strong><small>Accept any itinerary, confirmation, reservation, or supplier reference.</small></span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draftSettings.rules.noteRequiredForMarkdownOrPartial}
                onChange={(event) => setDraftSettings((current) => ({ ...current, rules: { ...current.rules, noteRequiredForMarkdownOrPartial: event.target.checked } }))}
              />
              <span><strong>Require notes for Markdown and Partial</strong><small>Prevents saving without a clear explanation.</small></span>
            </label>
            <label className="field">
              <span>CS KPI</span>
              <input
                type="number"
                value={draftSettings.rules.csKpi}
                onChange={(event) => setDraftSettings((current) => ({ ...current, rules: { ...current.rules, csKpi: Number(event.target.value) } }))}
              />
            </label>
            <label className="field">
              <span>Groups KPI</span>
              <input
                type="number"
                value={draftSettings.rules.groupsKpi}
                onChange={(event) => setDraftSettings((current) => ({ ...current, rules: { ...current.rules, groupsKpi: Number(event.target.value) } }))}
              />
            </label>
            <label className="field wide-field">
              <span>Guided Call ID pattern</span>
              <input
                value={draftSettings.rules.guidedCallIdPattern}
                onChange={(event) => setDraftSettings((current) => ({ ...current, rules: { ...current.rules, guidedCallIdPattern: event.target.value } }))}
              />
              <em>Default: CA followed by exactly 32 hexadecimal characters.</em>
            </label>
          </div>

          <div className="center-manager">
            <h3>Call Centers</h3>
            <div className="center-chips">
              {draftSettings.callCenters.map((center) => (
                <span key={center}>
                  {center}
                  <button
                    type="button"
                    aria-label={`Remove ${center}`}
                    onClick={() => setDraftSettings((current) => ({
                      ...current,
                      callCenters: current.callCenters.filter((item) => item !== center),
                    }))}
                  >×</button>
                </span>
              ))}
            </div>
            <div className="inline-add">
              <input value={newCenter} onChange={(event) => setNewCenter(event.target.value)} placeholder="New call center" />
              <button type="button" className="secondary-button" onClick={addCenter}>Add</button>
            </div>
          </div>
        </section>
      )}

      {editingUser && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card user-modal" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
            <p className="eyebrow">Access control</p>
            <h2 id="user-modal-title">{visibleUsers.some((user) => user.email === editingUser.email) ? 'Edit Person' : 'Add Person'}</h2>

            <div className="modal-form-grid">
              <label className="field">
                <span>Name</span>
                <input value={editingUser.displayName} onChange={(event) => setEditingUser({ ...editingUser, displayName: event.target.value })} />
              </label>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={editingUser.email}
                  onChange={(event) => setEditingUser({ ...editingUser, email: event.target.value })}
                  disabled={visibleUsers.some((user) => user.email === editingUser.email)}
                />
              </label>
              <label className="field">
                <span>Role</span>
                <select
                  value={editingUser.role}
                  onChange={(event) =>
                    setEditingUser({
                      ...editingUser,
                      role: event.target.value as UserRole,
                    })
                  }
                  disabled={
                    editingUser.email.trim().toLowerCase() === SUPER_ADMIN_EMAIL ||
                    (!isSuperAdmin && editingUser.role === 'admin')
                  }
                >
                  <option value="evaluator">Evaluator</option>
                  <option value="viewer">Viewer</option>
                  {(isSuperAdmin || editingUser.role === 'admin') && (
                    <option value="admin">Admin</option>
                  )}
                </select>
                <em>
                  Junior is the Super Admin and can change Barbara’s role and access.
                </em>
              </label>
              <label className="field wide-field">
                <span>Admin note</span>
                <textarea value={editingUser.notes} onChange={(event) => setEditingUser({ ...editingUser, notes: event.target.value })} placeholder="Optional internal note" />
              </label>
            </div>

            <div className="permission-editor">
              <label className="toggle-row">
                <input type="checkbox" checked={editingUser.active} onChange={(event) => setEditingUser({ ...editingUser, active: event.target.checked })} disabled={
                    editingUser.email.trim().toLowerCase() === SUPER_ADMIN_EMAIL ||
                    (!isSuperAdmin && editingUser.role === 'admin')
                  }
                />
                <span><strong>Account active</strong><small>Blocked people can’t enter the app.</small></span>
              </label>
              <label className="toggle-row guided-toggle">
                <input type="checkbox" checked={editingUser.guidedMode} onChange={(event) => setEditingUser({ ...editingUser, guidedMode: event.target.checked })} disabled={
                    editingUser.role === 'admin' ||
                    (!isSuperAdmin &&
                      editingUser.email.trim().toLowerCase() !== currentUserEmail)
                  }
                />
                <span><strong>Guided Mode</strong><small>Adds friendly reminders, locked scoring fields, and a final checklist.</small></span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={editingUser.permissions.canSubmitReviews}
                  onChange={(event) => setEditingUser({ ...editingUser, permissions: { ...editingUser.permissions, canSubmitReviews: event.target.checked } })}
                  disabled={editingUser.role === 'viewer'}
                />
                <span><strong>Can submit reviews</strong></span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={editingUser.permissions.canViewHistory}
                  onChange={(event) => setEditingUser({ ...editingUser, permissions: { ...editingUser.permissions, canViewHistory: event.target.checked } })}
                />
                <span><strong>Can view review history</strong></span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={editingUser.permissions.canEditAgentDetails}
                  onChange={(event) => setEditingUser({ ...editingUser, permissions: { ...editingUser.permissions, canEditAgentDetails: event.target.checked } })}
                />
                <span><strong>Can edit call and agent details</strong></span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={editingUser.permissions.canEditCriteriaSelections}
                  onChange={(event) => setEditingUser({ ...editingUser, permissions: { ...editingUser.permissions, canEditCriteriaSelections: event.target.checked } })}
                />
                <span><strong>Can select criteria statuses</strong></span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={editingUser.permissions.canEditCustomNotes}
                  onChange={(event) => setEditingUser({ ...editingUser, permissions: { ...editingUser.permissions, canEditCustomNotes: event.target.checked } })}
                />
                <span><strong>Can add custom notes</strong></span>
              </label>
            </div>

            {editingUser.email.toLowerCase() === 'shoultskelly22@gmail.com' && (
              <div className="kind-note">
                Kelly’s default setup uses Guided Mode. The app gives clear reminders without using negative or embarrassing language.
              </div>
            )}

            {isSuperAdmin &&
              editingUser.email.trim().toLowerCase() !== SUPER_ADMIN_EMAIL && (
                <div className="kind-note">
                  Super Admin control is active. Junior can change this person’s role,
                  permissions, Guided Mode, and active status, including for administrators.
                </div>
              )}

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditingUser(null)}>Cancel</button>
              <button type="button" className="primary-button" onClick={saveUser} disabled={busy}>{busy ? 'Saving…' : 'Save Person'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}