# BTC/USD Real-Time MVRV Tracker 🚀

Aplikasi pemantauan metrik on-chain **MVRV (Market Value to Realized Value)** untuk pasangan **BTC/USD** secara *real-time* (sub-detik).

Aplikasi ini menggabungkan *live price feed* langsung dari WebSocket bursa (Binance / Coinbase) dengan metrik basis biaya on-chain (*Realized Price*) untuk menghitung rasio valuasi pasar Bitcoin secara instan.

---

## 📌 Apa itu MVRV Ratio?

**MVRV (Market Value to Realized Value)** adalah salah satu indikator on-chain paling populer dan andal dalam sejarah Bitcoin untuk mendeteksi siklus pasar (*market cycles*), titik akumulasi (*bottom*), dan puncak euforia (*top*).

### Rumus Perhitungan:
$$\text{MVRV Ratio} = \frac{\text{Market Value (Market Cap)}}{\text{Realized Value (Realized Cap)}} = \frac{\text{Harga Pasar BTC (Spot)}}{\text{Realized Price}}$$

* **Market Cap:** $\text{Harga Pasar Spot} \times \text{Circulating Supply}$
* **Realized Price:** Biaya rata-rata tertimbang dari seluruh Bitcoin saat terakhir kali berpindah di blockchain (harga modal agregat para investor & penambang).
* **Realized Cap:** $\text{Realized Price} \times \text{Circulating Supply}$

---

## 🚦 Interpretasi Zona MVRV

| Zona MVRV | Rentang Rasio | Status Pasar | Makna Historis |
| :--- | :--- | :--- | :--- |
| **Undervalued / Bottom** 🟢 | `< 1.00x` | Akumulasi Emas | Harga spot berada di bawah harga beli rata-rata investor. Pasar dalam kondisi rugi bersih agregat (Kapitulasi: 2015, 2018, Mar 2020, Nov 2022). |
| **Fair Value / Expansion** 🔵 | `1.00x - 2.40x` | Pertumbuhan Sehat | Pasar berada dalam fase ekspansi normal dan akumulasi berkelanjutan. Mayoritas pemegang berada dalam posisi profit wajar. |
| **Overheated / High Risk** 🟠 | `2.40x - 3.70x` | Waspada / Euphoria | Keuntungan yang belum direalisasikan (*unrealized profit*) sangat besar. Tekanan jual dan aksi ambil untung meningkat tajam (misal: puncak rekor siklus lalu di kisaran ~$125k–$126k). |
| **Cycle Top / Mania** 🔴 | `> 3.70x` | Puncak Siklus | Puncak gelembung siklus bull market historis (Nov 2013, Des 2017, Apr 2021). Pasar berada dalam kondisi keserakahan ekstrem. |

---

## ✨ Fitur Utama Aplikasi

1. **Live Tick Stream (Sub-Detik):**
   - Menggunakan WebSocket langsung ke Binance (`btcusdt@ticker`) dengan opsi switch ke Coinbase (`BTC-USD`).
   - Fallback otomatis ke REST API jika WebSocket dibatasi/terputus.
2. **Kalkulasi MVRV Dinamis:**
   - Dihitung seketika pada setiap perubahan harga (*tick-by-tick*).
   - Menghitung persentase keuntungan agregat jaringan dan jarak ke titik *breakeven* on-chain.
3. **Speedometer Heat Gauge & Color Coded Zones:**
   - Jarum dinamis yang bergeser mengikuti rasio MVRV saat ini secara halus.
   - Penanda warna zona: Hijau (Undervalued), Biru (Fair Value), Oranye (Overheated), Merah (Cycle Top).
4. **Grafik Real-Time Dual-Axis (Chart.js):**
   - Menampilkan pergerakan Harga BTC (Sumbu Kiri) dan Rasio MVRV (Sumbu Kanan) secara berdampingan.
   - Pilihan filter history: 50, 100, atau 200 ticks, serta tombol jeda & bersihkan grafik.
5. **Kalkulator Simulasi Skenario:**
   - Masukkan target harga BTC apa pun (misal: $100.000 atau $150.000) untuk melihat proyeksi rasio MVRV dan status zona siklusnya seketika.
   - Dilengkapi tabel target harga level kunci ($RP \times 1.0$, $RP \times 2.0$, $RP \times 2.4$, $RP \times 3.7$).
6. **Sintesis Audio & Notifikasi (Web Audio API):**
   - Notifikasi nada harmonis saat terjadi pergantian zona siklus penting tanpa butuh file audio eksternal.
7. **Pengaturan Parameter Fleksibel:**
   - Dukungan kustomisasi Realized Price dan Circulating Supply secara manual atau melalui sinkronisasi data on-chain.

---

## 🚀 Cara Menjalankan Aplikasi

### Opsi 1: Menjalankan dengan Server Python (Direkomendasikan)
Di terminal, navigasikan ke direktori proyek dan jalankan:

```bash
cd /Users/dastindimaz/.gemini/antigravity/scratch/btc-mvrv-tracker
python3 server.py
```

Aplikasi akan menyajikan halaman di **`http://localhost:8000`** dan secara otomatis membuka browser Anda.

### Opsi 2: Membuka File Langsung di Browser
Anda juga dapat langsung membuka file `index.html` menggunakan browser favorit Anda (Google Chrome, Safari, Firefox, Edge, Brave):

```bash
open /Users/dastindimaz/.gemini/antigravity/scratch/btc-mvrv-tracker/index.html
```

---

## 📁 Struktur File Proyek

```
btc-mvrv-tracker/
├── index.html     # Struktur UI dashboard terminal finansial modern
├── style.css      # Styling tema gelap Glassmorphism, animasi & responsivitas
├── app.js         # Engine real-time: WebSocket, kalkulasi MVRV, Chart, Audio
├── server.py      # Server HTTP lokal Python tanpa dependensi eksternal
└── README.md      # Panduan lengkap penggunaan dan dokumentasi metrik
```
