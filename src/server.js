const { createApp } = require('./app');
const { openDb } = require('./db');
const PORT = Number(process.env.PORT || 3000);
const DB_FILE = process.env.DB_FILE || 'talenthub.db';
const { server } = createApp(openDb(DB_FILE));
server.listen(PORT, () => console.log(`TalentHub running on http://localhost:${PORT} (db: ${DB_FILE})`));
