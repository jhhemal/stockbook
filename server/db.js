/* Mongoose connection with caching for serverless (Vercel re-uses warm
   containers; a cached connection avoids reconnecting on every request). */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

let cached = global._mongoose;
if (!cached) cached = global._mongoose = { conn: null, promise: null, seeded: false };

const DEFAULT_GRADES = ['A', 'A-', 'AB', 'B', 'Z', 'Genuine'];

// (model, storage, {grade: qty}) — initial stock from the manual list
const INITIAL_STOCK = [
  ['11 Pro', '64', { 'A-': 1 }],
  ['11 PM', '256', { A: 2 }],
  ['12', '128', { 'A-': 1 }],
  ['12', '256', { 'A-': 1 }],
  ['12 Pro', '128', { 'A-': 1 }],
  ['13 Pro', '256', { A: 2, 'A-': 2 }],
  ['13 PM', '128', { A: 13, 'A-': 7 }],
  ['13 PM', '256', { 'A-': 1 }],
  ['14', '256', { A: 12, 'A-': 10 }],
  ['14 PM', '128', { 'A-': 1 }],
  ['15', '128', { A: 15 }],
  ['15 Pro', '128', { A: 4, 'A-': 6 }],
  ['16 PM', '256', { A: 12 }],
  ['16e', '128', { A: 2 }],
  ['16 Plus', '128', { A: 1, 'A-': 2 }],
  ['16 Pro', '', { A: 15, 'A-': 9 }],
  ['16 PM', '512', { A: 26, 'A-': 23 }], // second '16 PM 256' in the list — rename if wrong
  ['17 PM', '256', { A: 1 }],
];

async function seed() {
  const { User, Grade, Product, StockMovement } = require('./models');

  if ((await User.countDocuments()) === 0) {
    await User.create({
      username: process.env.ADMIN_USERNAME || 'admin',
      passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10),
      role: 'admin',
    });
  }

  if ((await Grade.countDocuments()) === 0) {
    await Grade.insertMany(DEFAULT_GRADES.map((name, i) => ({ name, sortOrder: i })));
  }

  if ((await Product.countDocuments()) === 0) {
    const grades = await Grade.find();
    const byName = Object.fromEntries(grades.map(g => [g.name, g]));
    for (let i = 0; i < INITIAL_STOCK.length; i++) {
      const [model, storage, counts] = INITIAL_STOCK[i];
      const countMap = {};
      const movements = [];
      for (const [gname, qty] of Object.entries(counts)) {
        if (byName[gname] && qty > 0) {
          countMap[byName[gname]._id.toString()] = qty;
          movements.push({
            productName: `${model} ${storage}`.trim(),
            gradeName: gname, change: qty, reason: 'initial', username: 'system',
          });
        }
      }
      await Product.create({ model, storage, sortOrder: i, counts: countMap });
      if (movements.length) await StockMovement.insertMany(movements);
    }
  }
}

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set');
    cached.promise = mongoose.connect(uri, { bufferCommands: false });
  }
  cached.conn = await cached.promise;
  if (!cached.seeded) {
    await seed();
    cached.seeded = true;
  }
  return cached.conn;
}

module.exports = { connectDB };
