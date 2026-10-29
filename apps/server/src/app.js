const express = require('express');
const cors = require('cors');
const authRouter = require('./routes/auth.routes');
const projectsRouter = require('./routes/projects.routes');
const shareLinksRouter = require('./routes/shareLinks.routes');
const notFound = require('./middleware/notFound.middleware');
const errorHandler = require('./middleware/error.middleware');

function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
  // 작업면 스냅샷(카드 100장 + 메모)이 기본 100kb를 넘을 수 있어 늘립니다.
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/share-links', shareLinksRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = createApp;
