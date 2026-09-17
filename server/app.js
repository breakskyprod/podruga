const express = require('express');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
//  НАСТРОЙКИ GITHUB RELEASES (откуда проксируем видео)
//  Можно задать через переменные окружения на Render,
//  либо вписать сюда напрямую.
// ============================================================
const GITHUB_USER = process.env.GITHUB_USER || 'breakskyprod';
const GITHUB_REPO = process.env.GITHUB_REPO || 'podruga';
const GITHUB_TAG  = process.env.GITHUB_TAG  || 'v1.0.0';

function buildGithubUrl(filename) {
    return `https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/download/${GITHUB_TAG}/${filename}`;
}

// ============================================================
//  РАЗДАЧА СТАТИКИ
// ============================================================
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Сначала пытаемся отдать локальный файл из uploads,
// если его нет — уходим в прокси-обработчик ниже.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============================================================
//  ПРОКСИ ДЛЯ ВИДЕО ИЗ GITHUB RELEASES
//  Срабатывает, если локального файла в /uploads/ нет.
//  Поддерживает Range-запросы (перемотку) и CORS для iOS.
// ============================================================
app.get('/uploads/:filename', async (req, res) => {
    const { filename } = req.params;
    const githubUrl = buildGithubUrl(filename);

    // Пробрасываем Range, если запрашивает браузер
    const headers = {};
    if (req.headers.range) {
        headers.Range = req.headers.range;
    }

    try {
        const response = await fetch(githubUrl, { headers, redirect: 'follow' });

        if (!response.ok && response.status !== 206) {
            console.warn(`[proxy] ${filename} → ${response.status}`);
            return res.status(404).end();
        }

        // Пробрасываем статус (200 или 206)
        res.status(response.status);

        // Копируем важные заголовки
        ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'].forEach(h => {
            const v = response.headers.get(h);
            if (v) res.setHeader(h, v);
        });

        // Заголовки для CORS — критично для iOS Safari
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

        // Стримим тело ответа клиенту
        if (response.body) {
            Readable.fromWeb(response.body).pipe(res);
        } else {
            res.end();
        }
    } catch (err) {
        console.error(`[proxy] Ошибка при загрузке ${filename}:`, err.message);
        res.status(500).end();
    }
});

// ============================================================
//  СЦЕНАРИЙ
// ============================================================
const DATA_FILE = path.join(__dirname, 'data', 'series.json');

function loadSeries() {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

// Все сцены одной серии
app.get('/api/scenes', (req, res) => {
    try {
        const series = loadSeries();
        const allScenes = [];
        (series.episodes || []).forEach(ep => {
            (ep.scenes || []).forEach(s => {
                allScenes.push({ ...s, episode_id: ep.id });
            });
        });
        res.json({ title: series.title, scenes: allScenes });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Одна сцена по id
app.get('/api/scene/:id', (req, res) => {
    try {
        const series = loadSeries();
        for (const ep of (series.episodes || [])) {
            const scene = (ep.scenes || []).find(s => s.id === req.params.id);
            if (scene) return res.json({ ...scene, episode_id: ep.id });
        }
        res.status(404).json({ error: 'Сцена не найдена' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Первая сцена
app.get('/api/start', (req, res) => {
    try {
        const series = loadSeries();
        for (const ep of (series.episodes || [])) {
            const first = (ep.scenes || []).find(s => s.type === 'start') || (ep.scenes || [])[0];
            if (first) return res.json({ ...first, episode_id: ep.id });
        }
        res.status(404).json({ error: 'Нет стартовой сцены' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
//  ЗАПУСК
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`📡 Прокси видео: github.com/${GITHUB_USER}/${GITHUB_REPO}@${GITHUB_TAG}`);
});
