# Aile Bütçe Takip Sistemi - Proje Detayları

Bu belge, projenin teknik yapısını, amacını ve kullanım rehberini içermektedir.

---

## 🚀 1. Geliştirici Teknik İstemi (Developer Prompt)

**Hedef:** Aile bütçesini aylık bazda takip eden, çift döviz (EUR/TRY) desteği sunan, verileri grafiklerle görselleştiren ve "Sabit Gider" otomasyonu olan premium bir web uygulaması geliştirilmesi.

### 🛠 Teknoloji Yığını (Tech Stack)
*   **Frontend:** Vite + TypeScript + Tailwind CSS
*   **Veri Görselleştirme:** D3.js (Trend grafikleri için)
*   **Backend/Storage:** Firebase Firestore (Gerçek zamanlı senkronizasyon) ve yerel JSON fallback (`db.json`).
*   **API:** Döviz kurları için `Frankfurter API` (EUR/TRY/USD).

### 📋 Temel Özellikler ve Mantık
*   **Veri Yapısı:** Ay/yıl bazlı kayıtlar. Her ay için EUR/TRY kuru sabitlenir.
*   **Çift Döviz:** Hollanda (EUR) ve Türkiye (TRY) harcamaları. ₺ harcamalar otomatik EUR'ya çevrilir.
*   **Sabit Kalem Otomasyonu:** "SABİT" (FIXED) işaretli kalemler yeni ay açıldığında otomatik kopyalanır.
*   **Dinamik UI:** Sürükle-bırak grup yönetimi, kullanıcı tanımlı renk kodları.
*   **Analiz:** D3.js trend grafikleri, canlı bütçe doluluk barı ve anlık istatistikler.

---

## 🎯 2. Projenin Amacı

Bu uygulama, özellikle farklı ülkelerde harcamaları olan kullanıcılar için karmaşık bütçe yönetimini tek bir noktada toplar:

1.  **Çift Para Birimi Çözümü:** ₺ ve € harcamalarını ortak bir paydada (EUR) birleştirerek gerçek finansal durumu gösterir.
2.  **Otomasyon:** Her ay aynı olan rutin giderlerin (kira, sigorta vb.) elle girilmesini önleyerek zaman kazandırır.
3.  **Görsel Farkındalık:** Grafik ve istatistiklerle tasarruf ve harcama alışkanlıklarını analiz etmeyi kolaylaştırır.
4.  **Esnek Depolama:** Hem yerel (`db.json`) hem bulut (Firebase) desteği ile veri özgürlüğü sunur.

---

## 👤 3. Kullanım Rehberi (User Guide)

### 1. Giriş ve Dashboard
Uygulama açıldığında geçmiş ayların özet kartları ve finansal trend grafiği sizi karşılar.

### 2. Yeni Ay Başlatma
*   **"Yeni Ay"** butonuna basın.
*   Ay/Yıl seçin. Sistem, önceki aydaki "Sabit" kalemleri otomatik olarak yeni aya taşır.

### 3. Veri Girişi
*   **Gelir/Gider Ekleme:** İlgili grup altından yeni kalemler ekleyin.
*   **Döviz Seçimi:** Harcama tipine göre TRY veya EUR seçin.
*   **Sürükle-Bırak:** Harcama kalemlerini gruplar arasında sürükleyerek taşıyın.

### 4. Özelleştirme
*   Grup renklerini yanındaki renk paletinden değiştirerek bütçenizi kişiselleştirin.
*   Grup isimlerini üzerine tıklayarak düzenleyin.

### 5. Kaydetme ve İzleme
*   Üstteki **"Hero Stats"** üzerinden kalan bütçenizi anlık izleyin.
*   İşleminiz bitince **"Bütçeyi Kaydet"** butonuna basarak verileri senkronize edin.
