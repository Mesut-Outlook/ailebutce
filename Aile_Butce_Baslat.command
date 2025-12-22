#!/bin/bash

# Proje klasörünün tam yolu
PROJECT_DIR="/Users/mesutozdemir/_PROJELER/Aile_Butce"

# Terminal başlığını ayarla
echo -n -e "\033]0;Aile Bütçe Başlatıcı\007"

echo "=================================================="
echo "   Aile Bütçe Uygulaması Başlatılıyor..."
echo "=================================================="
echo "Proje Dizini: $PROJECT_DIR"

# Proje dizinine git
cd "$PROJECT_DIR" || {
    echo "HATA: Proje dizini bulunamadı!"
    echo "Lütfen şu yolun doğru olduğundan emin olun: $PROJECT_DIR"
    read -p "Çıkmak için bir tuşa basın..."
    exit 1
}

# Çıkışta temizlik yap: Tüm alt süreçleri sonlandır
cleanup() {
    echo ""
    echo "🛑 Uygulama kapatılıyor, servisler durduruluyor..."
    # PID grubunu sonlandır (kendi PID'si hariç tüm çocukları)
    pkill -P $$ 2>/dev/null
    exit
}

# Sinyalleri yakala (Pencere kapanması, Ctrl+C vb.)
trap cleanup EXIT INT TERM

# Uygulamayı başlat ve tarayıcıyı aç
echo "🚀 Sunucu başlatılıyor ve tarayıcı açılıyor..."
# npm run dev çıktısını göster, arka planda çalıştır
npm run dev -- --open &

# Arka plandaki işlemin ID'sini al
APP_PID=$!

# Kullanıcıya bilgi ver
echo "--------------------------------------------------"
echo "✅ Uygulama aktif (PID: $APP_PID)."
echo "❌ Durdurmak için bu terminal penceresini kapatın."
echo "--------------------------------------------------"

# İşlemi bekle
wait $APP_PID
