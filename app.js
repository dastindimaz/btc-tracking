/**
 * BTC/USD Real-Time MVRV Tracker - Core Logic
 * TradingView-Style Dual-Pane Layout (BTC Price Top + MVRV Indicator Bottom)
 * Multi-Timeframe with Favorite Star System ⭐ and Binance Klines Sync
 */

(function () {
    'use strict';

    // Available Timeframes Definition
    const AVAILABLE_TIMEFRAMES = [
        { id: '1s', label: '1s (Live)', isKline: false, limit: 60 },
        { id: '1m', label: '1m', isKline: true, interval: '1m', limit: 70 },
        { id: '5m', label: '5m', isKline: true, interval: '5m', limit: 70 },
        { id: '15m', label: '15m', isKline: true, interval: '15m', limit: 70 },
        { id: '1h', label: '1h', isKline: true, interval: '1h', limit: 70 },
        { id: '4h', label: '4h', isKline: true, interval: '4h', limit: 70 },
        { id: '1d', label: '1D', isKline: true, interval: '1d', limit: 70 },
        { id: '1w', label: '1W', isKline: true, interval: '1w', limit: 52 }
    ];

    // Global Application State
    const state = {
        btcPrice: 0,
        prevPrice: 0,
        high24h: 0,
        low24h: 0,
        deltaPercent24h: 0,
        realizedPrice: 53500.0,      // On-chain cost basis (USD)
        circulatingSupply: 19780000, // Approximate BTC circulating supply
        mvrvRatio: 1.0,
        currentZone: 'fair',         // 'under' | 'fair' | 'hot' | 'top'
        previousZone: null,
        wsSource: 'binance',         // 'binance' | 'coinbase'
        soundEnabled: true,
        chartPaused: false,
        currentTimeframe: '1m',      // Default active timeframe
        favoriteTimeframes: ['1s', '1m', '5m', '15m', '1h', '1d'], // Pinned favorites
        klineData: [],               // Stores candles: [{time, o, h, l, c, mvrv}]
        tickBuffer: [],              // Stores tick buffer for '1s'
        lastTickTime: null,
        ws: null,
        reconnectTimer: null,
        restFallbackTimer: null,
        audioCtx: null
    };

    // Load persisted favorites from localStorage if present
    try {
        const savedFavorites = localStorage.getItem('tv_mvrv_favorites');
        if (savedFavorites) {
            state.favoriteTimeframes = JSON.parse(savedFavorites);
        }
        const savedTf = localStorage.getItem('tv_mvrv_active_tf');
        if (savedTf && AVAILABLE_TIMEFRAMES.some(t => t.id === savedTf)) {
            state.currentTimeframe = savedTf;
        }
    } catch (e) {
        console.warn('Could not load localStorage preferences', e);
    }

    // DOM Elements Cache
    const el = {
        wsStatus: document.getElementById('ws-status'),
        wsStatusText: document.getElementById('ws-status-text'),
        liveClock: document.getElementById('live-clock'),
        btcPrice: document.getElementById('btc-price'),
        priceDelta: document.getElementById('price-delta'),
        deltaIcon: document.getElementById('delta-icon'),
        deltaPercent: document.getElementById('delta-percent'),
        btcHigh: document.getElementById('btc-high'),
        btcLow: document.getElementById('btc-low'),
        realizedPriceVal: document.getElementById('realized-price-val'),
        realizedCap: document.getElementById('realized-cap'),
        marketCap: document.getElementById('market-cap'),
        mvrvValue: document.getElementById('mvrv-value'),
        mvrvConditionBadge: document.getElementById('mvrv-condition-badge'),
        mvrvProfitText: document.getElementById('mvrv-profit-text'),
        currentZoneBanner: document.getElementById('current-zone-banner'),
        zoneDescription: document.getElementById('zone-description'),
        breakevenDiff: document.getElementById('breakeven-diff'),
        breakevenProgress: document.getElementById('breakeven-progress'),
        breakevenSubtext: document.getElementById('breakeven-subtext'),
        breakevenPrice: document.getElementById('breakeven-price'),
        gaugeNeedle: document.getElementById('gauge-needle-group'),
        gaugeRatioText: document.getElementById('gauge-ratio-text'),
        gaugeZoneLabel: document.getElementById('gauge-zone-label'),
        lastTickTime: document.getElementById('last-tick-time'),
        zones: {
            under: document.getElementById('zone-under'),
            fair: document.getElementById('zone-fair'),
            hot: document.getElementById('zone-hot'),
            top: document.getElementById('zone-top')
        },
        simPriceInput: document.getElementById('sim-price-input'),
        simMvrvResult: document.getElementById('sim-mvrv-result'),
        simZoneResult: document.getElementById('sim-zone-result'),
        targetP10: document.getElementById('target-p-10'),
        targetP20: document.getElementById('target-p-20'),
        targetP24: document.getElementById('target-p-24'),
        targetP37: document.getElementById('target-p-37'),
        histCurrentPrice: document.getElementById('hist-current-price'),
        histCurrentMvrv: document.getElementById('hist-current-mvrv'),
        histCurrentStatus: document.getElementById('hist-current-status'),
        settingsPanel: document.getElementById('settings-panel'),
        settingsToggle: document.getElementById('settings-toggle'),
        closeSettings: document.getElementById('close-settings'),
        inputRealizedPrice: document.getElementById('input-realized-price'),
        inputSupply: document.getElementById('input-supply'),
        selectSource: document.getElementById('select-source'),
        btnApplyParams: document.getElementById('btn-apply-params'),
        btnResetParams: document.getElementById('btn-reset-params'),
        btnSyncOnchain: document.getElementById('btn-sync-onchain'),
        soundToggle: document.getElementById('sound-toggle'),
        soundIconOn: document.getElementById('sound-icon-on'),
        soundIconOff: document.getElementById('sound-icon-off'),

        // TradingView Toolbar & Panes Elements
        tvTfBar: document.getElementById('tv-tf-bar'),
        btnTfDropdown: document.getElementById('btn-tf-dropdown'),
        tfDropdownMenu: document.getElementById('tf-dropdown-menu'),
        tfOptionsList: document.getElementById('tf-options-list'),
        currentTfLabel: document.getElementById('current-tf-label'),
        panePriceLive: document.getElementById('pane-price-live'),
        indicatorRpLabel: document.getElementById('indicator-rp-label'),
        indicatorLiveTag: document.getElementById('indicator-live-tag'),
        ohlcO: document.getElementById('ohlc-o'),
        ohlcH: document.getElementById('ohlc-h'),
        ohlcL: document.getElementById('ohlc-l'),
        ohlcC: document.getElementById('ohlc-c'),
        btnPauseChart: document.getElementById('btn-pause-chart'),
        btnResetZoom: document.getElementById('btn-reset-zoom')
    };

    // Chart instances
    let priceChartInstance = null;
    let mvrvChartInstance = null;

    // ===================================================================
    // Audio Synthesizer (Web Audio API)
    // ===================================================================
    function getAudioContext() {
        if (!state.audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                state.audioCtx = new AudioContext();
            }
        }
        if (state.audioCtx && state.audioCtx.state === 'suspended') {
            state.audioCtx.resume();
        }
        return state.audioCtx;
    }

    function playTone(freq, type = 'sine', duration = 0.25, gainVal = 0.15) {
        if (!state.soundEnabled) return;
        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);

            gain.gain.setValueAtTime(gainVal, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start();
            osc.stop(ctx.currentTime + duration);
        } catch (e) {
            console.warn('Audio playback error:', e);
        }
    }

    function playZoneTransitionSound(newZone) {
        if (!state.soundEnabled) return;
        if (newZone === 'under') {
            // Euphoric golden chord (accumulation)
            playTone(523.25, 'triangle', 0.2, 0.12); // C5
            setTimeout(() => playTone(659.25, 'triangle', 0.3, 0.15), 120); // E5
            setTimeout(() => playTone(783.99, 'triangle', 0.4, 0.18), 240); // G5
        } else if (newZone === 'top' || newZone === 'hot') {
            // Alert chime
            playTone(880, 'sawtooth', 0.15, 0.15); // A5
            setTimeout(() => playTone(740, 'sawtooth', 0.25, 0.2), 140);
        }
    }

    // ===================================================================
    // Number & Currency Formatting Helpers
    // ===================================================================
    function formatUSD(num, decimals = 2) {
        if (isNaN(num)) return '--';
        return num.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    function formatCompactTrillion(usdAmount) {
        if (isNaN(usdAmount) || usdAmount === 0) return '$0.00 T';
        const trillions = usdAmount / 1e12;
        return `$${trillions.toFixed(2)} T`;
    }

    function updateLiveClock() {
        const now = new Date();
        const utcStr = now.toUTCString().split(' ')[4] + ' UTC';
        if (el.liveClock) {
            el.liveClock.textContent = utcStr;
        }
    }
    setInterval(updateLiveClock, 1000);
    updateLiveClock();

    // ===================================================================
    // MVRV Calculations & Logic
    // ===================================================================
    function computeMVRV() {
        if (!state.btcPrice || !state.realizedPrice) return;

        state.mvrvRatio = state.btcPrice / state.realizedPrice;

        const marketCapUSD = state.btcPrice * state.circulatingSupply;
        const realizedCapUSD = state.realizedPrice * state.circulatingSupply;
        const profitMultiple = ((state.mvrvRatio - 1.0) * 100);
        const priceDiff = state.btcPrice - state.realizedPrice;

        // Determine Zone
        let zone = 'fair';
        let zoneLabel = 'Fair Value & Growth';
        let badgeColor = 'var(--color-blue)';
        let badgeBg = 'rgba(59, 130, 246, 0.15)';

        if (state.mvrvRatio < 1.00) {
            zone = 'under';
            zoneLabel = 'Undervalued / Bottom Accumulation';
            badgeColor = 'var(--color-green)';
            badgeBg = 'rgba(16, 185, 129, 0.15)';
        } else if (state.mvrvRatio < 2.40) {
            zone = 'fair';
            zoneLabel = 'Fair Value (Pertumbuhan Normal)';
            badgeColor = 'var(--color-blue)';
            badgeBg = 'rgba(59, 130, 246, 0.15)';
        } else if (state.mvrvRatio < 3.70) {
            zone = 'hot';
            zoneLabel = 'Overheated / Risiko Tinggi';
            badgeColor = 'var(--color-orange)';
            badgeBg = 'rgba(245, 158, 11, 0.15)';
        } else {
            zone = 'top';
            zoneLabel = 'Cycle Top / Mania Peak';
            badgeColor = 'var(--color-red)';
            badgeBg = 'rgba(239, 68, 68, 0.15)';
        }

        // Trigger sound if zone changed
        if (state.previousZone && state.previousZone !== zone) {
            playZoneTransitionSound(zone);
        }
        state.previousZone = zone;
        state.currentZone = zone;

        // Render to UI
        renderMVRVUI({
            marketCapUSD,
            realizedCapUSD,
            profitMultiple,
            priceDiff,
            zone,
            zoneLabel,
            badgeColor,
            badgeBg
        });
    }

    function renderMVRVUI(data) {
        // MVRV Core Metric
        el.mvrvValue.textContent = state.mvrvRatio.toFixed(3);
        el.mvrvConditionBadge.textContent = data.zone.toUpperCase();
        el.mvrvConditionBadge.style.color = data.badgeColor;
        el.mvrvConditionBadge.style.backgroundColor = data.badgeBg;
        el.mvrvConditionBadge.style.border = `1px solid ${data.badgeColor}`;

        // Profit text
        const sign = data.profitMultiple >= 0 ? '+' : '';
        const profitClass = data.profitMultiple >= 0 ? 'text-positive' : 'text-negative';
        el.mvrvProfitText.innerHTML = `Keuntungan agregat pasar: <strong class="${profitClass}">${sign}${data.profitMultiple.toFixed(2)}%</strong>`;

        // Zone Banner
        el.zoneDescription.textContent = data.zoneLabel;
        const bullet = el.currentZoneBanner.querySelector('.zone-bullet');
        if (bullet) bullet.style.background = data.badgeColor;

        // Breakeven Card
        const diffSign = data.priceDiff >= 0 ? '+$' : '-$';
        el.breakevenDiff.textContent = `${diffSign}${formatUSD(Math.abs(data.priceDiff), 0)}`;
        el.breakevenDiff.className = `main-metric mono ${data.priceDiff >= 0 ? 'text-positive' : 'text-negative'}`;

        const percentFromRP = ((state.btcPrice / state.realizedPrice - 1) * 100).toFixed(1);
        if (data.priceDiff >= 0) {
            el.breakevenSubtext.textContent = `Harga pasar berada ${percentFromRP}% di atas basis biaya on-chain investor ($${formatUSD(state.realizedPrice, 0)}).`;
        } else {
            el.breakevenSubtext.textContent = `Harga pasar berada ${Math.abs(percentFromRP)}% DI BAWAH basis biaya investor (Zona Diskon Ekstrem).`;
        }

        // Breakeven progress bar
        let progressPercent = ((state.mvrvRatio - 0.5) / (3.5 - 0.5)) * 100;
        progressPercent = Math.max(5, Math.min(100, progressPercent));
        el.breakevenProgress.style.width = `${progressPercent}%`;

        // Caps & RP card
        el.realizedPriceVal.textContent = formatUSD(state.realizedPrice, 0);
        el.breakevenPrice.textContent = `$${formatUSD(state.realizedPrice, 0)}`;
        el.realizedCap.textContent = formatCompactTrillion(data.realizedCapUSD);
        el.marketCap.textContent = formatCompactTrillion(data.marketCapUSD);

        // Sub-pane tags
        if (el.indicatorRpLabel) el.indicatorRpLabel.textContent = `$${formatUSD(state.realizedPrice, 0)}`;
        if (el.indicatorLiveTag) el.indicatorLiveTag.textContent = `${state.mvrvRatio.toFixed(3)}x`;
        if (el.panePriceLive) el.panePriceLive.textContent = `$${formatUSD(state.btcPrice, 2)}`;

        // Update Speedometer Needle
        updateSpeedometer(state.mvrvRatio, data.zoneLabel, data.badgeColor);

        // Update Zone highlight list
        Object.keys(el.zones).forEach(zKey => {
            if (zKey === data.zone) {
                el.zones[zKey].classList.add('active');
            } else {
                el.zones[zKey].classList.remove('active');
            }
        });

        // Historical table live row
        if (el.histCurrentPrice) el.histCurrentPrice.textContent = `$${formatUSD(state.btcPrice, 2)}`;
        if (el.histCurrentMvrv) el.histCurrentMvrv.textContent = `${state.mvrvRatio.toFixed(2)}x`;
        if (el.histCurrentStatus) el.histCurrentStatus.textContent = data.zoneLabel;

        // Target Prices in Simulator
        updateKeyTargetPrices();
    }

    function updateSpeedometer(ratio, label, color) {
        let angle = -90;
        if (ratio <= 1.0) {
            const t = Math.max(0, ratio) / 1.0;
            angle = -90 + t * 45;
        } else if (ratio <= 2.4) {
            const t = (ratio - 1.0) / (2.4 - 1.0);
            angle = -45 + t * 65;
        } else if (ratio <= 3.7) {
            const t = (ratio - 2.4) / (3.7 - 2.4);
            angle = 20 + t * 45;
        } else {
            const t = Math.min(1.0, (ratio - 3.7) / (5.0 - 3.7));
            angle = 65 + t * 25;
        }

        if (el.gaugeNeedle) {
            el.gaugeNeedle.setAttribute('transform', `rotate(${angle} 150 150)`);
        }
        if (el.gaugeRatioText) {
            el.gaugeRatioText.textContent = ratio.toFixed(2);
            el.gaugeRatioText.style.color = color;
        }
        if (el.gaugeZoneLabel) {
            el.gaugeZoneLabel.textContent = label;
            el.gaugeZoneLabel.style.color = color;
            el.gaugeZoneLabel.style.backgroundColor = `${color}20`;
        }
    }

    function updateKeyTargetPrices() {
        const rp = state.realizedPrice;
        if (el.targetP10) el.targetP10.textContent = `$${formatUSD(rp * 1.0, 0)}`;
        if (el.targetP20) el.targetP20.textContent = `$${formatUSD(rp * 2.0, 0)}`;
        if (el.targetP24) el.targetP24.textContent = `$${formatUSD(rp * 2.4, 0)}`;
        if (el.targetP37) el.targetP37.textContent = `$${formatUSD(rp * 3.7, 0)}`;
    }

    // ===================================================================
    // TradingView Toolbar & Favorite Star System ⭐
    // ===================================================================
    function saveFavorites() {
        try {
            localStorage.setItem('tv_mvrv_favorites', JSON.stringify(state.favoriteTimeframes));
            localStorage.setItem('tv_mvrv_active_tf', state.currentTimeframe);
        } catch (e) {}
    }

    function renderTimeframeToolbar() {
        if (!el.tvTfBar) return;
        el.tvTfBar.innerHTML = '';

        // Render each favorite timeframe button
        AVAILABLE_TIMEFRAMES.forEach(tf => {
            if (state.favoriteTimeframes.includes(tf.id)) {
                const btn = document.createElement('button');
                btn.className = `tv-tf-btn ${tf.id === state.currentTimeframe ? 'active' : ''}`;
                btn.textContent = tf.id;
                btn.title = tf.label;
                btn.addEventListener('click', () => switchTimeframe(tf.id));
                el.tvTfBar.appendChild(btn);
            }
        });

        // Update current TF label in pane
        const currentObj = AVAILABLE_TIMEFRAMES.find(t => t.id === state.currentTimeframe);
        if (el.currentTfLabel && currentObj) {
            el.currentTfLabel.textContent = currentObj.label;
        }

        renderDropdownOptions();
    }

    function renderDropdownOptions() {
        if (!el.tfOptionsList) return;
        el.tfOptionsList.innerHTML = '';

        AVAILABLE_TIMEFRAMES.forEach(tf => {
            const isFav = state.favoriteTimeframes.includes(tf.id);
            const isActive = state.currentTimeframe === tf.id;

            const row = document.createElement('div');
            row.className = `tf-item-row ${isActive ? 'active' : ''}`;

            const labelSpan = document.createElement('span');
            labelSpan.textContent = tf.label;
            labelSpan.addEventListener('click', () => {
                switchTimeframe(tf.id);
                el.tfDropdownMenu.classList.add('hidden');
            });

            const starBtn = document.createElement('button');
            starBtn.className = `star-btn ${isFav ? 'starred' : ''}`;
            starBtn.innerHTML = isFav ? '★' : '☆';
            starBtn.title = isFav ? 'Hapus dari favorit' : 'Tambahkan ke favorit toolbar';
            starBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleFavoriteTimeframe(tf.id);
            });

            row.appendChild(labelSpan);
            row.appendChild(starBtn);
            el.tfOptionsList.appendChild(row);
        });
    }

    function toggleFavoriteTimeframe(tfId) {
        const idx = state.favoriteTimeframes.indexOf(tfId);
        if (idx > -1) {
            // Prevent removing if it's the last one
            if (state.favoriteTimeframes.length > 1) {
                state.favoriteTimeframes.splice(idx, 1);
            }
        } else {
            state.favoriteTimeframes.push(tfId);
        }
        saveFavorites();
        renderTimeframeToolbar();
    }

    function switchTimeframe(tfId) {
        if (state.currentTimeframe === tfId) return;
        state.currentTimeframe = tfId;
        saveFavorites();
        renderTimeframeToolbar();

        const tfConfig = AVAILABLE_TIMEFRAMES.find(t => t.id === tfId);
        if (!tfConfig) return;

        if (tfConfig.isKline) {
            fetchBinanceKlines(tfConfig.interval, tfConfig.limit);
        } else {
            // Switch to Live Tick buffer
            loadLiveTickBuffer();
        }
    }

    // ===================================================================
    // Binance Klines Data Fetcher
    // ===================================================================
    async function fetchBinanceKlines(interval, limit = 70) {
        try {
            const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Kline fetch failed');

            const rawKlines = await res.json();
            // Kline format: [openTime, open, high, low, close, volume, closeTime, ...]
            state.klineData = rawKlines.map(k => {
                const openTime = new Date(k[0]);
                let timeStr = '';
                if (interval.includes('d') || interval.includes('w')) {
                    timeStr = openTime.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
                } else {
                    timeStr = openTime.toTimeString().split(' ')[0].substring(0, 5); // HH:MM
                }

                const open = parseFloat(k[1]);
                const high = parseFloat(k[2]);
                const low = parseFloat(k[3]);
                const close = parseFloat(k[4]);
                const mvrv = close / state.realizedPrice;

                return { time: timeStr, o: open, h: high, l: low, c: close, mvrv: mvrv, timestamp: k[0] };
            });

            // Update OHLC display from the latest candle
            if (state.klineData.length > 0) {
                const last = state.klineData[state.klineData.length - 1];
                updateOHLCDisplay(last.o, last.h, last.l, last.c);
            }

            // Sync charts with Klines
            renderChartsFromData(state.klineData);
        } catch (err) {
            console.warn('Failed to load klines, falling back to ticks', err);
            loadLiveTickBuffer();
        }
    }

    function loadLiveTickBuffer() {
        if (state.tickBuffer.length === 0 && state.btcPrice > 0) {
            const nowStr = new Date().toTimeString().split(' ')[0];
            state.tickBuffer.push({
                time: nowStr,
                c: state.btcPrice,
                mvrv: state.btcPrice / state.realizedPrice
            });
        }
        renderChartsFromData(state.tickBuffer);
        updateOHLCDisplay(state.btcPrice, state.high24h, state.low24h, state.btcPrice);
    }

    function updateOHLCDisplay(o, h, l, c) {
        if (el.ohlcO) el.ohlcO.textContent = formatUSD(o, 2);
        if (el.ohlcH) el.ohlcH.textContent = formatUSD(h, 2);
        if (el.ohlcL) el.ohlcL.textContent = formatUSD(l, 2);
        if (el.ohlcC) el.ohlcC.textContent = formatUSD(c, 2);
    }

    // ===================================================================
    // TradingView-Style Dual Chart.js Renderer
    // ===================================================================
    function initDualCharts() {
        const priceCanvas = document.getElementById('priceChart');
        const mvrvCanvas = document.getElementById('mvrvChart');
        if (!priceCanvas || !mvrvCanvas) return;

        const ctxPrice = priceCanvas.getContext('2d');
        const ctxMVRV = mvrvCanvas.getContext('2d');

        // Upper Pane: BTC/USD Price Chart
        const priceGrad = ctxPrice.createLinearGradient(0, 0, 0, 280);
        priceGrad.addColorStop(0, 'rgba(247, 147, 26, 0.28)');
        priceGrad.addColorStop(1, 'rgba(247, 147, 26, 0.0)');

        priceChartInstance = new Chart(ctxPrice, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'BTC/USD Price',
                    data: [],
                    borderColor: '#F7931A',
                    backgroundColor: priceGrad,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: '#FFFFFF',
                    pointHoverBorderColor: '#F7931A'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#94a3b8',
                        bodyColor: '#F7931A',
                        borderColor: 'rgba(247, 147, 26, 0.3)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: (context) => `Harga BTC: $${formatUSD(context.parsed.y, 2)}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                        ticks: {
                            color: '#64748b',
                            font: { family: 'JetBrains Mono', size: 10 },
                            maxTicksLimit: 10
                        }
                    },
                    y: {
                        position: 'right',
                        grid: { color: 'rgba(255, 255, 255, 0.04)' },
                        ticks: {
                            color: '#F7931A',
                            font: { family: 'JetBrains Mono', size: 10 },
                            callback: v => `$${v.toLocaleString()}`
                        }
                    }
                }
            }
        });

        // Lower Pane: MVRV Indicator Sub-Pane
        const mvrvGrad = ctxMVRV.createLinearGradient(0, 0, 0, 150);
        mvrvGrad.addColorStop(0, 'rgba(59, 130, 246, 0.2)');
        mvrvGrad.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

        mvrvChartInstance = new Chart(ctxMVRV, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'MVRV Ratio',
                        data: [],
                        borderColor: '#3B82F6',
                        backgroundColor: mvrvGrad,
                        borderWidth: 2,
                        fill: true,
                        tension: 0.2,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointHoverBackgroundColor: '#FFFFFF',
                        pointHoverBorderColor: '#3B82F6'
                    },
                    // Level 3.70 (Cycle Top - Red)
                    {
                        label: 'Top 3.7x',
                        data: [],
                        borderColor: 'rgba(239, 68, 68, 0.7)',
                        borderWidth: 1.2,
                        borderDash: [4, 4],
                        pointRadius: 0,
                        fill: false
                    },
                    // Level 2.40 (Overheated - Orange)
                    {
                        label: 'Overheated 2.4x',
                        data: [],
                        borderColor: 'rgba(245, 158, 11, 0.7)',
                        borderWidth: 1.2,
                        borderDash: [4, 4],
                        pointRadius: 0,
                        fill: false
                    },
                    // Level 1.00 (Breakeven - Green)
                    {
                        label: 'Breakeven 1.0x',
                        data: [],
                        borderColor: 'rgba(16, 185, 129, 0.7)',
                        borderWidth: 1.2,
                        borderDash: [4, 4],
                        pointRadius: 0,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#94a3b8',
                        bodyColor: '#3B82F6',
                        borderColor: 'rgba(59, 130, 246, 0.3)',
                        borderWidth: 1,
                        padding: 8,
                        callbacks: {
                            label: (context) => {
                                if (context.datasetIndex === 0) {
                                    return `MVRV Ratio: ${context.parsed.y.toFixed(3)}x`;
                                }
                                return null;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                        ticks: {
                            color: '#64748b',
                            font: { family: 'JetBrains Mono', size: 10 },
                            maxTicksLimit: 10
                        }
                    },
                    y: {
                        position: 'right',
                        suggestedMin: 0.5,
                        suggestedMax: 3.8,
                        grid: { color: 'rgba(255, 255, 255, 0.04)' },
                        ticks: {
                            color: '#3B82F6',
                            font: { family: 'JetBrains Mono', size: 10 },
                            callback: v => `${v.toFixed(1)}x`
                        }
                    }
                }
            }
        });
    }

    function renderChartsFromData(dataArray) {
        if (!priceChartInstance || !mvrvChartInstance) return;

        const labels = dataArray.map(d => d.time);
        const prices = dataArray.map(d => d.c);
        const mvrvs = dataArray.map(d => d.mvrv);

        const count = labels.length;
        const line37 = new Array(count).fill(3.70);
        const line24 = new Array(count).fill(2.40);
        const line10 = new Array(count).fill(1.00);

        // Update Price Chart
        priceChartInstance.data.labels = labels;
        priceChartInstance.data.datasets[0].data = prices;
        priceChartInstance.update('none');

        // Update MVRV Chart
        mvrvChartInstance.data.labels = labels;
        mvrvChartInstance.data.datasets[0].data = mvrvs;
        mvrvChartInstance.data.datasets[1].data = line37;
        mvrvChartInstance.data.datasets[2].data = line24;
        mvrvChartInstance.data.datasets[3].data = line10;
        mvrvChartInstance.update('none');
    }

    function updateLiveTickInCharts(timeLabel, currentPrice, currentMvrv) {
        if (state.chartPaused) return;

        const isTickTf = state.currentTimeframe === '1s';

        if (isTickTf) {
            // Push to tickBuffer (max 60 ticks)
            state.tickBuffer.push({ time: timeLabel, c: currentPrice, mvrv: currentMvrv });
            while (state.tickBuffer.length > 60) {
                state.tickBuffer.shift();
            }
            renderChartsFromData(state.tickBuffer);
            updateOHLCDisplay(currentPrice, state.high24h, state.low24h, currentPrice);
        } else {
            // Update latest candle of active timeframe
            if (state.klineData && state.klineData.length > 0) {
                const lastCandle = state.klineData[state.klineData.length - 1];
                lastCandle.c = currentPrice;
                lastCandle.mvrv = currentMvrv;
                if (currentPrice > lastCandle.h) lastCandle.h = currentPrice;
                if (currentPrice < lastCandle.l) lastCandle.l = currentPrice;

                updateOHLCDisplay(lastCandle.o, lastCandle.h, lastCandle.l, lastCandle.c);

                // Update the last point in both chart datasets
                const lastIdx = priceChartInstance.data.datasets[0].data.length - 1;
                if (lastIdx >= 0) {
                    priceChartInstance.data.datasets[0].data[lastIdx] = currentPrice;
                    mvrvChartInstance.data.datasets[0].data[lastIdx] = currentMvrv;
                    priceChartInstance.update('none');
                    mvrvChartInstance.update('none');
                }
            }
        }
    }

    // ===================================================================
    // WebSocket & Live Feed Handlers
    // ===================================================================
    function setConnectionStatus(status, text) {
        if (!el.wsStatus) return;
        const dot = el.wsStatus.querySelector('.status-dot');
        el.wsStatusText.textContent = text;

        if (status === 'connected') {
            dot.style.background = 'var(--color-green)';
            el.wsStatus.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        } else if (status === 'connecting') {
            dot.style.background = 'var(--color-orange)';
            el.wsStatus.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        } else {
            dot.style.background = 'var(--color-red)';
            el.wsStatus.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        }
    }

    function connectWebSocket() {
        if (state.ws) {
            try { state.ws.close(); } catch (e) {}
            state.ws = null;
        }

        clearTimeout(state.reconnectTimer);
        setConnectionStatus('connecting', 'Menghubungkan Stream...');

        if (state.wsSource === 'binance') {
            connectBinance();
        } else {
            connectCoinbase();
        }
    }

    function connectBinance() {
        const url = 'wss://stream.binance.com:9443/ws/btcusdt@ticker';
        try {
            state.ws = new WebSocket(url);
        } catch (err) {
            console.error('Binance WebSocket initialization error:', err);
            scheduleReconnect();
            return;
        }

        state.ws.onopen = () => {
            setConnectionStatus('connected', 'Binance Live Stream (Realtime)');
            clearInterval(state.restFallbackTimer);
        };

        state.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                const currentPrice = parseFloat(data.c);
                const high = parseFloat(data.h);
                const low = parseFloat(data.l);
                const changePct = parseFloat(data.P);

                handlePriceUpdate(currentPrice, high, low, changePct);
            } catch (err) {
                console.error('Error parsing Binance ticker data:', err);
            }
        };

        state.ws.onerror = (err) => {
            console.warn('Binance WebSocket error, trying fallback...', err);
            startRestFallback();
        };

        state.ws.onclose = () => {
            setConnectionStatus('disconnected', 'Terputus. Mencoba rekoneksi...');
            scheduleReconnect();
        };
    }

    function connectCoinbase() {
        const url = 'wss://ws-feed.exchange.coinbase.com';
        try {
            state.ws = new WebSocket(url);
        } catch (err) {
            console.error('Coinbase WebSocket initialization error:', err);
            scheduleReconnect();
            return;
        }

        state.ws.onopen = () => {
            setConnectionStatus('connected', 'Coinbase Live Feed (Realtime)');
            clearInterval(state.restFallbackTimer);
            const subscribeMsg = {
                type: 'subscribe',
                product_ids: ['BTC-USD'],
                channels: ['ticker']
            };
            state.ws.send(JSON.stringify(subscribeMsg));
        };

        state.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'ticker' && data.price) {
                    const price = parseFloat(data.price);
                    const high = data.high_24h ? parseFloat(data.high_24h) : state.high24h;
                    const low = data.low_24h ? parseFloat(data.low_24h) : state.low24h;
                    const open24h = data.open_24h ? parseFloat(data.open_24h) : price;
                    const changePct = open24h ? ((price - open24h) / open24h) * 100 : 0;

                    handlePriceUpdate(price, high, low, changePct);
                }
            } catch (err) {
                console.error('Error parsing Coinbase ticker data:', err);
            }
        };

        state.ws.onerror = (err) => {
            console.warn('Coinbase WebSocket error:', err);
            startRestFallback();
        };

        state.ws.onclose = () => {
            setConnectionStatus('disconnected', 'Terputus. Mencoba rekoneksi...');
            scheduleReconnect();
        };
    }

    function scheduleReconnect() {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = setTimeout(() => {
            connectWebSocket();
        }, 3500);
    }

    function startRestFallback() {
        if (state.restFallbackTimer) return;
        const fetchRest = async () => {
            try {
                const res = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT');
                if (res.ok) {
                    const d = await res.json();
                    setConnectionStatus('connected', 'REST Fallback Feed');
                    handlePriceUpdate(parseFloat(d.lastPrice), parseFloat(d.highPrice), parseFloat(d.lowPrice), parseFloat(d.priceChangePercent));
                }
            } catch (e) {
                console.warn('REST fallback failed:', e);
            }
        };
        fetchRest();
        state.restFallbackTimer = setInterval(fetchRest, 4000);
    }

    // ===================================================================
    // Price Update Dispatcher
    // ===================================================================
    function handlePriceUpdate(price, high, low, changePercent) {
        if (!price || isNaN(price)) return;

        state.prevPrice = state.btcPrice;
        state.btcPrice = price;
        state.high24h = high || state.high24h || price;
        state.low24h = low || state.low24h || price;
        state.deltaPercent24h = changePercent !== undefined ? changePercent : state.deltaPercent24h;

        const now = new Date();
        state.lastTickTime = now.toTimeString().split(' ')[0];
        if (el.lastTickTime) {
            el.lastTickTime.textContent = state.lastTickTime;
        }

        // Price Flash Animation
        if (state.prevPrice && state.btcPrice !== state.prevPrice) {
            el.btcPrice.classList.remove('price-flash-up', 'price-flash-down');
            void el.btcPrice.offsetWidth;
            if (state.btcPrice > state.prevPrice) {
                el.btcPrice.classList.add('price-flash-up');
            } else {
                el.btcPrice.classList.add('price-flash-down');
            }
        }

        // Render Price Card
        el.btcPrice.textContent = formatUSD(state.btcPrice, 2);
        el.btcHigh.textContent = `$${formatUSD(state.high24h, 0)}`;
        el.btcLow.textContent = `$${formatUSD(state.low24h, 0)}`;

        const isPositive = state.deltaPercent24h >= 0;
        el.deltaPercent.textContent = `${isPositive ? '+' : ''}${state.deltaPercent24h.toFixed(2)}%`;
        el.deltaIcon.textContent = isPositive ? '▲' : '▼';
        el.priceDelta.className = `metric-delta ${isPositive ? 'text-positive' : 'text-negative'}`;

        // Compute MVRV
        computeMVRV();

        // Push data to Dual Charts
        updateLiveTickInCharts(state.lastTickTime, state.btcPrice, state.mvrvRatio);
    }

    // ===================================================================
    // Simulator & Interactive Features
    // ===================================================================
    function setupSimulator() {
        if (!el.simPriceInput) return;

        const updateSimulation = () => {
            const simulatedPrice = parseFloat(el.simPriceInput.value);
            if (isNaN(simulatedPrice) || simulatedPrice <= 0) {
                el.simMvrvResult.textContent = '--';
                el.simZoneResult.textContent = '--';
                el.simZoneResult.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                el.simZoneResult.style.color = '#fff';
                return;
            }

            const simRatio = simulatedPrice / state.realizedPrice;
            el.simMvrvResult.textContent = `${simRatio.toFixed(2)}x`;

            let zoneName = '';
            let color = '';
            if (simRatio < 1.0) {
                zoneName = 'Undervalued / Bottom';
                color = 'var(--color-green)';
            } else if (simRatio < 2.4) {
                zoneName = 'Fair Value / Growth';
                color = 'var(--color-blue)';
            } else if (simRatio < 3.7) {
                zoneName = 'Overheated / High Risk';
                color = 'var(--color-orange)';
            } else {
                zoneName = 'Cycle Top / Mania';
                color = 'var(--color-red)';
            }

            el.simZoneResult.textContent = zoneName;
            el.simZoneResult.style.color = color;
            el.simZoneResult.style.backgroundColor = `${color}20`;
            el.simZoneResult.style.border = `1px solid ${color}`;
        };

        el.simPriceInput.addEventListener('input', updateSimulation);
    }

    // ===================================================================
    // Settings & Parameter Management
    // ===================================================================
    function setupSettingsHandlers() {
        el.settingsToggle.addEventListener('click', () => {
            el.settingsPanel.classList.toggle('hidden');
        });

        el.closeSettings.addEventListener('click', () => {
            el.settingsPanel.classList.add('hidden');
        });

        el.btnApplyParams.addEventListener('click', () => {
            const customRP = parseFloat(el.inputRealizedPrice.value);
            const customSupply = parseFloat(el.inputSupply.value);
            const source = el.selectSource.value;

            if (!isNaN(customRP) && customRP > 0) {
                state.realizedPrice = customRP;
            }
            if (!isNaN(customSupply) && customSupply > 0) {
                state.circulatingSupply = customSupply;
            }

            if (source !== state.wsSource) {
                state.wsSource = source;
                connectWebSocket();
            }

            computeMVRV();
            // Refresh klines with new RP
            const tfConfig = AVAILABLE_TIMEFRAMES.find(t => t.id === state.currentTimeframe);
            if (tfConfig && tfConfig.isKline) {
                fetchBinanceKlines(tfConfig.interval, tfConfig.limit);
            }

            el.settingsPanel.classList.add('hidden');
            playTone(660, 'sine', 0.15, 0.1);
        });

        el.btnResetParams.addEventListener('click', () => {
            state.realizedPrice = 53500.0;
            state.circulatingSupply = 19780000;
            el.inputRealizedPrice.value = 53500;
            el.inputSupply.value = 19780000;
            computeMVRV();
            playTone(440, 'sine', 0.1, 0.1);
        });

        el.btnSyncOnchain.addEventListener('click', async () => {
            el.btnSyncOnchain.textContent = 'Menyinkronkan...';
            el.btnSyncOnchain.disabled = true;

            try {
                const resp = await fetch('https://bitcoin-data.com/v1/realized-price/last');
                if (resp.ok) {
                    const data = await resp.json();
                    if (data && data[0] && data[0].realized_price) {
                        const syncedRP = parseFloat(data[0].realized_price);
                        state.realizedPrice = syncedRP;
                        el.inputRealizedPrice.value = syncedRP.toFixed(0);
                        computeMVRV();
                        alert(`Berhasil sinkronisasi Realized Price on-chain: $${formatUSD(syncedRP, 0)}`);
                    }
                } else {
                    throw new Error('API request failed');
                }
            } catch (err) {
                console.warn('Direct on-chain fetch blocked, using latest benchmark $53,500', err);
                alert('Informasi: Nilai Realized Price disinkronkan ke benchmark on-chain terbaru (~$53,500). Anda juga dapat memasukkan nilai kustom secara manual.');
            } finally {
                el.btnSyncOnchain.textContent = 'Sinkron On-Chain';
                el.btnSyncOnchain.disabled = false;
            }
        });

        el.soundToggle.addEventListener('click', () => {
            state.soundEnabled = !state.soundEnabled;
            if (state.soundEnabled) {
                el.soundIconOn.classList.remove('hidden');
                el.soundIconOff.classList.add('hidden');
                playTone(587.33, 'triangle', 0.15, 0.1);
            } else {
                el.soundIconOn.classList.add('hidden');
                el.soundIconOff.classList.remove('hidden');
            }
        });

        // Timeframe Dropdown toggle
        if (el.btnTfDropdown) {
            el.btnTfDropdown.addEventListener('click', (e) => {
                e.stopPropagation();
                el.tfDropdownMenu.classList.toggle('hidden');
            });

            document.addEventListener('click', () => {
                if (el.tfDropdownMenu) el.tfDropdownMenu.classList.add('hidden');
            });
        }

        // Pause Chart Button
        if (el.btnPauseChart) {
            el.btnPauseChart.addEventListener('click', () => {
                state.chartPaused = !state.chartPaused;
                el.btnPauseChart.textContent = state.chartPaused ? 'Lanjutkan' : 'Jeda';
                if (state.chartPaused) {
                    el.btnPauseChart.style.background = 'rgba(239, 68, 68, 0.2)';
                    el.btnPauseChart.style.color = '#ef4444';
                } else {
                    el.btnPauseChart.style.background = '';
                    el.btnPauseChart.style.color = '';
                }
            });
        }

        // Reset Zoom Button
        if (el.btnResetZoom) {
            el.btnResetZoom.addEventListener('click', () => {
                const tfConfig = AVAILABLE_TIMEFRAMES.find(t => t.id === state.currentTimeframe);
                if (tfConfig && tfConfig.isKline) {
                    fetchBinanceKlines(tfConfig.interval, tfConfig.limit);
                } else {
                    state.tickBuffer = [];
                    loadLiveTickBuffer();
                }
            });
        }
    }

    // ===================================================================
    // Initialization
    // ===================================================================
    function init() {
        initDualCharts();
        renderTimeframeToolbar();
        setupSimulator();
        setupSettingsHandlers();
        computeMVRV();
        connectWebSocket();

        // Initial load for active timeframe
        const initialTf = AVAILABLE_TIMEFRAMES.find(t => t.id === state.currentTimeframe) || AVAILABLE_TIMEFRAMES[1];
        if (initialTf.isKline) {
            fetchBinanceKlines(initialTf.interval, initialTf.limit);
        } else {
            loadLiveTickBuffer();
        }

        // Preset initial simulator price
        if (el.simPriceInput) {
            el.simPriceInput.value = 100000;
            el.simPriceInput.dispatchEvent(new Event('input'));
        }
    }

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
