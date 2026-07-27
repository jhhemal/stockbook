// Local development server (Vercel uses api/index.js instead)
require('dotenv').config();
const path = require('path');
const express = require('express');
const app = require('./app');

// Serve the built client if it exists (production-style local run)
const dist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (req, res, next) => {
  res.sendFile(path.join(dist, 'index.html'), err => { if (err) next(); });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`StockBook running on http://localhost:${PORT}`));
