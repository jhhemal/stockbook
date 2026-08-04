/* Manual phone counts — independent of Stock.counts. A count session is a
 * single counting pass (e.g. this week's count); its lines snapshot each
 * product's name so history survives a later rename/delete. */
const express = require('express');
const { models } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function include() {
  return [{ model: models.CountLine, as: 'lines' }];
}

function sessionOut(s) {
  const lines = (s.lines || [])
    .map(l => ({
      id: String(l.id), productId: l.productId ? String(l.productId) : null,
      productName: l.productName, qty: l.qty,
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName, undefined, { numeric: true, sensitivity: 'base' }));
  return {
    id: String(s.id), note: s.note || '', username: s.username, createdAt: s.createdAt,
    totalUnits: lines.reduce((n, l) => n + l.qty, 0),
    lineCount: lines.length,
    lines,
  };
}

/* GET /api/counts — history, newest first */
router.get('/', async (req, res) => {
  const sessions = await models.CountSession.findAll({ include: include(), order: [['createdAt', 'DESC']] });
  res.json(sessions.map(sessionOut));
});

router.get('/:id', async (req, res) => {
  const s = await models.CountSession.findByPk(req.params.id, { include: include() });
  if (!s) return res.status(404).json({ detail: 'Count not found' });
  res.json(sessionOut(s));
});

/* POST /api/counts — { note, lines: [{ product_id, qty }] }. Zero/blank
 * counts are dropped rather than saved as noise. */
router.post('/', async (req, res) => {
  const note = String(req.body?.note || '').trim().slice(0, 200) || null;
  const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [];

  const cleanLines = [];
  for (const l of rawLines) {
    const qty = Math.max(0, parseInt(l?.qty) || 0);
    if (!qty) continue;
    const product = l?.product_id ? await models.Product.findByPk(l.product_id) : null;
    if (!product) continue;
    cleanLines.push({ productId: product.id, productName: product.displayName, qty });
  }
  if (!cleanLines.length) return res.status(422).json({ detail: 'Enter at least one count' });

  const session = await models.CountSession.create({ note, username: req.user.username });
  await models.CountLine.bulkCreate(cleanLines.map(l => ({ ...l, sessionId: session.id })));
  const full = await models.CountSession.findByPk(session.id, { include: include() });
  res.status(201).json(sessionOut(full));
});

router.delete('/:id', async (req, res) => {
  const s = await models.CountSession.findByPk(req.params.id);
  if (!s) return res.status(404).json({ detail: 'Count not found' });
  await models.CountLine.destroy({ where: { sessionId: s.id } });
  await s.destroy();
  res.status(204).end();
});

module.exports = router;
