// Saf bütçe mantığı: DOM ve Firebase'den bağımsız, budget.test.ts ile test edilir.

export type Currency = 'EUR' | 'TRY' | 'USD'
// FIXED: her ay aynı tutar · VARIABLE: her ay var ama tutar değişir (ör. kredi kartı) · ONCE: sadece bu ay
export type ExpenseType = 'FIXED' | 'VARIABLE' | 'ONCE'
export type SectionType = 'INCOME' | 'EXPENSE'
export type GroupType = 'HOLLANDA' | 'TURKIYE' | 'INCOME_ENTRIES'

export interface BudgetDetail {
  id: string
  name: string
  amount: number
  currency: Currency
  type: ExpenseType
  section: SectionType
  group: GroupType
  subGroup: string
  paymentDay?: number
  color?: string
  paid?: boolean
}

export interface BudgetRecord {
  id: string // "Ekim 2026" — Firestore doc ID ile aynı
  monthYear: string
  exchangeRate: number // EUR/TRY
  usdRate: number // USD/TRY
  // Aşağıdaki toplamlar eski kayıtlarla uyum için saklanır; ekran her zaman details'ten hesaplar.
  totalTurkiyeTL: number
  totalHollandaEUR: number
  totalIncomeEUR: number
  totalExpenseEUR: number
  transferAmountEUR: number
  grandTotalEUR: number
  details: BudgetDetail[]
  trBalanceTRY?: number // Türkiye hesabında zaten duran para; gönderilecekten düşülür
  transferSent?: boolean
  categoryLimits?: Record<string, number> // Kategori bütçe limitleri (EUR)
  importedHashes?: string[] // Ekstre içe aktarma parmak izleri
}

export const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

export const monthKey = (m: number, y: number) => `${MONTHS[m]} ${y}`

export const parseMonthKey = (key: string): { m: number; y: number } => {
  const [name, year] = key.split(' ')
  return { m: MONTHS.indexOf(name), y: parseInt(year) }
}

// Ayları kronolojik sıralamak için tek sayı: 2026*12 + 9
export const monthIndex = (key: string) => {
  const { m, y } = parseMonthKey(key)
  return y * 12 + m
}

export const shiftMonth = (key: string, delta: number) => {
  const i = monthIndex(key) + delta
  return monthKey(i % 12, Math.floor(i / 12))
}

// "1.234,56" / "95,68" / "6.200" / "95.68" → sayı. TR/NL yazımında nokta binlik, virgül ondalıktır;
// virgül yoksa ve nokta tam 3 haneli grupları ayırıyorsa binlik sayılır.
export const parseAmount = (raw: string): number => {
  let s = raw.replace(/[\s€₺$]/g, '')
  if (s.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

export const toEUR = (d: BudgetDetail, eur: number, usd: number) => {
  if (d.currency === 'EUR') return d.amount
  if (!eur) return 0
  return d.currency === 'TRY' ? d.amount / eur : (d.amount * usd) / eur
}

export const toTRY = (d: BudgetDetail, eur: number, usd: number) =>
  d.currency === 'TRY' ? d.amount : d.currency === 'EUR' ? d.amount * eur : d.amount * usd

export interface Totals {
  incomeEUR: number
  nlEUR: number
  trTRY: number // Türkiye ödemelerinin TL karşılığı
  trEUR: number
  sendTRY: number // hesaptaki bakiye düşüldükten sonra
  sendEUR: number
  leftEUR: number // gelir − (Hollanda + Türkiye)
}

export const totals = (b: BudgetRecord): Totals => {
  const eur = b.exchangeRate || 0
  const usd = b.usdRate || 0
  let incomeEUR = 0, nlEUR = 0, trTRY = 0
  for (const d of b.details) {
    if (d.section === 'INCOME') incomeEUR += toEUR(d, eur, usd)
    else if (d.group === 'TURKIYE') trTRY += toTRY(d, eur, usd)
    else nlEUR += toEUR(d, eur, usd)
  }
  const trEUR = eur ? trTRY / eur : 0
  const sendTRY = Math.max(0, trTRY - (b.trBalanceTRY || 0))
  const sendEUR = eur ? sendTRY / eur : 0
  return { incomeEUR, nlEUR, trTRY, trEUR, sendTRY, sendEUR, leftEUR: incomeEUR - nlEUR - trEUR }
}

// Kaydetmeden önce eski alanları doldurur (eski raporlar/araçlar bunları okuyor olabilir).
export const withStoredTotals = (b: BudgetRecord): BudgetRecord => {
  const t = totals(b)
  return {
    ...b,
    monthYear: b.id,
    totalTurkiyeTL: t.trTRY,
    totalHollandaEUR: t.nlEUR,
    totalIncomeEUR: t.incomeEUR,
    totalExpenseEUR: t.nlEUR + t.trEUR,
    transferAmountEUR: t.sendEUR,
    grandTotalEUR: t.nlEUR + t.trEUR,
  }
}

export const newId = () => `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

// Yeni ay: tek seferlikler hariç tüm kalemler kopyalanır, "ödendi" sıfırlanır.
export const monthFrom = (id: string, source: BudgetRecord | undefined, eurRate: number, usdRate: number): BudgetRecord =>
  withStoredTotals({
    id,
    monthYear: id,
    exchangeRate: eurRate || source?.exchangeRate || 0,
    usdRate: usdRate || source?.usdRate || 0,
    totalTurkiyeTL: 0, totalHollandaEUR: 0, totalIncomeEUR: 0, totalExpenseEUR: 0, transferAmountEUR: 0, grandTotalEUR: 0,
    details: (source?.details ?? [])
      .filter((d) => d.type !== 'ONCE')
      .map((d) => ({ ...d, id: newId(), paid: false })),
    trBalanceTRY: 0,
    transferSent: false,
    categoryLimits: source?.categoryLimits ? { ...source.categoryLimits } : undefined,
  })

// Ödeme gününe göre (günsüzler sonda), sonra ada göre.
export const byDay = (a: BudgetDetail, b: BudgetDetail) =>
  (a.paymentDay ?? 99) - (b.paymentDay ?? 99) || a.name.localeCompare(b.name, 'tr')

// --- KATEGORİ VE YILLIK RAPORLAMA ---------------------------------------------

export interface CategorySummary {
  name: string
  totalEUR: number
  pct: number // 0-100 arasında
  limitEUR?: number
  isOverLimit: boolean
  count: number
}

export const categoryTotals = (b: BudgetRecord): CategorySummary[] => {
  const eur = b.exchangeRate || 0
  const usd = b.usdRate || 0
  const map = new Map<string, { totalEUR: number; count: number }>()

  for (const d of b.details) {
    if (d.section === 'INCOME') continue
    const name = d.subGroup?.trim() || 'Diğer'
    const prev = map.get(name) || { totalEUR: 0, count: 0 }
    map.set(name, {
      totalEUR: prev.totalEUR + toEUR(d, eur, usd),
      count: prev.count + 1,
    })
  }

  if (b.categoryLimits) {
    for (const name of Object.keys(b.categoryLimits)) {
      if (!map.has(name) && b.categoryLimits[name] > 0) {
        map.set(name, { totalEUR: 0, count: 0 })
      }
    }
  }

  let totalExpenseEUR = 0
  for (const v of map.values()) {
    totalExpenseEUR += v.totalEUR
  }

  const list: CategorySummary[] = []
  for (const [name, v] of map.entries()) {
    const limitEUR = b.categoryLimits?.[name]
    const isOverLimit = limitEUR !== undefined && limitEUR > 0 && v.totalEUR > limitEUR
    const pct = totalExpenseEUR > 0 ? (v.totalEUR / totalExpenseEUR) * 100 : 0
    list.push({
      name,
      totalEUR: v.totalEUR,
      pct,
      limitEUR,
      isOverLimit,
      count: v.count,
    })
  }

  return list.sort((a, b) => b.totalEUR - a.totalEUR || a.name.localeCompare(b.name, 'tr'))
}

export interface YearMonthRow {
  month: number // 0 - 11
  monthName: string
  key: string
  record?: BudgetRecord
  totals?: Totals
}

export interface YearReport {
  year: number
  rows: YearMonthRow[]
  totalIncomeEUR: number
  totalNlEUR: number
  totalTrEUR: number
  totalSendEUR: number
  totalExpenseEUR: number
  totalLeftEUR: number
  maxMonthEUR: number
}

export const yearReport = (year: number, allBudgets: BudgetRecord[]): YearReport => {
  const map = new Map<string, BudgetRecord>()
  for (const b of allBudgets) {
    map.set(b.id, b)
  }

  const rows: YearMonthRow[] = []
  let totalIncomeEUR = 0
  let totalNlEUR = 0
  let totalTrEUR = 0
  let totalSendEUR = 0
  let totalExpenseEUR = 0
  let maxMonthEUR = 0

  for (let m = 0; m < 12; m++) {
    const key = monthKey(m, year)
    const record = map.get(key)
    const t = record ? totals(record) : undefined
    if (t) {
      totalIncomeEUR += t.incomeEUR
      totalNlEUR += t.nlEUR
      totalTrEUR += t.trEUR
      totalSendEUR += t.sendEUR
      const expense = t.nlEUR + t.trEUR
      totalExpenseEUR += expense
      if (expense > maxMonthEUR) maxMonthEUR = expense
      if (t.incomeEUR > maxMonthEUR) maxMonthEUR = t.incomeEUR
    }
    rows.push({
      month: m,
      monthName: MONTHS[m],
      key,
      record,
      totals: t,
    })
  }

  return {
    year,
    rows,
    totalIncomeEUR,
    totalNlEUR,
    totalTrEUR,
    totalSendEUR,
    totalExpenseEUR,
    totalLeftEUR: totalIncomeEUR - totalExpenseEUR,
    maxMonthEUR: maxMonthEUR || 1,
  }
}
