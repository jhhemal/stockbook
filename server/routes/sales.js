const express = require('express');
const { models, Op } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const saleOut = s => ({
  id: String(s.id), productId: s.productId ? String(s.productId) : null,
  productName: s.productName, gradeName: s.gradeName,
  qty: s.qty, username: s.username, createdAt: s.createdAt,
});

router.get('/', async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
  const since = new Date(Date.now() - days * 864e5);
  const sales = await models.Sale.findAll({
    where: { createdAt: { [Op.gte]: since } },
    order: [['createdAt', 'DESC']],
  });
  res.json(sales.map(saleOut));
});

router.post('/', async (req, res) => {
  const { product_id, grade_id, qty } = req.body || {};
  const q = parseInt(qty);
  if (!q || q < 1) return res.status(422).json({ detail: 'Quantity must be at least 1' });
  const p = await models.Product.findByPk(product_id);
  const grade = await models.Grade.findByPk(grade_id);
  if (!p || !grade) return res.status(404).json({ detail: 'Product or grade not found' });

  const key = String(grade.id);
  const available = p.counts?.[key] || 0;
  if (q > available) return res.status(422).json({ detail: `Only ${available} available in grade ${grade.name}` });

  p.counts = { ...p.counts, [key]: available - q };
  await p.save();
  const sale = await models.Sale.create({
    productId: p.id, productName: p.displayName, gradeName: grade.name,
    qty: q, username: req.user.username,
  });
  await models.StockMovement.create({
    productName: p.displayName, gradeName: grade.name,
    change: -q, reason: 'sale', username: req.user.username,
  });
  res.status(201).json(saleOut(sale));
});

router.delete('/:id', async (req, res) => {
  const sale = await models.Sale.findByPk(req.params.id);
  if (!sale) return res.status(404).json({ detail: 'Sale not found' });
  if (sale.productId) {
    const p = await models.Product.findByPk(sale.productId);
    const grade = await models.Grade.findOne({ where: { name: sale.gradeName } });
    if (p && grade) {
      const key = String(grade.id);
      p.counts = { ...p.counts, [key]: (p.counts?.[key] || 0) + sale.qty };
      await p.save();
      await models.StockMovement.create({
        productName: sale.productName, gradeName: sale.gradeName,
        change: sale.qty, reason: 'sale_reverted', username: req.user.username,
      });
    }
  }
  await sale.destroy();
  res.status(204).end();
});

module.exports = router;
