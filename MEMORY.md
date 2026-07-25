# Proje Hafıza Belgesi (MEMORY.md)

Bu belge, **Aile Bütçe Takip Sistemi** projesi hakkındaki uzun vadeli hafızayı, teknik kararları, veri modellerini ve önemli detayları barındırır.

---

## 🧠 Temel Mimari Kararlar ve Hafıza

### 1. Çift Para Birimi ve Kur Yönetimi
- **Temel Para Birimi:** Bütçe hesaplamaları ve genel toplamlar **EUR** cinsinden tutulur.
- **TRY Harcamaları:** `amount / eurRate` formülüyle EUR'ya dönüştürülür.
- **USD Harcamaları:** Önce TRY (`amount * usdRate`), ardından EUR'ya dönüştürülür.
- **Kur Sağlayıcı:** `https://api.frankfurter.dev` üzerinden günlük kurlar çekilir. Her ayın bütçe kaydı kendi kur verisini (`exchangeRate`, `usdRate`) bağımsız saklar.

### 2. Çift Depolama Modeli (`BudgetService`)
- Uygulama başlangıcında `VITE_FIREBASE_CONFIG` kontrol edilir:
  - **Firestore Mode:** `VITE_FIREBASE_CONFIG` mevcutsa `FirestoreBudgetService` aktif olur. Firestore yolu: `artifacts/{APP_ID}/users/{USER_ID}/budgets`. Real-time `onSnapshot` kullanılır.
  - **Local File Mode:** `VITE_FIREBASE_CONFIG` yoksa `FileBudgetService` aktif olur. Vite dev server üzerindeki `/api/db` endpoint'ini kullanarak `db.json` dosyasına okuma/yazma yapar. Her kayıtta `history/` altına otomatik yedek alınır.

### 3. Sabit Kalem (Fixed Expense) Sistemi
- `type === 'FIXED'` olan kalemler (örn. ev kredisi, abonelikler, sigortalar) yeni ay bütçesi oluşturulurken (`initNewBudget()`) önceki aydan otomatik kopyalanır.
- Hollanda rutin sabit giderleri varsayılan referans listesindedir (`FixedExpences.md`).

### 4. DOM & Event Handler Mimarisi
- `index.html` içinde tüm SPA modalları ve sayfa yapısı yer alır.
- Dinamik HTML üretimi esnasında `onclick` çağrıları `window` global objesine bağlı metodlar üzerinden yürütülür (`window.addGroup`, `window.addExpenseItem`, `window.deleteBudget` vb.).

---

## 🗄 Veri Modeli Özeti

```typescript
BudgetDetail {
  id: string;
  name: string;
  amount: number;
  currency: 'EUR' | 'TRY' | 'USD';
  type: 'FIXED' | 'VARIABLE';
  section: 'INCOME' | 'EXPENSE';
  group: 'HOLLANDA' | 'TURKIYE' | 'INCOME_ENTRIES';
  subGroup: string;
  color?: string;
  paymentDay?: number;
}

BudgetRecord {
  id: string;              // "Ocak 2026"
  monthYear: string;
  exchangeRate: number;    // EUR/TRY
  usdRate: number;         // USD/TRY
  totalTurkiyeTL: number;
  totalHollandaEUR: number;
  totalIncomeEUR: number;
  totalExpenseEUR: number;
  transferAmountEUR: number;
  grandTotalEUR: number;
  details: BudgetDetail[];
}
```

---

## 📋 Sabit Gider Referans Verileri (Hollanda)

- **Krediler:** ABN AMRO, Freo
- **Faturalar:** Vodafone, Ziggo, Vattenfall
- **Sigortalar:** Zilveren Kruis, ANWB, ABN AMRO Verzekering, Voogd & Voogd, Reaal
- **Vergiler:** Belastingdienst, Waterschap Amstel Gooi en Vecht

---

## ⚠️ Dikkat Edilmesi Gereken Hususlar & Kısıtlamalar

- `/api/db` endpoint'i **sadece `npm run dev` çalışırken** aktiftir; production build (`dist/`) içinde yoktur.
- `db.json` ve `history/` dosyaları `.gitignore` ile korumaya alınmıştır.
- `src/main.ts` ~2500+ satırlık tek dosyadır; yapılan değişikliklerin event handler'lar ve state güncellemeleri üzerindeki yan etkilerine dikkat edilmelidir.

### 🚨 CSS Sınıf Adı Çakışması — Global DOM Sorgularının Riski (2026-07-25)

`saveCurrentBudget()` kalemleri okurken **global** `document.querySelectorAll('.expense-item')` kullanıyordu.
`index.html` içindeki ana sayfa "Gider" hero kutucuğu da (dekoratif) `expense-item` sınıfını
taşıdığı için sorguya dâhil oluyor, içinde `.expense-name` input'u bulunmadığından
`querySelector(...).value` çağrısı `TypeError` fırlatıyordu.

`saveCurrentBudget` `async` olduğu ve click listener dönen promise'i beklemediği için hata
**unhandled promise rejection** olarak yutuluyordu → KAYDET butonu sessizce hiçbir şey yapmıyordu.

**Kalıcı kurallar:**
1. Bütçe kalemleri **asla** global sorguyla taranmaz. Daima üç editör konteyneri üzerinden
   kapsamlandırılır: `income-groups-container`, `expense-groups-container`, `turkiye-groups-container`.
2. `expense-item` / `income-item` gibi **veri anlamı taşıyan sınıf adları** dekoratif öğelerde
   kullanılmaz. Hero kutucukları `hci-` ön ekini kullanır (`hci-expense`).
3. `async` handler'lar `addEventListener`'a çıplak geçilmez; hata kullanıcıya gösterilmelidir
   (`.catch(...)` → `showAlert`). Aksi hâlde arıza tamamen sessiz kalır.

### 🚨 GitHub Pages `base` Yolu (2026-07-25)

Yayın hedefi **GitHub Pages project page**: `https://mesut-outlook.github.io/ailebutce/`.
`vite.config.ts` içindeki `base` bu yüzden `'/ailebutce/'` olmalıdır.

`base: '/'` iken deploy workflow'u "success" veriyordu ama build edilen `index.html`
asset'leri kökten çağırdığı için (`/assets/index-*.js`) hepsi **404** dönüyor, site
JS ve CSS olmadan tamamen ölü açılıyordu. Dosyalar aslında `/ailebutce/assets/` altında
sağlamdı — sorun sadece referans yoluydu.

> **Not:** Yeşil bir deploy, sitenin çalıştığı anlamına gelmez. Değişiklikten sonra canlı
> URL'deki asset yollarının gerçekten 200 döndüğü kontrol edilmelidir.

Dev tarafında `npm run dev` artık `http://127.0.0.1:8080/ailebutce/` adresinde servis eder;
kök yol otomatik olarak buraya 302 ile yönlenir. `/api/db` middleware'i base'den bağımsız
çalışmaya devam eder.

### 🚨 Modal Görünürlüğü — `hidden` değil `show` (2026-07-25)

`.modal-overlay` varsayılan olarak `display:none`'dır ve **yalnızca `.show` sınıfı** ile açılır.
`classList.remove('hidden')` tek başına modalı görünür yapmaz. Üst bardaki
`#create-new-budget-btn` bu yüzden çalışmıyordu.
