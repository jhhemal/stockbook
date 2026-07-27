const express = require('express');
const { models } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const gradeOut = g => ({ id: String(g.id), name: g.name, sortOrder: g.sortOrder });

router.get('/', async (req, res) => {
  const grades = await models.Grade.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  res.json(grades.map(gradeOut));
});

router.post('/', requireAdmin, async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(422).json({ detail: 'Name is required' });
  if (await models.Grade.findOne({ where: { name } })) {
    return res.status(409).json({ detail: 'Grade already exists' });
  }
  const sortOrder = req.body?.sortOrder ?? (await models.Grade.count());
  const grade = await models.Grade.create({ name, sortOrder });
  res.status(201).json(gradeOut(grade));
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const grade = await models.Grade.findByPk(req.params.id);
  if (!grade) return res.status(404).json({ detail: 'Grade not found' });
  if (req.body?.name) grade.name = req.body.name.trim();
  if (req.body?.sortOrder !== undefined) grade.sortOrder = req.body.sortOrder;
  await grade.save();
  res.json(gradeOut(grade));
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const grade = await models.Grade.findByPk(req.params.id);
  if (!grade) return res.status(404).json({ detail: 'Grade not found' });
  // JSON counts column: check usage in JS (product counts are small)
  const products = await models.Product.findAll();
  const key = String(grade.id);
  const inUse = products.filter(p => (p.counts?.[key] || 0) > 0).length;
  if (inUse) {
    return res.status(422).json({ detail: `Grade '${grade.name}' still has stock in ${inUse} product(s). Empty it first.` });
  }
  await grade.destroy();
  res.status(204).end();
});

module.exports = router;
