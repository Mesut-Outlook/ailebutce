# Geliştirme Planı: Raporlama ve Ekstre İçe Aktarma

> Bu dosya Agy (ve diğer ajanlar) için uygulama talimatıdır. Yapılacaklar sırası ve kabul kriterleri burada.
> Her bölüm bittiğinde `coordination.md` güncellenir.

## Genel kurallar

- Hesap mantığı `src/budget.ts` içinde kalır (DOM/Firebase bağımsız). Her yeni fonksiyon için `src/budget.test.ts` içine kontrol eklenir (`node src/budget.test.ts`).
- Yeni npm bağımlılığı **eklenmez**. Grafikler için inline SVG veya düz CSS yeterli (D3 zaten kaldırıldı).
- Yeni alanlar opsiyonel olmalı (`?`). Eski Firestore kayıtları bozulmamalı.
- Her kullanıcı metni `esc()` ile basılır. Her değişiklik sonrası `npm run lint` ve `npm run build`.
- Banka verisi hassastır: içe aktarma **tamamen tarayıcıda** çalışır, dış servise gönderilmez. Ekstre dosyaları (`*.csv`) repoya **girmez**; `.gitignore`'a eklenir.

---

## Aşama 1: Gelişmiş raporlama (önce bu, dış veri gerektirmez)

### 1a. Yıllık karşılaştırma
- Geçmiş ekranına (`historyView`) "Yıl" görünümü: her ay için gelir, Hollanda, Türkiye (EUR eşdeğeri), kalan (`totals()` kullanılarak).
- Gösterim: tablo + her ay için yatay çubuk (CSS `width: %` yeterli). Yıl seçici (önceki/sonraki).
- Veri kaynağı: `service` üzerinden o yılın kayıtları. Kayıt yoksa satır boş gösterilir, hata atılmaz.

### 1b. Kategori dağılımı
- `BudgetDetail.subGroup` değerine göre (örn. "Krediler", "Faturalar", "Sigortalar") seçili ayın EUR toplamı.
- Gösterim: kategori listesi, her satırda toplam ve tüm giderlere oranı (%).
- Gelir kalemleri (`section === 'INCOME'`) hariç tutulur.

### 1c. Kategori bütçe limiti
- `BudgetRecord`'a opsiyonel alan: `categoryLimits?: Record<string, number>` (EUR cinsinden, subGroup adı anahtar).
- `monthFrom()` bu alanı önceki aydan **kopyalar** (yeni ay açılınca limitler kaybolmasın).
- Kategori toplamı limiti aşarsa satırda uyarı rozeti. Limit girişi: kategori satırına dokunup tutar yazma (mevcut `openSheet` deseni).
- Test: limit aşımı hesabı ve `monthFrom` kopyalaması `budget.test.ts` içinde.

**Kabul kriterleri (Aşama 1)**
- [x] Yıl görünümü, geçmiş verisi olan ve olmayan aylarla hatasız çalışır.
- [x] Kategori yüzdeleri seçili ayın giderlerine göre toplamı %100 eder (yuvarlama farkı hariç).
- [x] Limit aşımı uyarısı görünür; limit yokken uyarı yok.
- [x] Yeni ay açınca limitler kopyalanır.
- [x] `node src/budget.test.ts`, `npm run lint`, `npm run build` geçer.

---

## Aşama 2: Ekstre içe aktarma (BLOKE: örnek dosya bekleniyor)

**Önce kullanıcıdan istenecek:** ABN AMRO'dan indirilen hesap hareketi CSV'si, kişisel bilgiler (IBAN, isim, karşı taraf adı) silinmiş veya maskelenmiş bir örnek. Başlık satırını ve birkaç satırı görmeden ayrıştırıcı yazılmaz. Başlık adlarını tahmin ederek sabitlemek yasak.

### 2a. Ayrıştırma
- Dosya seçimi `<input type="file">` ile. Sadece `.csv`.
- Ayraç ve sayı biçimi dosyadan tespit edilir (`;` ve virgül ondalık beklenir, `parseAmount()` kullanılır).
- Her satırdan: tarih, tutar (negatif = çıkış), açıklama. Gelen (pozitif) hareketler şimdilik atlanır.
- Ayrıştırıcı saf fonksiyon olarak `budget.ts`'e (veya `src/bank.ts`) yazılır; test için örnek satırlar kullanılır.

### 2b. Eşleştirme
- Her çıkış hareketi, seçili ayın **ödenmemiş** (`paid !== true`) kalemleriyle karşılaştırılır.
- Eşleşme puanı: açıklamadaki kelimelerin kalem adıyla örtüşmesi (küçük harf, Türkçe/Hollandaca karakter normalizasyonu) + tutar farkı tolerans içindeyse (öneri: ±%5 veya ±1 EUR, hangisi büyükse).
- Eşleşme **otomatik işaretlenmez**. Önizleme ekranında her satır için öneri gösterilir, kullanıcı onaylar veya değiştirir.
- Eşleşmeyen hareketler "eşleşmedi" listesinde kalır; kullanıcı elle kalemle eşleştirebilir ya da atlayabilir.

### 2c. Tekrar içe aktarma koruması
- Her hareketin parmak izi: tarih + tutar + açıklama özeti. Onaylanan parmak izleri `BudgetRecord.importedHashes?: string[]` alanına yazılır.
- Aynı dosya iki kez yüklenirse yeni kayıt açılmaz, "zaten işlenmiş" diye bildirilir.

### 2d. Onay sonucu
- Onaylanan eşleşme: ilgili kalem `paid: true` olur ve `save()` ile yazılır.
- Tutar farkı varsa kalemin tutarı değişmez; fark bilgi olarak gösterilir (kullanıcı kararı).

**Kabul kriterleri (Aşama 2)**
- [ ] Örnek ekstre (maskeli) ile ayrıştırma doğru satır sayısı ve tutar verir (test var).
- [ ] Hiçbir hareket onaysız işaretlenmez.
- [ ] Aynı dosya ikinci kez yüklenince çift kayıt oluşmaz.
- [ ] CSV dosyaları `git status` içinde görünmez (`.gitignore`).
- [ ] Veri tarayıcıdan dışarı gönderilmez (ağ isteği yok; kontrol: tarayıcı Network sekmesi).

---

## Açık sorular (kullanıcı cevaplamalı)

1. Kredi kartı ekstresi de içe aktarılacak mı, yoksa sadece ABN AMRO hesap hareketleri mi? (Plan: sadece hesap hareketleri, kart Aşama 3.)
2. Eşleşme tutar toleransı ±%5 mi, sabit ±1 EUR mu?

## Dosya haritası (tahmini)

| Dosya | Değişiklik |
|---|---|
| `src/budget.ts` | `categoryLimits`, kategori toplamı, `monthFrom` kopyalaması, (Aşama 2) ayrıştırma/eşleştirme |
| `src/budget.test.ts` | Her yeni fonksiyon için kontrol |
| `src/main.ts` | Yıl görünümü, kategori ekranı, limit sheet'i, (Aşama 2) içe aktarma önizleme |
| `index.html` | Gerekirse sekme/alan iskeleti |
| `src/style.css` | Çubuk, uyarı rozeti, önizleme tablosu |
| `.gitignore` | `*.csv` |
