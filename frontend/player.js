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
//  БЕЗОПАСНЫЙ PLAY
// ============================================================
function safePlay(el) {
    if (!el) return;
    try {
        const p = el.play();
        if (p && typeof p.catch === 'function') {
            p.catch(err => {
                if (err && err.name !== 'AbortError') {
                    console.warn('play() ошибка:', err);
                }
            });
        }
    } catch (e) {
        console.warn('play() выбросил:', e);
    }
}

// ============================================================
//  РАЗРЕШЕНИЕ ПУТИ К ВИДЕО
// ============================================================
function resolveVideoUrl(video) {
    if (!video) return '';
    if (/^https?:\/\//i.test(video)) return video;
    return `/uploads/${video}`;
}

// ============================================================
//  DOM
// ============================================================
const video = document.getElementById('videoPlayer');
const insertPlayer = document.getElementById('insertPlayer');
const overlay = document.getElementById('overlay');
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
//  СОХРАНЕНИЕ ПРОГРЕССА
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
        if (endMessage) endMessage.classList.add('hidden');

        if (scene.video && scene.video.trim() !== '' && video) {
            video.src = resolveVideoUrl(scene.video);
            video.load();
            video.oncanplay = () => {
                video.oncanplay = null;
                safePlay(video);
                if (controls) controls.classList.add('visible');
                if (player) player.classList.add('show-controls');
            };
        } else if (video) {
            video.removeAttribute('src');
            video.load();
        }

        buildChoiceAreas(scene);
        sceneChoiceState.pauseAt = computeChoicePauseAt(scene);
        sceneChoiceState.timeoutDuration = typeof scene.choice_timeout === 'number'
            ? scene.choice_timeout
            : 30;

        lastTime = 0;
        saveProgress();
    } catch (err) {
        console.error('Ошибка загрузки сцены:', err);
    }
}

function buildChoiceAreas(scene) {
    if (!overlay) return;
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
//  ТРИГГЕР ПАУЗЫ ДЛЯ ВЫБОРА
// ============================================================
function triggerChoicePause() {
    if (!currentScene || !currentScene.choices || sceneChoiceState.resolved) return;
    sceneChoiceState.triggered = true;

    if (video) video.pause();
    if (overlay) {
        overlay.querySelectorAll('.area').forEach(el => el.style.display = 'flex');
    }

    const timeout = sceneChoiceState.timeoutDuration;
    sceneChoiceState.timeoutAt = Date.now() + timeout * 1000;

    if (choiceCountdownEl) choiceCountdownEl.classList.remove('hidden');
    if (countdownNumberEl) countdownNumberEl.textContent = timeout;
    const circumference = 2 * Math.PI * 19;
    if (countdownRingEl) {
        countdownRingEl.style.strokeDasharray = circumference;
        countdownRingEl.style.strokeDashoffset = 0;
    }

    sceneChoiceState.countdownId = setInterval(() => {
        const remaining = Math.max(0, (sceneChoiceState.timeoutAt - Date.now()) / 1000);
        if (countdownNumberEl) countdownNumberEl.textContent = Math.ceil(remaining);
        const ratio = remaining / timeout;
        if (countdownRingEl) {
            countdownRingEl.style.strokeDashoffset = circumference * (1 - ratio);
        }
    }, 100);

    sceneChoiceState.timeoutId = setTimeout(() => {
        if (!sceneChoiceState.resolved) handleNoChoice();
    }, timeout * 1000);
}

// ============================================================
//  ВСТАВКА
// ============================================================
function playInsertOnly(videoFile) {
    return new Promise((resolve) => {
        if (!insertPlayer) {
            resolve();
            return;
        }
        isInsertPlaying = true;
        if (playPauseBtn) playPauseBtn.classList.add('playing');
        if (currentTimeEl) currentTimeEl.textContent = '0:00';
        if (durationEl) durationEl.textContent = '0:00';
        if (timelineProgress) timelineProgress.style.width = '0%';
        if (timelineThumb) timelineThumb.style.left = '0%';
        if (timelineBuffered) timelineBuffered.style.width = '0%';

        if (video) video.pause();
        insertPlayer.classList.add('active');
        insertPlayer.src = resolveVideoUrl(videoFile);
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
            if (playPauseBtn) playPauseBtn.classList.remove('playing');
            resolve();
        };

        const onEnded = finish;
        const onError = () => {
            console.warn('Вставка не загрузилась, пропускаем:', videoFile);
            finish();
        };

        insertPlayer.addEventListener('ended', onEnded);
        insertPlayer.addEventListener('error', onError);

        insertPlayer.oncanplay = () => {
            insertPlayer.oncanplay = null;
            safePlay(insertPlayer);
        };
        insertPlayer.load();

        // Страховка на 5 секунд
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
// ============================================================
async function continueAfterInsert(afterChoice, fallbackNext) {
    if (afterChoice.resume_at != null) {
        const dur = (video && video.duration) || 0;
        if (dur > 0 && afterChoice.resume_at >= dur - 0.5) {
            if (video) video.currentTime = dur - 0.1;
            setTimeout(() => onSceneEnded(), 150);
            return;
        }
        if (video) {
            video.currentTime = Math.min(afterChoice.resume_at, dur > 0 ? dur - 0.1 : afterChoice.resume_at);
            safePlay(video);
        }
        showControls();
        return;
    }

    if (fallbackNext) {
        await loadScene(fallbackNext);
        return;
    }

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
    if (choiceCountdownEl) choiceCountdownEl.classList.add('hidden');
    if (overlay) {
        overlay.querySelectorAll('.area').forEach(el => el.style.display = 'none');
    }

    const nextAfterInsert = choice.next || (currentScene && currentScene.next) || null;

    if (choice.after_choice && choice.after_choice.video) {
        await playInsertOnly(choice.after_choice.video);
        await continueAfterInsert(choice.after_choice, nextAfterInsert);
    } else if (choice.next) {
        await loadScene(choice.next);
    } else if (choice.resume_at != null && video) {
        video.currentTime = choice.resume_at;
        safePlay(video);
    } else if (video) {
        safePlay(video);
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
    if (choiceCountdownEl) choiceCountdownEl.classList.add('hidden');
    if (overlay) {
        overlay.querySelectorAll('.area').forEach(el => el.style.display = 'none');
    }

    const nc = (currentScene && currentScene.no_choice) || {};
    const nextAfterInsert = nc.next || (currentScene && currentScene.next) || null;

    if (nc.after_choice && nc.after_choice.video) {
        await playInsertOnly(nc.after_choice.video);
        await continueAfterInsert(nc.after_choice, nextAfterInsert);
    } else if (nc.next) {
        await loadScene(nc.next);
    } else if (nc.resume_at != null && video) {
        video.currentTime = nc.resume_at;
        safePlay(video);
    } else if (video) {
        safePlay(video);
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

    if (endMessage) endMessage.classList.remove('hidden');
    clearProgress();
}

// ============================================================
//  ОБНОВЛЕНИЕ UI
// ============================================================
function onActiveTimeUpdate() {
    const v = getActiveVideo();
    if (!v) return;
    const cur = v.currentTime;
    const dur = v.duration || 0;

    if (dur > 0) {
        const percent = (cur / dur) * 100;
        if (timelineProgress) timelineProgress.style.width = percent + '%';
        if (timelineThumb) timelineThumb.style.left = percent + '%';
    }
    if (currentTimeEl) currentTimeEl.textContent = formatTime(cur);

    if (!isInsertPlaying) {
        if (sceneChoiceState.pauseAt != null
            && !sceneChoiceState.triggered
            && !sceneChoiceState.resolved
            && lastTime < sceneChoiceState.pauseAt
            && cur >= sceneChoiceState.pauseAt) {
            triggerChoicePause();
        }
        lastTime = cur;
    }
}

function onActiveLoadedMetadata() {
    const v = getActiveVideo();
    if (v && durationEl) durationEl.textContent = formatTime(v.duration);
}

function onActiveProgress() {
    const v = getActiveVideo();
    if (!v) return;
    if (v.buffered.length > 0 && v.duration && timelineBuffered) {
        const bufferedEnd = v.buffered.end(v.buffered.length - 1);
        timelineBuffered.style.width = ((bufferedEnd / v.duration) * 100) + '%';
    }
}

function onActivePlay() {
    if (playPauseBtn) playPauseBtn.classList.add('playing');
    showControls();
}
function onActivePause() {
    if (playPauseBtn) playPauseBtn.classList.remove('playing');
    showControls();
}

function showBuffering() { if (bufferingSpinner) bufferingSpinner.classList.add('visible'); }
function hideBuffering() { if (bufferingSpinner) bufferingSpinner.classList.remove('visible'); }

function bindVideoEvents(v) {
    if (!v) return;
    v.addEventListener('timeupdate', onActiveTimeUpdate);
    v.addEventListener('loadedmetadata', onActiveLoadedMetadata);
    v.addEventListener('progress', onActiveProgress);
    v.addEventListener('play', onActivePlay);
    v.addEventListener('pause', onActivePause);
    v.addEventListener('waiting', showBuffering);
    v.addEventListener('stalled', showBuffering);
    v.addEventListener('playing', hideBuffering);
    v.addEventListener('canplay', hideBuffering);
    v.addEventListener('seeked', hideBuffering);
    v.addEventListener('error', hideBuffering);
}

bindVideoEvents(video);
bindVideoEvents(insertPlayer);

if (video) video.addEventListener('ended', onSceneEnded);

// ============================================================
//  PLAY / PAUSE
// ============================================================
function togglePlay() {
    if (sceneChoiceState.triggered && !sceneChoiceState.resolved) return;
    const v = getActiveVideo();
    if (!v) return;
    if (v.paused) safePlay(v);
    else v.pause();
}
if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlay);
if (video) video.addEventListener('click', togglePlay);
if (insertPlayer) insertPlayer.addEventListener('click', togglePlay);

// ============================================================
//  ТАЙМЛАЙН
// ============================================================
function seekFromEvent(e) {
    if (sceneChoiceState.triggered && !sceneChoiceState.resolved) return;
    if (!timeline) return;
    const rect = timeline.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches?.[0]?.clientX ?? 0);
    let x = clientX - rect.left;
    x = Math.max(0, Math.min(x, rect.width));
    const v = getActiveVideo();
    if (v && v.duration) v.currentTime = (x / rect.width) * v.duration;
}
if (timeline) {
    timeline.addEventListener('mousedown', (e) => { isDraggingTimeline = true; seekFromEvent(e); });
    timeline.addEventListener('touchstart', (e) => { isDraggingTimeline = true; seekFromEvent(e); }, { passive: true });
}
document.addEventListener('mousemove', (e) => { if (isDraggingTimeline) seekFromEvent(e); });
document.addEventListener('mouseup', () => { isDraggingTimeline = false; });
document.addEventListener('touchmove', (e) => { if (isDraggingTimeline) seekFromEvent(e); }, { passive: true });
document.addEventListener('touchend', () => { isDraggingTimeline = false; });

// ============================================================
//  ГРОМКОСТЬ
// ============================================================
if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
        const v = getActiveVideo();
        if (!v) return;
        v.volume = parseFloat(e.target.value);
        v.muted = v.volume === 0;
        updateVolumeIcon();
    });
}
if (volumeBtn) {
    volumeBtn.addEventListener('click', () => {
        const v = getActiveVideo();
        if (!v) return;
        v.muted = !v.muted;
        updateVolumeIcon();
    });
}
function updateVolumeIcon() {
    if (!volumeBtn) return;
    const v = getActiveVideo();
    if (!v) return;
    volumeBtn.classList.remove('volume-high', 'volume-low', 'volume-mute');
    if (v.muted || v.volume === 0) volumeBtn.classList.add('volume-mute');
    else if (v.volume < 0.5) volumeBtn.classList.add('volume-low');
    else volumeBtn.classList.add('volume-high');
}
updateVolumeIcon();

// ============================================================
//  FULLSCREEN
// ============================================================
if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
        if (video && video.webkitEnterFullscreen && !document.fullscreenEnabled) {
            video.webkitEnterFullscreen();
            return;
        }
        if (!document.fullscreenElement) {
            if (player) player.requestFullscreen().catch(err => console.log(err));
        } else {
            document.exitFullscreen();
        }
    });
}

// ============================================================
//  ПОКАЗ/СКРЫТИЕ ПАНЕЛИ
// ============================================================
function showControls() {
    if (!controls || !player) return;
    controls.classList.add('visible');
    player.classList.add('show-controls');
    clearTimeout(hideControlsTimeout);
    const v = getActiveVideo();
    if (!v) return;
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
if (player) {
    player.addEventListener('mousemove', showControls);
    player.addEventListener('mouseleave', () => {
        const keepVisible = sceneChoiceState.triggered && !sceneChoiceState.resolved;
        if (keepVisible) return;
        const v = getActiveVideo();
        if (v && !v.paused) {
            if (controls) controls.classList.remove('visible');
            if (player) player.classList.remove('show-controls');
        }
    });
}

// ============================================================
//  РЕСТАРТ
// ============================================================
const restartBtn = document.getElementById('restartBtn');
if (restartBtn) {
    restartBtn.addEventListener('click', () => {
        clearProgress();
        loadScene('s01_perepiska');
    });
}

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
            { const v = getActiveVideo(); if (v) v.currentTime += 5; }
            showControls();
            break;
        case 'ArrowLeft':
            if (sceneChoiceState.triggered && !sceneChoiceState.resolved) return;
            { const v = getActiveVideo(); if (v) v.currentTime -= 5; }
            showControls();
            break;
        case 'KeyF':
            if (fullscreenBtn) fullscreenBtn.click();
            break;
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
