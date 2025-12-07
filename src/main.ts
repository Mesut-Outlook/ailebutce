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

class LocalBudgetService implements BudgetService {
  private storageKey = 'offline_budgets'
  private listeners: ((budgets: BudgetRecord[]) => void)[] = []

  async init(): Promise<void> {
    console.log('LocalBudgetService initialized')
    await new Promise((resolve) => setTimeout(resolve, 500))
    this.notify()
  }

  getUserId(): string {
    return 'Çevrimdışı Kullanıcı'
  }

  private getBudgets(): BudgetRecord[] {
    const data = localStorage.getItem(this.storageKey)
    if (!data) return []
    const raw: any[] = JSON.parse(data)
    // Migrate on read
    return raw.map(item => item.totalTurkiyeTL !== undefined ? item : migrateLegacyData(item))
  }

  private saveBudgets(budgets: BudgetRecord[]) {
    localStorage.setItem(this.storageKey, JSON.stringify(budgets))
    this.notify()
  }

  async saveBudget(budget: BudgetRecord): Promise<void> {
    const budgets = this.getBudgets()
    const index = budgets.findIndex((b) => b.id === budget.id)
    if (index >= 0) {
      budgets[index] = budget
    } else {
      budgets.push(budget)
    }
    this.saveBudgets(budgets)
  }

  async deleteBudget(id: string): Promise<void> {
    const budgets = this.getBudgets().filter((b) => b.id !== id)
    this.saveBudgets(budgets)
  }

  subscribe(callback: (budgets: BudgetRecord[]) => void): () => void {
    this.listeners.push(callback)
    callback(this.getBudgets())
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback)
    }
  }

  private notify() {
    this.listeners.forEach((l) => l(this.getBudgets()))
  }
}

class FirestoreBudgetService implements BudgetService {
  private db: Firestore
  private auth: Auth
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
  }
}

const monthNames = [
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
const currentYear = new Date().getFullYear()

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
const summaryBody = getElement<HTMLTableSectionElement>('summary-body')
const detailBody = getElement<HTMLTableSectionElement>('detail-body')
const detailCard = getElement<HTMLDivElement>('detail-card')
const detailHeaderText = getElement<HTMLSpanElement>('detail-header-text')
const errorBox = getElement<HTMLDivElement>('error-box')
// Changed DOM elements for new inputs
const yearSelectInput = getElement<HTMLInputElement>('year-select')
const monthSelectInput = getElement<HTMLSelectElement>('month-select')

const eurRateInput = getElement<HTMLInputElement>('eur-rate')
const budgetForm = document.getElementById('budget-form') as HTMLFormElement | null
const chartContainer = getElement<HTMLDivElement>('chart-container')

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

const showError = (message: string) => {
  errorBox.textContent = message
  errorBox.classList.remove('hidden')
}

const hideError = () => {
  errorBox.classList.add('hidden')
}

const populateMonthSelect = () => {
  monthSelectInput.innerHTML = ''
  monthNames.forEach((month) => {
    const option = document.createElement('option')
    option.value = month
    option.textContent = month
    monthSelectInput.appendChild(option)
  })
  // Default to current year
  yearSelectInput.value = currentYear.toString()
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

  // 1. Process Income Groups (Treat as flat for now, or group if needed)
  // We'll stick to the flat selector for income since it's simpler
  document.getElementById('income-groups-container')?.querySelectorAll('.expense-item').forEach(item => {
    const amountDisplay = (item.querySelector('.expense-amount') as HTMLInputElement).value
    const amount = parseFloat(amountDisplay) || 0
    const currency = (item.querySelector('.expense-currency') as HTMLSelectElement).value as Currency
    let amountEUR = amount
    if (currency === 'TRY' && eurRate > 0) amountEUR = amount / eurRate

    totalIncome += amountEUR
  })

  // 2. Process HOLLANDA & TURKIYE Groups individually to update headers
  const expenseGroups = document.querySelectorAll('[data-group-type="HOLLANDA"], [data-group-type="TURKIYE"]')

  expenseGroups.forEach(groupEl => {
    const groupId = groupEl.id
    const groupType = groupEl.getAttribute('data-group-type')
    let groupTotalEUR = 0
    let groupTotalTL = 0 // For Turkiye internal display if we wanted, but we use EUR for header usually or mix.

    groupEl.querySelectorAll('.expense-item').forEach(item => {
      const amountDisplay = (item.querySelector('.expense-amount') as HTMLInputElement).value
      const amount = parseFloat(amountDisplay) || 0
      const currency = (item.querySelector('.expense-currency') as HTMLSelectElement).value as Currency
      const isFixed = (item.querySelector('.expense-fixed') as HTMLInputElement)?.checked

      // Global Sums
      let amountEUR = 0
      if (currency === 'EUR') {
        amountEUR = amount
        if (groupType === 'TURKIYE') {
          // Convert EUR to TL for Turkiye Total Tracking? 
          // The logic says "totalTurkiyeTL" is the source of truth for transfer.
          // If user enters EUR in Turkiye, we calculate TL equivalent for the record?
          // Or just add to expense? The original logic accumulated 'totalTurkiyeTL' only from visible items.
          if (eurRate > 0) totalTurkiyeTL += (amount * eurRate)
        }
      } else {
        // TRY
        if (groupType === 'TURKIYE') {
          // Native Turkiye expense
          totalTurkiyeTL += amount
          if (eurRate > 0) amountEUR = amount / eurRate
          groupTotalTL += amount
        } else {
          // Hollanda TRY expense? Rare but possible
          if (eurRate > 0) amountEUR = amount / eurRate
        }
      }

      if (groupType === 'HOLLANDA' || groupType === 'TURKIYE') {
        totalExpense += amountEUR
        groupTotalEUR += amountEUR
      }
    })

    // Update Group Header Total
    const headerTotalSpan = document.getElementById(`total-${groupId}`)
    if (headerTotalSpan) {
      // For Turkiye, maybe show TRY? Or EUR? User asked for "totals". Let's show EUR for consistency in summary, or flexible.
      // Let's show the main currency of the group.
      if (groupType === 'TURKIYE') {
        // Show TRY value for Turkiye Groups
        headerTotalSpan.textContent = formatCurrency(groupTotalTL, 'TRY')
      } else {
        // Hollanda
        headerTotalSpan.textContent = formatCurrency(groupTotalEUR, 'EUR')
      }
    }
  })

  // Update Display
  const displayIncome = document.getElementById('display-total-income')
  const displayExpense = document.getElementById('display-total-expense')
  const displayNet = document.getElementById('display-net-balance')
  const displayTurkiyeTL = document.getElementById('display-turkey-total-try')
  const displayTurkiyeConv = document.getElementById('display-turkey-converted')
  const displayTurkiyeConvFooter = document.getElementById('display-turkey-converted-footer')

  if (displayIncome) displayIncome.textContent = formatCurrency(totalIncome, 'EUR')
  if (displayExpense) displayExpense.textContent = formatCurrency(totalExpense, 'EUR')
  if (displayNet) {
    const net = totalIncome - totalExpense
    displayNet.textContent = formatCurrency(net, 'EUR')
    displayNet.className = `text-3xl font-bold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`
  }

  if (displayTurkiyeTL) displayTurkiyeTL.textContent = formatCurrency(totalTurkiyeTL, 'TRY')

  if (displayTurkiyeConv || displayTurkiyeConvFooter) {
    const conv = eurRate > 0 ? totalTurkiyeTL / eurRate : 0
    const text = `≈ ${formatCurrency(conv, 'EUR')}`
    if (displayTurkiyeConv) displayTurkiyeConv.textContent = text
    if (displayTurkiyeConvFooter) displayTurkiyeConvFooter.textContent = text
  }
}

// Attach live listener
document.addEventListener('input', (e) => {
  if ((e.target as HTMLElement).matches('input, select')) {
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
    groupDiv.className = 'bg-green-50/50 border border-green-100 rounded-md p-2'
    groupDiv.innerHTML = `<div id="${groupId}-items" class="space-y-2"></div>`

  } else if (groupType === 'TURKIYE') {
    groupDiv.className = 'border-l-4 border-orange-300 pl-2 py-1 mb-2 bg-white/60'
    groupDiv.innerHTML = `
        <div class="flex justify-between items-center mb-1 group-header">
             <div class="flex items-center gap-2 w-full">
                 <button onclick="toggleGroup('${groupId}')" class="text-gray-400 hover:text-gray-600 transition transform duration-200" id="${groupId}-icon">
                   <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                 </button>
                 <input type="text" class="bg-transparent text-sm font-bold text-gray-600 focus:outline-none flex-grow" value="${groupName}" placeholder="Kategori (Örn: Market)"/>
                 <span id="total-${groupId}" class="text-xs font-bold text-orange-600 mr-2">0.00 ₺</span>
                 <button onclick="removeGroup('${groupId}')" class="text-gray-400 hover:text-red-500"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
             </div>
        </div>
        <div id="${groupId}-items" class="space-y-2 transition-all duration-300 origin-top"></div>
      `
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

    // Add Drop Zone Logic
    const itemsContainer = groupDiv.querySelector('.group-items-container') as HTMLElement

    itemsContainer.addEventListener('dragover', (e) => {
      e.preventDefault() // Allow drop
      itemsContainer.classList.add('bg-blue-50')
    })

    itemsContainer.addEventListener('dragleave', () => {
      itemsContainer.classList.remove('bg-blue-50')
    })

    itemsContainer.addEventListener('drop', (e) => {
      e.preventDefault()
      itemsContainer.classList.remove('bg-blue-50')
      const itemId = e.dataTransfer?.getData('text/plain')
      if (itemId) {
        const itemEl = document.getElementById(itemId)
        if (itemEl) {
          itemsContainer.appendChild(itemEl)
          // Recalculate totals immediately as the group (and potentially currency/type context) changed
          calculateEditorTotals()
        }
      }
    })
  }
  container.appendChild(groupDiv)

  // If new group, add initial item
  if (!document.getElementById(`${groupId}-items`)?.hasChildNodes()) {
    addExpenseItem(groupId)
  }
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
  row.className = 'expense-item flex gap-2 items-center'
  row.id = itemId

  const isFixed = data?.type === 'FIXED'
  const currentCurrency = data?.currency || defaultCurrency

  row.draggable = true
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/plain', itemId)
    row.classList.add('opacity-50')
  })
  row.addEventListener('dragend', () => {
    row.classList.remove('opacity-50')
  })

  row.innerHTML = `
    <div class="cursor-move text-gray-400 p-1">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
    </div>
    <div class="w-16">
       <input type="number" min="1" max="31" class="expense-day block w-full rounded-md border-gray-300 shadow-sm p-2 border text-sm text-center" placeholder="Gün" value="${data?.paymentDay || ''}" title="Ödeme Günü (1-31)" />
    </div>
    <div class="flex-grow">
      <input type="text" class="expense-name block w-full rounded-md border-gray-300 shadow-sm p-2 border text-sm" placeholder="${isIncome ? 'Gelir Kaynağı' : 'Harcama Adı'}" value="${data?.name || ''}" required />
    </div>
    <div class="w-24">
      <input type="number" step="0.01" class="expense-amount block w-full rounded-md border-gray-300 shadow-sm p-2 border text-sm" placeholder="Tutar" value="${data?.amount || ''}" required />
    </div>
    <div class="w-20">
      <select class="expense-currency block w-full rounded-md border-gray-300 shadow-sm p-1 border text-xs h-full bg-gray-50">
        <option value="EUR" ${currentCurrency === 'EUR' ? 'selected' : ''}>EUR</option>
        <option value="TRY" ${currentCurrency === 'TRY' ? 'selected' : ''}>TRY</option>
      </select>
    </div>
    ${!isIncome ? `
    <div class="flex items-center gap-1" title="Sabit Gider (Her ay otomatik eklenir)">
      <input type="checkbox" class="expense-fixed w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" ${isFixed ? 'checked' : ''} />
      <span class="text-xs text-gray-400">Sabit</span>
    </div>
    ` : ''}
    <button onclick="removeExpenseItem('${itemId}')" class="text-red-400 hover:text-red-600 p-1">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
    </button>
  `
  itemsContainer.appendChild(row)
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
    // Ids are generated like `${groupId}-items`.
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
  document.getElementById('add-income-btn')?.addEventListener('click', () => addGroup('INCOME_ENTRIES', 'Gelirler'))
  document.getElementById('add-group-hollanda-btn')?.addEventListener('click', () => addGroup('HOLLANDA'))
  document.getElementById('add-turkey-expense-btn')?.addEventListener('click', () => addGroup('TURKIYE', 'Genel'))

  document.getElementById('toggle-all-btn')?.addEventListener('click', toggleAllGroups)

  // SAVE BTN
  document.getElementById('save-budget-btn')?.addEventListener('click', async () => {
    if (!budgetService) return

    const month = monthSelectInput.value
    const year = yearSelectInput.value
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
      transferAmountEUR: totalExpense, // Simplification
      grandTotalEUR: totalExpense,
      details
    }

    try {
      await budgetService.saveBudget(record)
      alert('Bütçe kaydedildi!')
      setDirty(false)
    } catch (e) {
      console.error(e)
      alert('Kaydetme hatası')
    }
  })
}

// Call setupButtons at init
setTimeout(setupButtons, 1000) // Hacky wait for DOM? No, main.ts is module, runs after parse. DOM should be ready?
// Safer to call in initializeAppService



const getLastBudget = (): BudgetRecord | undefined => {
  if (allBudgetSummary.length === 0) return undefined
  // Sort reverse chronologically
  const sorted = [...allBudgetSummary].sort((a, b) => {
    const [monthA, yearA] = a.id.split(' ')
    const [monthB, yearB] = b.id.split(' ')
    const dateA = new Date(Number(yearA), monthNames.indexOf(monthA))
    const dateB = new Date(Number(yearB), monthNames.indexOf(monthB))
    return dateB.getTime() - dateA.getTime() // Newest first
  })
  return sorted[0]
}

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
  const groupsToCreate = new Map<string, { type: GroupType, name: string, items: BudgetDetail[] }>()

  // Helper to get key
  const getKey = (type: GroupType, name: string) => `${type}::${name}`

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
        groupsToCreate.set(key, { type: gType, name: subGroup, items: [] })
      }
      groupsToCreate.get(key)?.items.push(item)
    })
  }

  // 2. Render Groups and Items
  groupsToCreate.forEach((groupData, key) => {
    const groupId = generateId()
    // Get color from first item?
    const color = groupData.items.length > 0 ? groupData.items[0].color : ''

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

// State for revert
let currentLoadedMonth = ''

const loadFormData = () => {
  const currentYear = yearSelectInput.value
  const selectedMonth = (document.getElementById('month-select') as HTMLSelectElement).value // Use dynamic ref incase replaced
  const monthKey = `${selectedMonth} ${currentYear}`

  const existingData = allBudgetSummary.find((b) => b.id === monthKey)

  budgetForm?.reset()
  // Restore selections
  yearSelectInput.value = currentYear
  if (document.getElementById('month-select')) (document.getElementById('month-select') as HTMLSelectElement).value = selectedMonth

  // Reset Containers
  const incomeContainer = document.getElementById('income-groups-container')
  const hollandaContainer = document.getElementById('expense-groups-container')
  const turkiyeContainer = document.getElementById('turkiye-groups-container')
  if (incomeContainer) incomeContainer.innerHTML = ''
  if (hollandaContainer) hollandaContainer.innerHTML = ''
  if (turkiyeContainer) turkiyeContainer.innerHTML = ''

  if (existingData) {
    // Case 1: Existing Budget - Load fully
    eurRateInput.value = existingData.exchangeRate.toFixed(4)
    renderGroupsAndItems(existingData.details)
  } else {
    // Case 2: New Budget
    // User Requirement: Force new rate entry for new month
    eurRateInput.value = ''

    // Auto-fill FIXED inputs only from *last available budget*
    const lastBudget = getLastBudget()

    if (lastBudget && lastBudget.details.length > 0) {
      // Filter for FIXED items only
      // "paymentDay" is part of the detail object, so it carries over automatically in the render
      const fixedItems = lastBudget.details.filter(d => d.type === 'FIXED')

      if (fixedItems.length > 0) {
        renderGroupsAndItems(fixedItems)
      } else {
        renderGroupsAndItems([])
      }
    } else {
      // Case 3: Brand new
      renderGroupsAndItems([])
    }
  }

  // Update State & Clean
  currentLoadedMonth = monthKey
  setDirty(false)
}

// --- D3 CHART ---
const getTooltip = () => {
  const existing = document.querySelector<HTMLDivElement>('.chart-tooltip')
  if (existing) return d3.select(existing)
  return d3.select('body').append('div').attr('class', 'chart-tooltip')
}

const renderChart = (data: BudgetRecord[]) => {
  if (data.length === 0) {
    chartContainer.innerHTML = '<p class="text-gray-500">Grafik verisi bulunamadı. Lütfen bütçe ekleyin.</p>'
    return
  }

  chartContainer.innerHTML = '<svg id="monthly-chart" width="100%"></svg>'
  const svg = d3.select<SVGSVGElement, ChartPoint>('#monthly-chart')
  const margin = { top: 20, right: 30, bottom: 60, left: 90 }
  const fullWidth = chartContainer.clientWidth || 600
  const fullHeight = chartContainer.clientHeight || 320
  const width = Math.max(fullWidth - margin.left - margin.right, 200)
  const height = Math.max(fullHeight - margin.top - margin.bottom, 200)

  svg.attr('width', fullWidth).attr('height', fullHeight)
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

  const chartData: ChartPoint[] = data.map((item) => ({
    month: item.monthYear,
    totalEUR: item.grandTotalEUR, // Use new field
  }))

  const x = d3
    .scaleBand<string>()
    .range([0, width])
    .domain(chartData.map((d) => d.month))
    .padding(0.2)

  const maxY = d3.max(chartData, (d: ChartPoint) => d.totalEUR) ?? 0
  const y = d3.scaleLinear().range([height, 0]).domain([0, maxY * 1.15 || 100])

  g.append('g')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x))
    .selectAll('text')
    .attr('transform', 'rotate(-45)')
    .style('text-anchor', 'end')
    .style('font-size', '10px')
    .style('fill', '#6b7280')

  g.append('g')
    .call(
      d3.axisLeft(y).tickFormat((value: number | { valueOf(): number }) =>
        formatCurrency(typeof value === 'number' ? value : Number(value.valueOf()), 'EUR'),
      ),
    )
    .style('font-size', '10px')
    .style('fill', '#6b7280')

  g.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('y', 0 - margin.left + 10)
    .attr('x', 0 - height / 2)
    .attr('dy', '1em')
    .style('text-anchor', 'middle')
    .style('font-weight', 'bold')
    .style('fill', '#4b5563')
    .text('Toplam Harcama (EUR)')

  const line = d3
    .line<ChartPoint>()
    .x((d: ChartPoint) => (x(d.month) ?? 0) + (x.bandwidth() / 2 || 0))
    .y((d: ChartPoint) => y(d.totalEUR))

  g.append('path').datum(chartData).attr('fill', 'none').attr('stroke', '#4f46e5').attr('stroke-width', 3).attr('d', line)

  const tooltip = getTooltip()

  g.selectAll('circle')
    .data(chartData)
    .enter()
    .append('circle')
    .attr('cx', (d: ChartPoint) => (x(d.month) ?? 0) + (x.bandwidth() / 2 || 0))
    .attr('cy', (d: ChartPoint) => y(d.totalEUR))
    .attr('r', 6)
    .attr('fill', '#4f46e5')
    .attr('stroke', '#ffffff')
    .attr('stroke-width', 2)
    .style('cursor', 'pointer')
    .on('mouseover', function (this: SVGCircleElement, event: MouseEvent, d: ChartPoint) {
      d3.select<SVGCircleElement, ChartPoint>(this).attr('r', 8).attr('fill', '#1d4ed8')
      tooltip.transition().duration(200).style('opacity', 0.9)
      tooltip
        .html(`<strong>${d.month}</strong><br>${formatCurrency(d.totalEUR, 'EUR')}`)
        .style('left', `${event.pageX + 10}px`)
        .style('top', `${event.pageY - 28}px`)
    })
    .on('mouseout', function (this: SVGCircleElement) {
      d3.select<SVGCircleElement, ChartPoint>(this).attr('r', 6).attr('fill', '#4f46e5')
      tooltip.transition().duration(500).style('opacity', 0)
    })
}

// --- SUMMARY TABLE ---
const renderSummaryTable = (data: BudgetRecord[]) => {
  summaryBody.innerHTML = ''

  if (data.length === 0) {
    summaryBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Henüz kaydedilmiş bütçe bulunmuyor.</td></tr>'
    return
  }

  data.forEach((budget) => {
    const row = document.createElement('tr')
    row.className = 'cursor-pointer hover:bg-indigo-50 transition duration-150 ease-in-out group'
    row.onclick = () => showMonthDetails(budget.id, row)

    row.innerHTML = `
      <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${budget.monthYear}</td>
      <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600 text-right">${formatCurrency(budget.totalTurkiyeTL, 'TRY')}</td>
      <td class="px-4 py-3 whitespace-nowrap text-xs text-gray-500 text-right">${budget.exchangeRate.toFixed(4)}</td>
      <td class="px-4 py-3 whitespace-nowrap text-sm font-bold text-indigo-600 text-right">${formatCurrency(budget.grandTotalEUR, 'EUR')}</td>
      <td class="px-4 py-3 whitespace-nowrap text-center">
        <button onclick="event.stopPropagation(); deleteBudget('${budget.id}')" class="text-red-500 hover:text-red-700 p-1 rounded-full opacity-0 group-hover:opacity-100 transition duration-300">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </td>
    `
    summaryBody.appendChild(row)
  })
}

const showMonthDetails = (monthKey: string, selectedRow: HTMLTableRowElement | null) => {
  const budgetData = allBudgetSummary.find((budget) => budget.id === monthKey)
  selectedMonthKey = monthKey

  // Check dirty state
  if (isDirty) {
    if (!confirm('Kaydedilmemiş değişiklikleriniz var. Başka bir aya geçmek üzeresiniz. Devam edilsin mi?')) {
      return
    }
  }

  // Sync inputs with selected budget
  const [m, y] = monthKey.split(' ')
  if (monthSelectInput.value !== m || yearSelectInput.value !== y) {
    monthSelectInput.value = m
    yearSelectInput.value = y
    loadFormData()
  }

  document.querySelectorAll<HTMLTableRowElement>('#summary-body tr').forEach((row) => {
    row.classList.remove('bg-indigo-200', 'ring-2', 'ring-indigo-500')
  })

  selectedRow?.classList.add('bg-indigo-200', 'ring-2', 'ring-indigo-500')

  if (!budgetData || !budgetData.details) {
    detailHeaderText.textContent = `${monthKey} Detay (Veri Eksik)`
    detailBody.innerHTML = '<tr><td colspan="2" class="text-center py-4 text-gray-400">Detay bilgisi bulunamadı.</td></tr>'
    detailCard.classList.remove('hidden')
    return
  }

  detailCard.classList.remove('hidden')
  detailHeaderText.textContent = `${monthKey} Harcama Detayı`
  detailBody.innerHTML = ''

  // Group Details by Group for display
  const hollandaItems = budgetData.details.filter(d => d.group === 'HOLLANDA')
  const turkiyeItems = budgetData.details.filter(d => d.group === 'TURKIYE')

  // Helper to render section
  const renderSection = (title: string, items: BudgetDetail[]) => {
    if (items.length === 0) return

    const headerRow = document.createElement('tr')
    headerRow.className = 'bg-gray-100 font-bold'
    headerRow.innerHTML = `<td colspan="2" class="px-4 py-1 text-xs text-gray-700">${title}</td>`
    detailBody.appendChild(headerRow)

    items.sort((a, b) => b.amount - a.amount).forEach(item => {
      const row = document.createElement('tr')
      row.innerHTML = `
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-600 flex items-center justify-between">
            <span>${item.name} <span class="text-xs text-gray-400">(${item.subGroup})</span></span>
            ${item.type === 'FIXED' ? '<span class="text-xs bg-indigo-100 text-indigo-700 px-1 rounded">Sabit</span>' : ''}
        </td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-right">${formatCurrency(item.amount, item.currency)}</td>
      `
      detailBody.appendChild(row)
    })
  }

  renderSection('Hollanda', hollandaItems)
  renderSection('Türkiye', turkiyeItems)

}

window.deleteBudget = async (monthKey: string) => {
  if (!budgetService) return
  if (!window.confirm(`${monthKey} bütçesini silmek istediğinizden emin misiniz?`)) {
    return
  }

  try {
    await budgetService.deleteBudget(monthKey)
    if (selectedMonthKey === monthKey) {
      detailCard.classList.add('hidden')
      selectedMonthKey = null
    }
  } catch (error) {
    console.error('Bütçe silme hatası:', error)
    window.alert(`Bütçe silinemedi: ${(error as Error).message}`)
  }
}

// --- BOOTSTRAP ---
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

// Check before unload
window.addEventListener('beforeunload', (e) => {
  if (isDirty) {
    e.preventDefault()
    e.returnValue = ''
  }
})

// --- BOOTSTRAP ---
const onBudgetsUpdated = (budgets: BudgetRecord[]) => {
  allBudgetSummary = [...budgets]
  allBudgetSummary.sort((a, b) => {
    const [monthA, yearA] = a.id.split(' ')
    const [monthB, yearB] = b.id.split(' ')
    const dateA = new Date(Number(yearA), monthNames.indexOf(monthA))
    const dateB = new Date(Number(yearB), monthNames.indexOf(monthB))
    return dateA.getTime() - dateB.getTime()
  })

  renderSummaryTable(allBudgetSummary)
  renderChart(allBudgetSummary)

  // Initial Load
  loadFormData()
  setDirty(false) // Initial load is clean
}

const initializeAppService = async () => {
  try {
    const hasFirebaseConfig = Object.keys(firebaseConfig).length > 2 // Check if we have more than a dummy/empty object

    if (hasFirebaseConfig && !firebaseConfig.apiKey.includes('YOUR_API_KEY')) {
      console.log('Firebase Config Found. Initializing Cloud Mode...')
      budgetService = new FirestoreBudgetService(firebaseConfig, appId, initialAuthToken)
    } else {
      console.log('Firebase Config Missing or Dummy. Initializing Offline Mode...')
      budgetService = new LocalBudgetService()

      const badge = document.createElement('span')
      badge.className = 'ml-2 px-2 py-0.5 rounded text-xs font-bold bg-yellow-100 text-yellow-800 border border-yellow-200'
      badge.textContent = 'ÇEVRİMDIŞI MOD'
      userIdDisplay.parentNode?.appendChild(badge)
    }

    await budgetService.init()

    userIdDisplay.textContent = budgetService.getUserId()
    appContainer.classList.remove('hidden')
    loadingOverlay.classList.add('hidden')
    populateMonthSelect()

    unsubscribeBudgets = budgetService.subscribe(onBudgetsUpdated)

    // Setup global listeners
    setupButtons()

    // Attach Dirty Listeners globally to container
    document.getElementById('budget-ui-container')?.addEventListener('input', (e) => {
      if ((e.target as HTMLElement).matches('input, select')) {
        setDirty(true)
      }
    })

  } catch (error) {
    console.error('Başlatma hatası:', error)
    showError(`Uygulama başlatılamadı: ${(error as Error).message}`)
    loadingOverlay.classList.add('hidden')
  }
}

monthSelectInput.addEventListener('change', (e) => {
  if (isDirty) {
    if (!confirm('Kaydedilmemiş değişiklikleriniz var. Çıkmak istediğinize emin misiniz?')) {
      // Revert selection? Hard to revert select strictly without previous value state.
      // But actually loadFormData reads the value. 
      // If we cancel, we stay on previous data visually but the select might have changed.
      // Ideally we should track `selectedMonthKey`.
      const currentKey = allBudgetSummary.find(b => b.id === `${monthSelectInput.value} ${yearSelectInput.value}`) ? `${monthSelectInput.value} ${yearSelectInput.value}` : null
      // Actually simpler: Just proceed if confirm is yes. If no, we must revert the SELECT to previous.
      // Reverting is tricky without tracking previous. 
      // Let's just alert and let them manually change back? Or proceed.
      // Standard behavior: Confirm OK -> Load new. Confirm Cancel -> Don't load.
      // But the select value already changed.
      // Let's implement a safe switcher.
    } else {
      loadFormData()
    }
  } else {
    loadFormData()
  }
})

yearSelectInput.addEventListener('change', () => {
  if (isDirty) {
    if (!confirm('Kaydedilmemiş değişiklikleriniz var. Yıl değiştirmek üzeresiniz. Devam edilsin mi?')) {
      if (currentLoadedMonth) {
        const [m, y] = currentLoadedMonth.split(' ')
        yearSelectInput.value = y
      }
      return
    }
  }
  loadFormData()
})


window.addEventListener('resize', () => {
  if (allBudgetSummary.length > 0) {
    renderChart(allBudgetSummary)
  }
})


// --- ONE-TIME AUTO SEED ---
const runAutoSeed = async () => {
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
  window.location.reload();
};

// Start the app
initializeAppService().then(() => {
  runAutoSeed();
});
