# Aile Bütçe Takip ve Analiz Sistemi

Tailwind, D3.js ve Firebase Firestore kullanan tek sayfalık bu uygulama, aylık harcamaları kaydetmenizi, anlık özet tabloları görmenizi ve Euro bazında trend grafikleri üretmenizi sağlar. Vite + TypeScript altyapısı sayesinde yerel geliştirme ortamı hızlıdır ve Firebase işlemleri modüler olarak yönetilir.

## Özellikler

- Aylık bütçe verilerini EUR/TRY kuru ile birlikte kaydetme veya güncelleme
- Harcama kalemlerinin dinamik olarak eklenip çıkarılabildiği gelişmiş form
- Firestore gerçek zamanlı dinleme ile tablo ve grafiklerin anında güncellenmesi
- D3.js ile aylık toplam harcamaların Euro bazında trend grafiği
- Detay kartında seçili aya ait kalemlerin büyükten küçüğe sıralanması

## Gereksinimler

- Node.js 18+ ve npm 10+
- Firebase projesi (Firestore + Authentication etkin)

## Kurulum

1. Bağımlılıkları yükleyin:

   ```bash
   npm install
   ```

2. Firebase yapılandırmasını paylaşmak için kök dizinde bir `.env` dosyası oluşturun:

   ```bash
   VITE_APP_ID=aile-butce
   VITE_FIREBASE_CONFIG={"apiKey":"xxx","authDomain":"xxx","projectId":"xxx", ... }
   # Opsiyonel: Kimlik doğrulama için özel tokenınız varsa
   # VITE_INITIAL_AUTH_TOKEN=eyJhbGciOi...
   ```

   > Not: `VITE_FIREBASE_CONFIG` değeri geçerli bir JSON string olmalıdır. Yerel geliştirmede anonim oturum kullanmak istemiyorsanız `VITE_INITIAL_AUTH_TOKEN` değişkenini de tanımlayın.

3. Geliştirme sunucusunu çalıştırın:

   ```bash
   npm run dev
   ```

4. Üretim paketini oluşturmak için:

   ```bash
   npm run build
   npm run preview
   ```

## Firebase Entegrasyonu

Uygulama, `__app_id`, `__firebase_config` ve `__initial_auth_token` gibi global değişkenler tanımlanmışsa bunları otomatik olarak kullanır. Eğer bu değişkenleri sağlayan bir arka uç katmanınız yoksa, yukarıda anlatıldığı gibi `.env` dosyası ile aynı bilgileri Vite ortam değişkenleri olarak verebilirsiniz.

## Komutlar

- `npm run dev` – Vite geliştirme sunucusu (HMR destekli)
- `npm run build` – TypeScript kontrolü + üretim çıkışı
- `npm run preview` – Derlenen uygulamayı yerel olarak ön izleme
- `npm run lint` – ESLint denetimi

## Notlar

- Firestore koleksiyon yolu `artifacts/{APP_ID}/users/{USER_ID}/budgets` desenini kullanır; isteğinize göre güncelleyebilirsiniz.
- Tailwind CSS yerel PostCSS hattıyla derlenir; CDN kullanımı yoktur.
- D3.js ve Firebase paketleri npm üzerinden içe aktarılır; ağ erişimi olmayan ortamlarda `npm install` işlemini çevrimdışı gerçekleştirebilirsiniz.

---

## Çalışma Mantığı (İş Akışı)

### 1. Bütçe Yapısı

Her aylık bütçe şu bileşenlerden oluşur:

- **Gelirler (INCOME_ENTRIES)**: Maaş, ek gelirler, geri ödemeler vb.
- **Hollanda Giderleri (HOLLANDA)**: EUR olarak girilen giderler (kira, faturalar, sigortalar vb.)
- **Türkiye Giderleri (TURKIYE)**: TL olarak girilen ve EUR'ya çevrilen giderler

### 2. Sabit Kalem Sistemi

- Her gelir veya gider kalemi **"Sabit"** olarak işaretlenebilir
- Sabit kalemler her yeni ay açıldığında **otomatik olarak kopyalanır**
- Kopyalama mantığı:
  1. En son kaydedilen ay bulunur (`getLastBudget`)
  2. `type === 'FIXED'` olan tüm kalemler filtrelenir
  3. Bu kalemler yeni aya aynı grup, ad ve miktarla kopyalanır

### 3. Yeni Ay Oluşturma

1. "Yeni Ay" butonuna tıkla
2. Ay ve yıl seç
3. "Oluştur"a tıkla
4. Sistem:
   - Varsayılan grupları oluşturur
   - Sabit kalemleri önceki aydan kopyalar
   - Yeni form açılır

### 4. Veri Saklama

- **Yerel Mod**: `db.json` dosyasına kaydedilir (Express API ile)
- **Firebase Mod**: Firestore'a gerçek zamanlı kaydedilir

### 5. Grafik ve Özet

- Hoşgeldin sayfasında tüm ayların özeti kartlarda gösterilir
- Çizgi grafik:
  - 🟢 Yeşil = Toplam Gelir
  - 🔴 Kırmızı = Toplam Gider
  - 🟣 Mor = Kalan Bütçe

### 6. EUR/TRY Kuru

- Her ay için döviz kuru ayrı ayrı kaydedilir
- Türkiye giderleri bu kura göre EUR'ya çevrilir
- Toplam hesaplamalarda EUR bazında gösterilir
