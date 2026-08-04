const express = require('express');
const { models } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// A partner only needs their own name/color, already embedded in their
// orders — the full partner list (everyone else's business relationships)
// is out of scope for them.
router.use((req, res, next) => {
  if (req.user.role === 'partner') return res.status(403).json({ detail: 'Not available for partner accounts' });
  next();
});

const partnerOut = p => ({ id: String(p.id), name: p.name, color: p.color, sortOrder: p.sortOrder });

router.get('/', async (req, res) => {
  const partners = await models.Partner.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  res.json(partners.map(partnerOut));
});

router.post('/', requireAdmin, async (req, res) => {
  const name = (req.body?.name || '').trim();
  const color = (req.body?.color || '').trim();
  if (!name) return res.status(422).json({ detail: 'Name is required' });
  if (!color) return res.status(422).json({ detail: 'Color is required' });
  if (await models.Partner.findOne({ where: { name } })) {
    return res.status(409).json({ detail: 'Partner already exists' });
  }
  const sortOrder = await models.Partner.count();
  const partner = await models.Partner.create({ name, color, sortOrder });
  res.status(201).json(partnerOut(partner));
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const partner = await models.Partner.findByPk(req.params.id);
  if (!partner) return res.status(404).json({ detail: 'Partner not found' });
  const name = (req.body?.name ?? '').trim();
  const color = (req.body?.color ?? '').trim();
  if (name && name !== partner.name) {
    if (await models.Partner.findOne({ where: { name } })) {
      return res.status(409).json({ detail: 'Partner already exists' });
    }
    partner.name = name;
  }
  if (color) partner.color = color;
  await partner.save();
  res.json(partnerOut(partner));
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const partner = await models.Partner.findByPk(req.params.id);
  if (!partner) return res.status(404).json({ detail: 'Partner not found' });
  const inUse = await models.Order.count({ where: { partnerId: partner.id } });
  if (inUse) {
    return res.status(422).json({ detail: `'${partner.name}' has ${inUse} order(s). Delete those orders first.` });
  }
  await partner.destroy();
  res.status(204).end();
});

module.exports = router;
