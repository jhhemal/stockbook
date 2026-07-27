const express = require('express');
const { Grade, Product } = require('../models');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const gradeOut = g => ({ id: g._id, name: g.name, sortOrder: g.sortOrder });

router.get('/', async (req, res) => {
  const grades = await Grade.find().sort({ sortOrder: 1, _id: 1 });
  res.json(grades.map(gradeOut));
});

router.post('/', requireAdmin, async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(422).json({ detail: 'Name is required' });
  if (await Grade.findOne({ name })) return res.status(409).json({ detail: 'Grade already exists' });
  const sortOrder = req.body?.sortOrder ?? (await Grade.countDocuments());
  const grade = await Grade.create({ name, sortOrder });
  res.status(201).json(gradeOut(grade));
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const grade = await Grade.findById(req.params.id);
  if (!grade) return res.status(404).json({ detail: 'Grade not found' });
  if (req.body?.name) grade.name = req.body.name.trim();
  if (req.body?.sortOrder !== undefined) grade.sortOrder = req.body.sortOrder;
  await grade.save();
  res.json(gradeOut(grade));
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const grade = await Grade.findById(req.params.id);
  if (!grade) return res.status(404).json({ detail: 'Grade not found' });
  const key = `counts.${grade._id.toString()}`;
  const inUse = await Product.countDocuments({ [key]: { $gt: 0 } });
  if (inUse) {
    return res.status(422).json({ detail: `Grade '${grade.name}' still has stock in ${inUse} product(s). Empty it first.` });
  }
  await grade.deleteOne();
  res.status(204).end();
});

module.exports = router;
