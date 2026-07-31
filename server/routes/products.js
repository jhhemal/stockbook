const express = require('express');
const { models } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function productOut(p) {
  const counts = p.counts || {};
  return {
    id: String(p.id), model: p.model, storage: p.storage, sortOrder: p.sortOrder,
    displayName: p.displayName, counts,
    total: Object.values(counts).reduce((n, q) => n + q, 0),
    updatedAt: p.updatedAt,
  };
}

router.get('/', async (req, res) => {
  const products = await models.Product.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  res.json(products.map(productOut));
});

router.post('/', async (req, res) => {
  const model = (req.body?.model || '').trim();
  const storage = (req.body?.storage || '').trim();
  if (!model) return res.status(422).json({ detail: 'Model name is required' });
  if (await models.Product.findOne({ where: { model, storage } })) {
    return res.status(409).json({ detail: `'${`${model} ${storage}`.trim()}' already exists` });
  }
  const sortOrder = await models.Product.count();
  const counts = {};
  const movements = [];
  const displayName = `${model} ${storage}`.trim();
  for (const [gradeId, qty] of Object.entries(req.body?.counts || {})) {
    const q = Math.max(0, parseInt(qty) || 0);
    if (q > 0) {
      const grade = await models.Grade.findByPk(gradeId);
      if (grade) {
        counts[String(grade.id)] = q;
        movements.push({ productName: displayName, gradeName: grade.name, change: q, reason: 'initial', username: req.user.username });
      }
    }
  }
  const p = await models.Product.create({ model, storage, sortOrder, counts });
  if (movements.length) await models.StockMovement.bulkCreate(movements);
  res.status(201).json(productOut(p));
});

router.post('/reorder', async (req, res) => {
  const ids = req.body?.order;
  if (!Array.isArray(ids) || !ids.length) return res.status(422).json({ detail: 'order must be a non-empty array of product ids' });
  const products = await models.Product.findAll({ where: { id: ids } });
  if (products.length !== ids.length) return res.status(404).json({ detail: 'One or more products not found' });
  const byId = new Map(products.map(p => [String(p.id), p]));
  await Promise.all(ids.map((id, i) => byId.get(String(id)).update({ sortOrder: i })));
  const ordered = await models.Product.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  res.json(ordered.map(productOut));
});

/* POST /api/products/import — bulk stock-in from a purchase CSV, already
 * aggregated client-side into { model, storage, qty } per product/storage.
 * Matches existing products (creating any that don't exist yet) and adds
 * qty to the given grade's count, logging one movement per item. */
router.post('/import', async (req, res) => {
  const { grade_id, items } = req.body || {};
  const grade = grade_id ? await models.Grade.findByPk(grade_id) : null;
  if (!grade) return res.status(422).json({ detail: 'Pick a grade for the imported stock' });
  if (!Array.isArray(items) || !items.length) return res.status(422).json({ detail: 'No items to import' });

  let created = 0, updated = 0, totalUnits = 0;
  const movements = [];
  for (const it of items) {
    const model = String(it?.model || '').trim();
    const storage = String(it?.storage || '').trim();
    const qty = Math.max(0, parseInt(it?.qty) || 0);
    if (!model || !qty) continue;

    let product = await models.Product.findOne({ where: { model, storage } });
    if (!product) {
      const sortOrder = await models.Product.count();
      product = await models.Product.create({ model, storage, sortOrder, counts: {} });
      created++;
    } else {
      updated++;
    }
    const key = String(grade.id);
    product.counts = { ...product.counts, [key]: (product.counts?.[key] || 0) + qty };
    await product.save();
    movements.push({ productName: product.displayName, gradeName: grade.name, change: qty, reason: 'import', username: req.user.username });
    totalUnits += qty;
  }
  if (movements.length) await models.StockMovement.bulkCreate(movements);

  const products = await models.Product.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  res.json({ created, updated, totalUnits, products: products.map(productOut) });
});

router.patch('/:id', async (req, res) => {
  const p = await models.Product.findByPk(req.params.id);
  if (!p) return res.status(404).json({ detail: 'Product not found' });
  if (req.body?.model !== undefined) p.model = req.body.model.trim();
  if (req.body?.storage !== undefined) p.storage = req.body.storage.trim();
  if (req.body?.sortOrder !== undefined) p.sortOrder = req.body.sortOrder;
  await p.save();
  res.json(productOut(p));
});

router.delete('/:id', async (req, res) => {
  const p = await models.Product.findByPk(req.params.id);
  if (!p) return res.status(404).json({ detail: 'Product not found' });
  await p.destroy();
  res.status(204).end();
});

async function changeStock(req, res, computeNewQty) {
  const { grade_id } = req.body || {};
  const p = await models.Product.findByPk(req.params.id);
  const grade = grade_id ? await models.Grade.findByPk(grade_id) : null;
  if (!p || !grade) return res.status(404).json({ detail: 'Product or grade not found' });
  const key = String(grade.id);
  const current = p.counts?.[key] || 0;
  const newQty = computeNewQty(current);
  if (newQty < 0) return res.status(422).json({ detail: `Stock can't go below 0 (currently ${current})` });
  // JSON column: assign a fresh object so Sequelize detects the change
  p.counts = { ...p.counts, [key]: newQty };
  await p.save();
  if (newQty !== current) {
    await models.StockMovement.create({
      productName: p.displayName, gradeName: grade.name,
      change: newQty - current, reason: 'adjust', username: req.user.username,
    });
  }
  res.json(productOut(p));
}

/* Quick +/- correction, logged as 'adjust' */
router.post('/:id/adjust', (req, res) =>
  changeStock(req, res, current => current + (parseInt(req.body?.change) || 0)));

/* Set an exact quantity (edit form) */
router.post('/:id/set', (req, res) =>
  changeStock(req, res, () => Math.max(0, parseInt(req.body?.qty) || 0)));

module.exports = router;
