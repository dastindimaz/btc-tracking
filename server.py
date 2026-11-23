#!/usr/bin/env python3
"""
BTC/USD Real-Time MVRV Tracker - Local Server
Menyajikan dashboard web secara lokal melalui HTTP server bawaan Python
tanpa dependensi eksternal tambahan.
"""

import os
import sys
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class MVRVRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Tambahkan header CORS dan no-cache untuk development lancar
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

def run_server():
    os.chdir(DIRECTORY)
    server_address = ('127.0.0.1', PORT)
    
    try:
        httpd = HTTPServer(server_address, MVRVRequestHandler)
        url = f"http://localhost:{PORT}"
        print("=" * 60)
        print("  🚀 BTC/USD Real-Time MVRV Tracker Server Berjalan!")
        print(f"  📍 URL Aplikasi : {url}")
        print(f"  📂 Direktori    : {DIRECTORY}")
        print("  Tekan Ctrl + C untuk menghentikan server.")
        print("=" * 60)
        
        # Buka browser secara otomatis jika dijalankan di environment desktop
        try:
            webbrowser.open(url)
        except Exception:
            pass

        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Menghentikan server...")
        httpd.server_close()
        sys.exit(0)
    except OSError as e:
        if e.errno == 48: # Address already in use
            print(f"⚠️ Port {PORT} sedang digunakan. Mencoba port {PORT + 1}...")
            # Coba port alternatif
            alt_server_address = ('127.0.0.1', PORT + 1)
            httpd = HTTPServer(alt_server_address, MVRVRequestHandler)
            print(f"📍 URL Aplikasi : http://localhost:{PORT + 1}")
            httpd.serve_forever()
        else:
            raise e

if __name__ == '__main__':
    run_server()
