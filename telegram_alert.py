#!/usr/bin/env python3
"""
BTC/USD MVRV Telegram Alert Bot
Memantau rasio MVRV secara berkala dan mengirim notifikasi Telegram
ketika MVRV menyentuh atau turun di bawah 1.0 (Zona Akumulasi Emas).
"""

import time
import datetime
import json
import urllib.request
import urllib.error

# ==============================================================================
# KONFIGURASI TELEGRAM & ALERT
# Ganti nilai di bawah ini dengan Token Bot & Chat ID Telegram Anda:
# ==============================================================================
TELEGRAM_BOT_TOKEN = "GANTI_DENGAN_BOT_TOKEN_ANDA"
TELEGRAM_CHAT_ID = "GANTI_DENGAN_CHAT_ID_ANDA"

# Ambang batas MVRV untuk memicu alert
MVRV_THRESHOLD = 1.00

# Basis biaya on-chain default (dapat disinkronkan otomatis)
DEFAULT_REALIZED_PRICE = 53500.0

# Interval pemeriksaan (dalam detik)
CHECK_INTERVAL_SECONDS = 30

# Cooldown alert (dalam detik) agar tidak terjadi spam pesan (contoh: 1 jam = 3600 detik)
ALERT_COOLDOWN_SECONDS = 3600
# ==============================================================================

BULAN_INDONESIA = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
]

def get_wib_time_string() -> str:
    """Mengembalikan waktu saat ini dalam format Bahasa Indonesia zona WIB (UTC+7)."""
    # UTC + 7 jam untuk Waktu Indonesia Barat (WIB)
    wib_tz = datetime.timezone(datetime.timedelta(hours=7))
    now_wib = datetime.datetime.now(wib_tz)
    
    hari = now_wib.day
    bulan = BULAN_INDONESIA[now_wib.month - 1]
    tahun = now_wib.year
    jam_menit = now_wib.strftime("%H:%M")
    
    return f"{hari} {bulan} {tahun} jam {jam_menit} WIB"

last_alert_time = 0
was_below_threshold = False

def send_telegram_message(message: str) -> bool:
    """Mengirim pesan ke Telegram menggunakan Telegram Bot API."""
    if "GANTI_DENGAN" in TELEGRAM_BOT_TOKEN:
        print("[SIMULASI TELEGRAM] Token belum disetel. Pesan yang akan dikirim:")
        print(message)
        print("-" * 50)
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": "HTML"
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status == 200
    except urllib.error.URLError as e:
        print(f"❌ Gagal mengirim pesan Telegram: {e}")
        return False

def get_live_btc_price() -> float:
    """Mengambil harga live BTC/USDT dari Binance Public API."""
    url = "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return float(data.get("price", 0))
    except Exception as e:
        print(f"⚠️ Gagal mengambil harga BTC: {e}")
        return 0.0

def get_latest_realized_price() -> float:
    """Mencoba mengambil Realized Price on-chain terbaru."""
    url = "https://bitcoin-data.com/v1/realized-price/last"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, list) and len(data) > 0:
                return float(data[0].get("realized_price", DEFAULT_REALIZED_PRICE))
    except Exception:
        pass
    return DEFAULT_REALIZED_PRICE

def main():
    global last_alert_time, was_below_threshold
    print("=" * 65)
    print("  🤖 BTC/USD MVRV Telegram Alert Bot Aktif")
    print(f"  🎯 Target Alert: MVRV <= {MVRV_THRESHOLD:.2f} (Zona Akumulasi/Diskon)")
    print(f"  ⏱️  Interval Cek: Setiap {CHECK_INTERVAL_SECONDS} detik")
    print("=" * 65)

    realized_price = get_latest_realized_price()
    print(f"ℹ️  Realized Price yang digunakan: ${realized_price:,.2f}")

    while True:
        try:
            btc_price = get_live_btc_price()
            if btc_price > 0:
                mvrv = btc_price / realized_price
                current_time = time.time()
                time_str = time.strftime("%Y-%m-%d %H:%M:%S")

                print(f"[{time_str}] BTC: ${btc_price:,.2f} | RP: ${realized_price:,.2f} | MVRV: {mvrv:.3f}x")

                # Kondisi Pemicu Alert: MVRV <= 1.00
                if mvrv <= MVRV_THRESHOLD:
                    time_since_last_alert = current_time - last_alert_time
                    
                    # Picu alert jika baru pertama kali menembus ke bawah ATAU cooldown telah lewat
                    if (not was_below_threshold) or (time_since_last_alert > ALERT_COOLDOWN_SECONDS):
                        discount_pct = abs((mvrv - 1.0) * 100)
                        
                        waktu_wib = get_wib_time_string()
                        
                        alert_msg = (
                            "🚨 <b>ALERT: BITCOIN MVRV MENEMBUS KE BAWAH 1.0!</b> 🚨\n\n"
                            f"🟢 <b>Status:</b> Undervalued / Zona Akumulasi Emas\n"
                            f"📊 <b>MVRV Ratio:</b> <code>{mvrv:.3f}x</code>\n"
                            f"💰 <b>Harga Pasar (Spot):</b> <code>${btc_price:,.2f}</code>\n"
                            f"🧱 <b>Realized Price (RP):</b> <code>${realized_price:,.2f}</code>\n"
                            f"📉 <b>Diskon dari Modal Jaringan:</b> <b>-{discount_pct:.2f}%</b>\n\n"
                            "💡 <i>Catatan Historis: Secara historis (2015, 2018, Mar 2020, Nov 2022), "
                            "ketika MVRV berada di bawah 1.0, rata-rata seluruh pasar berada dalam posisi rugi "
                            "dan merupakan area dasar siklus bear market (Kapitulasi).</i>\n\n"
                            f"🕒 <b>Waktu:</b> <code>{waktu_wib}</code>"
                        )
                        
                        print("\n📢 Mengirim sinyal alert ke Telegram...")
                        send_telegram_message(alert_msg)
                        last_alert_time = current_time
                        was_below_threshold = True
                else:
                    # Reset status jika harga sudah kembali di atas 1.0
                    was_below_threshold = False

            time.sleep(CHECK_INTERVAL_SECONDS)

        except KeyboardInterrupt:
            print("\n🛑 Bot alert dihentikan.")
            break
        except Exception as e:
            print(f"⚠️ Terjadi kesalahan pada loop: {e}")
            time.sleep(10)

if __name__ == "__main__":
    main()
