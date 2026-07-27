const express = require('express');
const { Product, Grade, Sale, StockMovement } = require('../models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const saleOut = s => ({
  id: s._id, productId: s.productId, productName: s.productName,
  gradeName: s.gradeName, qty: s.qty, username: s.username, createdAt: s.createdAt,
});

router.get('/', async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
  const since = new Date(Date.now() - days * 864e5);
  const sales = await Sale.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 });
  res.json(sales.map(saleOut));
});

router.post('/', async (req, res) => {
  const { product_id, grade_id, qty } = req.body || {};
  const q = parseInt(qty);
  if (!q || q < 1) return res.status(422).json({ detail: 'Quantity must be at least 1' });
  const p = await Product.findById(product_id).catch(() => null);
  const grade = await Grade.findById(grade_id).catch(() => null);
  if (!p || !grade) return res.status(404).json({ detail: 'Product or grade not found' });

  const key = grade._id.toString();
  const available = p.counts.get(key) || 0;
  if (q > available) return res.status(422).json({ detail: `Only ${available} available in grade ${grade.name}` });

  p.counts.set(key, available - q);
  await p.save();
  const sale = await Sale.create({
    productId: p._id, productName: p.displayName, gradeName: grade.name,
    qty: q, username: req.user.username,
  });
  await StockMovement.create({
    productName: p.displayName, gradeName: grade.name,
    change: -q, reason: 'sale', username: req.user.username,
  });
  res.status(201).json(saleOut(sale));
});

router.delete('/:id', async (req, res) => {
  const sale = await Sale.findById(req.params.id);
  if (!sale) return res.status(404).json({ detail: 'Sale not found' });
  if (sale.productId) {
    const p = await Product.findById(sale.productId);
    const grade = await Grade.findOne({ name: sale.gradeName });
    if (p && grade) {
      const key = grade._id.toString();
      p.counts.set(key, (p.counts.get(key) || 0) + sale.qty);
      await p.save();
      await StockMovement.create({
        productName: sale.productName, gradeName: sale.gradeName,
        change: sale.qty, reason: 'sale_reverted', username: req.user.username,
      });
    }
  }
  await sale.deleteOne();
  res.status(204).end();
});

module.exports = router;
