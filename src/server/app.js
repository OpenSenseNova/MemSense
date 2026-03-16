import express from 'express';
import {
  saveChunk,
  fetchRecent,
  searchChunks,
  searchByTime,
  feedback,
  promoteDemote,
  forget,
  audit,
} from './service.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/v1/memory/save', async (req, res) => {
    try {
      const data = await saveChunk(req.body || {});
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/v1/memory/fetch_recent', async (req, res) => {
    try {
      const chunks = await fetchRecent(req.body || {});
      res.json({ ok: true, data: { chunks, total: chunks.length } });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/v1/memory/search', async (req, res) => {
    try {
      const chunks = await searchChunks({
        ...req.body,
        query_text: req.body?.query,
      });
      res.json({ ok: true, data: { chunks, total: chunks.length } });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/v1/memory/search_by_time', async (req, res) => {
    try {
      const items = await searchByTime(req.body || {});
      res.json({ ok: true, data: { items, total: items.length } });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/v1/memory/feedback', async (req, res) => {
    try {
      const data = await feedback(req.body || {});
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/v1/memory/promote_demote', async (req, res) => {
    try {
      const data = await promoteDemote(req.body || {});
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/v1/memory/forget', async (req, res) => {
    try {
      const data = await forget(req.body || {});
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/v1/memory/audit', async (req, res) => {
    try {
      const data = await audit(req.body || {});
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  return app;
}
