const express = require('express');
const { connectDB } = require('./db');
const { auth, users } = require('./routes/authUsers');
const grades = require('./routes/grades');
const partners = require('./routes/partners');
const products = require('./routes/products');
const sales = require('./routes/sales');
const reports = require('./routes/reports');
const orders = require('./routes/orders');

const app = express();
app.use(express.json());

// Connect (and seed on first run) before handling any API request
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    // Full diagnostic goes to the server log only — showing it to users
    // surfaced as raw setup instructions in a toast on every transient blip.
    console.error('DB connection failed:', err);
    res.status(503).json({ detail: 'Server is temporarily unavailable — please try again in a moment.' });
  }
});

app.use('/api/auth', auth);
app.use('/api/users', users);
app.use('/api/grades', grades);
app.use('/api/partners', partners);
app.use('/api/orders', orders);
app.use('/api/products', products);
app.use('/api/sales', sales);
app.use('/api/reports', reports);

// error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ detail: 'Something went wrong' });
});

module.exports = app;
