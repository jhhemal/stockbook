const express = require('express');
const { connectDB } = require('./db');
const { auth, users } = require('./routes/authUsers');
const grades = require('./routes/grades');
const products = require('./routes/products');
const sales = require('./routes/sales');
const reports = require('./routes/reports');

const app = express();
app.use(express.json());

// Connect (and seed on first run) before handling any API request
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('DB connection failed:', err);
    // Surface the real reason so misconfiguration is easy to diagnose
    res.status(500).json({
      detail: `Database connection failed: ${err.message}. ` +
        `Check that DATABASE_URL is set to your Supabase Transaction pooler string ` +
        `(Supabase Dashboard → Connect → Transaction pooler, port 6543) with the real password filled in.`,
    });
  }
});

app.use('/api/auth', auth);
app.use('/api/users', users);
app.use('/api/grades', grades);
app.use('/api/products', products);
app.use('/api/sales', sales);
app.use('/api/reports', reports);

// error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ detail: 'Something went wrong' });
});

module.exports = app;
