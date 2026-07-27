const express = require('express');
const { Product, Grade, StockMovement } = require('../models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function productOut(p) {
  const counts = Object.fromEntries(p.counts || []);
  return {
    id: p._id, model: p.model, storage: p.storage, sortOrder: p.sortOrder,
    displayName: p.displayName, counts,
    total: Object.values(counts).reduce((n, q) => n + q, 0),
  };
}

router.get('/', async (req, res) => {
  const products = await Product.find().sort({ sortOrder: 1, _id: 1 });
  res.json(products.map(productOut));
});

router.post('/', async (req, res) => {
  const model = (req.body?.model || '').trim();
  const storage = (req.body?.storage || '').trim();
  if (!model) return res.status(422).json({ detail: 'Model name is required' });
  if (await Product.findOne({ model, storage })) {
    return res.status(409).json({ detail: `'${model} ${storage}'.trim() already exists`.replace("'.trim()", "'") });
  }
  const sortOrder = await Product.countDocuments();
  const counts = {};
  const movements = [];
  const displayName = `${model} ${storage}`.trim();
  for (const [gradeId, qty] of Object.entries(req.body?.counts || {})) {
    const q = Math.max(0, parseInt(qty) || 0);
    if (q > 0) {
      const grade = await Grade.findById(gradeId).catch(() => null);
      if (grade) {
        counts[gradeId] = q;
        movements.push({ productName: displayName, gradeName: grade.name, change: q, reason: 'initial', username: req.user.username });
      }
    }
  }
  const p = await Product.create({ model, storage, sortOrder, counts });
  if (movements.length) await StockMovement.insertMany(movements);
  res.status(201).json(productOut(p));
});

router.patch('/:id', async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ detail: 'Product not found' });
  if (req.body?.model !== undefined) p.model = req.body.model.trim();
  if (req.body?.storage !== undefined) p.storage = req.body.storage.trim();
  if (req.body?.sortOrder !== undefined) p.sortOrder = req.body.sortOrder;
  await p.save();
  res.json(productOut(p));
});

router.delete('/:id', async (req, res) => {
  const p = await Product.findByIdAndDelete(req.params.id);
  if (!p) return res.status(404).json({ detail: 'Product not found' });
  res.status(204).end();
});

/* Quick +/- correction, logged as 'adjust' */
router.post('/:id/adjust', async (req, res) => {
  const { grade_id, change } = req.body || {};
  const p = await Product.findById(req.params.id);
  const grade = await Grade.findById(grade_id).catch(() => null);
  if (!p || !grade) return res.status(404).json({ detail: 'Product or grade not found' });
  const key = grade._id.toString();
  const current = p.counts.get(key) || 0;
  const newQty = current + (parseInt(change) || 0);
  if (newQty < 0) return res.status(422).json({ detail: `Stock can't go below 0 (currently ${current})` });
  p.counts.set(key, newQty);
  await p.save();
  if (newQty !== current) {
    await StockMovement.create({
      productName: p.displayName, gradeName: grade.name,
      change: newQty - current, reason: 'adjust', username: req.user.username,
    });
  }
  res.json(productOut(p));
});

/* Set an exact quantity (edit form) */
router.post('/:id/set', async (req, res) => {
  const { grade_id, qty } = req.body || {};
  const p = await Product.findById(req.params.id);
  const grade = await Grade.findById(grade_id).catch(() => null);
  if (!p || !grade) return res.status(404).json({ detail: 'Product or grade not found' });
  const q = Math.max(0, parseInt(qty) || 0);
  const key = grade._id.toString();
  const current = p.counts.get(key) || 0;
  p.counts.set(key, q);
  await p.save();
  if (q !== current) {
    await StockMovement.create({
      productName: p.displayName, gradeName: grade.name,
      change: q - current, reason: 'adjust', username: req.user.username,
    });
  }
  res.json(productOut(p));
});

module.exports = router;
