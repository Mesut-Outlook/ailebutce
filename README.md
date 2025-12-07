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
