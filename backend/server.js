'use strict';
require('dotenv').config({ quiet: true });
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const S = require('./src/security');
const api = require('./src/routes');

const app = express();
const PUB = process.env.FRONTEND_DIR ? path.resolve(process.env.FRONTEND_DIR) : path.join(__dirname, '..', 'frontend');

if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      'style-src-attr': ["'unsafe-inline'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(S.isProd ? { upgradeInsecureRequests: [] } : {})
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(cookieParser());
app.use(express.json({ limit: '200kb' }));

app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, S.csrfGuard, api);

app.use(express.static(PUB, { index: false, extensions: ['html'] }));

const page = (file) => (req, res) => res.sendFile(path.join(PUB, file));
app.get('/', page('index.html'));
app.get('/app', page('app.html'));
app.get('/r/:token', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PUB, 'guest.html'));
});
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).sendFile(path.join(PUB, '404.html')));

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log('RSVP Desk is running at http://localhost:' + PORT));
}
module.exports = app;
