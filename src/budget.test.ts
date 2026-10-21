// Çalıştır: node src/budget.test.ts
import { monthFrom, parseAmount, shiftMonth, totals, type BudgetDetail, type BudgetRecord } from './budget.ts'

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
  details: [
    item({ name: 'Maaş', amount: 5000, section: 'INCOME', group: 'INCOME_ENTRIES' }),
    item({ name: 'Hypotheek', amount: 1400 }),
    item({ name: 'Kredi kartı', amount: 20000, currency: 'TRY', group: 'TURKIYE', type: 'VARIABLE', paid: true }),
    item({ name: 'Yazlık aidatı', amount: 100, currency: 'USD', group: 'TURKIYE' }), // 4000 TL
    item({ name: 'Annem', amount: 100, currency: 'EUR', group: 'TURKIYE' }), // 5000 TL
    item({ name: 'Tamir', amount: 1000, currency: 'TRY', group: 'TURKIYE', type: 'ONCE' }),
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

console.log('budget.test.ts: tamam')
