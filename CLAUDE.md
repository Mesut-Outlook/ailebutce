# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proje Yapısı

Tek sayfalık TypeScript uygulaması. Tüm uygulama mantığı `src/main.ts` (~2566 satır) içindedir; `index.html` sayfanın tamamını barındırır.

```
Aile_Butce/
├── src/
│   ├── main.ts        # Tüm uygulama mantığı
│   └── style.css      # Tüm stiller (CSS custom props + Tailwind)
├── index.html         # SPA root; tüm HTML ve modal markup burada
├── vite.config.ts     # Dev server + /api/db yerel API plugin'i
├── scripts/
│   └── sync-to-firebase.mjs  # Yerel db.json'ı manuel Firebase'e yükler
├── db.json            # Yerel mod veri dosyası (git'te yok)
└── history/           # db.json otomatik yedekleri (git'te yok)
```

## Geliştirme Komutları

```bash
npm install
npm run dev      # Dev server: http://127.0.0.1:8080
npm run build    # tsc -b && vite build → dist/
npm run lint     # eslint
npm run preview  # dist/ üzerinden preview
```

## Ortam Değişkenleri (.env)

| Değişken | Açıklama |
|---|---|
| `VITE_APP_ID` | Firebase artifact yolu için uygulama ID'si |
| `VITE_FIREBASE_CONFIG` | Firebase config (JSON string) |
| `VITE_TEST_USER_EMAIL` | Firebase otomatik giriş e-postası |
| `VITE_TEST_USER_PASSWORD` | Firebase otomatik giriş şifresi |
| `VITE_APP_PIN` | Uygulama PIN kilidi (opsiyonel; yoksa PIN ekranı atlanır) |

## Mimari — Servis Katmanı

`BudgetService` arayüzü iki somut sınıf tarafından uygulanır; hangisinin kullanılacağı başlangıçta belirlenir ve sonradan değiştirilemez.

```
BudgetService (interface)
├── FileBudgetService   # VITE_FIREBASE_CONFIG yoksa; /api/db endpoint üzerinden db.json
└── FirestoreBudgetService  # VITE_FIREBASE_CONFIG varsa; Firestore onSnapshot ile real-time
```

`FileBudgetService`: GET /api/db ile okur, POST /api/db ile yazar. Her POST'ta `history/` altına yedek alınır (son 20 tutulur). Vite plugin (`vite.config.ts`) bu endpoint'i sağlar — yalnızca `npm run dev` sırasında çalışır, `dist/` build'lerinde yok.

`FirestoreBudgetService`: `onSnapshot` ile anlık senkronizasyon. Firestore yolu: `artifacts/{APP_ID}/users/{USER_ID}/budgets`. `login()` / `register()` / `logout()` metodları var.

## Veri Yapısı

```typescript
BudgetDetail {
  id: string
  name: string
  amount: number
  currency: 'EUR' | 'TRY' | 'USD'
  type: 'FIXED' | 'VARIABLE'  // FIXED: yeni aya otomatik kopyalanır
  section: 'INCOME' | 'EXPENSE'
  group: 'HOLLANDA' | 'TURKIYE' | 'INCOME_ENTRIES'
  subGroup: string             // Grup adı (örn. "Kredi", "Market")
  color?: string               // Grup rengi (hex)
  paymentDay?: number          // 1-31
}

BudgetRecord {
  id: string              // "Ocak 2026" formatı (aynı zamanda Firestore doc ID)
  monthYear: string
  exchangeRate: number    // EUR/TRY kuru
  usdRate: number         // USD/TRY kuru
  totalTurkiyeTL: number
  totalHollandaEUR: number
  totalIncomeEUR: number
  totalExpenseEUR: number
  transferAmountEUR: number
  grandTotalEUR: number
  details: BudgetDetail[]
}
```

## Önemli Örüntüler

### Sabit Kalem Sistemi
`type === 'FIXED'` olan kalemler yeni ay oluştururken `initNewBudget()` içinde önceki aydan (`getLastBudget()`) kopyalanır. Grup adı ve rengi de korunur.

### Dirty State
Her input değişiminde `setDirty(true)` çağrılır; kaydet butonuna görsel ring eklenir. `window.beforeunload` dirty ise tarayıcıyı uyarır. Sayfa değişimi ya da ay geçişi öncesi otomatik kayıt tetiklenir.

### Döviz Hesaplama
TRY kalemler `amount / eurRate` ile EUR'ya çevrilir. USD kalemler önce TRY'ye (`amount * usdRate`), sonra EUR'ya çevrilir. Her ayın kuru bağımsız kaydedilir. Kur `frankfurter.dev` API'sinden çekilir.

### Window Global Callback'leri
Dinamik DOM içindeki `onclick` handler'ları `window` üzerinden atanır. Yeni DOM-tabanlı event gerektiğinde aynı pattern izle:
```typescript
window.addGroup = (groupType: GroupType) => { ... }
window.removeGroup = (groupId: string) => { ... }
window.addExpenseItem = (groupId: string) => { ... }
window.removeExpenseItem = (itemId: string) => { ... }
window.deleteBudget = async (monthKey: string) => { ... }
window.toggleGroup = (groupId: string) => { ... }
```

### Göç (Migration)
`silentCloudMigration()`: Firebase'e ilk girişte, `localStorage['db_json_migrated_final']` yoksa yerel `db.json`'ı sessizce buluta aktarır. `migrateLegacyData()` eski tek-döviz veri yapısını yeni `BudgetRecord` formatına dönüştürür.

## DOM Yapısı — Sayfalar

| ID | Sayfa |
|---|---|
| `page-landing` | Ana sayfa (ay kartları + hero stats) |
| `page-editor` | Bütçe düzenleme formu |
| `page-reports` | Raporlar (D3 grafikleri) |
| `login-page` | PIN giriş ekranı |
| `loading-overlay` | Başlangıç yükleme maskesi |

## D3 Grafikleri (`page-reports`)

- `renderTrendChartInternal()` — Çizgi grafik: Gelir/Gider/Kalan trend
- `renderCategoryBreakdown()` — Donut: Son ay kategori dağılımı
- `renderSavingsGauge()` — Tasarruf oranı yüzdesi
- `renderFixedVariableReport()` — Sabit/değişken gider bar
- `renderAverageBudgetTable()` — Aylık ortalama top-5 kategori

## Build Detayları

`vite.config.ts` build'de `firebase` ve `d3` paketlerini ayrı chunk'lara böler (500 kB uyarısını geçmemek için). `chunkSizeWarningLimit: 650`. Deploy: GitHub Actions `deploy.yml` → Vercel.

## Dikkat Edilmesi Gerekenler

- `index.html` çok büyük; tüm modal HTML'leri burada. Yeni UI eklerken buraya bakın.
- `main.ts` monolitik yapıda; tüm fonksiyonlar tek dosyada.
- `/api/db` endpoint'i sadece `vite dev` sırasında aktif; production build'lerde bu endpoint yoktur.
- `db.json` ve `history/` git'te yok (`.gitignore`).
- Dev server portu **8080** (`vite.config.ts`).
