# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proje Yapısı

Telefon öncelikli tek sayfalık TypeScript uygulaması (PWA). Amaç: aylık düzenli ödemeleri takip etmek ve Türkiye'ye gönderilecek parayı hesaplamak.

```
ailebutce/
├── src/
│   ├── budget.ts       # Saf hesap mantığı: tipler, totals(), monthFrom(), parseAmount()
│   ├── budget.test.ts  # node src/budget.test.ts
│   ├── main.ts         # Servisler, ekran render'ı, olaylar
│   └── style.css       # Düz CSS, :root token'ları + prefers-color-scheme koyu tema
├── index.html          # Kabuk: giriş formu, #top, #view, alt sekmeler, <dialog id="sheet">
├── public/             # manifest.webmanifest + ikonlar
├── vite.config.ts      # Dev server + /api/db yerel API plugin'i
├── scripts/sync-to-firebase.mjs
├── db.json             # Yerel mod veri dosyası (git'te yok)
└── history/            # db.json otomatik yedekleri (git'te yok)
```

## Geliştirme Komutları

```bash
npm install
npm run dev      # Dev server: http://127.0.0.1:8080/ailebutce/ (kök yol buraya yönlenir)
npm run build    # tsc -b && vite build → dist/
npm run lint     # eslint
node src/budget.test.ts  # hesap mantığı kontrolleri
npm run preview  # dist/ üzerinden preview
```

## Ortam Değişkenleri (.env)

| Değişken | Açıklama |
|---|---|
| `VITE_APP_ID` | Firebase artifact yolu için uygulama ID'si |
| `VITE_FIREBASE_CONFIG` | Firebase config (JSON string) |

## Mimari

`BudgetService` iki sınıfla uygulanır, başlangıçta seçilir:
- `FileBudgetService`: `VITE_FIREBASE_CONFIG` yoksa; `/api/db` üzerinden `db.json` (yalnızca `npm run dev`).
- `FirestoreBudgetService`: `artifacts/{APP_ID}/users/{UID}/budgets`, `onSnapshot` ile canlı. E-posta+şifre girişi; uygulamada kayıt yok. Koruma `firestore.rules`'ta.

Ekran durumu `main.ts`'te üç değişken: `budgets`, `tab` ('month' | 'history'), `cursor` ("Ekim 2026"). Her veri değişiminde `render()` tüm görünümü HTML string'den yeniden kurar; kullanıcı metni daima `esc()`'ten geçer.

**Kaydet butonu yoktur:** her işlem `save()` ile anında yazılır. **Olaylar:** `data-act="..."` öznitelikli öğeler, tek `document` click dinleyicisi ve `actions` nesnesi. Formlar `<dialog id="sheet">` içinde açılır, `submit` dinleyicisi `form` gizli alanına göre ayırır.

## Veri Yapısı

`src/budget.ts`'teki `BudgetDetail` / `BudgetRecord`. Firestore dokümanlarıyla geriye uyumlu; yeni opsiyonel alanlar `paid`, `trBalanceTRY`, `transferSent`. `type`: `FIXED` (her ay aynı), `VARIABLE` (her ay, tutar değişir), `ONCE` (sadece bu ay). `group`: `TURKIYE` | `HOLLANDA` | `INCOME_ENTRIES`.

- **Türkiye'ye gönderilecek** = (Türkiye kalemlerinin TL toplamı − `trBalanceTRY`) / EUR kuru.
- **Yeni ay** (`monthFrom`): önceki aydan `ONCE` dışındaki kalemler kopyalanır, `paid` sıfırlanır, kur Frankfurter'dan çekilir.
- Eski toplam alanları (`totalTurkiyeTL` vb.) `withStoredTotals()` ile kayıtta doldurulur; ekran bunları okumaz.

## Build Detayları

`vite.config.ts` build'de `firebase`'i ayrı chunk'a böler. `chunkSizeWarningLimit: 650`. Deploy: GitHub Actions `deploy.yml` → **GitHub Pages**
(https://mesut-outlook.github.io/ailebutce/).

**`base` ayarı kritik:** Site bir GitHub Pages *project page*'i olduğu için `vite.config.ts`
içinde `base: '/ailebutce/'` olmak zorundadır. `'/'` bırakılırsa build edilen `index.html`
asset'leri kökten ister, hepsi 404 verir ve sayfa JS/CSS'siz açılır (deploy "success"
görünmesine rağmen site tamamen ölüdür).

## Dikkat Edilmesi Gerekenler

- `/api/db` yalnızca `vite dev` sırasında vardır. Telefondan yerel test: `npm run dev -- --host`.
- Firestore `ignoreUndefinedProperties: true` ile başlatılır; boş `paymentDay` başka türlü yazmayı bozar.
- `db.json` ve `history/` git'te yok (`.gitignore`).
- Dev server portu **8080** (`vite.config.ts`).
