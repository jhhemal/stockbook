/* Database layer — Sequelize with a dialect switch:
 *   DATABASE_URL set (postgres://...)  -> Postgres  (production / Vercel + Neon)
 *   DATABASE_URL not set               -> SQLite    (local file, zero setup)
 *
 * The connection + models are cached in `global` so warm serverless
 * invocations on Vercel reuse them instead of reconnecting.
 */
const { Sequelize, DataTypes, Op } = require('sequelize');
const bcrypt = require('bcryptjs');

let cached = global._db;
if (!cached) cached = global._db = { ready: null, sequelize: null, models: {} };

function createSequelize() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
    return new Sequelize(url, {
      dialect: 'postgres',
      logging: false,
      pool: { max: 2, min: 0, idle: 10000 }, // small pool for serverless
      dialectOptions: isLocal ? {} : { ssl: { require: true, rejectUnauthorized: false } },
    });
  }
  if (process.env.VERCEL) {
    throw new Error(
      "DATABASE_URL is not set. On Vercel, add a Postgres database (Storage tab → Create Database → Neon) — it sets DATABASE_URL automatically."
    );
  }
  return new Sequelize({
    dialect: 'sqlite',
    storage: process.env.SQLITE_PATH || './stockbook.db',
    logging: false,
  });
}

function defineModels(sequelize) {
  const User = sequelize.define('User', {
    username: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'staff' }, // admin | staff
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  });

  const Grade = sequelize.define('Grade', {
    name: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { timestamps: false });

  const Product = sequelize.define('Product', {
    model: { type: DataTypes.STRING(80), allowNull: false },
    storage: { type: DataTypes.STRING(30), allowNull: false, defaultValue: '' },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // { "<gradeId>": qty } — per-grade quantities (JSON works on sqlite & postgres)
    counts: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  }, {
    indexes: [{ unique: true, fields: ['model', 'storage'] }],
  });
  Object.defineProperty(Product.prototype, 'displayName', {
    get() { return `${this.model} ${this.storage}`.trim(); },
  });

  const Sale = sequelize.define('Sale', {
    productId: { type: DataTypes.INTEGER, allowNull: true },
    productName: { type: DataTypes.STRING(120), allowNull: false }, // snapshot, survives deletes
    gradeName: { type: DataTypes.STRING(30), allowNull: false },
    qty: { type: DataTypes.INTEGER, allowNull: false },
    username: { type: DataTypes.STRING(50), allowNull: false, defaultValue: '' },
  }, { indexes: [{ fields: ['createdAt'] }] });

  const StockMovement = sequelize.define('StockMovement', {
    productName: { type: DataTypes.STRING(120), allowNull: false },
    gradeName: { type: DataTypes.STRING(30), allowNull: false },
    change: { type: DataTypes.INTEGER, allowNull: false },              // +5 / -2
    reason: { type: DataTypes.STRING(30), allowNull: false },           // adjust | sale | sale_reverted | initial
    username: { type: DataTypes.STRING(50), allowNull: false, defaultValue: '' },
  }, { indexes: [{ fields: ['createdAt'] }] });

  return { User, Grade, Product, Sale, StockMovement };
}

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

async function seed(models) {
  const { User, Grade, Product, StockMovement } = models;

  if ((await User.count()) === 0) {
    await User.create({
      username: process.env.ADMIN_USERNAME || 'admin',
      passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10),
      role: 'admin',
    });
  }

  if ((await Grade.count()) === 0) {
    await Grade.bulkCreate(DEFAULT_GRADES.map((name, i) => ({ name, sortOrder: i })));
  }

  if ((await Product.count()) === 0) {
    const grades = await Grade.findAll();
    const byName = Object.fromEntries(grades.map(g => [g.name, g]));
    for (let i = 0; i < INITIAL_STOCK.length; i++) {
      const [model, storage, gradeCounts] = INITIAL_STOCK[i];
      const counts = {};
      const movements = [];
      const displayName = `${model} ${storage}`.trim();
      for (const [gname, qty] of Object.entries(gradeCounts)) {
        if (byName[gname] && qty > 0) {
          counts[String(byName[gname].id)] = qty;
          movements.push({ productName: displayName, gradeName: gname, change: qty, reason: 'initial', username: 'system' });
        }
      }
      await Product.create({ model, storage, sortOrder: i, counts });
      if (movements.length) await StockMovement.bulkCreate(movements);
    }
  }
}

async function connectDB() {
  if (!cached.ready) {
    cached.ready = (async () => {
      const sequelize = createSequelize();
      const models = defineModels(sequelize);
      await sequelize.authenticate();
      await sequelize.sync(); // creates tables if missing
      await seed(models);
      cached.sequelize = sequelize;
      Object.assign(cached.models, models);
    })();
  }
  await cached.ready;
}

module.exports = { connectDB, models: cached.models, Op };
