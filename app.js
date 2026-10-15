
        /* ================= PWA: SERVICE WORKER + INSTALL ================= */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

let deferredPrompt = null;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standaloneQuery = window.matchMedia('(display-mode: standalone)');
const INSTALLED_KEY = 'flipclock.installed';

function isInstalledApp() {
    return standaloneQuery.matches || navigator.standalone === true;
}

/* Front-screen install button: visible until the app runs as an installed app */
function updateInstallUI() {
    let installedFlag = false;
    try { installedFlag = localStorage.getItem(INSTALLED_KEY) === '1'; } catch (e) {}
    const show = !isInstalledApp() && !installedFlag;
    const btn = document.getElementById('front-install-btn');
    btn.classList.toggle('hidden', !show);
    btn.classList.toggle('flex', show);
}

function markInstalled() {
    try { localStorage.setItem(INSTALLED_KEY, '1'); } catch (e) {}
    deferredPrompt = null;
    updateInstallUI();
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // The browser offering install again means the app is not installed (e.g. it was removed)
    try { localStorage.removeItem(INSTALLED_KEY); } catch (err) {}
    updateInstallUI();
});
window.addEventListener('appinstalled', markInstalled);
standaloneQuery.addEventListener && standaloneQuery.addEventListener('change', updateInstallUI);

function showTip(title, sub) {
    document.getElementById('alert-title').textContent = title;
    document.getElementById('alert-subtitle').textContent = sub;
    document.getElementById('alert-banner').classList.remove('hidden');
}

function installPWA() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choice) => {
            deferredPrompt = null;
            if (choice.outcome === 'accepted') markInstalled();
        });
    } else if (isIOS) {
        showTip('Install on iPhone', 'Tap Share, then "Add to Home Screen"');
    } else {
        showTip('Install App', 'Open the browser menu, then tap "Install app" or "Add to Home screen"');
    }
}

/* Keep the screen on while the app is open (it is a clock) */
let wakeLock = null;
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator && !wakeLock) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        }
    } catch (e) {}
}

/* ================= PERSISTENCE ================= */
const STORE_KEY = 'flipclock.v1';
function saveState() {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
            alarms, use24Hour, isMuted,
            timer: { total: timerTotalSeconds, remaining: timerRemainingSeconds, running: timerRunning, endAt: timerEndAt }
        }));
    } catch (e) {}
}
function loadState() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
}

/* ================= 3D FOLDING FLIP CARD ENGINE ================= */
        const flipValues = {};

        function initFlipUnits() {
            const units = document.querySelectorAll('.flip-unit');
            units.forEach(unit => {
                const id = unit.getAttribute('data-flip-id');
                flipValues[id] = '0';
                unit.innerHTML = `
                    <div class="upper-card"><span>0</span></div>
                    <div class="lower-card"><span>0</span></div>
                    <div class="flip-leaf">
                        <div class="flip-leaf-front"><span>0</span></div>
                        <div class="flip-leaf-back"><span>0</span></div>
                    </div>
                `;
            });
        }

        function updateFlipUnit(id, newValue, animate = true) {
            const strVal = String(newValue);
            if (flipValues[id] === strVal) return;

            const oldVal = flipValues[id] || '0';
            flipValues[id] = strVal;

            const unit = document.querySelector(`.flip-unit[data-flip-id="${id}"]`);
            if (!unit) return;

            const upper = unit.querySelector('.upper-card span');
            const lower = unit.querySelector('.lower-card span');
            const leafFront = unit.querySelector('.flip-leaf-front span');
            const leafBack = unit.querySelector('.flip-leaf-back span');

            if (!animate) {
                unit.classList.remove('flipping');
                upper.textContent = strVal;
                lower.textContent = strVal;
                leafFront.textContent = strVal;
                leafBack.textContent = strVal;
                return;
            }

            leafFront.textContent = oldVal;
            leafBack.textContent = strVal;
            upper.textContent = strVal;
            lower.textContent = oldVal;

            unit.classList.remove('flipping');
            void unit.offsetWidth;
            unit.classList.add('flipping');

            setTimeout(() => {
                lower.textContent = strVal;
                leafFront.textContent = strVal;
                unit.classList.remove('flipping');
            }, 410);
        }

        /* ================= WEB AUDIO SYNTHESIZER ================= */
        let audioCtx = null;
        let isMuted = false;
        let alertInterval = null;

        function ensureAudioContext() {
            if (!audioCtx) {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (AudioContextClass) audioCtx = new AudioContextClass();
            }
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
        }

        function playBeepPattern() {
            try { if (navigator.vibrate) navigator.vibrate([250, 120, 250]); } catch (e) {}
            if (isMuted) return;
            try {
                ensureAudioContext();
                if (!audioCtx) return;

                const now = audioCtx.currentTime;
                const freqs = [880, 1174.66];
                freqs.forEach((f, idx) => {
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(f, now + idx * 0.14);

                    gain.gain.setValueAtTime(0.001, now + idx * 0.14);
                    gain.gain.exponentialRampToValueAtTime(0.22, now + idx * 0.14 + 0.02);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 0.25);

                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    osc.start(now + idx * 0.14);
                    osc.stop(now + idx * 0.14 + 0.26);
                });
            } catch (e) {}
        }

        function triggerAlert(title, subtitle) {
            const banner = document.getElementById('alert-banner');
            document.getElementById('alert-title').textContent = title;
            document.getElementById('alert-subtitle').textContent = subtitle;
            banner.classList.remove('hidden');

            playBeepPattern();
            if (alertInterval) clearInterval(alertInterval);
            alertInterval = setInterval(playBeepPattern, 1200);
        }

        function dismissAlert() {
            document.getElementById('alert-banner').classList.add('hidden');
            if (alertInterval) {
                clearInterval(alertInterval);
                alertInterval = null;
            }
        }

        function toggleMute() {
            ensureAudioContext();
            isMuted = !isMuted;
            document.getElementById('sound-on-icon').classList.toggle('hidden', isMuted);
            document.getElementById('sound-off-icon').classList.toggle('hidden', !isMuted);
            document.getElementById('sound-label').textContent = isMuted ? 'Muted' : 'Sound On';
            saveState();
        }

        /* ================= NAVIGATION CONTROLLER ================= */
        const tabTitles = {
            clock: 'Current Time',
            alarm: 'Alarms',
            timer: 'Countdown Timer',
            stopwatch: 'Stopwatch & Laps'
        };

        function switchTab(tabName) {
            ensureAudioContext();
            document.getElementById('header-title').textContent = tabTitles[tabName] || 'Clock';

            ['clock', 'alarm', 'timer', 'stopwatch'].forEach(t => {
                const section = document.getElementById(`view-${t}`);
                if (t === tabName) {
                    section.classList.remove('hidden');
                    section.classList.add('flex');
                } else {
                    section.classList.add('hidden');
                    section.classList.remove('flex');
                }
            });

            document.querySelectorAll('.nav-btn').forEach(btn => {
                const active = btn.getAttribute('data-tab') === tabName;
                if (active) {
                    btn.className = 'nav-btn flex flex-col items-center justify-center py-2.5 rounded-xl transition-all bg-white text-black shadow-md';
                } else {
                    btn.className = 'nav-btn flex flex-col items-center justify-center py-2.5 rounded-xl transition-all text-neutral-500 hover:text-white';
                }
            });
        }

        /* ================= LIVE CLOCK & ALARM ENGINE ================= */
        let use24Hour = true;
        let lastTriggeredMinuteKey = '';

        let alarms = [];

        let modalHour = 7;
        let modalMinute = 0;

        function toggleTimeFormat() {
            use24Hour = !use24Hour;
            document.getElementById('format-toggle-btn').textContent = use24Hour ? '24H' : '12H';
            updateLiveClock();
            renderAlarms();
        }

        function formatTwoDigits(num) {
            return String(num).padStart(2, '0');
        }

        function updateLiveClock() {
            const now = new Date();
            const rawHours = now.getHours();
            const minutes = now.getMinutes();
            const seconds = now.getSeconds();

            let displayHours = rawHours;
            const ampmEl = document.getElementById('clock-ampm');

            if (!use24Hour) {
                const period = rawHours >= 12 ? 'PM' : 'AM';
                displayHours = rawHours % 12 || 12;
                ampmEl.textContent = period;
            } else {
                ampmEl.textContent = '24-HOUR FORMAT';
            }

            const hStr = formatTwoDigits(displayHours);
            const mStr = formatTwoDigits(minutes);
            const sStr = formatTwoDigits(seconds);

            updateFlipUnit('clock-h1', hStr[0]);
            updateFlipUnit('clock-h2', hStr[1]);
            updateFlipUnit('clock-m1', mStr[0]);
            updateFlipUnit('clock-m2', mStr[1]);
            updateFlipUnit('clock-s1', sStr[0]);
            updateFlipUnit('clock-s2', sStr[1]);

            const dateOptions = { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' };
            document.getElementById('clock-date').textContent = now.toLocaleDateString('en-US', dateOptions).toUpperCase();

            const currentKey = `${now.toDateString()} ${rawHours}:${minutes}`;
            if (lastTriggeredMinuteKey !== currentKey) {
                alarms.forEach(alarm => {
                    if (alarm.enabled && alarm.hour === rawHours && alarm.minute === minutes) {
                        lastTriggeredMinuteKey = currentKey;
                        triggerAlert('Alarm', `${formatAlarmTimeDisplay(alarm.hour, alarm.minute)} — ${alarm.label}`);
                    }
                });
            }
        }

        function formatAlarmTimeDisplay(h, m) {
            if (use24Hour) {
                return `${formatTwoDigits(h)}:${formatTwoDigits(m)}`;
            }
            const period = h >= 12 ? 'PM' : 'AM';
            const h12 = h % 12 || 12;
            return `${formatTwoDigits(h12)}:${formatTwoDigits(m)} ${period}`;
        }

        function updateNextAlarmSummary() {
            const active = alarms.filter(a => a.enabled);
            const textEl = document.getElementById('next-alarm-text');
            if (active.length === 0) {
                textEl.textContent = 'No active alarms';
                return;
            }
            const now = new Date();
            const nowMinutes = now.getHours() * 60 + now.getMinutes();

            let closest = active[0];
            let minDiff = Infinity;

            active.forEach(a => {
                const alarmMinutes = a.hour * 60 + a.minute;
                let diff = alarmMinutes - nowMinutes;
                if (diff <= 0) diff += 1440;
                if (diff < minDiff) {
                    minDiff = diff;
                    closest = a;
                }
            });

            const hrsLeft = Math.floor(minDiff / 60);
            const minsLeft = minDiff % 60;
            const timeStr = formatAlarmTimeDisplay(closest.hour, closest.minute);
            textEl.textContent = `Next: ${timeStr} (${hrsLeft}h ${minsLeft}m)`;
        }

        function renderAlarms() {
            saveState();
            const container = document.getElementById('alarm-list');
            updateNextAlarmSummary();

            if (alarms.length === 0) {
                container.innerHTML = `
                    <div class="h-48 flex flex-col items-center justify-center text-neutral-600 border border-dashed border-neutral-900 rounded-2xl">
                        <p class="text-xs font-mono uppercase tracking-widest">No alarms configured</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = alarms.map(alarm => {
                const displayTime = formatAlarmTimeDisplay(alarm.hour, alarm.minute);
                return `
                    <div class="flex items-center justify-between p-4 rounded-2xl border ${alarm.enabled ? 'border-neutral-800 bg-neutral-950' : 'border-neutral-900/60 bg-black opacity-50'} transition">
                        <div>
                            <div class="font-mono text-2xl sm:text-3xl font-bold tracking-tight text-white">${displayTime}</div>
                            <div class="text-xs text-neutral-400 mt-0.5">${alarm.label}</div>
                        </div>
                        <div class="flex items-center gap-3">
                            <button onclick="toggleAlarm(${alarm.id})" class="w-12 h-7 rounded-full p-1 transition-colors duration-200 ${alarm.enabled ? 'bg-white' : 'bg-neutral-800'}" aria-label="Toggle Alarm">
                                <div class="w-5 h-5 rounded-full transition-transform duration-200 ${alarm.enabled ? 'translate-x-5 bg-black' : 'translate-x-0 bg-neutral-400'}"></div>
                            </button>
                            <button onclick="deleteAlarm(${alarm.id})" class="p-2 text-neutral-600 hover:text-white transition" title="Delete Alarm">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function toggleAlarm(id) {
            alarms = alarms.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a);
            renderAlarms();
        }

        function deleteAlarm(id) {
            alarms = alarms.filter(a => a.id !== id);
            renderAlarms();
        }

        function openAlarmModal() {
            const now = new Date();
            modalHour = (now.getHours() + 1) % 24;
            modalMinute = 0;
            document.getElementById('modal-hour').textContent = formatTwoDigits(modalHour);
            document.getElementById('modal-minute').textContent = formatTwoDigits(modalMinute);
            document.getElementById('modal-label').value = '';
            document.getElementById('alarm-modal').classList.remove('hidden');
        }

        function closeAlarmModal() {
            document.getElementById('alarm-modal').classList.add('hidden');
        }

        function stepModalTime(unit, delta) {
            if (unit === 'h') {
                modalHour = (modalHour + delta + 24) % 24;
                document.getElementById('modal-hour').textContent = formatTwoDigits(modalHour);
            } else {
                modalMinute = (modalMinute + delta + 60) % 60;
                document.getElementById('modal-minute').textContent = formatTwoDigits(modalMinute);
            }
        }

        function saveNewAlarm() {
            const labelInput = document.getElementById('modal-label').value.trim();
            alarms.push({
                id: Date.now(),
                hour: modalHour,
                minute: modalMinute,
                label: labelInput || 'Alarm',
                enabled: true
            });
            alarms.sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
            renderAlarms();
            closeAlarmModal();
        }

        /* ================= COUNTDOWN TIMER ENGINE (timestamp based, survives reloads) ================= */
let timerTotalSeconds = 300;
let timerRemainingSeconds = 300;
let timerRunning = false;
let timerInterval = null;
let timerEndAt = 0;

function setTimerUI(state) {
    const labels = { ready: ['Start', 'Ready'], running: ['Pause', 'Running'], paused: ['Resume', 'Paused'], done: ['Start', 'Completed'] };
    const setup = document.getElementById('timer-setup-controls');
    document.getElementById('timer-toggle-btn').textContent = labels[state][0];
    document.getElementById('timer-status-badge').textContent = labels[state][1];
    setup.classList.toggle('opacity-30', state === 'running');
    setup.classList.toggle('pointer-events-none', state === 'running');
}

function renderTimerDisplay(animate = true) {
    const hStr = formatTwoDigits(Math.floor(timerRemainingSeconds / 3600));
    const mStr = formatTwoDigits(Math.floor((timerRemainingSeconds % 3600) / 60));
    const sStr = formatTwoDigits(timerRemainingSeconds % 60);
    updateFlipUnit('timer-h1', hStr[0], animate);
    updateFlipUnit('timer-h2', hStr[1], animate);
    updateFlipUnit('timer-m1', mStr[0], animate);
    updateFlipUnit('timer-m2', mStr[1], animate);
    updateFlipUnit('timer-s1', sStr[0], animate);
    updateFlipUnit('timer-s2', sStr[1], animate);
}

function adjustTimer(unitMultiplier, step) {
    if (timerRunning) return;
    timerRemainingSeconds = Math.max(0, Math.min(359999, timerRemainingSeconds + unitMultiplier * step));
    timerTotalSeconds = timerRemainingSeconds;
    renderTimerDisplay(true);
    saveState();
}

function setTimerPreset(seconds) {
    if (timerRunning) return;
    timerRemainingSeconds = seconds;
    timerTotalSeconds = seconds;
    renderTimerDisplay(true);
    saveState();
}

function timerTick() {
    const left = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
    if (left !== timerRemainingSeconds) {
        timerRemainingSeconds = left;
        renderTimerDisplay(true);
    }
    if (left <= 0) {
        clearInterval(timerInterval);
        timerRunning = false;
        timerEndAt = 0;
        setTimerUI('done');
        saveState();
        triggerAlert('Timer Complete', 'Your countdown has finished');
    }
}

function toggleTimer() {
    ensureAudioContext();
    if (timerRunning) {
        clearInterval(timerInterval);
        timerRemainingSeconds = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
        timerRunning = false;
        timerEndAt = 0;
        setTimerUI('paused');
        renderTimerDisplay(true);
    } else {
        if (timerRemainingSeconds <= 0) return;
        timerRunning = true;
        timerEndAt = Date.now() + timerRemainingSeconds * 1000;
        setTimerUI('running');
        timerInterval = setInterval(timerTick, 250);
    }
    saveState();
}

function resetTimer() {
    clearInterval(timerInterval);
    timerRunning = false;
    timerEndAt = 0;
    timerRemainingSeconds = timerTotalSeconds || 300;
    setTimerUI('ready');
    renderTimerDisplay(true);
    saveState();
}

/* ================= STOPWATCH & LAP COUNTER ENGINE ================= */
        let swRunning = false;
        let swStartTime = 0;
        let swElapsedMs = 0;
        let swRafId = null;
        let swLaps = [];
        let lastLapTotalMs = 0;

        function renderStopwatchDisplay(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60) % 100;
            const seconds = totalSeconds % 60;
            const centiseconds = Math.floor((ms % 1000) / 10);

            const mStr = formatTwoDigits(minutes);
            const sStr = formatTwoDigits(seconds);
            const csStr = formatTwoDigits(centiseconds);

            updateFlipUnit('sw-m1', mStr[0], true);
            updateFlipUnit('sw-m2', mStr[1], true);
            updateFlipUnit('sw-s1', sStr[0], true);
            updateFlipUnit('sw-s2', sStr[1], true);

            updateFlipUnit('sw-ms1', csStr[0], false);
            updateFlipUnit('sw-ms2', csStr[1], false);
        }

        function formatStopwatchString(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            const centiseconds = Math.floor((ms % 1000) / 10);
            return `${formatTwoDigits(minutes)}:${formatTwoDigits(seconds)}.${formatTwoDigits(centiseconds)}`;
        }

        function tickStopwatch() {
            if (!swRunning) return;
            const currentMs = swElapsedMs + (performance.now() - swStartTime);
            renderStopwatchDisplay(currentMs);
            swRafId = requestAnimationFrame(tickStopwatch);
        }

        function toggleStopwatch() {
            ensureAudioContext();
            const primaryBtn = document.getElementById('sw-primary-btn');
            const secondaryBtn = document.getElementById('sw-secondary-btn');

            if (swRunning) {
                swElapsedMs += performance.now() - swStartTime;
                swRunning = false;
                cancelAnimationFrame(swRafId);
                primaryBtn.textContent = 'Resume';
                secondaryBtn.textContent = 'Reset';
                secondaryBtn.disabled = false;
            } else {
                swStartTime = performance.now();
                swRunning = true;
                primaryBtn.textContent = 'Stop';
                secondaryBtn.textContent = 'Lap';
                secondaryBtn.disabled = false;
                swRafId = requestAnimationFrame(tickStopwatch);
            }
        }

        function lapOrResetStopwatch() {
            const primaryBtn = document.getElementById('sw-primary-btn');
            const secondaryBtn = document.getElementById('sw-secondary-btn');

            if (swRunning) {
                const totalMs = swElapsedMs + (performance.now() - swStartTime);
                const splitMs = totalMs - lastLapTotalMs;
                lastLapTotalMs = totalMs;

                swLaps.unshift({
                    number: swLaps.length + 1,
                    split: splitMs,
                    total: totalMs
                });
                renderLaps();
            } else {
                swElapsedMs = 0;
                lastLapTotalMs = 0;
                swLaps = [];
                primaryBtn.textContent = 'Start';
                secondaryBtn.textContent = 'Lap';
                secondaryBtn.disabled = true;
                renderStopwatchDisplay(0);
                renderLaps();
            }
        }

        function renderLaps() {
            const listEl = document.getElementById('lap-list');
            if (swLaps.length === 0) {
                listEl.innerHTML = `
                    <div class="h-full flex items-center justify-center text-xs text-neutral-600 font-mono">No laps recorded</div>
                `;
                return;
            }

            let fastestSplit = Infinity;
            let slowestSplit = -Infinity;
            if (swLaps.length >= 2) {
                swLaps.forEach(l => {
                    if (l.split < fastestSplit) fastestSplit = l.split;
                    if (l.split > slowestSplit) slowestSplit = l.split;
                });
            }

            listEl.innerHTML = swLaps.map(lap => {
                let badge = '';
                if (swLaps.length >= 2) {
                    if (lap.split === fastestSplit) {
                        badge = '<span class="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-white text-black font-bold">BEST</span>';
                    } else if (lap.split === slowestSplit) {
                        badge = '<span class="ml-2 text-[9px] px-1.5 py-0.5 rounded border border-neutral-700 text-neutral-400">SLOW</span>';
                    }
                }
                return `
                    <div class="py-3 flex items-center justify-between font-mono text-xs sm:text-sm">
                        <span class="text-neutral-400 flex items-center">#${formatTwoDigits(lap.number)}${badge}</span>
                        <span class="text-white font-semibold">${formatStopwatchString(lap.split)}</span>
                        <span class="text-neutral-300">${formatStopwatchString(lap.total)}</span>
                    </div>
                `;
            }).join('');
        }

        /* ================= INITIALIZATION ================= */
window.onload = function () {
    const s = loadState();
    if (Array.isArray(s.alarms)) alarms = s.alarms;
    use24Hour = s.use24Hour !== false;
    isMuted = !!s.isMuted;
    document.getElementById('format-toggle-btn').textContent = use24Hour ? '24H' : '12H';
    document.getElementById('sound-on-icon').classList.toggle('hidden', isMuted);
    document.getElementById('sound-off-icon').classList.toggle('hidden', !isMuted);
    document.getElementById('sound-label').textContent = isMuted ? 'Muted' : 'Sound On';

    initFlipUnits();

    let finishedWhileAway = false;
    if (s.timer) {
        timerTotalSeconds = s.timer.total ?? 300;
        timerRemainingSeconds = s.timer.remaining ?? timerTotalSeconds;
        if (s.timer.running && s.timer.endAt) {
            timerEndAt = s.timer.endAt;
            timerRemainingSeconds = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
            if (timerRemainingSeconds > 0) {
                timerRunning = true;
                setTimerUI('running');
                timerInterval = setInterval(timerTick, 250);
            } else {
                timerEndAt = 0;
                setTimerUI('done');
                finishedWhileAway = true;
            }
        }
    }

    renderAlarms();
    renderTimerDisplay(false);
    renderStopwatchDisplay(0);
    if (finishedWhileAway) triggerAlert('Timer Complete', 'Your countdown finished while the app was closed');

    // Tick aligned to the real second boundary so the clock never lags
    (function loop() {
        updateLiveClock();
        updateNextAlarmSummary();
        setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
    })();

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            updateLiveClock();
            if (timerRunning) timerTick();
            requestWakeLock();
        }
    });
    document.addEventListener('pointerdown', () => { ensureAudioContext(); requestWakeLock(); }, { passive: true });
    requestWakeLock();

    updateInstallUI();
};
