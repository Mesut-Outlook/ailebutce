import './style.css'
import { initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, type Auth } from 'firebase/auth'
import { collection, deleteDoc, doc, initializeFirestore, onSnapshot, setDoc, type Firestore } from 'firebase/firestore'
import {
  byDay, categoryTotals, MONTHS, monthFrom, monthIndex, monthKey, newId, parseAmount, parseMonthKey, shiftMonth, totals, withStoredTotals,
  yearReport, type BudgetDetail, type BudgetRecord, type Currency, type ExpenseType, type GroupType,
} from './budget.ts'

// --- VERİ SERVİSLERİ ---------------------------------------------------------

interface BudgetService {
  init(): Promise<void>
  saveBudget(budget: BudgetRecord): Promise<void>
  deleteBudget(id: string): Promise<void>
  subscribe(callback: (budgets: BudgetRecord[]) => void): void
  getUserId(): string | null
}

// Çok eski (tek dövizli) kayıtları yeni yapıya çevirir; Firestore'da hâlâ böyle doküman olabilir.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const migrateLegacyData = (legacy: any): BudgetRecord => withStoredTotals({
  id: legacy.id,
  monthYear: legacy.id,
  exchangeRate: legacy.exchangeRate || 0,
  usdRate: 0,
  totalTurkiyeTL: 0, totalHollandaEUR: 0, totalIncomeEUR: 0, totalExpenseEUR: 0, transferAmountEUR: 0, grandTotalEUR: 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: (legacy.details || []).map((d: any, i: number) => ({
    id: `legacy-${i}`, name: d.name, amount: d.amountTL, currency: 'TRY', type: 'VARIABLE',
    section: 'EXPENSE', group: 'TURKIYE', subGroup: 'Genel',
  })),
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const normalize = (raw: any): BudgetRecord => (raw.totalTurkiyeTL === undefined ? migrateLegacyData(raw) : raw)

// Yerel geliştirme: vite.config.ts'teki /api/db üzerinden db.json (yalnızca `npm run dev`).
class FileBudgetService implements BudgetService {
  private cache: BudgetRecord[] = []
  private listener: (b: BudgetRecord[]) => void = () => {}

  async init() {
    const res = await fetch('/api/db')
    if (!res.ok) throw new Error(`/api/db ${res.status}`)
    this.cache = (await res.json()).map(normalize)
  }
  getUserId() { return null }
  subscribe(cb: (b: BudgetRecord[]) => void) { this.listener = cb; cb(this.cache) }

  private async write(next: BudgetRecord[]) {
    this.cache = next
    this.listener(next)
    const res = await fetch('/api/db', { method: 'POST', body: JSON.stringify(next) })
    if (!res.ok) throw new Error(`db.json yazılamadı (${res.status})`)
  }
  saveBudget(b: BudgetRecord) { return this.write([...this.cache.filter((x) => x.id !== b.id), b]) }
  deleteBudget(id: string) { return this.write(this.cache.filter((x) => x.id !== id)) }
}

// Canlı site: Firestore, yol artifacts/{appId}/users/{uid}/budgets. Koruma firestore.rules'ta.
class FirestoreBudgetService implements BudgetService {
  private db!: Firestore
  auth!: Auth
  private userId: string | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private config: any
  private appId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(config: any, appId: string) { this.config = config; this.appId = appId }

  async init() {
    const app = initializeApp(this.config)
    // paymentDay gibi boş alanlar undefined kalabilir; Firestore aksi hâlde yazmayı reddeder.
    this.db = initializeFirestore(app, { ignoreUndefinedProperties: true })
    this.auth = getAuth(app)
    await new Promise<void>((resolve) => onAuthStateChanged(this.auth, (u) => { this.userId = u?.uid ?? null; resolve() }))
  }
  async login(email: string, pass: string) {
    const cred = await signInWithEmailAndPassword(this.auth, email, pass)
    this.userId = cred.user.uid
  }
  logout() { return signOut(this.auth) }
  getUserId() { return this.userId }

  private path() { return `artifacts/${this.appId}/users/${this.userId}/budgets` }
  saveBudget(b: BudgetRecord) { return setDoc(doc(this.db, this.path(), b.id), b) }
  deleteBudget(id: string) { return deleteDoc(doc(this.db, this.path(), id)) }
  subscribe(cb: (b: BudgetRecord[]) => void) {
    onSnapshot(collection(this.db, this.path()),
      (snap) => cb(snap.docs.map((d) => normalize({ ...d.data(), id: d.id }))),
      (err) => toast('Veriler okunamadı: ' + err.message))
  }
}

const firebaseConfig = (() => {
  try { return JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG || '{}') } catch { return {} }
})()
const service: BudgetService = firebaseConfig.apiKey
  ? new FirestoreBudgetService(firebaseConfig, import.meta.env.VITE_APP_ID || 'default-app-id')
  : new FileBudgetService()

// --- DURUM ---------------------------------------------------------------------

const now = new Date()
const todayKey = monthKey(now.getMonth(), now.getFullYear())
let budgets: BudgetRecord[] = []
let tab: 'month' | 'history' = 'month'
let cursor = todayKey
let historyYear = now.getFullYear()

const cur = () => budgets.find((b) => b.id === cursor)

const save = async (b: BudgetRecord) => {
  try { await service.saveBudget(withStoredTotals(b)) } catch (e) { toast('Kaydedilemedi: ' + (e as Error).message) }
}

const updateItem = (id: string, patch: Partial<BudgetDetail> | null) => {
  const b = cur()
  if (!b) return
  const details = patch === null
    ? b.details.filter((d) => d.id !== id)
    : b.details.map((d) => (d.id === id ? { ...d, ...patch } : d))
  return save({ ...b, details })
}

const fetchRates = async () => {
  try {
    const [e, u] = await Promise.all(['EUR', 'USD'].map((base) =>
      fetch(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=TRY`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))))
    return { eur: e.rates.TRY as number, usd: u.rates.TRY as number, date: e.date as string }
  } catch {
    return null
  }
}

// --- BİÇİMLEME ----------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const fmtCache = new Map<string, Intl.NumberFormat>()
const money = (n: number, c: Currency, digits = 2) => {
  const key = c + digits
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.NumberFormat('tr-TR', { style: 'currency', currency: c, minimumFractionDigits: 0, maximumFractionDigits: digits }))
  return fmtCache.get(key)!.format(Number.isFinite(n) ? n : 0)
}
const num = (n: number) => (n ? n.toLocaleString('tr-TR', { maximumFractionDigits: 4, useGrouping: false }) : '')
const monthName = (key: string) => MONTHS[parseMonthKey(key).m]

const toast = (msg: string) => {
  const el = $('toast')
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(Number(el.dataset.t))
  el.dataset.t = String(setTimeout(() => el.classList.remove('show'), 3500))
}

const icon = {
  prev: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
}
const svg = (name: keyof typeof icon) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon[name]}</svg>`

// --- EKRANLAR ------------------------------------------------------------------

const GROUPS: { key: GroupType; title: string; cur: Currency }[] = [
  { key: 'TURKIYE', title: 'Türkiye ödemeleri', cur: 'TRY' },
  { key: 'HOLLANDA', title: 'Hollanda ödemeleri', cur: 'EUR' },
  { key: 'INCOME_ENTRIES', title: 'Gelirler', cur: 'EUR' },
]
const TYPE_LABEL: Record<ExpenseType, string> = { FIXED: 'Her ay aynı', VARIABLE: 'Her ay, tutar değişir', ONCE: 'Sadece bu ay' }

const render = () => {
  const b = cur()
  $('app').dataset.tab = tab
  $('top').innerHTML = tab === 'month'
    ? `<button class="icon-btn" data-act="shift" data-d="-1" aria-label="Önceki ay">${svg('prev')}</button>
       <h1><span>${monthName(cursor)}</span> ${parseMonthKey(cursor).y}</h1>
       <button class="icon-btn" data-act="shift" data-d="1" aria-label="Sonraki ay">${svg('next')}</button>
       <button class="icon-btn end" data-act="settings" aria-label="Ayarlar">${svg('gear')}</button>`
    : `<button class="icon-btn" data-act="year-shift" data-d="-1" aria-label="Önceki yıl">${svg('prev')}</button>
       <h1><span>${historyYear}</span> Yılı</h1>
       <button class="icon-btn" data-act="year-shift" data-d="1" aria-label="Sonraki yıl">${svg('next')}</button>
       <button class="icon-btn end" data-act="settings" aria-label="Ayarlar">${svg('gear')}</button>`
  $('view').innerHTML = tab === 'history' ? historyView() : b ? monthView(b) : emptyMonthView()
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach((t) => t.setAttribute('aria-current', String(t.dataset.tab === tab)))
}

// Büyük tutarın kuruş kısmı küçük yazılır: dekont hissi + okunurluk.
const bigMoney = (n: number, c: Currency) => {
  const s = money(n, c)
  const i = s.lastIndexOf(',')
  return i < 0 ? esc(s) : `${esc(s.slice(0, i))}<small>${esc(s.slice(i))}</small>`
}

const monthView = (b: BudgetRecord) => {
  const t = totals(b)
  const spent = t.nlEUR + t.trEUR
  const scale = Math.max(t.incomeEUR, spent) || 1
  const pct = (n: number) => `${((Math.max(0, n) / scale) * 100).toFixed(1)}%`
  const balanceNote = b.trBalanceTRY ? ` Hesapta duran ${money(b.trBalanceTRY, 'TRY', 0)} düşüldü.` : ''

  return `
  <section class="slip ${b.transferSent ? 'sent' : ''}" aria-label="Türkiye'ye gönderilecek">
    <div class="slip-head">
      <span>${b.transferSent ? 'Türkiye’ye gönderildi' : 'Türkiye’ye gönderilecek'}</span>
      <button class="rate" data-act="rate">1 € = ${money(b.exchangeRate, 'TRY')}</button>
    </div>
    <p class="slip-amount">${bigMoney(t.sendEUR, 'EUR')}</p>
    <p class="slip-note">${money(t.trTRY, 'TRY', 0)} tutarındaki Türkiye ödemeleri için.${balanceNote}</p>
    <button class="slip-btn" data-act="sent">${b.transferSent ? 'Gönderilmedi olarak geri al' : 'Gönderdim olarak işaretle'}</button>
  </section>

  <section class="overview" aria-label="Ay özeti">
    <div class="bar" role="img" aria-label="Gelirin dağılımı">
      <i class="nl" style="width:${pct(t.nlEUR)}"></i><i class="tr" style="width:${pct(t.trEUR)}"></i>
    </div>
    <dl>
      <div><dt><b class="dot nl"></b>Hollanda</dt><dd>${money(t.nlEUR, 'EUR', 0)}</dd></div>
      <div><dt><b class="dot tr"></b>Türkiye</dt><dd>${money(t.trEUR, 'EUR', 0)}</dd></div>
      <div><dt>Gelir</dt><dd>${money(t.incomeEUR, 'EUR', 0)}</dd></div>
      <div class="${t.leftEUR < 0 ? 'neg' : ''}"><dt>Kalan</dt><dd>${money(t.leftEUR, 'EUR', 0)}</dd></div>
    </dl>
  </section>

  ${categoriesView(b)}

  ${GROUPS.map((g) => groupView(b, g)).join('')}
  `
}

const categoriesView = (b: BudgetRecord) => {
  const cats = categoryTotals(b)
  if (!cats.length) return ''
  const t = totals(b)
  const totalSpent = t.nlEUR + t.trEUR
  return `
  <section class="group g-CATS" aria-label="Kategori dağılımı ve bütçe limitleri">
    <header>
      <h2>Kategori dağılımı</h2>
      <span class="total">${money(totalSpent, 'EUR', 0)}</span>
      <span class="progress">Toplam ${cats.length} kategori · limit için dokunun</span>
    </header>
    <ul class="cat-list">
      ${cats.map((c) => `
        <li class="row cat-row">
          <button class="row-main cat-btn" data-act="cat-limit" data-cat="${esc(c.name)}">
            <div class="cat-top">
              <span class="name">${esc(c.name)}</span>
              <span class="amt">${money(c.totalEUR, 'EUR', 0)}</span>
            </div>
            <div class="cat-bar-wrap">
              <span class="cat-bar ${c.isOverLimit ? 'over' : ''}" style="width:${Math.min(100, Math.max(2, c.pct)).toFixed(1)}%"></span>
            </div>
            <div class="cat-bottom">
              <div class="cat-badges">
                ${c.isOverLimit
                  ? `<span class="badge warn">Limit aşıldı (+${money(c.totalEUR - c.limitEUR!, 'EUR', 0)})</span>`
                  : c.limitEUR !== undefined
                    ? `<span class="badge ok">Hedef limit: ${money(c.limitEUR, 'EUR', 0)}</span>`
                    : '<span class="badge hint">Limit belirle</span>'
                }
              </div>
              <span class="cat-pct">%${c.pct.toFixed(1)}</span>
            </div>
          </button>
        </li>
      `).join('')}
    </ul>
  </section>`
}

const groupView = (b: BudgetRecord, g: (typeof GROUPS)[number]) => {
  const items = b.details.filter((d) => (g.key === 'INCOME_ENTRIES' ? d.section === 'INCOME' : d.section !== 'INCOME' && d.group === g.key)).sort(byDay)
  const t = totals({ ...b, details: items, trBalanceTRY: 0 })
  const total = g.key === 'TURKIYE' ? money(t.trTRY, 'TRY', 0) : money(g.key === 'HOLLANDA' ? t.nlEUR : t.incomeEUR, 'EUR', 0)
  const paid = items.filter((d) => d.paid).length
  const doneWord = g.key === 'INCOME_ENTRIES' ? 'geldi' : 'ödendi'
  return `
  <section class="group g-${g.key}">
    <header>
      <h2>${g.title}</h2>
      <span class="total">${total}</span>
      ${items.length ? `<span class="progress">${paid}/${items.length} ${doneWord}</span>` : ''}
    </header>
    ${items.length ? `<ul>${items.map((d) => rowView(b, d)).join('')}</ul>` : ''}
    <button class="add-row" data-act="add" data-group="${g.key}">${svg('plus')} ${g.key === 'INCOME_ENTRIES' ? 'Gelir ekle' : 'Ödeme ekle'}</button>
  </section>`
}

const rowView = (b: BudgetRecord, d: BudgetDetail) => {
  const isNow = cursor === todayKey
  const late = isNow && !d.paid && d.paymentDay !== undefined && d.paymentDay < now.getDate()
  const soon = isNow && !d.paid && d.paymentDay !== undefined && !late && d.paymentDay - now.getDate() <= 3
  const eurHint = d.group === 'TURKIYE' && d.currency !== 'EUR' && b.exchangeRate
    ? `<small>${money(d.currency === 'TRY' ? d.amount / b.exchangeRate : (d.amount * b.usdRate) / b.exchangeRate, 'EUR', 0)}</small>`
    : ''
  const tag = d.type === 'VARIABLE' ? '<em class="tag">değişken</em>' : d.type === 'ONCE' ? '<em class="tag">bu ay</em>' : ''
  const state = late ? 'late' : soon ? 'soon' : ''
  return `
  <li class="row ${d.paid ? 'paid' : ''} ${state}">
    <button class="row-main" data-act="edit" data-id="${d.id}">
      <span class="day" title="${late ? 'Günü geçti' : soon ? 'Yaklaşıyor' : 'Ödeme günü'}">${d.paymentDay ?? '–'}</span>
      <span class="name">${esc(d.name)}<span class="meta">${esc(d.subGroup || '')}${tag}</span></span>
      <span class="amt">${money(d.amount, d.currency)}${eurHint}</span>
    </button>
    <button class="tick" data-act="toggle" data-id="${d.id}" aria-pressed="${!!d.paid}" aria-label="${esc(d.name)} ${d.section === 'INCOME' ? 'geldi' : 'ödendi'}">${svg('check')}</button>
  </li>`
}

const sourceFor = (key: string) =>
  [...budgets].filter((b) => monthIndex(b.id) < monthIndex(key)).sort((a, b) => monthIndex(b.id) - monthIndex(a.id))[0]
  ?? [...budgets].sort((a, b) => monthIndex(b.id) - monthIndex(a.id))[0]

const emptyMonthView = () => {
  const src = sourceFor(cursor)
  return `
  <section class="empty">
    <h2>${esc(cursor)} henüz açılmadı</h2>
    ${src
      ? `<p>${esc(src.id)} ayındaki kalemler kopyalanır. Tek seferlik olanlar alınmaz, hepsi “ödenmedi” olarak başlar, kur bugünkü kurla güncellenir.</p>
         <button class="primary" data-act="create">${esc(src.id)} ayından başlat</button>`
      : `<p>İlk ayını oluştur, sonra ödemelerini ekle. Sonraki aylar bundan kopyalanır.</p>
         <button class="primary" data-act="create">Boş ay başlat</button>`}
  </section>`
}

const historyView = () => {
  const rep = yearReport(historyYear, budgets)
  const activeCount = rep.rows.filter((r) => r.record).length

  return `
  <section class="year-summary" aria-label="${historyYear} yılı özeti">
    <div class="year-cards">
      <div class="card">
        <span class="card-label">Gelir</span>
        <strong class="card-val">${money(rep.totalIncomeEUR, 'EUR', 0)}</strong>
      </div>
      <div class="card">
        <span class="card-label">Hollanda</span>
        <strong class="card-val">${money(rep.totalNlEUR, 'EUR', 0)}</strong>
      </div>
      <div class="card">
        <span class="card-label">Türkiye</span>
        <strong class="card-val tr-text">${money(rep.totalTrEUR, 'EUR', 0)}</strong>
      </div>
      <div class="card">
        <span class="card-label">Kalan</span>
        <strong class="card-val ${rep.totalLeftEUR < 0 ? 'neg' : ''}">${money(rep.totalLeftEUR, 'EUR', 0)}</strong>
      </div>
    </div>
    <div class="year-foot">
      <span>Türkiye’ye gönderilen: <b>${money(rep.totalSendEUR, 'EUR', 0)}</b></span>
      <span>${activeCount}/12 ay kayıtlı</span>
    </div>
  </section>

  <section class="group year-table-sec" aria-label="${historyYear} aylık karşılaştırma">
    <header>
      <h2>Aylık Karşılaştırma</h2>
      <span class="total">${money(rep.totalExpenseEUR, 'EUR', 0)}</span>
      <span class="progress">Toplam yıllık harcama</span>
    </header>
    <ul class="year-table">
      ${rep.rows.map((r) => {
        if (!r.record || !r.totals) {
          return `
          <li class="row year-row empty-row">
            <button class="row-main hist-row-btn" data-act="open" data-key="${esc(r.key)}" aria-label="${r.key} ayını aç">
              <span class="hist-month">${r.monthName}</span>
              <span class="empty-bar-wrap"><span class="empty-bar"></span></span>
              <span class="hist-nums"><span class="empty-text">Kayıt yok</span></span>
            </button>
          </li>`
        }
        const t = r.totals
        const max = rep.maxMonthEUR
        return `
        <li class="row year-row">
          <button class="row-main hist-row-btn" data-act="open" data-key="${esc(r.key)}" aria-label="${r.key} detayını aç">
            <span class="hist-month">${r.monthName}</span>
            <span class="bar" role="img" aria-label="Hollanda ve Türkiye harcaması">
              <i class="nl" style="width:${((t.nlEUR / max) * 100).toFixed(1)}%"></i>
              <i class="tr" style="width:${((t.trEUR / max) * 100).toFixed(1)}%"></i>
            </span>
            <span class="hist-nums">
              <span class="val-main">${money(t.nlEUR + t.trEUR, 'EUR', 0)}</span>
              <span class="val-sub ${t.leftEUR < 0 ? 'neg' : ''}">kalan ${money(t.leftEUR, 'EUR', 0)}</span>
            </span>
          </button>
        </li>`
      }).join('')}
    </ul>
  </section>`
}

const limitSheet = (name: string, limit?: number) => openSheet(`
  <input type="hidden" name="form" value="cat-limit">
  <input type="hidden" name="cat" value="${esc(name)}">
  <h2>${esc(name)} Limiti</h2>
  <p class="hint">Bu kategori için aylık harcama hedefini belirleyin. Limit aşıldığında uyarı rozeti görünür.</p>
  <label class="field"><span>Aylık Hedef Limit (€)</span>
    <input name="limit" inputmode="decimal" value="${limit ? esc(num(limit).replace('.', ',')) : ''}" placeholder="Örn: 500" autocomplete="off" autofocus>
  </label>
  <div class="actions">
    ${limit ? `<button type="button" class="danger" data-act="delete-cat-limit" data-cat="${esc(name)}">Limiti Kaldır</button>` : ''}
    <button type="button" class="ghost" data-act="close">Vazgeç</button>
    <button class="primary">Kaydet</button>
  </div>`)

// --- ALT PENCERELER (native <dialog>) -------------------------------------------

const sheet = () => $<HTMLDialogElement>('sheet')
const openSheet = (html: string) => {
  sheet().innerHTML = `<form class="sheet-body" method="dialog">${html}</form>`
  sheet().showModal()
}

const itemSheet = (d: Partial<BudgetDetail> & { group: GroupType }) => {
  const categories = [...new Set(budgets.flatMap((b) => b.details.map((x) => x.subGroup)).filter(Boolean))]
  const radio = (name: string, value: string, label: string, checked: boolean) =>
    `<label><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}><span>${label}</span></label>`
  openSheet(`
    <input type="hidden" name="form" value="item"><input type="hidden" name="id" value="${d.id ?? ''}">
    <h2>${d.id ? 'Kalemi düzenle' : 'Yeni kalem'}</h2>
    <div class="seg" role="radiogroup" aria-label="Nereye">
      ${radio('group', 'TURKIYE', 'Türkiye', d.group === 'TURKIYE')}${radio('group', 'HOLLANDA', 'Hollanda', d.group === 'HOLLANDA')}${radio('group', 'INCOME_ENTRIES', 'Gelir', d.group === 'INCOME_ENTRIES')}
    </div>
    <label class="field"><span>Ad</span><input name="name" required value="${esc(d.name ?? '')}" placeholder="Kredi kartı, yazlık aidatı…" autocomplete="off"></label>
    <div class="field-row">
      <label class="field grow"><span>Tutar</span><input name="amount" inputmode="decimal" required value="${d.amount ? esc(num(d.amount).replace('.', ',')) : ''}" placeholder="0" autocomplete="off"></label>
      <label class="field cur-field"><span>Para</span><select name="currency">
        ${(['TRY', 'EUR', 'USD'] as Currency[]).map((c) => `<option value="${c}" ${(d.currency ?? (d.group === 'TURKIYE' ? 'TRY' : 'EUR')) === c ? 'selected' : ''}>${{ TRY: '₺ TL', EUR: '€ EUR', USD: '$ USD' }[c]}</option>`).join('')}
      </select></label>
      <label class="field day-field"><span>Gün</span><input name="day" type="number" min="1" max="31" inputmode="numeric" value="${d.paymentDay ?? ''}" placeholder="–"></label>
    </div>
    <fieldset class="field"><legend>Tekrar</legend><div class="choices">
      ${(['FIXED', 'VARIABLE', 'ONCE'] as ExpenseType[]).map((t) => radio('type', t, TYPE_LABEL[t], (d.type ?? 'FIXED') === t)).join('')}
    </div></fieldset>
    <label class="field"><span>Kategori</span><input name="subGroup" list="cats" value="${esc(d.subGroup ?? '')}" placeholder="Kredi, Sigorta, Fatura…" autocomplete="off"></label>
    <datalist id="cats">${categories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="actions">
      ${d.id ? '<button type="button" class="danger" data-act="delete-item">Sil</button>' : ''}
      <button type="button" class="ghost" data-act="close">Vazgeç</button>
      <button class="primary">Kaydet</button>
    </div>`)
}

const rateSheet = (b: BudgetRecord) => openSheet(`
  <input type="hidden" name="form" value="rate">
  <h2>${esc(b.id)} kuru</h2>
  <p class="hint">Bu ayın hesapları bu kurla yapılır. Diğer aylar etkilenmez.</p>
  <div class="field-row">
    <label class="field grow"><span>1 € kaç ₺</span><input name="eur" inputmode="decimal" required value="${num(b.exchangeRate).replace('.', ',')}"></label>
    <label class="field grow"><span>1 $ kaç ₺</span><input name="usd" inputmode="decimal" value="${num(b.usdRate).replace('.', ',')}"></label>
  </div>
  <button type="button" class="ghost wide" data-act="fetch-rate">Güncel kuru getir</button>
  <label class="field"><span>Türkiye hesabında zaten duran para (₺)</span><input name="balance" inputmode="decimal" value="${b.trBalanceTRY ? num(b.trBalanceTRY).replace('.', ',') : ''}" placeholder="0"></label>
  <p class="hint">Bu tutar gönderilecek paradan düşülür.</p>
  <div class="actions"><button type="button" class="ghost" data-act="close">Vazgeç</button><button class="primary">Kaydet</button></div>`)

const settingsSheet = () => {
  const cloud = service instanceof FirestoreBudgetService
  openSheet(`
  <h2>Ayarlar</h2>
  <p class="hint">${cloud ? `Giriş yapılan hesap: ${esc(service.auth.currentUser?.email ?? '')}` : 'Yerel mod: veriler bu bilgisayardaki db.json dosyasında.'}</p>
  <h3>Telefona uygulama olarak ekle</h3>
  <p class="hint">iPhone: Safari’de Paylaş düğmesi, sonra “Ana Ekrana Ekle”. Android: Chrome menüsü, sonra “Uygulamayı yükle”.</p>
  ${cur() ? `<h3>${esc(cursor)}</h3><button type="button" class="danger wide" data-act="delete-month">Bu ayı sil</button>` : ''}
  <div class="actions">
    ${cloud ? '<button type="button" class="ghost" data-act="logout">Çıkış yap</button>' : ''}
    <button type="button" class="primary" data-act="close">Kapat</button>
  </div>`)
}

// --- OLAYLAR -------------------------------------------------------------------

const actions: Record<string, (el: HTMLElement) => void | Promise<void>> = {
  shift: (el) => { cursor = shiftMonth(cursor, Number(el.dataset.d)); render() },
  'year-shift': (el) => { historyYear += Number(el.dataset.d); render() },
  open: (el) => { cursor = el.dataset.key!; tab = 'month'; render(); scrollTo(0, 0) },
  settings: settingsSheet,
  close: () => sheet().close(),
  rate: () => rateSheet(cur()!),
  'cat-limit': (el) => {
    const cat = el.dataset.cat
    if (!cat) return
    const b = cur()
    if (!b) return
    limitSheet(cat, b.categoryLimits?.[cat])
  },
  'delete-cat-limit': (el) => {
    const cat = el.dataset.cat
    const b = cur()
    if (!cat || !b) return
    const limits = { ...(b.categoryLimits || {}) }
    delete limits[cat]
    sheet().close()
    return save({ ...b, categoryLimits: limits })
  },
  add: (el) => itemSheet({ group: (el.dataset.group as GroupType) || 'TURKIYE' }),
  edit: (el) => { const d = cur()?.details.find((x) => x.id === el.dataset.id); if (d) itemSheet({ ...d, group: d.section === 'INCOME' ? 'INCOME_ENTRIES' : d.group }) },
  toggle: (el) => { const d = cur()?.details.find((x) => x.id === el.dataset.id); if (d) return updateItem(d.id, { paid: !d.paid }) },
  sent: () => { const b = cur(); if (b) return save({ ...b, transferSent: !b.transferSent }) },
  create: async (el) => {
    el.setAttribute('disabled', '')
    const r = await fetchRates()
    if (!r) toast('Güncel kur alınamadı, önceki ayın kuru kullanıldı.')
    await save(monthFrom(cursor, sourceFor(cursor), r?.eur ?? 0, r?.usd ?? 0))
  },
  'fetch-rate': async (el) => {
    el.textContent = 'Getiriliyor…'
    const r = await fetchRates()
    el.textContent = 'Güncel kuru getir'
    if (!r) return toast('Kur alınamadı. Elle girebilirsin.')
    const f = sheet().querySelector('form')!
    ;(f.elements.namedItem('eur') as HTMLInputElement).value = r.eur.toFixed(4).replace('.', ',')
    ;(f.elements.namedItem('usd') as HTMLInputElement).value = r.usd.toFixed(4).replace('.', ',')
    toast(`${r.date} tarihli kur getirildi. Kaydetmeyi unutma.`)
  },
  'delete-item': async () => {
    const id = (sheet().querySelector('[name=id]') as HTMLInputElement).value
    if (!confirm('Bu kalem bu aydan silinsin mi?')) return
    sheet().close()
    await updateItem(id, null)
  },
  'delete-month': async () => {
    if (!confirm(`${cursor} tamamen silinsin mi? Bu geri alınamaz.`)) return
    sheet().close()
    try { await service.deleteBudget(cursor) } catch (e) { toast('Silinemedi: ' + (e as Error).message) }
  },
  logout: async () => { await (service as FirestoreBudgetService).logout(); location.reload() },
}

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act], [data-tab]')
  if (!el) return
  if (el.dataset.tab) { tab = el.dataset.tab as typeof tab; render(); scrollTo(0, 0); return }
  Promise.resolve(actions[el.dataset.act!]?.(el)).catch((err) => toast('Hata: ' + (err as Error).message))
})

// Alt pencerenin dışına (arka plana) dokununca kapanır.
sheet().addEventListener('click', (e) => { if (e.target === sheet()) sheet().close() })

sheet().addEventListener('submit', (e) => {
  const f = new FormData(e.target as HTMLFormElement)
  const b = cur()
  if (!b) return
  if (f.get('form') === 'rate') {
    void save({ ...b, exchangeRate: parseAmount(String(f.get('eur'))), usdRate: parseAmount(String(f.get('usd'))), trBalanceTRY: parseAmount(String(f.get('balance'))) })
    return
  }
  if (f.get('form') === 'cat-limit') {
    const cat = String(f.get('cat')).trim()
    const limitVal = parseAmount(String(f.get('limit')))
    const limits = { ...(b.categoryLimits || {}) }
    if (limitVal > 0) {
      limits[cat] = limitVal
    } else {
      delete limits[cat]
    }
    sheet().close()
    void save({ ...b, categoryLimits: limits })
    return
  }
  if (f.get('form') !== 'item') return
  const group = f.get('group') as GroupType
  const day = parseInt(String(f.get('day')))
  const fields: Partial<BudgetDetail> = {
    name: String(f.get('name')).trim(),
    amount: parseAmount(String(f.get('amount'))),
    currency: f.get('currency') as Currency,
    type: f.get('type') as ExpenseType,
    group,
    section: group === 'INCOME_ENTRIES' ? 'INCOME' : 'EXPENSE',
    subGroup: String(f.get('subGroup')).trim(),
    paymentDay: day >= 1 && day <= 31 ? day : undefined,
  }
  const id = String(f.get('id'))
  if (id) void updateItem(id, fields)
  else void save({ ...b, details: [...b.details, { id: newId(), paid: false, ...fields } as BudgetDetail] })
})

// --- BAŞLANGIÇ -----------------------------------------------------------------

const enterApp = () => {
  $('login').hidden = true
  $('app').hidden = false
  service.subscribe((list) => { budgets = list; render() })
  render()
}

const start = async () => {
  try {
    await service.init()
  } catch (e) {
    $('boot').textContent = 'Veriler yüklenemedi: ' + (e as Error).message
    return
  }
  $('boot').hidden = true
  if (!(service instanceof FirestoreBudgetService) || service.getUserId()) return enterApp()

  // Hesap yalnızca Firebase Console'dan açılır; uygulamada kayıt yok (bkz. MEMORY.md güvenlik notu).
  const form = $<HTMLFormElement>('login')
  form.hidden = false
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const f = new FormData(form)
    const btn = form.querySelector('button')!
    btn.disabled = true
    $('login-error').textContent = ''
    try {
      await service.login(String(f.get('email')).trim(), String(f.get('password')))
      enterApp()
    } catch (err) {
      const code = (err as { code?: string }).code
      $('login-error').textContent = code === 'auth/invalid-credential' ? 'E-posta veya şifre hatalı.' : 'Giriş yapılamadı: ' + (err as Error).message
    } finally {
      btn.disabled = false
    }
  })
}

void start()
