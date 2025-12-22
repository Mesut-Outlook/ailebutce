import './style.css'
import * as d3 from 'd3'
import { initializeApp, setLogLevel } from 'firebase/app'
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCustomToken,
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

// --- ERROR HANDLING ---
const showError = (message: string) => {
  const errorBox = document.getElementById('error-box')
  if (errorBox) {
    errorBox.textContent = message
    errorBox.classList.remove('hidden')
  } else {
    alert(message)
  }
}

// --- TYPES ---
type Currency = 'EUR' | 'TRY'
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
  totalTurkiyeTL: number
  totalHollandaEUR: number
  totalIncomeEUR: number
  totalExpenseEUR: number
  transferAmountEUR: number
  grandTotalEUR: number
  details: BudgetDetail[]
}

type ChartPoint = {
  month: string
  totalEUR: number
}

// --- EUR/TRY EXCHANGE RATE API ---
interface ExchangeRateResponse {
  amount: number
  base: string
  date: string
  rates: { TRY: number }
}

const fetchEurTryRate = async (): Promise<{ rate: number; date: string } | null> => {
  try {
    const response = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=TRY')
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }
    const data: ExchangeRateResponse = await response.json()
    return {
      rate: data.rates.TRY,
      date: data.date
    }
  } catch (error) {
    console.error('Failed to fetch EUR/TRY rate:', error)
    return null
  }
}

// --- INTERFACES & SERVICES ---
interface BudgetService {
  init(): Promise<void>
  saveBudget(budget: BudgetRecord): Promise<void>
  deleteBudget(id: string): Promise<void>
  subscribe(callback: (budgets: BudgetRecord[]) => void): () => void
  getUserId(): string
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

  getUserId(): string {
    return ''
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
      // Only show alert if it's likely a manual action? 
      // To keep it simple and reassuring:
      // setTimeout(() => alert('✅ Bütçe Kaydedildi!'), 10) 
      // Use a custom toast via DOM?
      const toast = document.createElement('div')
      toast.className = 'fixed bottom-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 font-bold animate-bounce'
      toast.textContent = '✅ Bütçe Başarıyla Kaydedildi!'
      document.body.appendChild(toast)
      setTimeout(() => toast.remove(), 3000)
    } catch (error) {
      console.error('Failed to save budgets', error)
      alert('HATA: Veri dosyaya yazılamadı! Sunucu çalışıyor mu?')
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

    if (this.initialToken) {
      await signInWithCustomToken(this.auth, this.initialToken)
    } else {
      await signInAnonymously(this.auth)
    }

    return new Promise((resolve, reject) => {
      onAuthStateChanged(this.auth, (user) => {
        if (user) {
          this.userId = user.uid
          resolve()
        } else {
          reject(new Error('User not authenticated'))
        }
      })
    })
  }

  getUserId(): string {
    return this.userId || 'Bilinmiyor'
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
let selectedMonthKey: string | null = null
let unsubscribeBudgets: (() => void) | null = null
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

// --- HELPER FUNCTIONS ---
const formatCurrency = (amount: number, currency: 'TRY' | 'EUR') => {
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
      // It was deleted. Reset to Empty View
      document.getElementById('budget-ui-container')?.classList.add('hidden')
      document.getElementById('active-budget-display')?.classList.add('hidden')
      document.getElementById('empty-state-message')?.classList.remove('hidden')
      document.getElementById('delete-budget-btn')?.classList.add('hidden')
      activeMonth = ''
      activeYear = ''
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

  // 1. Process Income Groups
  document.getElementById('income-groups-container')?.querySelectorAll('.expense-item').forEach(item => {
    const amountDisplay = (item.querySelector('.expense-amount') as HTMLInputElement).value
    const amount = parseFloat(amountDisplay) || 0
    const currency = (item.querySelector('.expense-currency') as HTMLSelectElement).value as Currency
    let amountEUR = amount
    if (currency === 'TRY' && eurRate > 0) amountEUR = amount / eurRate

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

const removeGroup = (groupId: string) => {
  if (confirm('Grubu silmek istediğinize emin misiniz?')) {
    document.getElementById(groupId)?.remove()
    calculateEditorTotals()
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
  row.className = 'expense-item flex flex-wrap md:flex-nowrap gap-2 items-center p-2 bg-white rounded-lg border border-gray-100 shadow-sm md:shadow-none md:border-none md:p-0 md:bg-transparent mb-2 md:mb-0'
  row.id = itemId

  const isFixed = data?.type === 'FIXED'
  const currentCurrency = data?.currency || defaultCurrency

  row.innerHTML = `
    <!-- 1. Drag Handle -->
    <div class="drag-handle cursor-grab active:cursor-grabbing text-gray-400 p-1 hover:text-gray-600 rounded hover:bg-gray-100 transition" draggable="true">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
    </div>

    <!-- 2. Day Input -->
    <div class="w-16 md:w-20 shrink-0">
       <input type="number" min="1" max="31" class="expense-day block w-full rounded-md border-gray-300 shadow-sm p-2 border text-base md:text-sm text-center" placeholder="Gün" value="${data?.paymentDay || ''}" title="Ödeme Günü (1-31)" />
    </div>

    <!-- 3. Amount -->
    <div class="w-24 md:w-32 shrink-0">
      <input type="number" step="0.01" class="expense-amount block w-full rounded-md border-gray-300 shadow-sm p-2 border text-base md:text-sm" placeholder="Tutar" value="${data?.amount || ''}" required />
    </div>

    <!-- 4. Currency -->
    <div class="w-20 shrink-0">
      <select class="expense-currency block w-full rounded-md border-gray-300 shadow-sm p-1 border text-xs h-[38px] bg-gray-50">
        <option value="EUR" ${currentCurrency === 'EUR' ? 'selected' : ''}>EUR</option>
        <option value="TRY" ${currentCurrency === 'TRY' ? 'selected' : ''}>TRY</option>
      </select>
    </div>

    <!-- 5. Fixed Checkbox -->
    <div class="flex items-center gap-1 shrink-0" title="${isIncome ? 'Sabit Gelir (Her ay otomatik eklenir)' : 'Sabit Gider (Her ay otomatik eklenir)'}">
      <input type="checkbox" class="expense-fixed w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" ${isFixed ? 'checked' : ''} />
      <span class="text-xs text-gray-400 md:hidden lg:inline">Sabit</span>
    </div>

    <!-- 6. Name Input (Full width on mobile, moves to bottom via order-last) -->
    <div class="w-full md:w-auto md:flex-grow order-last md:order-none mt-1 md:mt-0">
      <input type="text" class="expense-name block w-full rounded-md border-gray-300 shadow-sm p-2 border text-base md:text-sm" placeholder="${isIncome ? 'Gelir Kaynağı' : 'Harcama Adı'}" value="${data?.name || ''}" required />
    </div>

    <!-- 7. Remove Button -->
    <button onclick="removeExpenseItem('${itemId}')" class="text-red-400 hover:text-red-600 p-1 shrink-0">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
    </button>
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
window.removeGroup = removeGroup
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

// Wire up GLOBAL buttons (since we replaced HTML and lost inline onclicks for main buttons)
// We need to wait for DOM? No, defer is not used but this is a module.
// So we should run setupEventListeners once DOM is ready or immediately if at bottom.
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

  // Click on privacy card to show income
  document.getElementById('income-privacy-card')?.addEventListener('click', () => {
    toggleIncomeVisibility(true)
  })

  // Click on hide button to hide income
  document.getElementById('hide-income-btn')?.addEventListener('click', () => {
    toggleIncomeVisibility(false)
  })

  document.getElementById('add-income-btn')?.addEventListener('click', () => addGroup('INCOME_ENTRIES', 'Gelirler'))
  document.getElementById('add-group-hollanda-btn')?.addEventListener('click', () => addGroup('HOLLANDA'))
  document.getElementById('add-turkey-expense-btn')?.addEventListener('click', () => addGroup('TURKIYE', 'Genel'))

  // Turkey expense section - separate buttons for item and group
  document.getElementById('add-turkey-item-btn')?.addEventListener('click', () => {
    // Find existing default group or create one
    let turkeyContainer = document.getElementById('turkiye-groups-container')
    let defaultGroup = turkeyContainer?.querySelector('[data-group-type="TURKIYE"]')

    if (!defaultGroup) {
      // Create a default group first
      const groupId = generateId()
      createGroupElement(groupId, 'TURKIYE', 'Genel')
      defaultGroup = document.getElementById(groupId)
    }

    // Add item to the default (first) group
    if (defaultGroup) {
      addExpenseItem(defaultGroup.id)
    }
  })
  document.getElementById('add-turkey-group-btn')?.addEventListener('click', () => addGroup('TURKIYE', 'Yeni Kategori'))

  document.getElementById('toggle-all-btn')?.addEventListener('click', toggleAllGroups)

  // SAVE BTN
  document.getElementById('save-budget-btn')?.addEventListener('click', async () => {
    if (!budgetService) return

    const month = activeMonth
    const year = activeYear
    const id = `${month} ${year}`
    const eurRate = parseFloat(eurRateInput.value) || 0

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

      if (d.section === 'INCOME') totalIncome += amountEUR
      else {
        totalExpense += amountEUR
        if (d.group === 'TURKIYE' && d.currency === 'TRY') totalTurkiyeTL += d.amount
      }
    })

    const record: BudgetRecord = {
      id,
      monthYear: id,
      exchangeRate: eurRate,
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
    } catch (e) {
      console.error(e)
      alert('Kaydetme hatası')
    }
  })

  // CLOSE BTN - Go back to welcome screen
  document.getElementById('close-budget-btn')?.addEventListener('click', () => {
    // Check if there are unsaved changes
    const statusBadge = document.getElementById('header-status-badge')
    const hasUnsavedChanges = statusBadge?.textContent?.includes('Değişiklik')

    if (hasUnsavedChanges) {
      if (!confirm('Kaydedilmemiş değişiklikler var. Yine de kapatmak istiyor musunuz?')) {
        return
      }
    }

    // Hide budget UI, show welcome screen
    document.getElementById('budget-ui-container')?.classList.add('hidden')
    document.getElementById('active-budget-display')?.classList.add('hidden')
    document.getElementById('empty-state-message')?.classList.remove('hidden')
    document.getElementById('delete-budget-btn')?.classList.add('hidden')

    // Reset active month/year
    activeMonth = ''
    activeYear = ''
    setDirty(false)
  })

  // DELETE BTN - Delete current budget and go back
  document.getElementById('delete-budget-btn')?.addEventListener('click', async () => {
    if (!budgetService || !activeMonth || !activeYear) return

    const budgetId = `${activeMonth} ${activeYear}`

    // İlk onay
    if (!confirm(`"${budgetId}" ayını silmek istediğinize emin misiniz?`)) {
      return
    }

    // İkinci onay
    if (!confirm(`DİKKAT: Bu işlem geri alınamaz! "${budgetId}" bütçesini kalıcı olarak silmek istediğinize emin misiniz?`)) {
      return
    }

    try {
      await budgetService.deleteBudget(budgetId)

      // Hide budget UI, show welcome screen
      document.getElementById('budget-ui-container')?.classList.add('hidden')
      document.getElementById('active-budget-display')?.classList.add('hidden')
      document.getElementById('empty-state-message')?.classList.remove('hidden')
      document.getElementById('delete-budget-btn')?.classList.add('hidden')

      // Reset active month/year
      activeMonth = ''
      activeYear = ''
      setDirty(false)

      // Show success toast
      const toast = document.createElement('div')
      toast.className = 'fixed bottom-4 right-4 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 font-bold'
      toast.textContent = '🗑️ Ay Silindi!'
      document.body.appendChild(toast)
      setTimeout(() => toast.remove(), 3000)
    } catch (e) {
      console.error(e)
      alert('Silme hatası!')
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
  groupsToCreate.forEach((groupData, key) => {
    const groupId = generateId()
    // Get color from first item?
    const color = groupData.color || ''

    createGroupElement(groupId, groupData.type, groupData.name, color)

    // Add items (clear initial default item first if any)
    const itemsContainer = document.getElementById(`${groupId} -items`)
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

const initNewBudget = (month: string, year: string) => {
  const monthKey = `${month} ${year}`

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
  document.getElementById('budget-ui-container')?.classList.remove('hidden')
  document.getElementById('active-budget-display')?.classList.remove('hidden')
  document.getElementById('empty-state-message')?.classList.add('hidden')
  document.getElementById('delete-budget-btn')?.classList.remove('hidden')

  // Clear containers
  const containers = ['income-groups-container', 'expense-groups-container', 'turkiye-groups-container']
  containers.forEach(id => {
    const el = document.getElementById(id)
    if (el) el.innerHTML = ''
  })

  if (existingData) {
    // Load Existing
    (document.getElementById('eur-rate') as HTMLInputElement).value = existingData.exchangeRate.toString() || ''
    renderGroupsAndItems(existingData.details)
    setDirty(false)
  } else {
    // Init New
    initNewBudget(m, y)
  }
}

// --- D3 CHART ---
const getTooltip = () => {
  const existing = document.querySelector<HTMLDivElement>('.chart-tooltip')
  if (existing) return d3.select(existing)
  return d3.select('body').append('div').attr('class', 'chart-tooltip')
}

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

  svg.selectAll('path').data(pie(data)).enter().append('path').attr('d', arc).attr('fill', (d, i) => color(i.toString()))
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
  if (!container) return
  container.innerHTML = ''
  if (budgets.length === 0) return

  // Sort Newest First
  const sorted = [...budgets].sort((a, b) => {
    const [ma, ya] = a.id.split(' ')
    const [mb, yb] = b.id.split(' ')
    if (ya !== yb) return parseInt(yb) - parseInt(ya)
    return months.indexOf(mb) - months.indexOf(ma)
  })

  sorted.forEach(budget => {
    const btn = document.createElement('button')
    btn.className = "flex flex-col items-start p-4 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-indigo-300 hover:bg-indigo-50 transition-all group text-left"

    // Parse ID for display
    const [m, y] = budget.id.split(' ')
    const balance = budget.totalIncomeEUR - budget.totalExpenseEUR

    btn.innerHTML = `
      <div class="flex justify-between w-full items-center mb-2">
        <span class="font-bold text-gray-800 text-lg group-hover:text-indigo-700">${m} ${y}</span>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-300 group-hover:text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </div>
      <div class="text-xs text-gray-500 font-mono space-y-1 w-full">
        <div class="flex justify-between">
           <span class="text-green-600">Gelir:</span>
           <span class="font-bold text-green-600">${formatCurrency(budget.totalIncomeEUR, 'EUR')}</span>
        </div>
        <div class="flex justify-between">
           <span class="text-red-500">Gider:</span>
           <span class="font-bold text-red-500">${formatCurrency(budget.totalExpenseEUR, 'EUR')}</span>
        </div>
        <div class="flex justify-between border-t pt-1 mt-1">
           <span class="font-medium">Kalan:</span>
           <span class="${balance < 0 ? 'text-red-500' : 'text-indigo-600'} font-bold">
             ${formatCurrency(balance, 'EUR')}
           </span>
        </div>
      </div>
    `
    btn.addEventListener('click', () => {
      handleBudgetSelect(m, y)
    })

    container.appendChild(btn)
  })
}

// Global handler for switching logic
const handleBudgetSelect = async (m: string, y: string) => {
  if (activeMonth === m && activeYear === y) return

  if (isDirty) {
    if (!confirm('Kaydedilmemiş değişiklikler var. Çıkmak istiyor musunuz?')) return
  }

  activeMonth = m
  activeYear = y
  loadFormData(m, y)

}




window.deleteBudget = async (monthKey: string) => {
  if (!budgetService) return
  if (!window.confirm(`${monthKey} bütçesini silmek istediğinizden emin misiniz?`)) {
    return
  }

  try {
    await budgetService.deleteBudget(monthKey)
    if (selectedMonthKey === monthKey) {
      document.getElementById('budget-ui-container')?.classList.add('hidden')
      selectedMonthKey = null
    }
  } catch (error) {
    console.error('Bütçe silme hatası:', error)
    window.alert(`Bütçe silinemedi: ${(error as Error).message}`)
  }
}

// --- BOOTSTRAP ---

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

    userIdDisplay.textContent = budgetService.getUserId()
    appContainer.classList.remove('hidden')
    loadingOverlay.classList.add('hidden')
    loadingOverlay.classList.add('hidden')
    // populateMonthSelect() -- REMOVED



    unsubscribeBudgets = budgetService.subscribe(onBudgetsUpdated)

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

      const result = await fetchEurTryRate()

      if (result) {
        if (modalRateInput) modalRateInput.value = result.rate.toFixed(4)
        if (rateDateSpan) rateDateSpan.textContent = result.date
        rateSourceInfo?.classList.remove('hidden')
      } else {
        alert('Kur bilgisi alınamadı. Lütfen manuel olarak girin veya tekrar deneyin.')
      }

      if (fetchRateBtnText) fetchRateBtnText.textContent = 'Kuru Getir'
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

    confirmBtn?.addEventListener('click', () => {
      const m = mSelect.value
      const y = ySelect.value
      const modalExchangeRate = modalRateInput?.value ? parseFloat(modalRateInput.value) : 0

      handleBudgetSelect(m, y)

      // Set the exchange rate in the main form if provided
      if (modalExchangeRate > 0) {
        const eurRateInput = document.getElementById('eur-rate') as HTMLInputElement
        if (eurRateInput) eurRateInput.value = modalExchangeRate.toFixed(4)
      }

      modal?.classList.add('hidden')
    })

    // Setup global listeners
    setupButtons()

    // Active Budget Select Listener
    document.getElementById('active-budget-select')?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value
      if (val) {
        const [m, y] = val.split(' ')
        handleBudgetSelect(m, y)
      } else {
        // "Seçiniz..." was selected -> Go Home
        if (isDirty) {
          if (!confirm('Kaydedilmemiş değişiklikler var. Çıkmak istiyor musunuz?')) {
            (e.target as HTMLSelectElement).value = `${activeMonth} ${activeYear}` // revert
            return
          }
        }
        activeMonth = ''
        activeYear = ''
        document.getElementById('budget-ui-container')?.classList.add('hidden')
        document.getElementById('active-budget-display')?.classList.add('hidden')
        document.getElementById('empty-state-message')?.classList.remove('hidden')
        renderWelcomeBudgetList(allBudgetSummary)
      }
    })

    // Home / Logo Button Listener
    document.getElementById('app-logo-btn')?.addEventListener('click', () => {
      if (isDirty && !confirm('Kaydedilmemiş değişiklikler var. Anasayfaya dönmek istiyor musunuz?')) return

      activeMonth = ''; activeYear = ''
      document.getElementById('active-budget-display')?.classList.add('hidden')

      // Reset Select
      const sel = document.getElementById('active-budget-select') as HTMLSelectElement
      if (sel) sel.value = ""

      showPage('empty-state-message')
      renderWelcomeBudgetList(allBudgetSummary)
    })

    // Attach Dirty Listeners globally to container
    document.getElementById('budget-ui-container')?.addEventListener('input', (e) => {
      if ((e.target as HTMLElement).matches('input, select')) {
        setDirty(true)
      }
    })

    // --- NAVIGATION LOGIC ---
    const showPage = (pageId: string) => {
      const pages = ['empty-state-message', 'budget-ui-container', 'reports-ui-container']
      pages.forEach(id => document.getElementById(id)?.classList.add('hidden'))
      document.getElementById(pageId)?.classList.remove('hidden')

      // Update Nav Buttons appearance
      const homeBtn = document.getElementById('nav-home-btn')
      const reportsBtn = document.getElementById('nav-reports-btn')

      if (pageId === 'reports-ui-container') {
        reportsBtn?.classList.replace('text-indigo-100', 'text-white')
        reportsBtn?.classList.add('bg-white/10')
        homeBtn?.classList.replace('text-white', 'text-indigo-100')
        homeBtn?.classList.remove('bg-white/10')

        renderReports(allBudgetSummary)
      } else {
        homeBtn?.classList.replace('text-indigo-100', 'text-white')
        homeBtn?.classList.add('bg-white/10')
        reportsBtn?.classList.replace('text-white', 'text-indigo-100')
        reportsBtn?.classList.remove('bg-white/10')
      }
    }

    document.getElementById('nav-home-btn')?.addEventListener('click', () => {
      if (isDirty && !confirm('Kaydedilmemiş değişiklikler var. Çıkmak istiyor musunuz?')) return
      activeMonth = ''; activeYear = ''
      document.getElementById('active-budget-display')?.classList.add('hidden')
      showPage('empty-state-message')
      renderWelcomeBudgetList(allBudgetSummary)
    })

    document.getElementById('nav-reports-btn')?.addEventListener('click', () => {
      if (isDirty && !confirm('Kaydedilmemiş değişiklikler var. Çıkmak istiyor musunuz?')) return
      activeMonth = ''; activeYear = ''
      document.getElementById('active-budget-display')?.classList.add('hidden')
      showPage('reports-ui-container')
    })

    // --- USAGE GUIDE MODAL LOGIC ---
    const guideModal = document.getElementById('usage-guide-modal')
    const showGuideBtn = document.getElementById('show-guide-btn')
    const closeGuideBtn = document.getElementById('close-guide-btn')
    const closeGuideFooterBtn = document.getElementById('close-guide-footer-btn')

    showGuideBtn?.addEventListener('click', () => {
      guideModal?.classList.remove('hidden')
    })

    const hideGuide = () => {
      guideModal?.classList.add('hidden')
    }

    closeGuideBtn?.addEventListener('click', hideGuide)
    closeGuideFooterBtn?.addEventListener('click', hideGuide)

    // Close on click outside
    guideModal?.addEventListener('click', (e) => {
      if (e.target === guideModal) hideGuide()
    })

    // Escape key support
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !guideModal?.classList.contains('hidden')) {
        hideGuide()
      }
    })

  } catch (error) {
    console.error('Başlatma hatası:', error)
    showError(`Uygulama başlatılamadı: ${(error as Error).message}`)
    loadingOverlay.classList.add('hidden')
  }
}






// --- ONE-TIME AUTO SEED ---
const runAutoSeed = async () => {
  // SAFER CHECK: If we have ANY data loaded from file (or firebase), DO NOT SEED.
  if (allBudgetSummary.length > 0) {
    console.log("Data detected. Skipping auto-seed.")
    return
  }

  // Also keep the LS check as double safety for first run
  if (localStorage.getItem('seeded_dec_2025_v1')) return;

  console.log("Auto-seeding Aralık 2025 data...");
  if (!budgetService) return;

  // 1. Clear Data
  localStorage.removeItem('offline_budgets');

  // 2. Prepare Data
  const monthKey = "Aralık 2025";
  const eurRate = 51.50; // Approximate rate

  const details: BudgetDetail[] = [
    // KREDİ & KİRA
    { id: 'seed-1', name: 'ABN AMRO BANK NV', amount: 1388.17, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Kredi', section: 'EXPENSE', paymentDay: 1 },
    { id: 'seed-6', name: 'MANDELAA (Aidat)', amount: 139.11, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Kredi', section: 'EXPENSE', paymentDay: 25 }, // Aidat fits here or Fatura? Let's keep strict to request or logical.

    // SİGORTA
    { id: 'seed-3', name: 'CZ (Sağlık Sigortası)', amount: 310.30, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Sigorta', section: 'EXPENSE', paymentDay: 28 },
    { id: 'seed-10', name: 'ZILVEREN KRUIS (Sağlık Sigortası)', amount: 288.95, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Sigorta', section: 'EXPENSE', paymentDay: 28 },
    { id: 'seed-2', name: 'REAAL LEVENSVERZEKERING', amount: 28.07, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Sigorta', section: 'EXPENSE', paymentDay: 28 },
    { id: 'seed-12', name: 'OHRA SCHADEVERZEKERINGEN', amount: 22.17, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Sigorta', section: 'EXPENSE', paymentDay: 28 },
    { id: 'seed-13', name: 'VOOGD VOOGD VERZEKERING', amount: 22.46, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Sigorta', section: 'EXPENSE', paymentDay: 28 },

    // FATURA
    { id: 'seed-5', name: 'KPN B.V. (İnternet)', amount: 67.50, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Fatura', section: 'EXPENSE', paymentDay: 21 },
    { id: 'seed-8', name: 'VATTENFALL (Elektrik/Gaz)', amount: 146.00, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Fatura', section: 'EXPENSE', paymentDay: 23 },
    { id: 'seed-9', name: 'WATERNET (Su)', amount: 23.00, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Fatura', section: 'EXPENSE', paymentDay: 16 },
    { id: 'seed-14', name: 'WATERSCHAP AMSTEL (Su Vergisi)', amount: 65.51, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Fatura', section: 'EXPENSE', paymentDay: 28 },
    { id: 'seed-11', name: 'BUDGET ENERGIE', amount: 250.00, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Fatura', section: 'EXPENSE', paymentDay: 23 },
    { id: 'seed-15', name: 'VODAFONE LIBERTEL BV', amount: 128.14, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Fatura', section: 'EXPENSE', paymentDay: 20 },
    { id: 'seed-16', name: 'ZIGGO SERVICES BV', amount: 67.83, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Fatura', section: 'EXPENSE', paymentDay: 20 },

    // VERGİ
    { id: 'seed-4', name: 'GEMEENTEBAR (Vergi)', amount: 81.00, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Vergi', section: 'EXPENSE', paymentDay: 28 },
    { id: 'seed-17', name: 'GEMEENTE AMSTERDAM', amount: 99.38, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Vergi', section: 'EXPENSE', paymentDay: 28 },
    { id: 'seed-20', name: 'CBR (Ehliyet)', amount: 48.00, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Vergi', section: 'EXPENSE', paymentDay: 28 },

    // DİĞER
    { id: 'seed-18', name: 'FREO (Kredi)', amount: 259.73, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Kredi', section: 'EXPENSE', paymentDay: 1 },
    { id: 'seed-19', name: 'THE RENT COMPANY BV', amount: 12.69, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Eğitim', section: 'EXPENSE', paymentDay: 28 },
    { id: 'seed-7', name: 'TRIODOS BANK (Banka)', amount: 13.00, currency: 'EUR', type: 'FIXED', group: 'HOLLANDA', subGroup: 'Banka', section: 'EXPENSE', paymentDay: 1 },
  ];

  const totalExpense = details.reduce((acc, curr) => acc + curr.amount, 0);

  const record: BudgetRecord = {
    id: monthKey,
    monthYear: monthKey,
    exchangeRate: eurRate,
    totalTurkiyeTL: 0,
    totalHollandaEUR: totalExpense,
    totalIncomeEUR: 0,
    totalExpenseEUR: totalExpense,
    transferAmountEUR: 0,
    grandTotalEUR: totalExpense,
    details: details
  };

  await budgetService.saveBudget(record);
  localStorage.setItem('seeded_dec_2025_v1', 'true');

  // Instead of reloading, directly load the seeded budget
  handleBudgetSelect('Aralık', '2025');
};

// Start the app
initializeAppService().then(() => {
  runAutoSeed();
});
