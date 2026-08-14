const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyC7Y-LT6hBF9uhv2Fj-J74KencZqvOiwJg',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'psych-support-app.firebaseapp.com',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || 'https://psych-support-app-default-rtdb.firebaseio.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'psych-support-app',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'psych-support-app.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1090749452629',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:1090749452629:web:073d01319785225c0cdfdc',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-NX0KK99XFC',
}

function requireFirebase() {
  const sdk = (window as any).firebase
  if (!sdk) throw new Error('Firebase did not load. Check your internet connection and refresh the page.')
  return sdk
}

const firebase = requireFirebase()
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig)

export const firebaseAuth = firebase.auth()
// Keep Firebase sessions durable across refreshes and browser restarts.
void firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((error: unknown) => {
  console.warn('Firebase auth persistence could not be set.', error)
})
export const firestore = firebase.firestore()
export const realtimeDb = firebase.database()
export const googleProvider = new firebase.auth.GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

export const OWNER_EMAIL = 'infojr.83@gmail.com'
export const BARBARA_EMAIL = 'barbara.kalchik8reserve@gmail.com'
export const APRIL_EMAIL = 'april.grantham@hotelplanner.com'
export const JIM_EMAIL = 'jim.fryer@hotelplanner.com'
export const KAREN_EMAIL = 'karen.caldas@hotelplanner.com'

// Junior and Barbara are protected Super Admins.
export const SUPER_ADMIN_EMAILS = new Set([
  OWNER_EMAIL,
  BARBARA_EMAIL,
])

// These accounts always map to the Admin role in the QA app.
export const ADMIN_EMAILS = new Set([
  OWNER_EMAIL,
  BARBARA_EMAIL,
  APRIL_EMAIL,
  JIM_EMAIL,
  KAREN_EMAIL,
])

// These HotelPlanner accounts can create a Firebase email/password login from
// the app's first-time setup screen. No Google account is required.
export const EMAIL_PASSWORD_ADMIN_EMAILS = new Set([
  APRIL_EMAIL,
  JIM_EMAIL,
  KAREN_EMAIL,
])

export function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

export function isSuperAdminEmail(value: unknown): boolean {
  return SUPER_ADMIN_EMAILS.has(normalizeEmail(value))
}

export function isAdminEmail(value: unknown): boolean {
  return ADMIN_EMAILS.has(normalizeEmail(value))
}
