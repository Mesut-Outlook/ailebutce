# Proje Koordinasyon Belgesi (coordination.md)

Bu belge, **Aile Bütçe Takip Sistemi** projesinde yapay zeka ajanları (Claude, Antigravity) ve geliştiriciler arasındaki görev dağılımı, aktif durum ve koordinasyonu yönetmek için kullanılır.

---

## 📌 Proje Genel Durumu

- **Proje Adı:** Aile Bütçe Takip Sistemi (`ailebutce`)
- **Teknoloji Yığını:** Vite, TypeScript, Tailwind CSS, D3.js, Firebase Firestore
- **Mevcut Aşama:** Geliştirme & İyileştirme Fazı
- **Mimar Yapı:** Single Page Application (SPA) — Ana mantık `src/main.ts` içinde, arayüz `index.html` içinde.

---

## 🎯 Aktif ve Planlanan Görevler (Yol Haritası)

### 🟢 Tamamlanan Çalışmalar
- [x] Dual currency (EUR/TRY/USD) kur çevrim desteği (`Frankfurter API`).
- [x] Çift depolama mimarisi (`FileBudgetService` & `FirestoreBudgetService`).
- [x] Sabit kalem (`type: 'FIXED'`) otomatik kopyalama mantığı.
- [x] D3.js grafik entegrasyonu (Trend, Kategori Dağılımı, Tasarruf Göstergesi).
- [x] Firebase anonim/otomatik giriş ve sessiz veri göçü (`silentCloudMigration`).
- [x] Proje rehberi ve teknik kılavuzlar (`CLAUDE.md`, `PROJECT_DETAILS.md`).
- [x] **KAYDET butonu arızası giderildi** (2026-07-25) — `.expense-item` sınıf çakışması nedeniyle
      `saveCurrentBudget()` sessizce `TypeError` fırlatıyordu. Detay için `MEMORY.md`.
- [x] Üst bardaki "Yeni Ay" (`#create-new-budget-btn`) modalının açılmaması giderildi.

### 🟡 Devam Eden / Sıradaki Görevler
- [ ] **Kod Refaktörü:** `src/main.ts` monolitik yapısının modüler bileşenlere (servisler, UI renderers, kur yöneticisi) bölünmesi.
- [ ] **Mobil Uyum & UX İyileştirmeleri:** Sürükle-bırak (drag-drop) ve grup içi sıralama etkileşimlerinin mobilde optimize edilmesi.
- [ ] **Offline / PWA Desteği:** Yerel depolama esnekliğini artırmak için PWA (Progressive Web App) desteği eklenmesi.
- [ ] **Gelişmiş Raporlama:** Yıllık karşılaştırmalı bütçe özetleri ve kategori bazlı bütçe limiti uyarıları.

---

## 🔄 Ajanlar ve Geliştirici Koordinasyon Kuralları

1. **Tek Kaynak İlkesi (Single Source of Truth):**
   - Kod değişiklikleri yapılırken `CLAUDE.md` ve `MEMORY.md` içinde belirtilen mimari desenlere (`BudgetService`, `window` global handlers vb.) riayet edilecektir.
2. **Değişiklik Günlüğü:**
   - Önemli mimari kararlar veya veri yapısı değişiklikleri `MEMORY.md` dosyasına işlenmelidir.
3. **Build & Lint Doğrulaması:**
   - Her majör değişiklik sonrasında `npm run lint` ve `npm run build` komutları çalıştırılarak tip ve derleme hataları kontrol edilmelidir.
4. **Git İzolasyonu:**
   - `db.json` ve `history/` klasörleri yerel test verileri içerdiği için asla versiyon kontrolüne dâhil edilmemelidir (`.gitignore`).

---

## 📊 Sürüm / Takip Günlüğü

| Tarih | Değişiklik / Not | Sorumlu |
|---|---|---|
| 2026-07-25 | `coordination.md` ve `MEMORY.md` dosyaları oluşturuldu ve güncellendi. | Antigravity AI |
| 2026-07-25 | KAYDET butonu arızası tespit edildi, düzeltildi ve tarayıcıda uçtan uca test edildi. `index.html` hero kutucuğu `expense-item` → `hci-expense`; `saveCurrentBudget()` DOM taraması editör konteynerleriyle kapsamlandırıldı; save click handler'ına `.catch` eklendi; `#create-new-budget-btn` modal `.show` düzeltmesi. `npm run build` başarılı. | Claude (Opus 5) |
