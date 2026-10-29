require('dotenv').config();
const { connectDB, closeDB } = require('./src/config/db');
const createApp = require('./src/app');

const PORT = process.env.PORT || 4000;

async function start() {
  await connectDB(process.env.MONGODB_URI, process.env.DB_NAME);
  createApp().listen(PORT, () => console.log(`Folduct server listening on port ${PORT}`));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await closeDB();
    process.exit(0);
  });
}
