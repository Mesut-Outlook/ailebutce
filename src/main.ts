import './style.css'
import * as d3 from 'd3'
import { initializeApp, setLogLevel } from 'firebase/app'
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  type Auth,
} from 'firebase/auth'
import {
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  setDoc,
  type Firestore,
} from 'firebase/firestore'

declare const __app_id: string | undefined
declare const __firebase_config: string | undefined
declare const __initial_auth_token: string | undefined

// --- CUSTOM UI COMPONENTS (NON-BLOCKING) ---
// --- CUSTOM UI COMPONENTS (NON-BLOCKING) ---
const showConfirm = (message: string, title = 'Emin misiniz?', options?: { cancel?: string, discard?: string, save?: string }): Promise<'cancel' | 'discard' | 'save'> => {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-confirm-modal')
    const titleEl = document.getElementById('confirm-modal-title')
    const msgEl = document.getElementById('confirm-modal-message')
    const cancelBtn = document.getElementById('confirm-modal-cancel-btn') as HTMLButtonElement
    const discardBtn = document.getElementById('confirm-modal-discard-btn') as HTMLButtonElement
    const saveBtn = document.getElementById('confirm-modal-save-btn') as HTMLButtonElement

    if (!modal || !titleEl || !msgEl || !cancelBtn || !discardBtn || !saveBtn) {
      const result = confirm(message)
      resolve(result ? 'discard' : 'cancel')
      return
    }

    titleEl.textContent = title
    msgEl.textContent = message

    // Set button labels if provided
    cancelBtn.textContent = options?.cancel || 'İptal'
    discardBtn.textContent = options?.discard || 'Kaydetmeden Çık'
    saveBtn.textContent = options?.save || 'Kaydet ve Çık'

    // Show/Hide Save button based on whether 'save' option is desired
    if (options && options.save === '') {
      saveBtn.classList.add('hidden')
      discardBtn.classList.remove('sm:order-2')
      discardBtn.classList.add('sm:order-3')
    } else {
      saveBtn.classList.remove('hidden')
      discardBtn.classList.remove('sm:order-3')
      discardBtn.classList.add('sm:order-2')
    }

    modal.classList.add('show')

    const cleanup = (result: 'cancel' | 'discard' | 'save') => {
      modal.classList.remove('show')
      // Clean up event listeners by cloning
      cancelBtn.replaceWith(cancelBtn.cloneNode(true))
      discardBtn.replaceWith(discardBtn.cloneNode(true))
      saveBtn.replaceWith(saveBtn.cloneNode(true))
      resolve(result)
    }

    document.getElementById('confirm-modal-cancel-btn')?.addEventListener('click', () => cleanup('cancel'))
    document.getElementById('confirm-modal-discard-btn')?.addEventListener('click', () => cleanup('discard'))
    document.getElementById('confirm-modal-save-btn')?.addEventListener('click', () => cleanup('save'))
  })
}

const showAlert = (message: string, title = 'Bildirim', type: 'info' | 'error' | 'success' = 'info'): Promise<void> => {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-alert-modal')
    const titleEl = document.getElementById('alert-modal-title')
    const msgEl = document.getElementById('alert-modal-message')
    const okBtn = document.getElementById('alert-modal-ok-btn')
    const iconContainer = document.getElementById('alert-modal-icon-container')

    if (!modal || !titleEl || !msgEl || !okBtn || !iconContainer) {
      alert(message)
      resolve()
      return
    }

    titleEl.textContent = title
    msgEl.textContent = message

    // Icon logic
    let iconColor = 'bg-indigo-100 text-indigo-600'
    let iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>'

    if (type === 'error') {
      iconColor = 'bg-red-100 text-red-600'
      iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>'
    } else if (type === 'success') {
      iconColor = 'bg-emerald-100 text-emerald-600'
      iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>'
    }

    iconContainer.className = `p-2 rounded-full ${iconColor}`
    iconContainer.innerHTML = iconSvg

    modal.classList.add('show')

    const cleanup = () => {
      modal.classList.remove('show')
      okBtn.replaceWith(okBtn.cloneNode(true))
      resolve()
    }

    document.getElementById('alert-modal-ok-btn')?.addEventListener('click', cleanup)
  })
}

const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
  const toast = document.createElement('div')
  const bg = type === 'success' ? 'bg-emerald-600' : type === 'error' ? 'bg-red-600' : 'bg-indigo-600'
  toast.className = `fixed bottom-4 right-4 ${bg} text-white px-6 py-3 rounded-lg shadow-lg z-[300] font-bold animate-bounce flex items-center gap-2`

  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'
  toast.innerHTML = `<span>${icon}</span> ${message}`

  document.body.appendChild(toast)
  setTimeout(() => {
    toast.classList.replace('animate-bounce', 'opacity-0')
    toast.style.transition = 'opacity 0.5s ease'
    setTimeout(() => toast.remove(), 500)
  }, 3000)
}

// --- ERROR HANDLING ---
const showError = (message: string) => {
  const errorBox = document.getElementById('error-box')
  if (errorBox) {
    errorBox.textContent = message
    errorBox.classList.remove('hidden')
  } else {
    showAlert(message, 'Hata', 'error')
  }
}

// --- TYPES ---
type Currency = 'EUR' | 'TRY' | 'USD'
type ExpenseType = 'FIXED' | 'VARIABLE'
type SectionType = 'INCOME' | 'EXPENSE'
type GroupType = 'HOLLANDA' | 'TURKIYE' | 'INCOME_ENTRIES'

interface BudgetDetail {
  id: string
  name: string
  amount: number
  currency: Currency
  type: ExpenseType
  section: SectionType
  group: GroupType
  subGroup: string // e.g. 'Mutfak', 'Sigorta', 'Genel'
  paymentDay?: number // 1-31
  color?: string // Hex color code
}

interface BudgetRecord {
  id: string
  monthYear: string
  exchangeRate: number
  usdRate: number
  totalTurkiyeTL: number
  totalHollandaEUR: number
  totalIncomeEUR: number
  totalExpenseEUR: number
  transferAmountEUR: number
  grandTotalEUR: number
  details: BudgetDetail[]
}

// type ChartPoint = { ... } // Removed unused type

// --- EUR/TRY EXCHANGE RATE API ---
interface ExchangeRateResponse {
  amount: number
  base: string
  date: string
  rates: { TRY: number }
}

const fetchExchangeRates = async (): Promise<{ eurRate: number; usdRate: number; date: string } | null> => {
  try {
    const [eurRes, usdRes] = await Promise.all([
      fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=TRY'),
      fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY')
    ])

    if (!eurRes.ok || !usdRes.ok) {
      throw new Error(`API error: ${eurRes.status} / ${usdRes.status}`)
    }

    const eurData: ExchangeRateResponse = await eurRes.json()
    const usdData: ExchangeRateResponse = await usdRes.json()

    return {
      eurRate: eurData.rates.TRY,
      usdRate: usdData.rates.TRY,
      date: eurData.date
    }
  } catch (error) {
    console.error('Failed to fetch exchange rates:', error)
    return null
  }
}

// --- INTERFACES & SERVICES ---
interface BudgetService {
  init(): Promise<void>
  saveBudget(budget: BudgetRecord): Promise<void>
  deleteBudget(id: string): Promise<void>
  subscribe(callback: (budgets: BudgetRecord[]) => void): () => void
  getUserId(): string | null
}

const migrateLegacyData = (legacyData: any): BudgetRecord => {
  // Migration logic for old data structure
  const details: BudgetDetail[] = (legacyData.details || []).map((d: any, index: number) => ({
    id: `legacy-${Date.now()}-${index}`,
    name: d.name,
    amount: d.amountTL,
    currency: 'TRY', // Old app was TL based inputs converted to EUR
    type: 'VARIABLE',
    section: 'EXPENSE',
    group: 'TURKIYE', // Assume old inputs were TR expenses
    subGroup: 'Genel'
  }))

  return {
    id: legacyData.id,
    monthYear: legacyData.monthYear,
    exchangeRate: legacyData.exchangeRate,
    usdRate: 0,
    totalTurkiyeTL: legacyData.totalTL,
    totalHollandaEUR: 0,
    totalIncomeEUR: 0,
    totalExpenseEUR: legacyData.totalEUR,
    transferAmountEUR: legacyData.totalEUR, // In old app, totalEUR was the converted total
    grandTotalEUR: legacyData.totalEUR,
    details
  }
}


class FileBudgetService implements BudgetService {
  private apiEndpoint = '/api/db'
  private listeners: ((budgets: BudgetRecord[]) => void)[] = []
  private cache: BudgetRecord[] = []

  async init(): Promise<void> {
    console.log('FileBudgetService initialized')
    try {
      await this.refresh()
    } catch (e) {
      console.warn('Could not fetch initial data, maybe server not ready', e)
    }
  }

  getUserId(): string | null {
    return null
  }

  private async refresh() {
    try {
      const res = await fetch(this.apiEndpoint)
      if (!res.ok) throw new Error('API Error')
      const raw = await res.json()
      // Migrate on read
      this.cache = raw.map((item: any) => item.totalTurkiyeTL !== undefined ? item : migrateLegacyData(item))
      this.notify()
    } catch (error) {
      console.error('Failed to load budgets', error)
    }
  }

  private async saveToServer(budgets: BudgetRecord[]) {
    try {
      await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(budgets)
      })
      this.cache = budgets
      this.notify()
      // Success feedback for manual verification
      // Use simple timeout to prevent blocking UI too much or annoying on auto-save (if any)
      // But user requested "Verify save button", so an explicit alert is good for now.
      // We can check if it was triggered manually? For now, simple alert.
      // Actually, let's use a non-blocking toast or console + maybe only alert if it takes long? 
      // User asked "Make sure save button works". 
      // Let's add:
      console.log('Veriler başarıyla db.json dosyasına yazıldı.')
      showToast('Bütçe Başarıyla Kaydedildi!', 'success')
    } catch (error) {
      console.error('Failed to save budgets', error)
      showAlert('HATA: Veri dosyaya yazılamadı! Sunucu çalışıyor mu?', 'Hata', 'error')
    }
  }

  async saveBudget(budget: BudgetRecord): Promise<void> {
    // Optimistic update
    const index = this.cache.findIndex((b) => b.id === budget.id)
    if (index >= 0) {
      this.cache[index] = budget
    } else {
      this.cache.push(budget)
    }

    // Notify immediately for UI snap
    this.notify()

    // Sync to backend
    await this.saveToServer(this.cache)
  }

  async deleteBudget(id: string): Promise<void> {
    this.cache = this.cache.filter((b) => b.id !== id)
    this.notify()
    await this.saveToServer(this.cache)
  }

  subscribe(callback: (budgets: BudgetRecord[]) => void): () => void {
    this.listeners.push(callback)
    callback(this.cache)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback)
    }
  }

  private notify() {
    this.listeners.forEach((l) => l(this.cache))
  }
}


class FirestoreBudgetService implements BudgetService {
  private db!: Firestore
  private auth!: Auth
  private userId: string | null = null
  private appId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private config: any
  private initialToken: string | null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(config: any, appId: string, initialToken: string | null) {
    this.config = config
    this.appId = appId
    this.initialToken = initialToken
  }

  async init(): Promise<void> {
    const app = initializeApp(this.config)
    this.db = getFirestore(app)
    this.auth = getAuth(app)
    setLogLevel('silent')

    return new Promise((resolve) => {
      onAuthStateChanged(this.auth, (user) => {
        if (user) {
          this.userId = user.uid
        } else {
          this.userId = null
        }
        resolve()
      })
    })
  }

  async login(email: string, pass: string) {
    await signInWithEmailAndPassword(this.auth, email, pass)
  }

  async register(email: string, pass: string) {
    await createUserWithEmailAndPassword(this.auth, email, pass)
  }

  async logout() {
    await signOut(this.auth)
  }

  getUserId(): string | null {
    return this.userId
  }

  async saveBudget(budget: BudgetRecord): Promise<void> {
    if (!this.userId) throw new Error('User not authenticated')
    const budgetDocRef = doc(this.db, `artifacts/${this.appId}/users/${this.userId}/budgets`, budget.id)
    await setDoc(budgetDocRef, budget)
  }

  async deleteBudget(id: string): Promise<void> {
    if (!this.userId) throw new Error('User not authenticated')
    const budgetDocRef = doc(this.db, `artifacts/${this.appId}/users/${this.userId}/budgets`, id)
    await deleteDoc(budgetDocRef)
  }

  subscribe(callback: (budgets: BudgetRecord[]) => void): () => void {
    if (!this.userId) return () => { }

    const budgetCollectionRef = collection(this.db, `artifacts/${this.appId}/users/${this.userId}/budgets`)
    return onSnapshot(
      budgetCollectionRef,
      (snapshot) => {
        const budgets: BudgetRecord[] = []
        snapshot.forEach((docSnap) => {
          const data = docSnap.data()
          // Check if data needs migration
          if (data && data.totalTurkiyeTL === undefined) {
            budgets.push(migrateLegacyData({ ...data, id: docSnap.id }))
          } else {
            budgets.push(data as BudgetRecord)
          }
        })
        callback(budgets)
      },
      (error) => {
        console.error('Firestore listen error:', error)
      }
    )
  }
}

// --- GLOBAL VARIABLES ---
declare global {
  interface Window {
    addGroup?: (groupType: GroupType) => void
    removeGroup?: (groupId: string) => void
    addExpenseItem?: (groupId: string) => void
    removeExpenseItem?: (itemId: string) => void
    deleteBudget?: (monthKey: string) => Promise<void>
    toggleGroup?: (groupId: string) => void
    toggleAllGroups?: () => void
  }
}

const months = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
]

const envAppId = (import.meta.env.VITE_APP_ID as string | undefined) ?? undefined
const envFirebaseConfig = (import.meta.env.VITE_FIREBASE_CONFIG as string | undefined) ?? undefined
const envInitialAuthToken = (import.meta.env.VITE_INITIAL_AUTH_TOKEN as string | undefined) ?? undefined

const appId = typeof __app_id !== 'undefined' && __app_id ? __app_id : envAppId || 'default-app-id'
const firebaseConfig = (() => {
  const rawConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? __firebase_config : envFirebaseConfig
  if (!rawConfig) return {}
  try { return JSON.parse(rawConfig) } catch (error) { return {} }
})()
const initialAuthToken = typeof __initial_auth_token !== 'undefined' && __initial_auth_token ? __initial_auth_token : envInitialAuthToken ?? null

let budgetService: BudgetService | null = null
let allBudgetSummary: BudgetRecord[] = []
// let unsubscribeBudgets: (() => void) | null = null // Removed unused variable
let activeMonth = ''
let activeYear = ''

// --- DIRTY CHECK STATE ---
let isDirty = false
const setDirty = (status: boolean) => {
  isDirty = status
  const saveBtn = document.getElementById('save-budget-btn')
  if (saveBtn) {
    if (isDirty) saveBtn.classList.add('ring-2', 'ring-offset-2', 'ring-indigo-500')
    else saveBtn.classList.remove('ring-2', 'ring-offset-2', 'ring-indigo-500')
  }
}
window.addEventListener('beforeunload', (e) => {
  if (isDirty) {
    e.preventDefault()
    e.returnValue = ''
  }
})

// --- DOM ELEMENTS ---
// ... existing fetch ...
const getElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (!element) throw new Error(`#${id} öğesi bulunamadı.`)
  return element as T
}

const loadingOverlay = getElement<HTMLDivElement>('loading-overlay')
const appContainer = getElement<HTMLDivElement>('app-container')
const userIdDisplay = getElement<HTMLSpanElement>('user-id')

// Helper for sorting/finding last budget
const getLastBudget = (): BudgetRecord | undefined => {
  if (allBudgetSummary.length === 0) return undefined
  const sorted = [...allBudgetSummary].sort((a, b) => {
    const [ma, ya] = a.id.split(' ')
    const [mb, yb] = b.id.split(' ')

    if (ya !== yb) return parseInt(yb) - parseInt(ya)
    return months.indexOf(mb) - months.indexOf(ma)
  })
  return sorted[0]
}

const eurRateInput = getElement<HTMLInputElement>('eur-rate')
const usdRateInput = getElement<HTMLInputElement>('usd-rate')

// --- HELPER FUNCTIONS ---
const formatCurrency = (amount: number, currency: Currency) => {
  const formatter = new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return formatter.format(Number.isFinite(amount) ? amount : 0)
}

// On Update
const onBudgetsUpdated = (budgets: BudgetRecord[]) => {
  // Update the global budget summary
  allBudgetSummary = budgets

  // Update callback when budgets change
  if (activeMonth && activeYear) {
    const activeKey = `${activeMonth} ${activeYear}`
    const exists = allBudgetSummary.some(b => b.id === activeKey)
    if (!exists) {
      // If it doesn't exist in the summary, it might be a brand new month we just started creating
      // but haven't saved yet. We should only reset if we are NOT in that "new month" state.
      // We can check if the current UI container is visible and dirty or just initialized.
      // For now, let's only reset if it's NOT a brand new intent.
      // Actually, if it's NOT in allBudgetSummary, we should probably just let it be 
      // until the user either saves it or navigates away.

      // Let's check if the budget-ui-container is visible. If it is, and we haven't saved yet, 
      // just ignore the "not exists" for now.
      const uiContainer = document.getElementById('budget-ui-container')
      const isVisible = uiContainer && !uiContainer.classList.contains('hidden')

      if (!isVisible) {
        // Only reset if the UI isn't even showing the month we think is active.
        activeMonth = ''
        activeYear = ''
      }
    } else {
      // Reload the current budget to reflect changes
      loadFormData(activeMonth, activeYear)
    }
  }

  // Update Welcome Screen List
  renderWelcomeBudgetList(allBudgetSummary)
}

// --- UI EVENT HANDLERS & STATE ---

const generateId = () => `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

const toggleGroup = (groupId: string) => {
  const itemsDiv = document.getElementById(`${groupId}-items`)
  const icon = document.getElementById(`${groupId}-icon`)
  if (itemsDiv) {
    itemsDiv.classList.toggle('hidden')
    if (icon) {
      icon.classList.toggle('rotate-180')
    }
  }
}

const calculateEditorTotals = () => {
  // Determine totals from DOM inputs
  let totalIncome = 0
  let totalExpense = 0
  let totalTurkiyeTL = 0
  const eurRate = parseFloat(eurRateInput.value) || 0
  const usdRate = parseFloat(usdRateInput.value) || 0

  // 1. Process Income Groups
  document.getElementById('income-groups-container')?.querySelectorAll('.expense-item').forEach(item => {
    const amountDisplay = (item.querySelector('.expense-amount') as HTMLInputElement).value
    const amount = parseFloat(amountDisplay) || 0
    const currency = (item.querySelector('.expense-currency') as HTMLSelectElement).value as Currency
    let amountEUR = amount
    if (currency === 'TRY' && eurRate > 0) amountEUR = amount / eurRate
    if (currency === 'USD' && usdRate > 0 && eurRate > 0) amountEUR = (amount * usdRate) / eurRate

    totalIncome += amountEUR
  })

  // 2. Process HOLLANDA & TURKIYE Groups
  const expenseGroups = document.querySelectorAll('[data-group-type="HOLLANDA"], [data-group-type="TURKIYE"]')

  expenseGroups.forEach(groupEl => {
    const groupId = groupEl.id
    const groupType = groupEl.getAttribute('data-group-type')
    let groupTotalEUR = 0
    let groupTotalTL = 0

    groupEl.querySelectorAll('.expense-item').forEach(item => {
      const amountDisplay = (item.querySelector('.expense-amount') as HTMLInputElement).value
      const amount = parseFloat(amountDisplay) || 0
      const currency = (item.querySelector('.expense-currency') as HTMLSelectElement).value as Currency

      // Global Sums
      let amountEUR = 0
      if (currency === 'EUR') {
        amountEUR = amount
        if (groupType === 'TURKIYE' && eurRate > 0) totalTurkiyeTL += (amount * eurRate)
      } else if (currency === 'USD') {
        if (usdRate > 0 && eurRate > 0) amountEUR = (amount * usdRate) / eurRate
        if (groupType === 'TURKIYE' && usdRate > 0) totalTurkiyeTL += (amount * usdRate)
      } else {
        // TRY
        if (groupType === 'TURKIYE') {
          totalTurkiyeTL += amount
          groupTotalTL += amount
        }
        if (eurRate > 0) amountEUR = amount / eurRate
      }

      if (groupType === 'HOLLANDA' || groupType === 'TURKIYE') {
        totalExpense += amountEUR
        groupTotalEUR += amountEUR
      }
    })

    // Update Group Header Total
    const headerTotalSpan = document.getElementById(`total-${groupId}`)
    if (headerTotalSpan) {
      // Show native currency total for group context
      if (groupType === 'TURKIYE') headerTotalSpan.textContent = formatCurrency(groupTotalTL, 'TRY')
      else headerTotalSpan.textContent = formatCurrency(groupTotalEUR, 'EUR')
    }
  })

  // 3. Update UI Display (Hero & Footers)
  const turkiyeEUR = (eurRate > 0) ? totalTurkiyeTL / eurRate : 0

  // Helper
  const setText = (id: string, val: string) => { const el = document.getElementById(id); if (el) el.textContent = val; }

  // Hero Stats
  setText('display-total-income', formatCurrency(totalIncome, 'EUR'))
  setText('display-total-expense', formatCurrency(totalExpense, 'EUR'))
  setText('display-balance', formatCurrency(totalIncome - totalExpense, 'EUR'))

  // Expense Card Breakdown
  setText('display-turkey-converted-hero', formatCurrency(turkiyeEUR, 'EUR'))
  setText('display-total-turkey-expense', formatCurrency(turkiyeEUR, 'EUR'))
  // setText('display-nl-only-hero', formatCurrency(totalExpense - turkiyeEUR, 'EUR')) // Removed old small one
  setText('display-hollanda-total-hero-large', formatCurrency(totalExpense - turkiyeEUR, 'EUR'))

  // Section Footers
  setText('display-total-turkiye', formatCurrency(totalTurkiyeTL, 'TRY'))
  setText('display-turkey-converted-footer', `(= ${formatCurrency(turkiyeEUR, 'EUR')})`)

  // 4. Update individual Turkey items with EUR equivalents
  document.querySelectorAll('[data-group-type="TURKIYE"] .expense-item').forEach(item => {
    const amount = parseFloat((item.querySelector('.expense-amount') as HTMLInputElement).value) || 0
    const currency = (item.querySelector('.expense-currency') as HTMLSelectElement).value as Currency
    const convEl = item.querySelector('.expense-conversion') as HTMLElement
    if (!convEl) return

    if (amount > 0 && eurRate > 0) {
      let amountEUR = 0
      if (currency === 'TRY') amountEUR = amount / eurRate
      else if (currency === 'USD' && usdRate > 0) amountEUR = (amount * usdRate) / eurRate
      
      if (amountEUR > 0) {
        convEl.textContent = `≈ ${formatCurrency(amountEUR, 'EUR')}`
        convEl.classList.remove('hidden')
      } else {
        convEl.classList.add('hidden')
      }
    } else {
      convEl.classList.add('hidden')
    }
  })

  // Progress Bar Animation
  const bar = document.getElementById('balance-progress-bar')
  if (bar) {
    const balance = totalIncome - totalExpense
    let pct = 0
    if (totalIncome > 0) pct = (balance / totalIncome) * 100
    pct = Math.max(0, Math.min(100, pct))

    bar.style.width = `${pct}%`

    bar.className = 'h-full transition-all duration-500 ' // Reset classes
    if (balance < 0) bar.classList.add('bg-red-500')
    else if (pct < 20) bar.classList.add('bg-orange-500')
    else bar.classList.add('bg-green-400')
  }
}

// Attach live listener
document.addEventListener('input', (e) => {
  if ((e.target as HTMLElement).matches('input, select')) {
    setDirty(true) // Mark as dirty on any input change
    calculateEditorTotals()
  }
})

const createGroupElement = (groupId: string, groupType: GroupType, groupName = '', initialColor = '#f9fafb') => {
  let containerId = ''
  if (groupType === 'HOLLANDA') containerId = 'expense-groups-container'
  else if (groupType === 'TURKIYE') containerId = 'turkiye-groups-container'
  else if (groupType === 'INCOME_ENTRIES') containerId = 'income-groups-container'

  const container = document.getElementById(containerId)
  if (!container) return

  const groupDiv = document.createElement('div')
  groupDiv.id = groupId
  groupDiv.setAttribute('data-group-type', groupType) // Important for logic

  // Visuals differ by type
  if (groupType === 'INCOME_ENTRIES') {
    const bgColor = initialColor || '#dcfce7' // Default green-100
    const borderColor = initialColor || '#bbf7d0' // Default green-200

    groupDiv.className = 'mb-4 border rounded-md shadow-sm overflow-hidden'
    groupDiv.style.borderColor = borderColor

    groupDiv.innerHTML = `
        <div class="px-3 py-2 border-b flex justify-between items-center group-header" style="background-color: ${bgColor}40; border-color: ${borderColor}">
          <div class="flex items-center gap-2 flex-grow">
              <button onclick="toggleGroup('${groupId}')" class="text-gray-400 hover:text-gray-600 transition transform duration-200" id="${groupId}-icon">
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
              </button>
              <input type="text" class="group-name-input bg-transparent font-semibold text-gray-700 focus:outline-none focus:border-green-500 border-b border-transparent w-full" placeholder="Gelir Grubu Adı" value="${groupName}" />
          </div>
          
          <div class="flex items-center gap-3">
            <input type="color" class="group-color-picker w-6 h-6 p-0 border-0 bg-transparent rounded cursor-pointer" value="${initialColor || '#dcfce7'}" title="Grup Rengi Seç">
            <button onclick="removeGroup('${groupId}')" class="text-gray-400 hover:text-red-500 transition">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </div>
        <div class="p-3 space-y-2 group-items-container min-h-[50px] transition-colors" id="${groupId}-items" style="background-color: ${bgColor}10">
          <!-- Items will go here -->
        </div>
        <div class="px-3 py-2 border-t text-right group-footer" style="background-color: ${bgColor}20; border-color: ${borderColor}">
           <button type="button" onclick="addExpenseItem('${groupId}')" class="text-xs font-medium text-green-600 hover:text-green-800">
             + Gelir Kalemi Ekle
           </button>
        </div>
      `

    // Color Picker Listener for Income
    const picker = groupDiv.querySelector('.group-color-picker') as HTMLInputElement
    const header = groupDiv.querySelector('.group-header') as HTMLElement
    const items = groupDiv.querySelector('.group-items-container') as HTMLElement
    const footer = groupDiv.querySelector('.group-footer') as HTMLElement

    picker?.addEventListener('input', (e) => {
      const c = (e.target as HTMLInputElement).value
      groupDiv.style.borderColor = c
      if (header) { header.style.backgroundColor = c + '40'; header.style.borderColor = c; }
      if (items) items.style.backgroundColor = c + '10'
      if (footer) { footer.style.backgroundColor = c + '20'; footer.style.borderColor = c; }
    })

  } else if (groupType === 'TURKIYE') {
    const bgColor = initialColor || '#fed7aa' // Default orange-200
    const borderColor = initialColor || '#fdba74' // Default orange-300

    groupDiv.className = 'mb-4 border rounded-md shadow-sm overflow-hidden'
    groupDiv.style.borderColor = borderColor

    groupDiv.innerHTML = `
        <div class="px-3 py-2 border-b flex justify-between items-center group-header" style="background-color: ${bgColor}40; border-color: ${borderColor}">
          <div class="flex items-center gap-2 flex-grow">
              <button onclick="toggleGroup('${groupId}')" class="text-gray-400 hover:text-gray-600 transition transform duration-200" id="${groupId}-icon">
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
              </button>
              <input type="text" class="group-name-input bg-transparent font-semibold text-gray-700 focus:outline-none focus:border-orange-500 border-b border-transparent w-full" placeholder="Türkiye Harcama Grubu" value="${groupName}" />
          </div>
          
          <div class="flex items-center gap-3">
            <input type="color" class="group-color-picker w-6 h-6 p-0 border-0 bg-transparent rounded cursor-pointer" value="${initialColor || '#fed7aa'}" title="Grup Rengi Seç">
            <span id="total-${groupId}" class="text-xs font-bold text-orange-600">0.00 ₺</span>
            <button onclick="removeGroup('${groupId}')" class="text-gray-400 hover:text-red-500 transition">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </div>
        <div class="p-3 space-y-2 group-items-container min-h-[50px] transition-colors" id="${groupId}-items" style="background-color: ${bgColor}10">
          <!-- Items will go here -->
        </div>
        <div class="px-3 py-2 border-t text-right group-footer" style="background-color: ${bgColor}20; border-color: ${borderColor}">
           <button type="button" onclick="addExpenseItem('${groupId}')" class="text-xs font-medium text-orange-600 hover:text-orange-800">
             + Kalem Ekle
           </button>
        </div>
      `

    // Color Picker Listener for Turkey
    const picker = groupDiv.querySelector('.group-color-picker') as HTMLInputElement
    const header = groupDiv.querySelector('.group-header') as HTMLElement
    const items = groupDiv.querySelector('.group-items-container') as HTMLElement
    const footer = groupDiv.querySelector('.group-footer') as HTMLElement

    picker?.addEventListener('input', (e) => {
      const c = (e.target as HTMLInputElement).value
      groupDiv.style.borderColor = c
      if (header) { header.style.backgroundColor = c + '40'; header.style.borderColor = c; }
      if (items) items.style.backgroundColor = c + '10'
      if (footer) { footer.style.backgroundColor = c + '20'; footer.style.borderColor = c; }
    })
  } else {
    // HOLLANDA (Standard)
    const bgColor = initialColor || '#f9fafb' // Default gray-50
    const borderColor = initialColor ? initialColor : '#e5e7eb' // Default gray-200
    // Use style to handle custom color
    groupDiv.className = 'mb-4 border rounded-md shadow-sm overflow-hidden'
    groupDiv.style.borderColor = borderColor

    groupDiv.innerHTML = `
        <div class="px-3 py-2 border-b flex justify-between items-center group-header" style="background-color: ${bgColor}40; border-color: ${borderColor}">
          <div class="flex items-center gap-2 flex-grow">
              <button onclick="toggleGroup('${groupId}')" class="text-gray-400 hover:text-gray-600 transition transform duration-200" id="${groupId}-icon">
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
              </button>
              <input type="text" class="group-name-input bg-transparent font-semibold text-gray-700 focus:outline-none focus:border-indigo-500 border-b border-transparent w-full" placeholder="Grup Adı (Örn: Mutfak)" value="${groupName}" />
          </div>
          
          <div class="flex items-center gap-3">
            <input type="color" class="group-color-picker w-6 h-6 p-0 border-0 bg-transparent rounded cursor-pointer" value="${initialColor || '#f9fafb'}" title="Grup Rengi Seç">
            <span id="total-${groupId}" class="text-sm font-bold text-indigo-600">0.00 EUR</span>
            <button onclick="removeGroup('${groupId}')" class="text-gray-400 hover:text-red-500 transition">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </div>
        <div class="p-3 space-y-2 group-items-container min-h-[50px] transition-colors" id="${groupId}-items" style="background-color: ${bgColor}10">
          <!-- Items will go here -->
        </div>
        <div class="px-3 py-2 border-t text-right" style="background-color: ${bgColor}20; border-color: ${borderColor}">
           <button type="button" onclick="addExpenseItem('${groupId}')" class="text-xs font-medium text-indigo-600 hover:text-indigo-800">
             + Kalem Ekle
           </button>
        </div>
      `

    // Color Picker Listener
    const picker = groupDiv.querySelector('.group-color-picker') as HTMLInputElement
    const header = groupDiv.querySelector('.group-header') as HTMLElement
    const items = groupDiv.querySelector('.group-items-container') as HTMLElement
    const footer = groupDiv.querySelector('.text-right') as HTMLElement // The last div

    picker?.addEventListener('input', (e) => {
      const c = (e.target as HTMLInputElement).value
      groupDiv.style.borderColor = c
      if (header) { header.style.backgroundColor = c + '40'; header.style.borderColor = c; }
      if (items) items.style.backgroundColor = c + '10'
      if (footer) { footer.style.backgroundColor = c + '20'; footer.style.borderColor = c; }
    })

    // Add Drop Zone Logic (With Counter for robustness)
    const itemsContainer = groupDiv.querySelector('.group-items-container') as HTMLElement
    let dragCounter = 0

    itemsContainer.addEventListener('dragenter', (e) => {
      e.preventDefault()
      dragCounter++
      itemsContainer.classList.add('bg-blue-50')
    })

    itemsContainer.addEventListener('dragover', (e) => {
      e.preventDefault() // Allow drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    })

    itemsContainer.addEventListener('dragleave', () => {
      dragCounter--
      if (dragCounter === 0) {
        itemsContainer.classList.remove('bg-blue-50')
      }
    })

    itemsContainer.addEventListener('drop', (e) => {
      e.preventDefault()
      dragCounter = 0
      itemsContainer.classList.remove('bg-blue-50')

      const itemId = e.dataTransfer?.getData('text/plain')

      if (itemId) {
        const itemEl = document.getElementById(itemId)
        // Check nature of item
        if (itemEl && itemEl.classList.contains('expense-item')) {
          // Calculate insertion point
          const afterElement = getDragAfterElement(itemsContainer, e.clientY)

          if (afterElement == null) {
            itemsContainer.appendChild(itemEl)
          } else {
            itemsContainer.insertBefore(itemEl, afterElement)
          }

          // Recalculate totals immediately
          calculateEditorTotals()
        }
      }
    })
  }
  container.appendChild(groupDiv)


  // If new group, add initial item -> REMOVED per user request
  // if (!document.getElementById(`${groupId}-items`)?.hasChildNodes()) {
  //   addExpenseItem(groupId)
  // }
}

// Helper for Drag Reordering
const getDragAfterElement = (container: HTMLElement, y: number) => {
  const draggableElements = [...container.querySelectorAll('.expense-item:not(.opacity-50)')]

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect()
    const offset = y - box.top - box.height / 2

    // We want the element where we are hovering *above* its middle (offset < 0)
    // and closest to 0
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child }
    } else {
      return closest
    }
  }, { offset: Number.NEGATIVE_INFINITY, element: null as Element | null }).element
}

const addGroup = (groupType: GroupType, name = 'Yeni Grup') => {
  const groupId = generateId()
  createGroupElement(groupId, groupType, name)
}

window.removeGroup = async (groupId: string) => {
  const result = await showConfirm('Grubu silmek istediğinize emin misiniz?', 'Grubu Sil', { discard: 'Evet, Sil', save: '' })
  if (result === 'discard') {
    const groupEl = document.getElementById(groupId)
    if (groupEl) {
      groupEl.remove()
      setDirty(true)
      calculateEditorTotals()
    }
  }
}

const addExpenseItem = (groupId: string, data?: Partial<BudgetDetail>) => {
  const itemsContainer = document.getElementById(`${groupId}-items`)
  if (!itemsContainer) return

  // Determine defaults
  // Find group type
  const groupEl = document.getElementById(groupId)
  const groupType = groupEl?.getAttribute('data-group-type') as GroupType || 'HOLLANDA'

  const defaultCurrency = groupType === 'TURKIYE' ? 'TRY' : 'EUR'
  const isIncome = groupType === 'INCOME_ENTRIES'

  const itemId = generateId()
  const row = document.createElement('div')
  // UPDATED: Responsive container
  // Mobile: Wrapped with border, spacing. Desktop: Single row, no border.
  row.className = 'expense-item'
  row.id = itemId

  const isFixed = data?.type === 'FIXED'
  const currentCurrency = data?.currency || defaultCurrency

  row.innerHTML = `
    <!-- 1. Drag Handle -->
    <div class="col-drag drag-handle" draggable="true">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
    </div>

    <!-- 2. Day Input -->
    <div class="col-day">
       <input type="number" min="1" max="31" class="expense-day input-base day-input" placeholder="Gün" value="${data?.paymentDay || ''}" title="Ödeme Günü" />
    </div>

    <!-- 3. Amount -->
    <div class="col-amount">
      <input type="number" step="0.01" class="expense-amount input-base amount-input" placeholder="Tutar" value="${data?.amount || ''}" required />
    </div>

    <!-- 4. Currency -->
    <div class="col-currency">
      <select class="expense-currency input-base" style="padding: 0.4rem 0.2rem;">
        <option value="EUR" ${currentCurrency === 'EUR' ? 'selected' : ''}>EUR</option>
        <option value="TRY" ${currentCurrency === 'TRY' ? 'selected' : ''}>TRY</option>
        <option value="USD" ${currentCurrency === 'USD' ? 'selected' : ''}>USD</option>
      </select>
    </div>

    <!-- 5. Fixed Checkbox -->
    <div class="col-fixed" title="${isIncome ? 'Sabit Gelir (Her ay otomatik eklenir)' : 'Sabit Gider (Her ay otomatik eklenir)'}">
      <input type="checkbox" class="expense-fixed" style="width: 14px; height: 14px; cursor: pointer;" ${isFixed ? 'checked' : ''} />
      <span class="text-xs text-muted font-medium">Sabit</span>
    </div>

    <!-- 5b. Conversion Display (Only for TURKIYE) -->
    <div class="expense-conversion hidden" style="font-size: 0.625rem; font-weight: 700; color: var(--color-tr); background: rgba(249,115,22,0.1); padding: 0.125rem 0.375rem; border-radius: 4px; font-variant-numeric: tabular-nums; flex-shrink: 0;"></div>

    <!-- 6. Name Input -->
    <div class="col-name">
      <input type="text" class="expense-name name-input" placeholder="${isIncome ? 'Gelir Kaynağı' : 'Harcama Adı'}" value="${data?.name || ''}" required />
    </div>

    <!-- 7. Remove Button -->
    <div class="col-remove">
      <button onclick="removeExpenseItem('${itemId}')" class="delete-btn" title="Sil">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  `
  itemsContainer.appendChild(row)

  // Attach Drag Listeners to Handle
  const handle = row.querySelector('.drag-handle') as HTMLElement
  if (handle) {
    handle.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', itemId)
      e.dataTransfer?.setDragImage(row, 10, 10) // Drag the whole row visual
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
      row.classList.add('opacity-50', 'scale-95', 'transform', 'transition')
    })

    handle.addEventListener('dragend', () => {
      row.classList.remove('opacity-50', 'scale-95', 'transform', 'transition')
    })
  }

  calculateEditorTotals()
}

const removeExpenseItem = (itemId: string) => {
  document.getElementById(itemId)?.remove()
  calculateEditorTotals()
}

window.addGroup = addGroup
window.addExpenseItem = addExpenseItem
window.removeExpenseItem = removeExpenseItem
window.toggleGroup = toggleGroup

let allCollapsed = false
const toggleAllGroups = () => {
  allCollapsed = !allCollapsed
  const btn = document.getElementById('toggle-all-btn')
  if (btn) btn.textContent = allCollapsed ? 'Tümünü Aç' : 'Tümünü Kapat'

  const allItems = document.querySelectorAll('[id$="-items"]')
  allItems.forEach(el => {
    // Skip income or main containers if query is too broad.
    // Ids are generated like `${ groupId } -items`.
    // Ensure we don't toggle containers we shouldn't.
    // But `generateId()` creates unique ids.
    if (allCollapsed) el.classList.add('hidden')
    else el.classList.remove('hidden')
  })

  // Rotate icons
  const allIcons = document.querySelectorAll('[id$="-icon"]')
  allIcons.forEach(el => {
    if (allCollapsed) el.classList.add('rotate-180')
    else el.classList.remove('rotate-180')
  })
}
window.toggleAllGroups = toggleAllGroups

const saveCurrentBudget = async () => {
  if (!budgetService) return

  const month = activeMonth
  const year = activeYear
  if (!month || !year) return

  const id = `${month} ${year}`
  const eurRate = parseFloat(eurRateInput.value) || 0
  const usdRate = parseFloat(usdRateInput.value) || 0

  const details: BudgetDetail[] = []

  // Scan DOM
  document.querySelectorAll('.expense-item').forEach(item => {
    const name = (item.querySelector('.expense-name') as HTMLInputElement).value
    const amount = parseFloat((item.querySelector('.expense-amount') as HTMLInputElement).value) || 0
    const currency = (item.querySelector('.expense-currency') as HTMLSelectElement).value as Currency
    const isFixed = (item.querySelector('.expense-fixed') as HTMLInputElement)?.checked || false
    const paymentDayInput = item.querySelector('.expense-day') as HTMLInputElement
    const paymentDay = paymentDayInput && paymentDayInput.value ? parseInt(paymentDayInput.value) : undefined

    const groupEl = item.closest('[data-group-type]')
    const groupType = groupEl?.getAttribute('data-group-type') as GroupType || 'HOLLANDA'
    const subGroupName = (groupEl?.querySelector('.group-name-input') as HTMLInputElement)?.value ||
      (groupEl?.querySelector('input[type="text"]') as HTMLInputElement)?.value || 'Genel'

    const groupColor = (groupEl?.querySelector('.group-color-picker') as HTMLInputElement)?.value

    // Derive Section
    let section: SectionType = 'EXPENSE'
    if (groupType === 'INCOME_ENTRIES') section = 'INCOME'

    details.push({
      id: item.id,
      name,
      amount,
      currency,
      type: isFixed ? 'FIXED' : 'VARIABLE',
      section,
      group: groupType,
      subGroup: subGroupName,
      paymentDay,
      color: groupColor
    })
  })

  // Calc totals again for record
  let totalIncome = 0
  let totalExpense = 0
  let totalTurkiyeTL = 0

  details.forEach(d => {
    let amountEUR = d.amount
    if (d.currency === 'TRY' && eurRate > 0) amountEUR = d.amount / eurRate
    if (d.currency === 'USD' && usdRate > 0 && eurRate > 0) amountEUR = (d.amount * usdRate) / eurRate

    if (d.section === 'INCOME') totalIncome += amountEUR
    else {
      totalExpense += amountEUR
      if (d.group === 'TURKIYE') {
        if (d.currency === 'TRY') totalTurkiyeTL += d.amount
        else if (d.currency === 'USD' && usdRate > 0) totalTurkiyeTL += (d.amount * usdRate)
      }
    }
  })

  const record: BudgetRecord = {
    id,
    monthYear: id,
    exchangeRate: eurRate,
    usdRate,
    totalTurkiyeTL,
    totalHollandaEUR: totalExpense - (totalTurkiyeTL / (eurRate || 1)), // Rough approx
    totalIncomeEUR: totalIncome,
    totalExpenseEUR: totalExpense,
    transferAmountEUR: (eurRate > 0) ? (totalTurkiyeTL / eurRate) : 0,
    grandTotalEUR: totalExpense,
    details
  }

  try {
    await budgetService.saveBudget(record)
    setDirty(false)
  } catch (error) {
    console.error('Save error:', error)
    showAlert('Kaydetme hatası', 'Hata', 'error')
  }
}

// --- NAVIGATION LOGIC ---
const updateNavState = (activeId: string) => {
  const ids = ['nav-home-btn', 'nav-budget-btn', 'nav-reports-btn', 'nav-profile-btn']
  ids.forEach(id => {
    const el = document.getElementById(id)
    if (el) {
      if (id === activeId) {
        el.classList.add('active')
        el.classList.remove('text-gray-400')
      } else {
        el.classList.remove('active')
        el.classList.add('text-gray-400')
      }
    }
  })
}

const showPage = (pageId: string) => {
  const pages = ['page-landing', 'page-editor', 'page-reports', 'login-page']
  pages.forEach(id => document.getElementById(id)?.classList.add('hidden'))
  document.getElementById(pageId)?.classList.remove('hidden')

  if (pageId === 'page-landing') updateNavState('nav-home-btn')
  else if (pageId === 'page-editor') updateNavState('nav-budget-btn')
  else if (pageId === 'page-reports') updateNavState('nav-reports-btn')
  
  // Also toggle desktop active states
  const dHome = document.getElementById('nav-home-btn-d')
  const dReports = document.getElementById('nav-reports-btn-d')
  if (pageId === 'page-reports') {
    dReports?.classList.replace('text-indigo-100', 'text-white')
    dReports?.classList.add('bg-white/10')
    dHome?.classList.replace('text-white', 'text-indigo-100')
    dHome?.classList.remove('bg-white/10')
  } else {
    dHome?.classList.replace('text-indigo-100', 'text-white')
    dHome?.classList.add('bg-white/10')
    dReports?.classList.replace('text-white', 'text-indigo-100')
    dReports?.classList.remove('bg-white/10')
  }
}

// Wire up GLOBAL buttons
const setupButtons = () => {
  // Income Privacy Toggle
  const toggleIncomeVisibility = (show: boolean) => {
    const incomeCard = document.getElementById('income-card')
    const incomeSection = document.getElementById('income-section')
    const privacyCard = document.getElementById('income-privacy-card')

    if (show) {
      incomeCard?.classList.remove('hidden')
      incomeSection?.classList.remove('hidden')
      privacyCard?.classList.add('hidden')
    } else {
      incomeCard?.classList.add('hidden')
      incomeSection?.classList.add('hidden')
      privacyCard?.classList.remove('hidden')
    }
  }

  document.getElementById('income-privacy-card')?.addEventListener('click', () => toggleIncomeVisibility(true))
  document.getElementById('hide-income-btn')?.addEventListener('click', () => toggleIncomeVisibility(false))
  document.getElementById('add-income-btn')?.addEventListener('click', () => addGroup('INCOME_ENTRIES', 'Gelirler'))
  document.getElementById('add-group-hollanda-btn')?.addEventListener('click', () => addGroup('HOLLANDA'))
  document.getElementById('add-turkey-group-btn')?.addEventListener('click', () => addGroup('TURKIYE', 'Yeni Kategori'))
  document.getElementById('add-turkey-item-btn')?.addEventListener('click', () => {
    let turkeyContainer = document.getElementById('turkiye-groups-container')
    let defaultGroup = turkeyContainer?.querySelector('[data-group-type="TURKIYE"]')
    if (!defaultGroup) {
      const groupId = generateId()
      createGroupElement(groupId, 'TURKIYE', 'Genel')
      defaultGroup = document.getElementById(groupId)
    }
    if (defaultGroup) addExpenseItem(defaultGroup.id)
  })

  document.getElementById('toggle-all-btn')?.addEventListener('click', toggleAllGroups)
  document.getElementById('save-budget-btn')?.addEventListener('click', saveCurrentBudget)

  const goHomeLogic = async () => {
    if (isDirty) {
      const result = await showConfirm('Kaydedilmemiş değişiklikler var. Ne yapmak istersiniz?', 'Ana Sayfaya Dön')
      if (result === 'cancel') return
      if (result === 'save') await saveCurrentBudget()
    }
    activeMonth = ''; activeYear = ''
    document.getElementById('active-budget-display')?.classList.add('hidden')
    showPage('page-landing')
    setDirty(false)
    renderWelcomeBudgetList(allBudgetSummary)
  }

  document.getElementById('close-budget-btn')?.addEventListener('click', goHomeLogic)
  document.getElementById('nav-home-btn')?.addEventListener('click', goHomeLogic)
  document.getElementById('nav-home-btn-d')?.addEventListener('click', goHomeLogic)
  document.getElementById('app-logo-btn')?.addEventListener('click', goHomeLogic)

  document.getElementById('nav-budget-btn')?.addEventListener('click', () => {
    if (activeMonth && activeYear) {
      showPage('page-editor')
    } else {
      const last = getLastBudget()
      if (last) {
        handleBudgetSelect(last.id.split(' ')[0], last.id.split(' ')[1])
      } else {
        document.getElementById('new-budget-modal')?.classList.add('show')
      }
    }
  })

  const goReportsLogic = async () => {
    if (isDirty) {
      const result = await showConfirm('Kaydedilmemiş değişiklikler var. Ne yapmak istersiniz?', 'Raporlara Git')
      if (result === 'cancel') return
      if (result === 'save') await saveCurrentBudget()
    }
    activeMonth = ''; activeYear = ''
    document.getElementById('active-budget-display')?.classList.add('hidden')
    showPage('page-reports')
    renderReports(allBudgetSummary)
  }

  document.getElementById('nav-reports-btn')?.addEventListener('click', goReportsLogic)
  document.getElementById('nav-reports-btn-d')?.addEventListener('click', goReportsLogic)

  document.getElementById('delete-budget-btn')?.addEventListener('click', async () => {
    if (!budgetService || !activeMonth || !activeYear) return
    const budgetId = `${activeMonth} ${activeYear}`
    if (await showConfirm(`"${budgetId}" ayını silmek istediğinize emin misiniz?`, 'Ayı Sil', { discard: 'Evet, Sil', save: '' }) !== 'discard') return
    if (await showConfirm(`DİKKAT: Bu işlem geri alınamaz! "${budgetId}" bütçesini kalıcı olarak silmek istediğinize emin misiniz?`, 'Kalıcı Olarak Sil', { discard: 'Kalıcı Olarak Sil', save: '' }) !== 'discard') return

    try {
      await budgetService.deleteBudget(budgetId)
      showPage('page-landing')
      document.getElementById('active-budget-display')?.classList.add('hidden')
      activeMonth = ''; activeYear = ''
      setDirty(false)
      showToast('Ay Silindi!', 'success')
    } catch (e) {
      console.error(e)
      showAlert('Silme hatası!', 'Hata', 'error')
    }
  })

  // Auth / Profile bindings
  document.getElementById('nav-profile-btn')?.addEventListener('click', () => {
      document.getElementById('user-menu-modal')?.classList.add('show')
  })
  document.getElementById('user-menu-btn')?.addEventListener('click', () => {
      document.getElementById('user-menu-modal')?.classList.add('show')
  })
  document.getElementById('close-user-menu')?.addEventListener('click', () => {
      document.getElementById('user-menu-modal')?.classList.remove('show')
  })
  
  // Active Budget Select Listener
  document.getElementById('active-budget-select')?.addEventListener('change', async (e) => {
    const val = (e.target as HTMLSelectElement).value
    if (val) {
      const [m, y] = val.split(' ')
      handleBudgetSelect(m, y)
    } else {
      if (isDirty) {
        const result = await showConfirm('Kaydedilmemiş değişiklikler var. Ne yapmak istersiniz?', 'Değişiklikleri Kaydet?')
        if (result === 'cancel') {
          (e.target as HTMLSelectElement).value = `${activeMonth} ${activeYear}`
          return
        }
        if (result === 'save') await saveCurrentBudget()
      }
      activeMonth = ''
      activeYear = ''
      document.getElementById('budget-ui-container')?.classList.add('hidden')
      document.getElementById('active-budget-display')?.classList.add('hidden')
      document.getElementById('empty-state-message')?.classList.remove('hidden')
      renderWelcomeBudgetList(allBudgetSummary)
    }
  })

  // Attach Dirty Listeners globally to container
  document.getElementById('budget-ui-container')?.addEventListener('input', (e) => {
    if ((e.target as HTMLElement).matches('input, select')) {
      setDirty(true)
    }
  })

  // Migrate Data - Trigger File Picker
  document.getElementById('migrate-data-btn')?.addEventListener('click', () => {
    if (!(budgetService instanceof FirestoreBudgetService) || !budgetService.getUserId()) {
      return showError('Sadece bulut (giriş yapılmış) modunda veri aktarımı yapılabilir.')
    }
    document.getElementById('migrate-file-input')?.click()
  })

  // Migrate Data - Handle File Upload
  document.getElementById('migrate-file-input')?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return

    const btn = document.getElementById('migrate-data-btn') as HTMLButtonElement
    const origText = btn.innerHTML
    if (btn) btn.innerHTML = 'Okunuyor <span class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;vertical-align:middle;margin-left:8px;border-top-color:var(--color-primary)"></span>'
    
    const reader = new FileReader()
    reader.onload = async (event) => {
      try {
        if (btn) btn.innerHTML = 'Aktarılıyor <span class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;vertical-align:middle;margin-left:8px;border-top-color:var(--color-primary)"></span>'
        const content = event.target?.result as string
        const data: BudgetRecord[] = JSON.parse(content)
        
        if (data && Array.isArray(data) && data.length > 0) {
          let loaded = 0
          for (const rec of data) {
            const migrated = rec.totalTurkiyeTL !== undefined ? rec : migrateLegacyData(rec)
            await budgetService.saveBudget(migrated)
            loaded++
          }
          if (btn) btn.innerHTML = 'Aktarıldı ✓'
          showToast(`${loaded} aylık eski veri veritabanınıza kopyalandı! Sayfa yenileniyor...`, 'success')
          
          setTimeout(() => {
            document.getElementById('user-menu-modal')?.classList.remove('show')
            window.location.reload()
          }, 2000)
        } else {
          showError('Seçilen dosya geçerli bir bütçe verisi içermiyor.')
          if (btn) btn.innerHTML = origText
        }
      } catch(err) {
        showError('Hata: Dosya işlenemedi. ' + (err as Error).message)
        if (btn) btn.innerHTML = origText
      }
      
      // Reset input so they can pick the same file again if it failed
      (e.target as HTMLInputElement).value = ''
    }
    reader.readAsText(file)
  })

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    if (budgetService instanceof FirestoreBudgetService) {
      try {
        await budgetService.logout()
        window.location.reload()
      } catch (e) {
        showError('Çıkış yapılamadı.')
      }
    }
  })
}

// Call setupButtons at init
// setTimeout(setupButtons, 1000) // Hacky wait for DOM? No, main.ts is module, runs after parse. DOM should be ready?
// Safer to call in initializeAppService




// --- FORM DATA LOADING ---
const renderGroupsAndItems = (details: BudgetDetail[]) => {
  // Clear existing
  const incomeContainer = document.getElementById('income-groups-container')
  const hollandaContainer = document.getElementById('expense-groups-container')
  const turkiyeContainer = document.getElementById('turkiye-groups-container')

  if (incomeContainer) incomeContainer.innerHTML = ''
  if (hollandaContainer) hollandaContainer.innerHTML = ''
  if (turkiyeContainer) turkiyeContainer.innerHTML = ''

  // 1. Identify all unique groups (GroupType + SubGroup)
  const groupsToCreate = new Map<string, { type: GroupType, name: string, items: BudgetDetail[], color?: string }>()

  // Helper to get key
  const getKey = (type: GroupType, name: string) => `${type}::${name} `

  // Ensure default groups exist if empty
  if (details.length === 0) {
    groupsToCreate.set(getKey('HOLLANDA', 'Genel'), { type: 'HOLLANDA', name: 'Genel', items: [] })
    groupsToCreate.set(getKey('TURKIYE', 'Genel'), { type: 'TURKIYE', name: 'Genel', items: [] })
    groupsToCreate.set(getKey('INCOME_ENTRIES', 'Gelirler'), { type: 'INCOME_ENTRIES', name: 'Gelirler', items: [] })
  } else {
    details.forEach(item => {
      // Data Migration check on fly: if item.section undefined, assume EXPENSE
      if (!item.section) item.section = 'EXPENSE'

      const subGroup = item.subGroup || 'Genel'
      let gType = item.group

      // If no group type but section is INCOME, force correct group type
      if (item.section === 'INCOME') gType = 'INCOME_ENTRIES'

      const key = getKey(gType, subGroup)
      if (!groupsToCreate.has(key)) {
        groupsToCreate.set(key, { type: gType, name: subGroup, items: [], color: item.color })
      }
      groupsToCreate.get(key)?.items.push(item)
    })
  }

  // 2. Render Groups and Items
  groupsToCreate.forEach((groupData) => {
    const groupId = generateId()
    // Get color from first item?
    const color = groupData.color || ''

    createGroupElement(groupId, groupData.type, groupData.name, color)

    // Add items (clear initial default item first if any)
    const itemsContainer = document.getElementById(`${groupId}-items`)
    if (itemsContainer) itemsContainer.innerHTML = ''

    groupData.items.forEach(item => {
      addExpenseItem(groupId, item)
    })

    // If empty group (but created above), leave it (or add default item?)
    // createGroupElement adds default item if empty. We cleared it.
    // So if no items, add one empty.
    if (groupData.items.length === 0) {
      addExpenseItem(groupId)
    }
  })

  calculateEditorTotals()
}

const initNewBudget = (_month: string, _year: string) => {
  // Clear current form
  document.getElementById('income-groups-container')!.innerHTML = ''
  document.getElementById('expense-groups-container')!.innerHTML = ''
  document.getElementById('turkiye-groups-container')!.innerHTML = ''
    ; (document.getElementById('eur-rate') as HTMLInputElement).value = ''

  // 1. Always create the Standard Groups first
  createDefaultGroups()

  // 2. Auto-fill FIXED inputs only from *last available budget*
  const lastBudget = getLastBudget()

  if (lastBudget && lastBudget.details.length > 0) {
    const fixedItems = lastBudget.details.filter(d => d.type === 'FIXED')

    if (fixedItems.length > 0) {
      // Merge Fixed Items into existing groups or create new ones
      fixedItems.forEach(item => {
        const subGroup = item.subGroup || 'Genel'
        let gType = item.group
        if (item.section === 'INCOME') gType = 'INCOME_ENTRIES'

        // Find existing group element by name to reuse it
        let targetGroupId: string | null = null

        // Helper to search ID
        const containerId = gType === 'INCOME_ENTRIES' ? 'income-groups-container' : (gType === 'TURKIYE' ? 'turkiye-groups-container' : 'expense-groups-container')
        const container = document.getElementById(containerId)
        if (container) {
          // Different group types use different input selectors
          // HOLLANDA uses .group-name-input, TURKIYE and INCOME_ENTRIES use plain text inputs
          const inputSelector = gType === 'HOLLANDA' ? '.group-name-input' : 'input[type="text"]'
          const inputs = container.querySelectorAll(inputSelector)
          for (let i = 0; i < inputs.length; i++) {
            if ((inputs[i] as HTMLInputElement).value === subGroup) {
              // Found match! Get the group element using data-group-type
              const groupEl = inputs[i].closest('[data-group-type]')
              if (groupEl) targetGroupId = groupEl.id // Use id instead of data-group-id
              break;
            }
          }
        }

        // If not found, create it
        if (!targetGroupId) {
          targetGroupId = generateId()
          createGroupElement(targetGroupId, gType, subGroup, item.color)
        }

        // Add the fixed item
        addExpenseItem(targetGroupId, item)
      })
    }
  }

  calculateEditorTotals()
  setDirty(false) // Clean start
}

const createDefaultGroups = () => {
  // HOLLANDA Standard Categories
  const nlGroups = [
    'Ev & Kira',
    'Market & Mutfak',
    'Faturalar',
    'Ulaşım & Yakıt',
    'Sağlık & Sigorta',
    'Çocuk & Eğitim',
    'Giyim & Kişisel',
    'Eğlence & Dışarıda Yeme'
  ]
  nlGroups.forEach(g => addGroup('HOLLANDA', g))

  // TURKIYE Standard Categories
  const trGroups = ['Genel Harcamalar', 'Vergi & Devlet', 'Aile Yardımı']
  trGroups.forEach(g => addGroup('TURKIYE', g))

  // INCOME Standard Categories
  const incGroups = ['Maaş (Mesut)', 'Maaş (Eş)', 'Ek Gelir', 'Geri Ödemeler']
  incGroups.forEach(g => addGroup('INCOME_ENTRIES', g))
}
const loadFormData = (specificMonth?: string, specificYear?: string) => {
  const m = specificMonth || activeMonth
  const y = specificYear || activeYear

  if (!m || !y) return // logic error

  const monthKey = `${m} ${y}`
  const existingData = allBudgetSummary.find((b) => b.id === monthKey)

  // UI Updates
  // UI Updates
  const selectEl = document.getElementById('active-budget-select') as HTMLSelectElement
  if (selectEl) {
    // Populate options
    selectEl.innerHTML = '' // Clear
    if (allBudgetSummary.length > 0) {
      // Sort: Newest first
      const sorted = [...allBudgetSummary].sort((a, b) => {
        const [ma, ya] = a.id.split(' ')
        const [mb, yb] = b.id.split(' ')
        if (ya !== yb) return parseInt(yb) - parseInt(ya)
        return months.indexOf(mb) - months.indexOf(ma)
      })

      sorted.forEach(b => {
        const op = document.createElement('option')
        op.value = b.id
        op.textContent = b.id
        op.className = "text-gray-800"
        selectEl.appendChild(op)
      })
    }
    // Set active
    selectEl.value = monthKey
  }

  // Show Form & Top Nav Budget Display
  showPage('page-editor')
  document.getElementById('active-budget-display')?.classList.remove('hidden')
  document.getElementById('editor-period-title')!.textContent = monthKey
  
  // Set explicit conversion display in header
  if (existingData) {
    document.getElementById('editor-eur-rate')!.textContent = formatCurrency(existingData.exchangeRate, 'TRY')
    document.getElementById('editor-usd-rate')!.textContent = formatCurrency(existingData.usdRate, 'TRY')
  }

  // Clear containers
  const containers = ['income-groups-container', 'expense-groups-container', 'turkiye-groups-container']
  containers.forEach(id => {
    const el = document.getElementById(id)
    if (el) el.innerHTML = ''
  })

  if (existingData) {
    // Load Existing
    eurRateInput.value = existingData.exchangeRate?.toString() || ''
    usdRateInput.value = existingData.usdRate?.toString() || ''
    renderGroupsAndItems(existingData.details)
    setDirty(false)
  } else {
    // Init New
    initNewBudget(m, y)
  }
}

// --- D3 CHART ---
// const getTooltip = () => { ... } // Removed unused helper

// --- NEW REPORTS CHART FUNCTIONS ---

const renderReports = (budgets: BudgetRecord[]) => {
  if (budgets.length === 0) return

  // 1. Avg Stats
  const avgIncome = d3.mean(budgets, b => b.totalIncomeEUR) || 0
  const avgExpense = d3.mean(budgets, b => b.totalExpenseEUR) || 0

  const setText = (id: string, val: string) => { const el = document.getElementById(id); if (el) el.textContent = val; }
  setText('report-avg-income', formatCurrency(avgIncome, 'EUR'))
  setText('report-avg-expense', formatCurrency(avgExpense, 'EUR'))

  // 2. Trend Chart (Reusable)
  const container = document.getElementById('reports-trend-chart')
  if (container) {
    container.innerHTML = '<svg id="reports-trend-svg" width="100%" height="100%"></svg>'
    renderTrendChartInternal(budgets, '#reports-trend-svg')
  }

  // 3. Category Breakdown (Donut)
  renderCategoryBreakdown(budgets)

  // 4. Savings Rate (Gauge)
  const lastBudget = [...budgets].sort((a, b) => b.id.localeCompare(a.id))[0]
  renderSavingsGauge(lastBudget)

  // 5. Fixed vs Variable (Bars)
  renderFixedVariableReport(lastBudget)

  // 6. Avg Budget Breakdown
  renderAverageBudgetTable(budgets)
}

const renderTrendChartInternal = (data: BudgetRecord[], targetSelector: string) => {
  const container = document.querySelector(targetSelector)?.parentElement
  if (!container) return

  const sortedData = [...data].sort((a, b) => {
    const [ma, ya] = a.id.split(' ')
    const [mb, yb] = b.id.split(' ')
    if (ya !== yb) return parseInt(ya) - parseInt(yb)
    return months.indexOf(ma) - months.indexOf(mb)
  })

  // Prepare data
  type ChartData = { month: string, income: number, hollandaExpense: number, turkeyExpense: number, totalExpense: number, balance: number }
  const chartData: ChartData[] = sortedData.map(item => {
    const turkeyEUR = item.exchangeRate > 0 ? item.totalTurkiyeTL / item.exchangeRate : 0
    const hollandaEUR = item.totalExpenseEUR - turkeyEUR
    return {
      month: item.monthYear,
      income: item.totalIncomeEUR,
      hollandaExpense: hollandaEUR,
      turkeyExpense: turkeyEUR,
      totalExpense: item.totalExpenseEUR,
      balance: item.totalIncomeEUR - item.totalExpenseEUR
    }
  })

  const svg = d3.select<SVGSVGElement, unknown>(targetSelector)
  svg.selectAll('*').remove()

  const margin = { top: 20, right: 30, bottom: 40, left: 70 }
  const fullWidth = container.clientWidth || 600
  const fullHeight = container.clientHeight || 320
  const width = fullWidth - margin.left - margin.right
  const height = fullHeight - margin.top - margin.bottom

  svg.attr('width', fullWidth).attr('height', fullHeight)
  const g = svg.append('g').attr('transform', `translate(${margin.left}, ${margin.top})`)

  const x = d3.scalePoint<string>().range([0, width]).domain(chartData.map(d => d.month)).padding(0.5)
  const maxY = d3.max(chartData.flatMap(d => [d.income, d.totalExpense])) || 5000
  const y = d3.scaleLinear().range([height, 0]).domain([0, Math.max(maxY * 1.1, 5000)])

  const yAxisTicks: number[] = []
  for (let i = 0; i <= (y.domain()[1] + 1000); i += 1000) { yAxisTicks.push(i) }

  g.append('g').attr('transform', `translate(0, ${height})`).call(d3.axisBottom(x))
  g.append('g').call(d3.axisLeft(y).tickValues(yAxisTicks).tickFormat(d => formatCurrency(d as number, 'EUR')))

  // Grid
  g.append('g').attr('class', 'grid').call(d3.axisLeft(y).tickValues(yAxisTicks).tickSize(-width).tickFormat(() => ''))
    .selectAll('line').style('stroke', '#e5e7eb').style('stroke-dasharray', '2,2')

  const line = (key: keyof ChartData) => d3.line<ChartData>().x(d => x(d.month) ?? 0).y(d => y(d[key] as number)).curve(d3.curveMonotoneX)

  const series = [
    { key: 'income' as const, color: '#22c55e', label: 'Gelir' },
    { key: 'hollandaExpense' as const, color: '#eab308', label: 'Hollanda Gider' },
    { key: 'turkeyExpense' as const, color: '#f97316', label: 'Türkiye Gider' },
    { key: 'totalExpense' as const, color: '#ef4444', label: 'Toplam Gider' },
    { key: 'balance' as const, color: '#6366f1', label: 'Kalan' }
  ]

  series.forEach(s => {
    g.append('path').datum(chartData).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 3).attr('d', line(s.key))
    g.selectAll(`.dot-${s.key}`).data(chartData).enter().append('circle')
      .attr('cx', d => x(d.month) ?? 0).attr('cy', d => y(d[s.key] as number)).attr('r', 4).attr('fill', s.color)
  })
}

const renderCategoryBreakdown = (budgets: BudgetRecord[]) => {
  const lastBudget = [...budgets].sort((a, b) => b.id.localeCompare(a.id))[0]
  if (!lastBudget) return

  const container = document.getElementById('reports-category-chart')
  if (!container) return
  container.innerHTML = ''

  // Aggregate by subGroup (Category)
  const catMap = new Map<string, number>()
  lastBudget.details.filter(d => d.section === 'EXPENSE').forEach(d => {
    const eur = d.currency === 'TRY' && lastBudget.exchangeRate > 0 ? d.amount / lastBudget.exchangeRate : d.amount
    catMap.set(d.subGroup, (catMap.get(d.subGroup) || 0) + eur)
  })

  const data = Array.from(catMap.entries()).map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value).slice(0, 8) // Top 8

  const width = container.clientWidth
  const height = container.clientHeight
  const radius = Math.min(width, height) / 2

  const svg = d3.select(container).append('svg').attr('width', width).attr('height', height)
    .append('g').attr('transform', `translate(${width / 2}, ${height / 2})`)

  const color = d3.scaleOrdinal(d3.schemeTableau10)
  const pie = d3.pie<{ name: string, value: number }>().value(d => d.value)
  const arc = d3.arc<d3.PieArcDatum<{ name: string, value: number }>>().innerRadius(radius * 0.6).outerRadius(radius)

  svg.selectAll('path').data(pie(data)).enter().append('path').attr('d', arc).attr('fill', (_, i) => color(i.toString()))
    .attr('stroke', 'white').style('stroke-width', '2px')

  // UI Legend
  const legend = document.getElementById('category-legend')
  if (legend) {
    legend.innerHTML = data.map((d, i) => `
      <div class="flex flex-col p-2 rounded-lg bg-gray-50/50 border border-gray-100/50">
        <div class="flex items-center gap-2 mb-1">
          <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${color(i.toString())}"></span>
          <span class="text-[10px] font-bold text-gray-700 truncate">${d.name}</span>
        </div>
        <div class="flex justify-between items-baseline">
           <span class="text-xs font-mono font-black text-indigo-700">${formatCurrency(d.value, 'EUR')}</span>
           <span class="text-[9px] text-gray-400 font-bold">%${Math.round((d.value / d3.sum(data, d => d.value)) * 100)}</span>
        </div>
      </div>
    `).join('')
  }
}

const renderSavingsGauge = (budget: BudgetRecord) => {
  if (!budget) return
  const income = budget.totalIncomeEUR
  const expense = budget.totalExpenseEUR
  const rate = income > 0 ? Math.max(0, (income - expense) / income) : 0
  const pct = Math.round(rate * 100)

  const pctEl = document.getElementById('savings-rate-pct')
  if (pctEl) pctEl.textContent = `${pct}%`

  const feedback = document.getElementById('savings-feedback')
  if (feedback) {
    if (pct > 30) feedback.textContent = "🚀 Harika! Gelirinizin %30'undan fazlasını tasarruf ediyorsunuz. Finansal özgürlüğe yakınsınız."
    else if (pct > 15) feedback.textContent = "👏 İyi gidiyorsunuz. Standart tasarruf oranlarının üzerindesiniz. Hedefiniz %20 olsun."
    else if (pct > 0) feedback.textContent = "👍 Tasarruf yapabiliyorsunuz, bu önemli bir adım. Giderleri biraz daha optimize edebiliriz."
    else feedback.textContent = "🚨 Dikkat: Harcamalarınız gelirinizi aşmış durumda. Bütçeyi gözden geçirme vaktı!"
  }
}

const renderFixedVariableReport = (budget: BudgetRecord) => {
  if (!budget) return
  let fixed = 0; let variable = 0
  budget.details.filter(d => d.section === 'EXPENSE').forEach(d => {
    const eur = d.currency === 'TRY' && budget.exchangeRate > 0 ? d.amount / budget.exchangeRate : d.amount
    if (d.type === 'FIXED') fixed += eur; else variable += eur
  })

  const total = fixed + variable
  const fixedPct = total > 0 ? (fixed / total) * 100 : 0
  const varPct = total > 0 ? (variable / total) * 100 : 0

  const setText = (id: string, val: string) => { const el = document.getElementById(id); if (el) el.textContent = val; }
  setText('fixed-expense-val', formatCurrency(fixed, 'EUR'))
  setText('variable-expense-val', formatCurrency(variable, 'EUR'))

  const fixedBar = document.getElementById('fixed-expense-bar'); if (fixedBar) fixedBar.style.width = `${fixedPct}%`
  const varBar = document.getElementById('variable-expense-bar'); if (varBar) varBar.style.width = `${varPct}%`
}

const renderAverageBudgetTable = (budgets: BudgetRecord[]) => {
  const container = document.getElementById('average-budget-breakdown')
  if (!container) return

  // Average by category across all months
  const catSum = new Map<string, number>()
  budgets.forEach(b => {
    b.details.filter(d => d.section === 'EXPENSE').forEach(d => {
      const eur = d.currency === 'TRY' && b.exchangeRate > 0 ? d.amount / b.exchangeRate : d.amount
      catSum.set(d.subGroup, (catSum.get(d.subGroup) || 0) + (eur / budgets.length))
    })
  })

  const sorted = Array.from(catSum.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)

  container.innerHTML = sorted.map(([name, avg]) => `
    <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
           <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <div>
          <p class="text-sm font-bold text-gray-800">${name}</p>
          <p class="text-[10px] text-gray-400 font-medium">AYLIK ORTALAMA</p>
        </div>
      </div>
      <span class="font-mono font-bold text-gray-700">${formatCurrency(avg, 'EUR')}</span>
    </div>
  `).join('')
}

const renderWelcomeBudgetList = (budgets: BudgetRecord[]) => {
  const container = document.getElementById('welcome-budget-list')
  const countSpan = document.getElementById('budget-count')
  
  if (countSpan) countSpan.textContent = `${budgets.length} adet`
  if (!container) return
  container.innerHTML = ''

  if (budgets.length === 0) {
    container.innerHTML = `
      <div class="text-center p-8 bg-white border border-dashed border-gray-300 rounded-xl mt-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
        <p class="text-gray-500 font-medium">Henüz kayıtlı bütçeniz yok.</p>
        <p class="text-xs text-gray-400 mt-1">Yeni Ay oluşturarak başlayın.</p>
      </div>
    `
    // Zero out hero
    const setText = (id: string, val: string) => { const el = document.getElementById(id); if (el) el.textContent = val; }
    setText('landing-income', '—')
    setText('landing-expense', '—')
    setText('landing-balance', '—')
    setText('landing-rate', '—')
    return
  }

  const sorted = [...budgets].sort((a, b) => {
    const [ma, ya] = a.id.split(' ')
    const [mb, yb] = b.id.split(' ')
    if (ya !== yb) return parseInt(yb) - parseInt(ya)
    return months.indexOf(mb) - months.indexOf(ma)
  })

  // Update Hero Stats with latest budget
  const setText = (id: string, val: string) => { const el = document.getElementById(id); if (el) el.textContent = val; }
  setText('landing-income', formatCurrency(sorted[0].totalIncomeEUR, 'EUR'))
  setText('landing-expense', formatCurrency(sorted[0].totalExpenseEUR, 'EUR'))
  const bal = sorted[0].totalIncomeEUR - sorted[0].totalExpenseEUR;
  setText('landing-balance', formatCurrency(bal, 'EUR'))
  setText('landing-rate', sorted[0].exchangeRate > 0 ? formatCurrency(sorted[0].exchangeRate, 'TRY') : '—')

  sorted.forEach(budget => {
    const div = document.createElement('div')
    div.className = 'budget-card shadow-sm hover:shadow-md transition-all'
    
    const [m, y] = budget.id.split(' ')
    const balance = budget.totalIncomeEUR - budget.totalExpenseEUR

    div.innerHTML = `
      <div class="info">
        <h3 class="text-gray-800 font-bold">${m} ${y}</h3>
        <p class="text-sm text-gray-500">Gider: ${formatCurrency(budget.totalExpenseEUR, 'EUR')} ${budget.totalTurkiyeTL > 0 ? `(TR: ${formatCurrency(budget.totalTurkiyeTL, 'TRY')})` : ''}</p>
      </div>
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <div class="amount ${balance < 0 ? 'text-red-500' : 'text-green-600'} font-bold">
          ${formatCurrency(balance, 'EUR')}
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-400"><path d="M9 18l6-6-6-6"/></svg>
      </div>
    `
    div.addEventListener('click', () => {
      handleBudgetSelect(m, y)
    })

    container.appendChild(div)
  })
}

// Global handler for switching logic
const handleBudgetSelect = async (m: string, y: string) => {
  if (activeMonth === m && activeYear === y) return

  const sel = document.getElementById('active-budget-select') as HTMLSelectElement

  if (isDirty) {
    const result = await showConfirm('Kaydedilmemiş değişiklikler var. Ne yapmak istersiniz?', 'Değişiklikleri Kaydet?')
    if (result === 'cancel') {
      // Revert select UI to current active month
      if (sel) sel.value = `${activeMonth} ${activeYear}`
      return
    }
    if (result === 'save') await saveCurrentBudget()
  }

  activeMonth = m
  activeYear = y
  loadFormData(m, y)
}




window.deleteBudget = async (monthKey: string) => {
  if (!budgetService) return
  if (await showConfirm(`${monthKey} bütçesini silmek istediğinizden emin misiniz?`, 'Bütçeyi Sil', { discard: 'Evet, Sil', save: '' }) !== 'discard') {
    return
  }

  try {
    await budgetService.deleteBudget(monthKey)
    if (activeMonth + ' ' + activeYear === monthKey) {
      document.getElementById('budget-ui-container')?.classList.add('hidden')
      activeMonth = ''
      activeYear = ''
    }
    showToast('Bütçe silindi', 'success')
  } catch (error) {
    console.error('Bütçe silme hatası:', error)
    showAlert(`Bütçe silinemedi: ${(error as Error).message}`, 'Hata', 'error')
  }
}

// --- BOOTSTRAP ---
const initializeAppService = async () => {
  try {
    const hasFirebaseConfig = Object.keys(firebaseConfig).length > 2 // Check if we have more than a dummy/empty object

    if (hasFirebaseConfig && !firebaseConfig.apiKey.includes('YOUR_API_KEY')) {
      console.log('Firebase Config Found. Initializing Cloud Mode...')
      budgetService = new FirestoreBudgetService(firebaseConfig, appId, initialAuthToken)
    } else {
      console.log('Firebase Config Missing or Dummy. Initializing Local File Mode...')
      budgetService = new FileBudgetService()
    }

    await budgetService.init()

    loadingOverlay.classList.add('hidden')
    
    // Auth Flow Logic
    const isCloudMode = budgetService instanceof FirestoreBudgetService
    
    if (isCloudMode && !budgetService.getUserId()) {
      // Need to login
      document.getElementById('login-page')?.classList.remove('hidden')
      document.getElementById('app-container')?.classList.add('hidden')

      // Pre-fill test credentials if available
      const testEmail = import.meta.env.VITE_TEST_USER_EMAIL as string | undefined
      const testPass = import.meta.env.VITE_TEST_USER_PASSWORD as string | undefined
      if (testEmail) (document.getElementById('login-email') as HTMLInputElement).value = testEmail
      if (testPass) (document.getElementById('login-password') as HTMLInputElement).value = testPass

      const loginForm = document.getElementById('login-form') as HTMLFormElement
      loginForm?.addEventListener('submit', async (e) => {
        e.preventDefault()
        const btn = document.getElementById('login-btn') as HTMLButtonElement
        const email = (document.getElementById('login-email') as HTMLInputElement).value
        const pass = (document.getElementById('login-password') as HTMLInputElement).value
        const err = document.getElementById('login-error')

        try {
          if (btn) btn.textContent = 'Giriş Yapılıyor...'
          if (err) err.textContent = ''
          
          await (budgetService as FirestoreBudgetService).login(email, pass)
          
          // Logged in successfully
          document.getElementById('login-page')?.classList.add('hidden')
          document.getElementById('app-container')?.classList.remove('hidden')
          userIdDisplay.textContent = budgetService!.getUserId() || 'Misafir'
          document.getElementById('profile-user-id')!.textContent = budgetService!.getUserId() || 'Bilinmiyor'
          
          finishAppInit()
        } catch (error: any) {
          if (btn) btn.textContent = 'Giriş Yap'
          if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
             // Create it!
             try {
                if (err) err.textContent = 'Hesap bulunamadı, oluşturuluyor...'
                await (budgetService as FirestoreBudgetService).register(email, pass)
                // Created successfully
                document.getElementById('login-page')?.classList.add('hidden')
                document.getElementById('app-container')?.classList.remove('hidden')
                userIdDisplay.textContent = budgetService!.getUserId() || 'Misafir'
                document.getElementById('profile-user-id')!.textContent = budgetService!.getUserId() || 'Bilinmiyor'
                finishAppInit()
             } catch (regError: any) {
                if (btn) btn.textContent = 'Giriş Yap'
                if (err) err.textContent = 'Hata: ' + regError.message
             }
          } else {
             if (err) err.textContent = 'Hata: ' + error.message
          }
        }
      })
    } else {
      // Local mode or already authenticated
      document.getElementById('app-container')?.classList.remove('hidden')
      userIdDisplay.textContent = budgetService.getUserId() || 'Misafir'
      document.getElementById('profile-user-id')!.textContent = budgetService.getUserId() || 'Bilinmiyor'
      finishAppInit()
    }

    function finishAppInit() {
      if (!budgetService) return
      budgetService.subscribe(onBudgetsUpdated)
      showPage('page-landing')
      
      // AUTO-MIGRATE ON LOGIN (Request: "sen yukle")
      silentCloudMigration()
    }

    async function silentCloudMigration() {
      if (!(budgetService instanceof FirestoreBudgetService)) return
      if (localStorage.getItem('db_json_migrated_final')) return
      
      try {
        console.log('SESSİZ AKTARIM: Yerel db.json kontrol ediliyor...')
        const res = await fetch('/api/db')
        if (!res.ok) return
        
        const data: BudgetRecord[] = await res.json()
        if (data && Array.isArray(data) && data.length > 0) {
          console.log(`SESSİZ AKTARIM: ${data.length} aylık veri buluta kopyalanıyor...`)
          showToast('Eski verileriniz arka planda buluta aktarılıyor...', 'info')
          
          for (const rec of data) {
            const migrated = rec.totalTurkiyeTL !== undefined ? rec : migrateLegacyData(rec)
            await budgetService.saveBudget(migrated)
          }
          
          localStorage.setItem('db_json_migrated_final', 'true')
          showToast('Eski verileriniz başarıyla aktarıldı!', 'success')
          // Refresh lists
          // budgetService will notify subscribers via snapshot-listener
        }
      } catch (err) {
        console.warn('Sessiz aktarım başaramadı (Sunucu veya dosya hatası):', err)
      }
    }

    // --- NEW BUDGET MODAL LOGIC ---
    const modal = document.getElementById('new-budget-modal')
    const createBtn = document.getElementById('create-new-budget-btn')
    const cancelBtn = document.getElementById('cancel-modal-btn')
    const confirmBtn = document.getElementById('confirm-new-budget-btn')
    const mSelect = document.getElementById('modal-month-select') as HTMLSelectElement
    const ySelect = document.getElementById('modal-year-select') as HTMLSelectElement
    const modalRateInput = document.getElementById('modal-exchange-rate') as HTMLInputElement
    const fetchRateBtn = document.getElementById('fetch-rate-btn')
    const fetchRateBtnText = document.getElementById('fetch-rate-btn-text')
    const rateSourceInfo = document.getElementById('rate-source-info')
    const rateDateSpan = document.getElementById('rate-date')

    if (mSelect && ySelect) {
      // Populate Modal Options
      months.forEach(m => {
        const op = document.createElement('option'); op.value = m; op.textContent = m;
        mSelect.appendChild(op)
      })
      const currentY = new Date().getFullYear()
      for (let y = currentY - 1; y <= currentY + 2; y++) {
        const op = document.createElement('option'); op.value = y.toString(); op.textContent = y.toString();
        ySelect.appendChild(op)
        if (y === currentY) op.selected = true
      }
      mSelect.value = months[new Date().getMonth()]
    }

    // Fetch Rate Button Handler
    fetchRateBtn?.addEventListener('click', async () => {
      if (fetchRateBtnText) fetchRateBtnText.textContent = 'Yükleniyor...'
      fetchRateBtn.classList.add('opacity-50', 'pointer-events-none')

      const result = await fetchExchangeRates()

      if (result) {
        if (modalRateInput) modalRateInput.value = result.eurRate.toFixed(4)
        const modalUsdRateInput = document.getElementById('modal-usd-rate') as HTMLInputElement
        if (modalUsdRateInput) modalUsdRateInput.value = result.usdRate.toFixed(4)
        if (rateDateSpan) rateDateSpan.textContent = result.date
        rateSourceInfo?.classList.remove('hidden')
      } else {
        if (fetchRateBtnText) fetchRateBtnText.textContent = 'Kurları Getir'
        if (fetchRateBtn) fetchRateBtn.removeAttribute('disabled')
        showAlert('Kur bilgisi alınamadı. Lütfen manuel olarak girin veya tekrar deneyin.', 'Bilgi', 'info')
      }

      if (fetchRateBtnText) fetchRateBtnText.textContent = 'Kurları Getir'
      fetchRateBtn.classList.remove('opacity-50', 'pointer-events-none')
    })

    createBtn?.addEventListener('click', () => {
      // Reset modal state when opening
      if (modalRateInput) modalRateInput.value = ''
      rateSourceInfo?.classList.add('hidden')
      modal?.classList.remove('hidden')
    })

    cancelBtn?.addEventListener('click', () => {
      modal?.classList.add('hidden')
    })

    confirmBtn?.addEventListener('click', async () => {
      const m = mSelect.value
      const y = ySelect.value
      const modalExchangeRate = modalRateInput?.value ? parseFloat(modalRateInput.value) : 0
      const modalUsdRate = (document.getElementById('modal-usd-rate') as HTMLInputElement)?.value ? parseFloat((document.getElementById('modal-usd-rate') as HTMLInputElement).value) : 0

      // If it doesn't exist, we'll auto-save it after initialization
      const monthKey = `${m} ${y}`
      const isNew = !allBudgetSummary.some(b => b.id === monthKey)

      await handleBudgetSelect(m, y)

      // Set the exchange rate in the main form if provided
      if (modalExchangeRate > 0) eurRateInput.value = modalExchangeRate.toFixed(4)
      if (modalUsdRate > 0) usdRateInput.value = modalUsdRate.toFixed(4)

      // If it was a new budget, save it immediately so it persists in the list/DB
      if (isNew) {
        await saveCurrentBudget()
      }

      modal?.classList.add('hidden')
    })

    // Setup global listeners
    setupButtons()

    const guideModal = document.getElementById('usage-guide-modal')
    const showGuideBtn = document.getElementById('show-guide-btn')
    const qaGuideBtn = document.getElementById('qa-guide')
    const closeGuideBtn = document.getElementById('close-guide-btn')
    const closeGuideFooterBtn = document.getElementById('close-guide-footer-btn')

    const showGuide = () => guideModal?.classList.add('show')
    const hideGuide = () => guideModal?.classList.remove('show')

    showGuideBtn?.addEventListener('click', showGuide)
    qaGuideBtn?.addEventListener('click', showGuide)
    closeGuideBtn?.addEventListener('click', hideGuide)
    closeGuideFooterBtn?.addEventListener('click', hideGuide)

    // Landing Page Quick Actions
    document.getElementById('qa-new-month')?.addEventListener('click', () => {
      document.getElementById('new-budget-modal')?.classList.add('show')
    })
    document.getElementById('qa-last-budget')?.addEventListener('click', () => {
      const last = getLastBudget()
      if (last) handleBudgetSelect(last.id.split(' ')[0], last.id.split(' ')[1])
    })
    document.getElementById('qa-reports')?.addEventListener('click', () => {
      showPage('page-reports')
      renderReports(allBudgetSummary)
    })

    // General app level listeners
    document.getElementById('new-budget-modal')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('new-budget-modal')) {
        document.getElementById('new-budget-modal')?.classList.remove('show')
      }
    })
    document.getElementById('user-menu-modal')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('user-menu-modal')) {
        document.getElementById('user-menu-modal')?.classList.remove('show')
      }
    })

    // Escape key support
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideGuide()
        document.getElementById('new-budget-modal')?.classList.remove('show')
        document.getElementById('custom-confirm-modal')?.classList.remove('show')
        document.getElementById('custom-alert-modal')?.classList.remove('show')
        document.getElementById('user-menu-modal')?.classList.remove('show')
      }
    })

  } catch (error) {
    console.error('Başlatma hatası:', error)
    showError(`Uygulama başlatılamadı: ${(error as Error).message}`)
    loadingOverlay.classList.add('hidden')
  }
} // <--- End of initializeAppService






// --- ONE-TIME AUTO SEED ---
const runAutoSeed = async () => {
  if (allBudgetSummary.length > 0) {
    console.log("Data detected. Skipping auto-seed.")
    return
  }
  if (localStorage.getItem('seeded_4months_v2')) return;
  if (!budgetService) return;

  console.log("Checking for local db.json data to migrate...");
  try {
    const res = await fetch('/api/db');
    if (res.ok) {
      const dbData: BudgetRecord[] = await res.json();
      if (dbData && dbData.length > 0) {
        console.log(`Found ${dbData.length} months of real data in db.json! Auto-migrating to Firebase...`);
        for (const record of dbData) {
          // ensure legacy fields are calculated correctly just in case
          const migrated = record.totalTurkiyeTL !== undefined ? record : migrateLegacyData(record);
          await budgetService.saveBudget(migrated);
        }
        localStorage.setItem('seeded_4months_v2', 'true');
        
        // Target the last month in their DB
        const lastRecord = dbData[dbData.length - 1];
        const parts = lastRecord.monthYear.split(' ');
        if (parts.length === 2) {
            handleBudgetSelect(parts[0], parts[1]);
        }
        showToast('Eski verileriniz (db.json) başarıyla buluta kopyalandı!', 'success');
        return;
      }
    }
  } catch (err) {
    console.log("Could not load /api/db for migration, falling back to mock seed.", err);
  }

  console.log("Local DB empty or not found. Auto-seeding 4 months of mock data...");
  localStorage.removeItem('offline_budgets');

  // We will seed 4 months: Eylül, Ekim, Kasım, Aralık 2025
  const seedMonths = [
    { month: 'Eylül', year: '2025', eurRate: 48.50, usdRate: 44.20, income: 4500, extraExpenseMultiplier: 0.8 },
    { month: 'Ekim', year: '2025', eurRate: 49.30, usdRate: 45.10, income: 4500, extraExpenseMultiplier: 1.1 },
    { month: 'Kasım', year: '2025', eurRate: 50.10, usdRate: 46.80, income: 4500, extraExpenseMultiplier: 0.9 },
    { month: 'Aralık', year: '2025', eurRate: 51.50, usdRate: 48.50, income: 5200, extraExpenseMultiplier: 1.3 } // Bonus month
  ];

  for (const mData of seedMonths) {
    const monthKey = `${mData.month} ${mData.year}`;
    
    // Base fixed expenses
    const details: BudgetDetail[] = [
      // INCOME
      { id: `seed-inc-1-${mData.month}`, name: 'Maaş', amount: mData.income, currency: 'EUR', type: 'FIXED', group: 'INCOME_ENTRIES', subGroup: 'Maaş', section: 'INCOME', paymentDay: 25 },
      
      // HOLLANDA FIXED
      { id: `seed-1-${mData.month}`, name: 'Kira/Mortgage', amount: 1388.17, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Kredi', section: 'EXPENSE', paymentDay: 1 },
      { id: `seed-3-${mData.month}`, name: 'Sağlık Sigortası (Aile)', amount: 310.30, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Sigorta', section: 'EXPENSE', paymentDay: 28 },
      { id: `seed-5-${mData.month}`, name: 'İnternet Düşük', amount: 67.50, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Fatura', section: 'EXPENSE', paymentDay: 21 },
      { id: `seed-8-${mData.month}`, name: 'Elektrik/Gaz', amount: 146.00, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Fatura', section: 'EXPENSE', paymentDay: 23 },
      { id: `seed-18-${mData.month}`, name: 'Kredi Taksidi', amount: 259.73, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Kredi', section: 'EXPENSE', paymentDay: 1 },

      // HOLLANDA VARIABLE (Varies by month)
      { id: `seed-v1-${mData.month}`, name: 'Market Alışverişi', amount: 450 * mData.extraExpenseMultiplier, currency: 'EUR', type: 'VARIABLE', group: 'HOLLANDA', subGroup: 'Market & Mutfak', section: 'EXPENSE', paymentDay: 10 },
      { id: `seed-v2-${mData.month}`, name: 'Yakıt', amount: 120 * mData.extraExpenseMultiplier, currency: 'EUR', type: 'VARIABLE', group: 'HOLLANDA', subGroup: 'Ulaşım & Yakıt', section: 'EXPENSE', paymentDay: 15 },
      { id: `seed-v3-${mData.month}`, name: 'Dışarıda Yemek', amount: 150 * mData.extraExpenseMultiplier, currency: 'EUR', type: 'VARIABLE', group: 'HOLLANDA', subGroup: 'Eğlence', section: 'EXPENSE', paymentDay: 20 },
      
      // TURKIYE VARIABLE 
      { id: `seed-t1-${mData.month}`, name: 'Aile Yardımı', amount: 5000, currency: 'TRY', type: 'VARIABLE', group: 'TURKIYE', subGroup: 'Aile Yardımı', section: 'EXPENSE', paymentDay: 5 },
      { id: `seed-t2-${mData.month}`, name: 'Abonelikler (Exxen vb)', amount: 450, currency: 'TRY', type: 'VARIABLE', group: 'TURKIYE', subGroup: 'Genel', section: 'EXPENSE', paymentDay: 12 }
    ];

    // Calculate Totals
    let totalTurkiyeTL = 0;
    let totalHollandaEUR = 0;
    let totalIncomeEUR = 0;
    let totalExpenseEUR = 0;

    details.forEach(d => {
      let eurAmount = d.amount;
      if (d.currency === 'TRY') {
        eurAmount = d.amount / mData.eurRate;
        if (d.section === 'EXPENSE') totalTurkiyeTL += d.amount;
      }
      
      if (d.section === 'INCOME') {
        totalIncomeEUR += eurAmount;
      } else {
        totalExpenseEUR += eurAmount;
        if (d.group === 'HOLLANDA') totalHollandaEUR += eurAmount;
      }
    });

    const record: BudgetRecord = {
      id: monthKey,
      monthYear: monthKey,
      exchangeRate: mData.eurRate,
      usdRate: mData.usdRate,
      totalTurkiyeTL,
      totalHollandaEUR,
      totalIncomeEUR,
      totalExpenseEUR,
      transferAmountEUR: totalTurkiyeTL / mData.eurRate,
      grandTotalEUR: totalExpenseEUR,
      details: details
    };

    await budgetService.saveBudget(record);
  }

  localStorage.setItem('seeded_4months_v2', 'true');
  handleBudgetSelect('Aralık', '2025');
};

// Start the app
initializeAppService().then(() => {
  runAutoSeed();
});

// --- MIGRATION UTILITY ---
// Call this from the browser console: window.migrateDbJson()
;(window as any).migrateDbJson = async () => {
  if (!(budgetService instanceof FirestoreBudgetService)) {
    console.error('Bu işlem sadece Cloud Mode (Firebase) aktifken çalışır.');
    return;
  }
  
  if (!budgetService.getUserId()) {
    console.error('Lütfen önce giriş yapın.');
    return;
  }

  try {
    console.log('Yerel db.json verileri alınıyor...');
    const res = await fetch('/api/db');
    if (!res.ok) throw new Error('Yerel sunucuya ulaşılamadı. Uygulamayı yerel dev modunda çalıştırdığınızdan emin olun.');
    
    const data: BudgetRecord[] = await res.json();
    if (!data || data.length === 0) {
      console.log('db.json boş, aktarılacak veri yok.');
      return;
    }

    console.log(`${data.length} kayıt bulundu. Firebase'e aktarılıyor...`);
    let successCount = 0;
    
    for (const record of data) {
      try {
        await budgetService.saveBudget(record);
        console.log(`✅ Aktarıldı: ${record.id}`);
        successCount++;
      } catch (e: any) {
         console.error(`❌ Hاتا: ${record.id} aktarılamadı`, e.message);
      }
    }
    
    console.log(`🎉 İşlem tamamlandı! ${successCount}/${data.length} kayıt başarıyla aktarıldı.`);
    alert(`Geçiş tamamlandı: ${successCount} kayıt Firebase'e kopyalandı.`);
    window.location.reload();
  } catch (error: any) {
    console.error('Migration Error:', error);
    alert(`Aktarım hatası: ${error.message}`);
  }
};

