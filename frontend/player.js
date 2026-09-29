// ============================================================
//  ФИКС ВЫСОТЫ ВЬЮПОРТА (iOS)
// ============================================================
function updateAppHeight() {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', h + 'px');
}
updateAppHeight();
window.addEventListener('resize', updateAppHeight);
window.addEventListener('orientationchange', () => setTimeout(updateAppHeight, 150));
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateAppHeight);
    window.visualViewport.addEventListener('scroll', updateAppHeight);
}

// ============================================================
//  КАЧЕСТВО ВИДЕО
// ============================================================
const QUALITY_LEVELS = [1080, 720, 480, 360, 144];
const QUALITY_KEY = 'video_quality';

let currentQuality = loadQualityPreference();

function loadQualityPreference() {
    try {
        const raw = localStorage.getItem(QUALITY_KEY);
        if (raw === 'auto') return 'auto';
        const n = parseInt(raw, 10);
        if (QUALITY_LEVELS.includes(n)) return n;
        return 'auto';
    } catch (e) { return 'auto'; }
}

function saveQualityPreference(q) {
    try { localStorage.setItem(QUALITY_KEY, String(q)); } catch (e) {}
}

function autoQuality() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const et = conn && conn.effectiveType;
    const ua = navigator.userAgent || '';
    const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
    const isSmallScreen = window.innerWidth < 768;

    if (et === 'slow-2g' || et === '2g') return 144;
    if (et === '3g') return isMobile || isSmallScreen ? 360 : 480;
    if (isMobile || isSmallScreen) return 720;
    return 1080;
}

function effectiveQuality() {
    return currentQuality === 'auto' ? autoQuality() : currentQuality;
}

function buildQualityChain(requested) {
    const chain = [];
    const startIdx = QUALITY_LEVELS.indexOf(requested);
    if (startIdx === -1) {
        return QUALITY_LEVELS.slice().concat(['base']);
    }
    for (let i = startIdx; i < QUALITY_LEVELS.length; i++) {
        chain.push(QUALITY_LEVELS[i]);
    }
    chain.push('base');
    return chain;
}

function buildVideoUrl(baseName, quality) {
    if (!baseName) return '';
    if (/^https?:\/\//i.test(baseName)) return baseName;
    const stem = baseName.replace(/\.mp4$/i, '');
    if (quality === 'base') return `/uploads/${baseName}`;
    return `/uploads/${stem}_${quality}.mp4`;
}

function updateQualityLabel() {
    const el = document.getElementById('qualityLabel');
    if (!el) return;
    if (currentQuality === 'auto') {
        el.textContent = 'AUTO';
    } else {
        el.textContent = currentQuality + 'p';
    }
}

// ============================================================
//  DOM
// ============================================================
const video = document.getElementById('videoPlayer');
const insertPlayer = document.getElementById('insertPlayer');
const overlay = document.getElementById('overlay');
const conditionalOverlaysEl = document.getElementById('conditionalOverlays');
const controls = document.getElementById('controls');
const player = document.getElementById('player');
const endMessage = document.getElementById('endMessage');
const timeline = document.getElementById('timeline');
const timelineProgress = document.getElementById('timelineProgress');
const timelineBuffered = document.getElementById('timelineBuffered');
const timelineThumb = document.getElementById('timelineThumb');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const playPauseBtn = document.getElementById('playPauseBtn');
const volumeBtn = document.getElementById('volumeBtn');
const volumeSlider = document.getElementById('volumeSlider');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const qualityBtn = document.getElementById('qualityBtn');
const qualityPopup = document.getElementById('qualityPopup');
const qualityPopupList = document.getElementById('qualityPopupList');
const choiceCountdownEl = document.getElementById('choiceCountdown');
const countdownNumberEl = document.getElementById('countdownNumber');
const countdownRingEl = document.getElementById('countdownRing');
const bufferingSpinner = document.getElementById('bufferingSpinner');

// ============================================================
//  СОСТОЯНИЕ
// ============================================================
let currentScene = null;
let currentSceneId = null;
let isInsertPlaying = false;
let isAutoAdvancing = false;
let lastTime = 0;
let hideControlsTimeout = null;
let isDraggingTimeline = false;

const sceneChoiceState = {
    pauseAt: null,
    triggered: false,
    resolved: false,
    timeoutId: null,
    countdownId: null,
    timeoutAt: 0,
    timeoutDuration: 30
};

const STORAGE_KEY = 'podruga_progress';

// ============================================================
//  СОХРАНЕНИЕ
// ============================================================
function saveProgress() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            sceneId: currentSceneId,
            savedAt: Date.now()
        }));
    } catch (e) {}
}
function loadProgress() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}
function clearProgress() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
}

// ============================================================
//  ФОРМАТ ВРЕМЕНИ
// ============================================================
function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function getActiveVideo() {
    return isInsertPlaying ? insertPlayer : video;
}

// ============================================================
//  CHOICE STATE
// ============================================================
function resetChoiceState() {
    if (sceneChoiceState.timeoutId) {
        clearTimeout(sceneChoiceState.timeoutId);
        sceneChoiceState.timeoutId = null;
    }
    if (sceneChoiceState.countdownId) {
        clearInterval(sceneChoiceState.countdownId);
        sceneChoiceState.countdownId = null;
    }
    sceneChoiceState.pauseAt = null;
    sceneChoiceState.triggered = false;
    sceneChoiceState.resolved = false;
    sceneChoiceState.timeoutAt = 0;
    sceneChoiceState.timeoutDuration = 30;
    if (choiceCountdownEl) choiceCountdownEl.classList.add('hidden');
}

function computeChoicePauseAt(scene) {
    if (!scene) return null;
    if (typeof scene.pause_at === 'number') return scene.pause_at;
    if (!scene.choices || !scene.choices.length) return null;
    const starts = scene.choices
        .map(c => c.area && c.area.time_start)
        .filter(t => typeof t === 'number' && !isNaN(t));
    if (!starts.length) return null;
    return Math.min(...starts);
}

// ============================================================
//  ЗАГРУЗКА ВИДЕО С ФОЛБЭКОМ ПО КАЧЕСТВУ
// ============================================================
function loadVideoWithFallback(baseName, opts = {}) {
    const chain = buildQualityChain(effectiveQuality());
    let index = 0;
    let resolved = false;
    const targetVideo = opts.isInsert ? insertPlayer : video;

    function tryNext() {
        if (index >= chain.length) {
            console.warn('Не удалось загрузить ни одно качество для', baseName);
            if (typeof opts.onAllFailed === 'function') opts.onAllFailed();
            return;
        }
        const q = chain[index++];
        const url = buildVideoUrl(baseName, q);
        console.log(`[quality] ${baseName} → ${q} (${url})`);

        targetVideo.src = url;
        targetVideo.load();

        const onError = () => {
            targetVideo.removeEventListener('error', onError);
            if (resolved) return;
            console.warn(`[quality] ${q} не загрузилось, пробуем ниже`);
            tryNext();
        };
        targetVideo.addEventListener('error', onError);

        const onLoadedData = () => {
            targetVideo.removeEventListener('error', onError);
            targetVideo.removeEventListener('loadeddata', onLoadedData);
            if (resolved) return;
            resolved = true;
            if (typeof opts.onSuccess === 'function') opts.onSuccess(q);
        };
        targetVideo.addEventListener('loadeddata', onLoadedData, { once: true });
    }
    tryNext();
}

// ============================================================
//  ЗАГРУЗКА СЦЕНЫ
// ============================================================
async function loadScene(sceneId) {
    try {
        resetChoiceState();
        const res = await fetch(`/api/scene/${sceneId}`);
        if (!res.ok) throw new Error('Сцена не найдена');
        const scene = await res.json();

        currentSceneId = scene.id;
        currentScene = scene;
        isAutoAdvancing = false;
        endMessage.classList.add('hidden');

        if (scene.video && scene.video.trim() !== '') {
            loadVideoWithFallback(scene.video, {
                isInsert: false,
                onSuccess: () => {
                    video.play().catch(() => {
                        controls.classList.add('visible');
                        player.classList.add('show-controls');
                    });
                }
            });
        } else {
            video.removeAttribute('src');
            video.load();
        }

        buildChoiceAreas(scene);
        sceneChoiceState.pauseAt = computeChoicePauseAt(scene);
        sceneChoiceState.timeoutDuration = typeof scene.choice_timeout === 'number'
            ? scene.choice_timeout
            : 30;

        conditionalOverlaysEl.innerHTML = '';
        lastTime = 0;
        saveProgress();
    } catch (err) {
        console.error(err);
    }
}

function buildChoiceAreas(scene) {
    overlay.innerHTML = '';
    if (!scene.choices) return;

    scene.choices.forEach(choice => {
        const area = choice.area;
        if (!area) return;
        const div = document.createElement('div');
        div.className = 'area';
        div.style.left = area.x + '%';
        div.style.top = area.y + '%';
        div.style.width = area.width + '%';
        div.style.height = area.height + '%';
        div.style.display = 'none';
        div.dataset.choiceId = choice.id;

        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = choice.label || '';
        div.appendChild(label);

        div.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sceneChoiceState.resolved) return;
            handleChoice(choice);
        });
        overlay.appendChild(div);
    });
}

// ============================================================
//  ТРИГГЕР ВЫБОРА
// ============================================================
function triggerChoicePause() {
    if (!currentScene || !currentScene.choices || sceneChoiceState.resolved) return;
    sceneChoiceState.triggered = true;

    video.pause();
    overlay.querySelectorAll('.area').forEach(el => el.style.display = 'flex');

    const timeout = sceneChoiceState.timeoutDuration;
    sceneChoiceState.timeoutAt = Date.now() + timeout * 1000;

    choiceCountdownEl.classList.remove('hidden');
    countdownNumberEl.textContent = timeout;
    const circumference = 2 * Math.PI * 19;
    countdownRingEl.style.strokeDasharray = circumference;
    countdownRingEl.style.strokeDashoffset = 0;

    sceneChoiceState.countdownId = setInterval(() => {
        const remaining = Math.max(0, (sceneChoiceState.timeoutAt - Date.now()) / 1000);
        countdownNumberEl.textContent = Math.ceil(remaining);
        const ratio = remaining / timeout;
        countdownRingEl.style.strokeDashoffset = circumference * (1 - ratio);
    }, 100);

    sceneChoiceState.timeoutId = setTimeout(() => {
        if (!sceneChoiceState.resolved) handleNoChoice();
    }, timeout * 1000);
}

// ============================================================
//  ПРОИГРЫВАНИЕ ВСТАВКИ (без resume — просто "доиграть и resolve")
// ============================================================
function playInsertOnly(videoFile) {
    return new Promise((resolve) => {
        isInsertPlaying = true;
        playPauseBtn.classList.add('playing');
        currentTimeEl.textContent = '0:00';
        durationEl.textContent = '0:00';
        timelineProgress.style.width = '0%';
        timelineThumb.style.left = '0%';
        timelineBuffered.style.width = '0%';

        video.pause();
        insertPlayer.classList.add('active');
        insertPlayer.currentTime = 0;

        let resolved = false;

        const finish = () => {
            if (resolved) return;
            resolved = true;
            insertPlayer.removeEventListener('ended', onEnded);
            insertPlayer.removeEventListener('error', onError);
            insertPlayer.classList.remove('active');
            insertPlayer.removeAttribute('src');
            insertPlayer.load();

            isInsertPlaying = false;
            playPauseBtn.classList.remove('playing');
            resolve();
        };

        const onEnded = finish;
        const onError = () => {
            console.warn('Вставка не загрузилась, пропускаем:', videoFile);
            finish();
        };

        insertPlayer.addEventListener('ended', onEnded);
        insertPlayer.addEventListener('error', onError);

        loadVideoWithFallback(videoFile, {
            isInsert: true,
            onSuccess: () => {
                insertPlayer.play().catch(() => {
                    insertPlayer.muted = true;
                    insertPlayer.play().catch(() => onError());
                });
            },
            onAllFailed: () => onError()
        });

        setTimeout(() => {
            if (!resolved && insertPlayer.readyState < 2) {
                console.warn('Вставка не готова за 5 секунд, пропускаем');
                finish();
            }
        }, 5000);
    });
}

// ============================================================
//  ЛОГИКА ПОСЛЕ ВСТАВКИ
//  Если resume_at задан — возвращаемся в текущую сцену.
//  Если нет — идём в next (свой или сцены).
// ============================================================
async function continueAfterInsert(afterChoice, fallbackNext) {
    if (afterChoice.resume_at != null) {
        // Возврат в текущую сцену
        const dur = video.duration || 0;
        if (dur > 0 && afterChoice.resume_at >= dur - 0.5) {
            video.currentTime = dur - 0.1;
            setTimeout(() => onSceneEnded(), 150);
            return;
        }
        video.currentTime = Math.min(afterChoice.resume_at, dur > 0 ? dur - 0.1 : afterChoice.resume_at);
        video.play().catch(() => {});
        showControls();
        return;
    }

    // Прямой переход в следующую сцену
    if (fallbackNext) {
        await loadScene(fallbackNext);
        return;
    }

    // Если next нигде не задан — считаем сцену завершённой
    onSceneEnded();
}

// ============================================================
//  ОБРАБОТКА ВЫБОРА
// ============================================================
async function handleChoice(choice) {
    sceneChoiceState.resolved = true;
    if (sceneChoiceState.timeoutId) {
        clearTimeout(sceneChoiceState.timeoutId);
        sceneChoiceState.timeoutId = null;
    }
    if (sceneChoiceState.countdownId) {
        clearInterval(sceneChoiceState.countdownId);
        sceneChoiceState.countdownId = null;
    }
    choiceCountdownEl.classList.add('hidden');
    overlay.querySelectorAll('.area').forEach(el => el.style.display = 'none');

    // Определяем, куда идти
    const nextAfterInsert = choice.next || (currentScene && currentScene.next) || null;

    if (choice.after_choice && choice.after_choice.video) {
        await playInsertOnly(choice.after_choice.video);
        await continueAfterInsert(choice.after_choice, nextAfterInsert);
    } else if (choice.next) {
        await loadScene(choice.next);
    } else if (choice.resume_at != null) {
        video.currentTime = choice.resume_at;
        video.play();
    } else {
        video.play();
    }
}

async function handleNoChoice() {
    if (sceneChoiceState.resolved) return;
    sceneChoiceState.resolved = true;
    if (sceneChoiceState.timeoutId) {
        clearTimeout(sceneChoiceState.timeoutId);
        sceneChoiceState.timeoutId = null;
    }
    if (sceneChoiceState.countdownId) {
        clearInterval(sceneChoiceState.countdownId);
        sceneChoiceState.countdownId = null;
    }
    choiceCountdownEl.classList.add('hidden');
    overlay.querySelectorAll('.area').forEach(el => el.style.display = 'none');

    const nc = (currentScene && currentScene.no_choice) || {};
    const nextAfterInsert = nc.next || (currentScene && currentScene.next) || null;

    if (nc.after_choice && nc.after_choice.video) {
        await playInsertOnly(nc.after_choice.video);
        await continueAfterInsert(nc.after_choice, nextAfterInsert);
    } else if (nc.next) {
        await loadScene(nc.next);
    } else if (nc.resume_at != null) {
        video.currentTime = nc.resume_at;
        video.play();
    } else {
        video.play();
    }
}

// ============================================================
//  ОКОНЧАНИЕ СЦЕНЫ
// ============================================================
function onSceneEnded() {
    if (isAutoAdvancing) return;
    const scene = currentScene;
    if (!scene) return;

    if (scene.next) {
        isAutoAdvancing = true;
        setTimeout(() => loadScene(scene.next), 300);
        return;
    }

    endMessage.classList.remove('hidden');
    clearProgress();
}

// ============================================================
//  УСЛОВНЫЕ ОВЕРЛЕИ
// ============================================================
function updateConditionalOverlays(cur) {
    if (!currentScene || !currentScene.conditional_overlays) return;
    currentScene.conditional_overlays.forEach((ov, idx) => {
        const start = ov.at_time || 0;
        const end = start + (ov.duration || 3);
        const inWindow = cur >= start && cur <= end;
        let el = conditionalOverlaysEl.querySelector(`[data-ov-idx="${idx}"]`);
        if (inWindow && !el) {
            el = document.createElement('div');
            el.className = 'cond-overlay type-' + (ov.type || 'text');
            el.dataset.ovIdx = idx;
            el.textContent = ov.text || '';
            conditionalOverlaysEl.appendChild(el);
        } else if (!inWindow && el) {
            el.remove();
        }
    });
}

// ============================================================
//  ОБНОВЛЕНИЕ UI
// ============================================================
function onActiveTimeUpdate() {
    const v = getActiveVideo();
    const cur = v.currentTime;
    const dur = v.duration || 0;

    if (dur > 0) {
        const percent = (cur / dur) * 100;
        timelineProgress.style.width = percent + '%';
        timelineThumb.style.left = percent + '%';
    }
    currentTimeEl.textContent = formatTime(cur);

    if (!isInsertPlaying) {
        if (sceneChoiceState.pauseAt != null
            && !sceneChoiceState.triggered
            && !sceneChoiceState.resolved
            && lastTime < sceneChoiceState.pauseAt
            && cur >= sceneChoiceState.pauseAt) {
            triggerChoicePause();
        }
        if (!sceneChoiceState.resolved) {
            updateConditionalOverlays(cur);
        }
        lastTime = cur;
    }
}

function onActiveLoadedMetadata() {
    durationEl.textContent = formatTime(getActiveVideo().duration);
}

function onActiveProgress() {
    const v = getActiveVideo();
    if (v.buffered.length > 0 && v.duration) {
        const bufferedEnd = v.buffered.end(v.buffered.length - 1);
        timelineBuffered.style.width = ((bufferedEnd / v.duration) * 100) + '%';
    }
}

function onActivePlay() { playPauseBtn.classList.add('playing'); showControls(); }
function onActivePause() { playPauseBtn.classList.remove('playing'); showControls(); }

function showBuffering() { bufferingSpinner.classList.add('visible'); }
function hideBuffering() { bufferingSpinner.classList.remove('visible'); }

function bindBufferingEvents(v) {
    v.addEventListener('waiting', showBuffering);
    v.addEventListener('stalled', showBuffering);
    v.addEventListener('playing', hideBuffering);
    v.addEventListener('canplay', hideBuffering);
    v.addEventListener('seeked', hideBuffering);
    v.addEventListener('error', hideBuffering);
}

video.addEventListener('timeupdate', onActiveTimeUpdate);
video.addEventListener('loadedmetadata', onActiveLoadedMetadata);
video.addEventListener('progress', onActiveProgress);
video.addEventListener('play', onActivePlay);
video.addEventListener('pause', onActivePause);
video.addEventListener('ended', onSceneEnded);
bindBufferingEvents(video);

insertPlayer.addEventListener('timeupdate', onActiveTimeUpdate);
insertPlayer.addEventListener('loadedmetadata', onActiveLoadedMetadata);
insertPlayer.addEventListener('progress', onActiveProgress);
insertPlayer.addEventListener('play', onActivePlay);
insertPlayer.addEventListener('pause', onActivePause);
bindBufferingEvents(insertPlayer);

// ============================================================
//  PLAY / PAUSE
// ============================================================
function togglePlay() {
    if (sceneChoiceState.triggered && !sceneChoiceState.resolved) return;
    const v = getActiveVideo();
    if (v.paused) v.play();
    else v.pause();
}
playPauseBtn.addEventListener('click', togglePlay);
video.addEventListener('click', togglePlay);
insertPlayer.addEventListener('click', togglePlay);

// ============================================================
//  ТАЙМЛАЙН
// ============================================================
function seekFromEvent(e) {
    if (sceneChoiceState.triggered && !sceneChoiceState.resolved) return;
    const rect = timeline.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches?.[0]?.clientX ?? 0);
    let x = clientX - rect.left;
    x = Math.max(0, Math.min(x, rect.width));
    const v = getActiveVideo();
    if (v.duration) v.currentTime = (x / rect.width) * v.duration;
}
timeline.addEventListener('mousedown', (e) => { isDraggingTimeline = true; seekFromEvent(e); });
document.addEventListener('mousemove', (e) => { if (isDraggingTimeline) seekFromEvent(e); });
document.addEventListener('mouseup', () => { isDraggingTimeline = false; });
timeline.addEventListener('touchstart', (e) => { isDraggingTimeline = true; seekFromEvent(e); }, { passive: true });
document.addEventListener('touchmove', (e) => { if (isDraggingTimeline) seekFromEvent(e); }, { passive: true });
document.addEventListener('touchend', () => { isDraggingTimeline = false; });

// ============================================================
//  ГРОМКОСТЬ
// ============================================================
volumeSlider.addEventListener('input', (e) => {
    const v = getActiveVideo();
    v.volume = parseFloat(e.target.value);
    v.muted = v.volume === 0;
    updateVolumeIcon();
});
volumeBtn.addEventListener('click', () => {
    const v = getActiveVideo();
    v.muted = !v.muted;
    updateVolumeIcon();
});
function updateVolumeIcon() {
    const v = getActiveVideo();
    volumeBtn.classList.remove('volume-high', 'volume-low', 'volume-mute');
    if (v.muted || v.volume === 0) volumeBtn.classList.add('volume-mute');
    else if (v.volume < 0.5) volumeBtn.classList.add('volume-low');
    else volumeBtn.classList.add('volume-high');
}
updateVolumeIcon();

// ============================================================
//  КАЧЕСТВО
// ============================================================
function buildQualityPopup() {
    qualityPopupList.innerHTML = '';
    const items = [
        { value: 'auto', label: 'Авто', badge: currentQuality === 'auto' ? `${autoQuality()}p` : null },
        { value: 1080, label: '1080p', badge: 'Full HD' },
        { value: 720,  label: '720p',  badge: 'HD' },
        { value: 480,  label: '480p',  badge: null },
        { value: 360,  label: '360p',  badge: null },
        { value: 144,  label: '144p',  badge: 'Эконом' }
    ];
    items.forEach(it => {
        const div = document.createElement('div');
        div.className = 'quality-item' + (currentQuality === it.value ? ' active' : '');
        div.dataset.value = it.value;
        div.innerHTML = `
            <span>${it.label}</span>
            ${it.badge ? `<span class="q-badge">${it.badge}</span>` : ''}
        `;
        div.addEventListener('click', () => {
            setQuality(it.value);
            qualityPopup.classList.add('hidden');
        });
        qualityPopupList.appendChild(div);
    });
}

function setQuality(q) {
    currentQuality = q;
    saveQualityPreference(q);
    updateQualityLabel();
    buildQualityPopup();

    if (currentScene && currentScene.video) {
        const time = video.currentTime;
        const wasPlaying = !video.paused && !sceneChoiceState.triggered;
        loadVideoWithFallback(currentScene.video, {
            isInsert: false,
            onSuccess: () => {
                video.currentTime = time;
                if (wasPlaying) video.play().catch(() => {});
            }
        });
    }
}

qualityBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    buildQualityPopup();
    qualityPopup.classList.toggle('hidden');
    showControls();
});

document.addEventListener('click', (e) => {
    if (!qualityPopup.classList.contains('hidden') &&
        !qualityPopup.contains(e.target) &&
        !qualityBtn.contains(e.target)) {
        qualityPopup.classList.add('hidden');
    }
});

if (navigator.connection) {
    navigator.connection.addEventListener('change', () => {
        if (currentQuality === 'auto') updateQualityLabel();
    });
}
updateQualityLabel();

// ============================================================
//  FULLSCREEN
// ============================================================
fullscreenBtn.addEventListener('click', () => {
    if (video.webkitEnterFullscreen && !document.fullscreenEnabled) {
        video.webkitEnterFullscreen();
        return;
    }
    if (!document.fullscreenElement) {
        player.requestFullscreen().catch(err => console.log(err));
    } else {
        document.exitFullscreen();
    }
});

// ============================================================
//  ПОКАЗ/СКРЫТИЕ ПАНЕЛИ
// ============================================================
function showControls() {
    controls.classList.add('visible');
    player.classList.add('show-controls');
    clearTimeout(hideControlsTimeout);
    const v = getActiveVideo();
    const keepVisible = sceneChoiceState.triggered && !sceneChoiceState.resolved;
    if (!v.paused || keepVisible) {
        if (!keepVisible) {
            hideControlsTimeout = setTimeout(() => {
                controls.classList.remove('visible');
                player.classList.remove('show-controls');
            }, 3000);
        }
    }
}
player.addEventListener('mousemove', showControls);
player.addEventListener('mouseleave', () => {
    const keepVisible = sceneChoiceState.triggered && !sceneChoiceState.resolved;
    if (keepVisible) return;
    const v = getActiveVideo();
    if (!v.paused) {
        controls.classList.remove('visible');
        player.classList.remove('show-controls');
    }
});

// ============================================================
//  РЕСТАРТ
// ============================================================
document.getElementById('restartBtn').addEventListener('click', () => {
    clearProgress();
    loadScene('s01_perepiska');
});

// ============================================================
//  КЛАВИАТУРА
// ============================================================
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    switch (e.code) {
        case 'Space':
            e.preventDefault();
            if (sceneChoiceState.triggered && !sceneChoiceState.resolved) return;
            togglePlay();
            break;
        case 'ArrowRight':
            if (sceneChoiceState.triggered && !sceneChoiceState.resolved) return;
            getActiveVideo().currentTime += 5;
            showControls();
            break;
        case 'ArrowLeft':
            if (sceneChoiceState.triggered && !sceneChoiceState.resolved) return;
            getActiveVideo().currentTime -= 5;
            showControls();
            break;
        case 'KeyF': fullscreenBtn.click(); break;
    }
});

// ============================================================
//  ЗАПУСК
// ============================================================
(async () => {
    const saved = loadProgress();
    if (saved && saved.sceneId) {
        try {
            await loadScene(saved.sceneId);
            return;
        } catch (e) {}
    }
    await loadScene('s01_perepiska');
})();
