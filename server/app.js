const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Раздача статики
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Сценарий
const DATA_FILE = path.join(__dirname, 'data', 'series.json');

function loadSeries() {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

// Все сцены одной серии (одна серия в тесте)
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

// Первая сцена (для автозапуска)
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

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});