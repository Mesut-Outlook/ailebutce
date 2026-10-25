// Çalıştır: node src/budget.test.ts
import {
  categoryTotals, monthFrom, parseAmount, shiftMonth, totals, yearReport,
  type BudgetDetail, type BudgetRecord,
} from './budget.ts'

const check = (ok: boolean, msg: string) => { if (!ok) throw new Error('FAIL: ' + msg) }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

check(parseAmount('95,68') === 95.68, 'virgüllü ondalık')
check(parseAmount('1.234,56') === 1234.56, 'binlik nokta + virgül')
check(parseAmount('95.68') === 95.68, 'noktalı ondalık')
check(parseAmount('6.200') === 6200, 'virgülsüz binlik nokta')
check(parseAmount('1.250.000') === 1250000, 'çoklu binlik nokta')
check(parseAmount('₺ 4 500') === 4500, 'sembol ve boşluk')
check(parseAmount('') === 0, 'boş')

check(shiftMonth('Aralık 2025', 1) === 'Ocak 2026', 'yıl atlama ileri')
check(shiftMonth('Ocak 2026', -1) === 'Aralık 2025', 'yıl atlama geri')

const item = (p: Partial<BudgetDetail>): BudgetDetail => ({
  id: 'x', name: 'x', amount: 0, currency: 'EUR', type: 'FIXED', section: 'EXPENSE', group: 'HOLLANDA', subGroup: '', ...p,
})
const rec: BudgetRecord = {
  id: 'Ekim 2026', monthYear: 'Ekim 2026', exchangeRate: 50, usdRate: 40,
  totalTurkiyeTL: 0, totalHollandaEUR: 0, totalIncomeEUR: 0, totalExpenseEUR: 0, transferAmountEUR: 0, grandTotalEUR: 0,
  trBalanceTRY: 1000,
  categoryLimits: { 'Krediler': 1300, 'Faturalar': 500 },
  details: [
    item({ name: 'Maaş', amount: 5000, section: 'INCOME', group: 'INCOME_ENTRIES', subGroup: 'Gelir' }),
    item({ name: 'Hypotheek', amount: 1400, subGroup: 'Krediler' }),
    item({ name: 'Kredi kartı', amount: 20000, currency: 'TRY', group: 'TURKIYE', type: 'VARIABLE', paid: true, subGroup: 'Faturalar' }), // 400 EUR
    item({ name: 'Yazlık aidatı', amount: 100, currency: 'USD', group: 'TURKIYE', subGroup: 'Aidat' }), // 4000 TL = 80 EUR
    item({ name: 'Annem', amount: 100, currency: 'EUR', group: 'TURKIYE', subGroup: 'Destek' }), // 100 EUR
    item({ name: 'Tamir', amount: 1000, currency: 'TRY', group: 'TURKIYE', type: 'ONCE', subGroup: 'Diğer' }), // 20 EUR
  ],
}
const t = totals(rec)
check(t.trTRY === 30000, 'TR toplam TL: ' + t.trTRY)
check(t.sendTRY === 29000, 'bakiye düşülür')
check(near(t.sendEUR, 580), 'gönderilecek EUR: ' + t.sendEUR)
check(near(t.leftEUR, 5000 - 1400 - 600), 'kalan: ' + t.leftEUR)
check(totals({ ...rec, trBalanceTRY: 99999 }).sendEUR === 0, 'bakiye fazlaysa 0')

const next = monthFrom('Kasım 2026', rec, 51, 0)
check(next.details.length === 5, 'tek seferlik kopyalanmaz')
check(next.details.every((d) => !d.paid), 'ödendi sıfırlanır')
check(next.exchangeRate === 51 && next.usdRate === 40, 'yeni kur, eksik kur önceki aydan')
check(next.trBalanceTRY === 0 && next.transferSent === false, 'transfer durumu sıfırlanır')
check(next.categoryLimits?.['Krediler'] === 1300 && next.categoryLimits?.['Faturalar'] === 500, 'kategori limitleri kopyalanır')
// Bağımsız kopya olduğunu kontrol et
if (next.categoryLimits) next.categoryLimits['Krediler'] = 999
check(rec.categoryLimits?.['Krediler'] === 1300, 'kategori limitleri derin kopyalanır')

// --- Kategori dağılımı ve limit testleri ---
const cats = categoryTotals(rec)
// Gelir (5000 EUR) hariç toplam gider: 1400 (Krediler) + 400 (Faturalar) + 80 (Aidat) + 100 (Destek) + 20 (Diğer) = 2000 EUR
const totalCatEUR = cats.reduce((sum, c) => sum + c.totalEUR, 0)
check(near(totalCatEUR, 2000), 'toplam kategori gideri 2000 EUR olmalı: ' + totalCatEUR)

const totalPct = cats.reduce((sum, c) => sum + c.pct, 0)
check(near(totalPct, 100), 'kategori yüzdeleri toplamı %100 olmalı: ' + totalPct)

const krediler = cats.find((c) => c.name === 'Krediler')!
check(krediler && krediler.totalEUR === 1400, 'Krediler 1400 EUR')
check(near(krediler.pct, 70), 'Krediler %70 olmalı (1400/2000)')
check(krediler.limitEUR === 1300, 'Krediler limiti 1300')
check(krediler.isOverLimit === true, 'Krediler limit aşımı uyarısı vermeli (1400 > 1300)')

const faturalar = cats.find((c) => c.name === 'Faturalar')!
check(faturalar && faturalar.totalEUR === 400, 'Faturalar 400 EUR')
check(faturalar.limitEUR === 500, 'Faturalar limiti 500')
check(faturalar.isOverLimit === false, 'Faturalar limit aşılmadı (400 <= 500)')

const aidat = cats.find((c) => c.name === 'Aidat')!
check(aidat && aidat.limitEUR === undefined && aidat.isOverLimit === false, 'Limit tanımlı değilse isOverLimit false')

// --- Yıllık rapor testleri ---
const yRep = yearReport(2026, [rec, next])
check(yRep.rows.length === 12, '12 ay satırı olmalı')
check(yRep.rows[9].record !== undefined, 'Ekim (index 9) kaydı var')
check(yRep.rows[10].record !== undefined, 'Kasım (index 10) kaydı var')
check(yRep.rows[0].record === undefined && yRep.rows[0].totals === undefined, 'Ocak (index 0) boş ve hatasız')
check(yRep.totalIncomeEUR > 0, 'Yıllık gelir hesaplandı')
check(yRep.totalExpenseEUR > 0, 'Yıllık gider hesaplandı')

console.log('budget.test.ts: tamam')
