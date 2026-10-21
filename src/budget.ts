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

const toEUR = (d: BudgetDetail, eur: number, usd: number) => {
  if (d.currency === 'EUR') return d.amount
  if (!eur) return 0
  return d.currency === 'TRY' ? d.amount / eur : (d.amount * usd) / eur
}

const toTRY = (d: BudgetDetail, eur: number, usd: number) =>
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
  })

// Ödeme gününe göre (günsüzler sonda), sonra ada göre.
export const byDay = (a: BudgetDetail, b: BudgetDetail) =>
  (a.paymentDay ?? 99) - (b.paymentDay ?? 99) || a.name.localeCompare(b.name, 'tr')
