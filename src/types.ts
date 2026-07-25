export type UserRole = 'admin' | 'evaluator' | 'viewer'
export type QaType = 'CS' | 'Groups'
export type CriterionStatus = '✓ Followed' | '✕ Markdown' | 'N/A' | 'Partial' | ''

export interface UserPermissions {
  canSubmitReviews: boolean
  canViewHistory: boolean
  canEditAgentDetails: boolean
  canEditCriteriaSelections: boolean
  canEditCustomNotes: boolean
}

export interface QaUser {
  email: string
  displayName: string
  role: UserRole
  active: boolean
  guidedMode: boolean
  notes: string
  permissions: UserPermissions
  createdAt?: string
  updatedAt?: string
  updatedBy?: string
}

export interface CriterionDefinition {
  number: number
  name: string
  points: number
  notes: string
}

export interface CriteriaSettings {
  CS: CriterionDefinition[]
  Groups: CriterionDefinition[]
}

export interface AppRules {
  confirmationRequired: boolean
  callIdRequired: boolean
  guidedCallIdPattern: string
  noteRequiredForMarkdownOrPartial: boolean
  csKpi: number
  groupsKpi: number
}

export interface AppSettings {
  criteria: CriteriaSettings
  callCenters: string[]
  statusOptions: Exclude<CriterionStatus, ''>[]
  rules: AppRules
}

export interface CriterionAnswer extends CriterionDefinition {
  status: CriterionStatus
  partialPoints: number
  autoPoints: number
  customNote: string
}

export interface ReviewDraft {
  requestId: string
  agentStartDate: string
  todayDate: string
  evaluator: string
  agentName: string
  callCenter: string
  callId: string
  qaType: QaType
  confirmationNumber: string
  callLength: string
  callDate: string
  criteria: CriterionAnswer[]
}

export interface ReviewRecord {
  id: string
  rowNumber: number
  savedTimestamp: string
  agentStartDate: string
  reviewDate: string
  evaluator: string
  agentName: string
  callCenter: string
  callId: string
  itineraryNumber: string
  emailSent: boolean
  emailSentAt?: string
  emailSentBy?: string
  qaType: QaType
  finalScore: number
  kpiTarget: number
  result: 'PASS' | 'FAIL'
  markdowns: number
  issueSummary: string
}

export interface AuthSession {
  idToken: string
  email: string
  name: string
  picture?: string
  isDev?: boolean
}

export interface BootstrapResponse {
  success: boolean
  user: QaUser
  users: QaUser[]
  settings: AppSettings
  message?: string
}

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
  review?: ReviewRecord
  user?: QaUser
  users?: QaUser[]
  settings?: AppSettings
  reviews?: ReviewRecord[]
}
