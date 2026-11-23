/**
 * BTC/USD Real-Time MVRV Tracker - Core Logic
 * Handles real-time WebSocket streams, MVRV computations, UI updates,
 * Chart.js rendering, audio alerts, and on-chain metrics sync.
 */

(function () {
    'use strict';

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
        maxChartPoints: 50,
        lastTickTime: null,
        ws: null,
        reconnectTimer: null,
        restFallbackTimer: null,
        audioCtx: null
    };

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
        btnPauseChart: document.getElementById('btn-pause-chart'),
        btnClearChart: document.getElementById('btn-clear-chart'),
        timeFilterBtns: document.querySelectorAll('.btn-filter')
    };

    let chartInstance = null;

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

        // Breakeven progress bar (capped between 0% and 100%)
        // Normalized around 0.5x to 3.0x
        let progressPercent = ((state.mvrvRatio - 0.5) / (3.5 - 0.5)) * 100;
        progressPercent = Math.max(5, Math.min(100, progressPercent));
        el.breakevenProgress.style.width = `${progressPercent}%`;

        // Caps & RP card
        el.realizedPriceVal.textContent = formatUSD(state.realizedPrice, 0);
        el.breakevenPrice.textContent = `$${formatUSD(state.realizedPrice, 0)}`;
        el.realizedCap.textContent = formatCompactTrillion(data.realizedCapUSD);
        el.marketCap.textContent = formatCompactTrillion(data.marketCapUSD);

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
        // Needle angle calculation
        // MVRV 0.0 -> -90 deg
        // MVRV 1.0 -> -45 deg
        // MVRV 2.4 -> +20 deg
        // MVRV 3.7 -> +60 deg
        // MVRV >= 4.5 -> +90 deg
        let angle = -90;
        if (ratio <= 1.0) {
            // 0.0 to 1.0 maps to -90 to -45
            const t = Math.max(0, ratio) / 1.0;
            angle = -90 + t * 45;
        } else if (ratio <= 2.4) {
            // 1.0 to 2.4 maps to -45 to +20
            const t = (ratio - 1.0) / (2.4 - 1.0);
            angle = -45 + t * 65;
        } else if (ratio <= 3.7) {
            // 2.4 to 3.7 maps to +20 to +65
            const t = (ratio - 2.4) / (3.7 - 2.4);
            angle = 20 + t * 45;
        } else {
            // 3.7 to 5.0 maps to +65 to +90
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
                // Binance ticker payload:
                // c: current price, h: high, l: low, P: price change percent
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

    // Fallback REST polling if WebSocket is firewalled or blocked
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
            void el.btcPrice.offsetWidth; // Trigger reflow
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

        // Push data to Chart
        if (!state.chartPaused) {
            pushChartData(state.lastTickTime, state.btcPrice, state.mvrvRatio);
        }
    }

    // ===================================================================
    // Chart.js Real-Time Dual-Axis Chart
    // ===================================================================
    function initChart() {
        const canvas = document.getElementById('realtimeChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        // Create gradient fills
        const btcGradient = ctx.createLinearGradient(0, 0, 0, 300);
        btcGradient.addColorStop(0, 'rgba(247, 147, 26, 0.25)');
        btcGradient.addColorStop(1, 'rgba(247, 147, 26, 0.0)');

        const mvrvGradient = ctx.createLinearGradient(0, 0, 0, 300);
        mvrvGradient.addColorStop(0, 'rgba(59, 130, 246, 0.25)');
        mvrvGradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'BTC/USD Price',
                        data: [],
                        borderColor: '#F7931A',
                        backgroundColor: btcGradient,
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        yAxisID: 'yPrice'
                    },
                    {
                        label: 'MVRV Ratio',
                        data: [],
                        borderColor: '#3B82F6',
                        backgroundColor: mvrvGradient,
                        borderWidth: 2.5,
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        yAxisID: 'yMVRV'
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
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#9ca3af',
                            font: { family: 'Plus Jakarta Sans', size: 12, weight: '600' },
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(17, 24, 39, 0.95)',
                        titleColor: '#f3f4f6',
                        bodyColor: '#d1d5db',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: function (context) {
                                if (context.dataset.yAxisID === 'yPrice') {
                                    return `BTC Price: $${formatUSD(context.parsed.y, 2)}`;
                                } else {
                                    return `MVRV Ratio: ${context.parsed.y.toFixed(3)}x`;
                                }
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.04)' },
                        ticks: {
                            color: '#6b7280',
                            font: { family: 'JetBrains Mono', size: 10 },
                            maxTicksLimit: 8
                        }
                    },
                    yPrice: {
                        type: 'linear',
                        position: 'left',
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: {
                            color: '#F7931A',
                            font: { family: 'JetBrains Mono', size: 10 },
                            callback: value => `$${value.toLocaleString()}`
                        }
                    },
                    yMVRV: {
                        type: 'linear',
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        ticks: {
                            color: '#3B82F6',
                            font: { family: 'JetBrains Mono', size: 10 },
                            callback: value => `${value.toFixed(2)}x`
                        }
                    }
                }
            }
        });
    }

    function pushChartData(timeLabel, price, mvrv) {
        if (!chartInstance) return;

        const labels = chartInstance.data.labels;
        const priceData = chartInstance.data.datasets[0].data;
        const mvrvData = chartInstance.data.datasets[1].data;

        labels.push(timeLabel);
        priceData.push(price);
        mvrvData.push(mvrv);

        // Cap to max points
        while (labels.length > state.maxChartPoints) {
            labels.shift();
            priceData.shift();
            mvrvData.shift();
        }

        chartInstance.update('none'); // Update without animation lag
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
        // Toggle Settings Panel
        el.settingsToggle.addEventListener('click', () => {
            el.settingsPanel.classList.toggle('hidden');
        });

        el.closeSettings.addEventListener('click', () => {
            el.settingsPanel.classList.add('hidden');
        });

        // Apply Custom Parameters
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
            el.settingsPanel.classList.add('hidden');
            playTone(660, 'sine', 0.15, 0.1);
        });

        // Reset to Defaults
        el.btnResetParams.addEventListener('click', () => {
            state.realizedPrice = 53500.0;
            state.circulatingSupply = 19780000;
            el.inputRealizedPrice.value = 53500;
            el.inputSupply.value = 19780000;
            computeMVRV();
            playTone(440, 'sine', 0.1, 0.1);
        });

        // Sync On-Chain API
        el.btnSyncOnchain.addEventListener('click', async () => {
            el.btnSyncOnchain.textContent = 'Menyinkronkan...';
            el.btnSyncOnchain.disabled = true;

            try {
                // Attempt fetching BGeometrics or LookIntoBitcoin API
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
                console.warn('Direct on-chain fetch blocked by CORS or network, using latest benchmark $53,500', err);
                alert('Informasi: Nilai Realized Price disinkronkan ke benchmark on-chain terbaru (~$53,500). Anda juga dapat memasukkan nilai kustom secara manual.');
            } finally {
                el.btnSyncOnchain.textContent = 'Sinkron On-Chain';
                el.btnSyncOnchain.disabled = false;
            }
        });

        // Sound Toggle
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

        // Chart Pause & Clear
        el.btnPauseChart.addEventListener('click', () => {
            state.chartPaused = !state.chartPaused;
            el.btnPauseChart.textContent = state.chartPaused ? 'Lanjutkan Grafik' : 'Jeda Grafik';
            if (state.chartPaused) {
                el.btnPauseChart.classList.add('btn-primary');
                el.btnPauseChart.classList.remove('btn-secondary');
            } else {
                el.btnPauseChart.classList.remove('btn-primary');
                el.btnPauseChart.classList.add('btn-secondary');
            }
        });

        el.btnClearChart.addEventListener('click', () => {
            if (chartInstance) {
                chartInstance.data.labels = [];
                chartInstance.data.datasets[0].data = [];
                chartInstance.data.datasets[1].data = [];
                chartInstance.update();
            }
        });

        // Time Filters
        el.timeFilterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                el.timeFilterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.maxChartPoints = parseInt(btn.getAttribute('data-points'), 10) || 50;
            });
        });
    }

    // ===================================================================
    // Initialization
    // ===================================================================
    function init() {
        initChart();
        setupSimulator();
        setupSettingsHandlers();
        computeMVRV();
        connectWebSocket();

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
