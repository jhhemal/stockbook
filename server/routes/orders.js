const express = require('express');
const { models, Op } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const lineOut = l => ({
  id: String(l.id),
  productId: l.productId ? String(l.productId) : null,
  productName: l.productName,
  grades: l.grades || [],
  batteryMin: l.batteryMin,
  note: l.note || '',
  qtyOrdered: l.qtyOrdered,
  qtyFulfilled: l.qtyFulfilled,
});

const orderOut = o => ({
  id: String(o.id),
  clientName: o.clientName,
  partnerId: String(o.partnerId),
  partnerName: o.partner ? o.partner.name : '',
  partnerColor: o.partner ? o.partner.color : '#9AA095',
  status: o.status,
  isRush: o.isRush,
  shipByType: o.shipByType,
  shipByValue: o.shipByValue,
  completedAt: o.completedAt,
  createdAt: o.createdAt,
  lines: (o.lines || []).map(lineOut),
});

// Built lazily (not at module load) since `models` isn't populated until
// connectDB() runs on the first request — a top-level array would capture
// `undefined` for OrderLine/Partner and crash Sequelize's include check.
function include() {
  return [
    { model: models.OrderLine, as: 'lines' },
    { model: models.Partner, as: 'partner' },
  ];
}

function loadOrder(id) {
  return models.Order.findByPk(id, {
    include: include(),
    order: [[{ model: models.OrderLine, as: 'lines' }, 'id', 'ASC']],
  });
}

/* Validate one incoming line body -> OrderLine fields (throws {status, detail}) */
async function buildLine(body) {
  const qty = parseInt(body?.qty);
  if (!qty || qty < 1) throw { status: 422, detail: 'Line quantity must be at least 1' };
  const product = await models.Product.findByPk(body?.product_id);
  if (!product) throw { status: 404, detail: 'Product not found' };
  const grades = Array.isArray(body?.grades) ? body.grades.map(String).filter(Boolean) : [];
  const batteryMin = body?.battery_min ? parseInt(body.battery_min) || null : null;
  const note = String(body?.note || '').trim().slice(0, 200) || null;
  return { productId: product.id, productName: product.displayName, grades, batteryMin, note, qtyOrdered: qty };
}

/* Auto-complete: all lines full -> completed; otherwise back to active. Cancelled is manual-only. */
async function syncStatus(orderId) {
  const order = await models.Order.findByPk(orderId);
  if (!order || order.status === 'cancelled') return;
  const lines = await models.OrderLine.findAll({ where: { orderId } });
  const allFull = lines.length > 0 && lines.every(l => l.qtyFulfilled >= l.qtyOrdered);
  if (allFull && order.status !== 'completed') {
    order.status = 'completed';
    order.completedAt = new Date();
    await order.save();
  } else if (!allFull && order.status === 'completed') {
    order.status = 'active';
    order.completedAt = null;
    await order.save();
  }
}

/* GET /api/orders?status=active|done&partner_id=N — rush first, newest first */
router.get('/', async (req, res) => {
  const where = {};
  where.status = req.query.status === 'done' ? { [Op.in]: ['completed', 'cancelled'] } : 'active';
  if (req.query.partner_id) where.partnerId = req.query.partner_id;
  const orders = await models.Order.findAll({
    where,
    include: include(),
    order: [
      ['isRush', 'DESC'], ['createdAt', 'DESC'],
      [{ model: models.OrderLine, as: 'lines' }, 'id', 'ASC'],
    ],
  });
  res.json(orders.map(orderOut));
});

/* POST /api/orders — { clientName, partner_id, isRush, shipByType, shipByValue, lines: [{product_id, grades, battery_min, qty}] } */
router.post('/', async (req, res) => {
  const clientName = (req.body?.clientName || '').trim();
  if (!clientName) return res.status(422).json({ detail: 'Client name is required' });
  const partner = await models.Partner.findByPk(req.body?.partner_id);
  if (!partner) return res.status(404).json({ detail: 'Partner not found' });
  const rawLines = req.body?.lines;
  if (!Array.isArray(rawLines) || !rawLines.length) {
    return res.status(422).json({ detail: 'At least one order line is required' });
  }
  let lines;
  try { lines = await Promise.all(rawLines.map(buildLine)); }
  catch (err) { return res.status(err.status || 500).json({ detail: err.detail || 'Invalid line' }); }

  const shipByType = ['date', 'day'].includes(req.body?.shipByType) ? req.body.shipByType : null;
  const shipByValue = shipByType ? String(req.body?.shipByValue || '').slice(0, 20) : null;

  const order = await models.Order.create({
    clientName, partnerId: partner.id,
    isRush: !!req.body?.isRush,
    shipByType: shipByValue ? shipByType : null,
    shipByValue: shipByValue || null,
  });
  await models.OrderLine.bulkCreate(lines.map(l => ({ ...l, orderId: order.id })));
  res.status(201).json(orderOut(await loadOrder(order.id)));
});

/* PATCH /api/orders/:id — clientName / partner_id / isRush / ship-by / status */
router.patch('/:id', async (req, res) => {
  const order = await models.Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ detail: 'Order not found' });

  if (req.body?.clientName !== undefined) {
    const name = req.body.clientName.trim();
    if (!name) return res.status(422).json({ detail: 'Client name is required' });
    order.clientName = name;
  }
  if (req.body?.partner_id !== undefined) {
    const partner = await models.Partner.findByPk(req.body.partner_id);
    if (!partner) return res.status(404).json({ detail: 'Partner not found' });
    order.partnerId = partner.id;
  }
  if (req.body?.isRush !== undefined) order.isRush = !!req.body.isRush;
  if (req.body?.shipByType !== undefined) {
    const type = ['date', 'day'].includes(req.body.shipByType) ? req.body.shipByType : null;
    const value = type ? String(req.body?.shipByValue || '').slice(0, 20) : null;
    order.shipByType = value ? type : null;
    order.shipByValue = value || null;
  }
  if (req.body?.status !== undefined) {
    if (!['active', 'completed', 'cancelled'].includes(req.body.status)) {
      return res.status(422).json({ detail: 'Invalid status' });
    }
    order.status = req.body.status;
    order.completedAt = req.body.status === 'completed' ? new Date() : null;
  }
  await order.save();
  res.json(orderOut(await loadOrder(order.id)));
});

/* DELETE /api/orders/:id — admin only */
router.delete('/:id', requireAdmin, async (req, res) => {
  const order = await models.Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ detail: 'Order not found' });
  await models.OrderLine.destroy({ where: { orderId: order.id } });
  await order.destroy();
  res.status(204).end();
});

/* POST /api/orders/:id/lines — add a line */
router.post('/:id/lines', async (req, res) => {
  const order = await models.Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ detail: 'Order not found' });
  let line;
  try { line = await buildLine(req.body); }
  catch (err) { return res.status(err.status || 500).json({ detail: err.detail || 'Invalid line' }); }
  await models.OrderLine.create({ ...line, orderId: order.id });
  await syncStatus(order.id);
  res.status(201).json(orderOut(await loadOrder(order.id)));
});

/* PATCH /api/orders/:id/lines/:lineId — edit grades / battery_min / note / qty_ordered */
router.patch('/:id/lines/:lineId', async (req, res) => {
  const line = await models.OrderLine.findOne({ where: { id: req.params.lineId, orderId: req.params.id } });
  if (!line) return res.status(404).json({ detail: 'Order line not found' });
  if (req.body?.grades !== undefined) {
    line.grades = Array.isArray(req.body.grades) ? req.body.grades.map(String).filter(Boolean) : [];
  }
  if (req.body?.battery_min !== undefined) {
    line.batteryMin = req.body.battery_min ? parseInt(req.body.battery_min) || null : null;
  }
  if (req.body?.note !== undefined) {
    line.note = String(req.body.note || '').trim().slice(0, 200) || null;
  }
  if (req.body?.qty_ordered !== undefined) {
    const q = parseInt(req.body.qty_ordered);
    if (!q || q < 1) return res.status(422).json({ detail: 'Line quantity must be at least 1' });
    line.qtyOrdered = q;
    if (line.qtyFulfilled > q) line.qtyFulfilled = q;
  }
  await line.save();
  await syncStatus(line.orderId);
  res.json(orderOut(await loadOrder(req.params.id)));
});

/* DELETE /api/orders/:id/lines/:lineId */
router.delete('/:id/lines/:lineId', async (req, res) => {
  const line = await models.OrderLine.findOne({ where: { id: req.params.lineId, orderId: req.params.id } });
  if (!line) return res.status(404).json({ detail: 'Order line not found' });
  const orderId = line.orderId;
  await line.destroy();
  await syncStatus(orderId);
  res.json(orderOut(await loadOrder(orderId)));
});

/* POST /api/orders/:id/lines/:lineId/fulfill — { qty } positive adds, negative corrects; clamped */
router.post('/:id/lines/:lineId/fulfill', async (req, res) => {
  const line = await models.OrderLine.findOne({ where: { id: req.params.lineId, orderId: req.params.id } });
  if (!line) return res.status(404).json({ detail: 'Order line not found' });
  const delta = parseInt(req.body?.qty);
  if (!delta) return res.status(422).json({ detail: 'Quantity is required' });
  line.qtyFulfilled = Math.min(line.qtyOrdered, Math.max(0, line.qtyFulfilled + delta));
  await line.save();
  await syncStatus(line.orderId);
  res.json(orderOut(await loadOrder(req.params.id)));
});

module.exports = router;
