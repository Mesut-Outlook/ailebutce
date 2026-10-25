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
- [x] **GitHub Pages `base` yolu düzeltildi** (2026-07-25) — `base: '/'` yüzünden canlı sitede
      tüm asset'ler 404 veriyor, sayfa JS/CSS'siz açılıyordu. `'/ailebutce/'` yapıldı.

- [x] **Mobil öncelikli yeniden tasarım** (2026-10-22) — dekont tarzı "Türkiye'ye gönder" ekranı, ödendi işaretleri, otomatik kayıt, Geçmiş sekmesi, PWA. Detay: `MEMORY.md`.
- [x] **Gelişmiş Raporlama (Aşama 1)** (2026-10-25) — Yıllık karşılaştırma ve yıl seçici (`yearReport`), kategori dağılımı (`categoryTotals`), kategori bütçe limiti ve uyarı rozeti (`categoryLimits`), `monthFrom` kopyalaması, birim testleri (`budget.test.ts`), `*.csv` gitignore koruması. Sorumlu: Antigravity.

### 🔴 Repo Sahibinin Firebase Console'da Yapması Gerekenler
- [ ] `firestore.rules` içeriğini Firebase Console → Firestore Database → Rules'a yapıştır ve **Publish** et.
- [ ] Authentication → Settings → User actions → **"Enable create (sign-up)" kapat**.
- [ ] Authentication → Users altında kendi hesabının var olduğunu doğrula (yoksa oradan oluştur).

> Bu üç adım yapılmadan veri gerçek anlamda korunmuş olmaz. Kod tarafı hazır.

### 🟡 Devam Eden / Sıradaki Görevler
- [ ] **Ekstre İçe Aktarma (Aşama 2):** ABN AMRO CSV'sini tarayıcıda ayrıştırıp kalemlerle eşleştirme, onaylı "ödendi" işaretleme. **BLOKE:** maskeli örnek CSV bekleniyor (başlık satırı görülmeden ayrıştırıcı yazılmaz). Detay: `docs/gelistirme-plani.md`.
- [ ] **Kredi kartı ekstresi:** Aşama 2 bittikten sonra, kapsamı kullanıcı onayıyla.

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
| 2026-07-25 | Güvenlik: gömülü kimlik bilgisiyle otomatik giriş kaldırıldı, gerçek Firebase e-posta+şifre giriş ekranı eklendi, `register()` kaldırıldı, mock seed yalnızca yerel moda kısıtlandı, `firestore.rules` eklendi. | Claude (Opus 5) |
| 2026-07-25 | GitHub Pages `base` yolu `'/'` → `'/ailebutce/'` düzeltildi; canlı sitedeki asset 404'leri giderildi. `CLAUDE.md` deploy hedefi Vercel yerine GitHub Pages olarak güncellendi. | Claude (Opus 5) |
| 2026-07-25 | KAYDET butonu arızası tespit edildi, düzeltildi ve tarayıcıda uçtan uca test edildi. `index.html` hero kutucuğu `expense-item` → `hci-expense`; `saveCurrentBudget()` DOM taraması editör konteynerleriyle kapsamlandırıldı; save click handler'ına `.catch` eklendi; `#create-new-budget-btn` modal `.show` düzeltmesi. `npm run build` başarılı. | Claude (Opus 5) |
| 2026-10-22 | Mobil öncelikli yeniden tasarım: `main.ts` baştan yazıldı (~470 satır), hesap mantığı `budget.ts`'e ayrıldı ve testlendi, Tailwind + D3 kaldırıldı, anında kayıt, ödendi işaretleri, Türkiye hesabı bakiyesi, PWA manifest. Veri yapısı geriye uyumlu. | Claude (Opus 5.5) |
| 2026-10-25 | Sonraki geliştirmelerin planı ve tasarımı yazıldı: `docs/gelistirme-plani.md`. Aşama 1 (raporlama) Agy'ye devredildi; Aşama 2 (ekstre içe aktarma) maskeli örnek CSV beklediği için bloke. Eklenen opsiyonel alanlar: `categoryLimits`, `importedHashes`. Kod değişikliği yapılmadı. | Claude (Haiku 5.5) |
| 2026-10-25 | Aşama 1 (Gelişmiş Raporlama) tamamlandı: Yıllık karşılaştırma, yıl seçici, 12 ay dökümü, kategori dağılımı oranları, kategori bütçe limitleri ve aşım rozetleri, yeni ay kopyalaması, `budget.test.ts` testleri, `*.csv` gitignore eklendi. `npm run lint` & `npm run build` temiz. | Antigravity AI |
