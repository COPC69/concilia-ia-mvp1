const express = require('express');
const cors = require('cors');
const reconcileRouter = require('./routes/reconcile');

const app = express();
const PORT = process.env.PORT || 10000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const corsOptions = ALLOWED_ORIGIN === '*'
  ? { origin: '*' }
  : { origin: ALLOWED_ORIGIN.split(',').map(x => x.trim()) };

app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'Concilia IA API',
    version: '1.0.0',
    description: 'MVP 1: concilia un archivo interno contra extracto bancario Excel/CSV'
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.use('/api', reconcileRouter);

app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(err.status || 500).json({
    ok: false,
    error: err.message || 'Error interno del servidor'
  });
});

app.listen(PORT, () => {
  console.log(`Concilia IA API escuchando en puerto ${PORT}`);
});
