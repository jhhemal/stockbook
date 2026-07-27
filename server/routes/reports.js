/* Text reports in the exact WhatsApp format:

     13 PM 128
     13 A
     7 A-

   GET /api/reports/stock                 full stock report
   GET /api/reports/stock?grades=A-       only listed grades (comma-separated)
   GET /api/reports/sold?day=today        sold on a given day ('today' | 'yesterday' | YYYY-MM-DD)
   GET /api/reports/movements             audit trail
*/
const express = require('express');
const { models, Op } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/stock', async (req, res) => {
  const allGrades = await models.Grade.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  let selected = allGrades;
  if (req.query.grades) {
    const wanted = new Set(req.query.grades.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
    selected = allGrades.filter(g => wanted.has(g.name.toLowerCase()));
    if (!selected.length) return res.status(422).json({ detail: `No matching grades in '${req.query.grades}'` });
  }
  const includeZero = req.query.include_zero === 'true';

  const products = await models.Product.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  const lines = [];
  let total = 0;
  for (const p of products) {
    const nonzero = selected
      .map(g => [g, (p.counts || {})[String(g.id)] || 0])
      .filter(([, q]) => q > 0);
    if (!nonzero.length && !includeZero) continue;
    lines.push(p.displayName);
    if (nonzero.length) {
      for (const [g, q] of nonzero) {
        lines.push(`${q} ${g.name}`);
        total += q;
      }
    } else {
      lines.push('0');
    }
  }
  res.json({ text: lines.join('\n'), total_units: total, line_count: lines.length });
});

router.get('/sold', async (req, res) => {
  const day = req.query.day || 'today';
  let target;
  if (day === 'today') target = new Date();
  else if (day === 'yesterday') target = new Date(Date.now() - 864e5);
  else {
    target = new Date(day + 'T00:00:00');
    if (isNaN(target)) return res.status(422).json({ detail: "day must be 'today', 'yesterday' or YYYY-MM-DD" });
  }
  const start = new Date(target); start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 864e5);

  const where = { createdAt: { [Op.gte]: start, [Op.lt]: end } };
  if (req.query.grades) {
    where.gradeName = { [Op.in]: req.query.grades.split(',').map(s => s.trim()).filter(Boolean) };
  }
  const sales = await models.Sale.findAll({ where });

  // aggregate: productName -> gradeName -> qty
  const agg = {};
  for (const s of sales) {
    agg[s.productName] = agg[s.productName] || {};
    agg[s.productName][s.gradeName] = (agg[s.productName][s.gradeName] || 0) + s.qty;
  }

  const isToday = start.toDateString() === new Date(new Date().setHours(0, 0, 0, 0)).toDateString();
  const label = isToday ? 'today' : start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const lines = [`Sold ${label}`];
  let total = 0;
  for (const pname of Object.keys(agg)) {
    lines.push(pname);
    for (const [gname, qty] of Object.entries(agg[pname])) {
      lines.push(`${qty} ${gname}`);
      total += qty;
    }
  }
  if (!Object.keys(agg).length) lines.push('Nothing sold');
  lines.push(`Total: ${total}`);
  res.json({ text: lines.join('\n'), total_units: total, line_count: lines.length });
});

router.get('/movements', async (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
  const rows = await models.StockMovement.findAll({ order: [['createdAt', 'DESC']], limit });
  res.json(rows.map(m => ({
    id: String(m.id), productName: m.productName, gradeName: m.gradeName,
    change: m.change, reason: m.reason, username: m.username, createdAt: m.createdAt,
  })));
});

module.exports = router;
