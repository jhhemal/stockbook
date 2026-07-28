# Orders Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace paper sticky-note buy orders with a digital Orders dashboard — partner-colored order cards with per-line partial fulfillment — as the app's landing page.

**Architecture:** Three new Sequelize models (Partner, Order, OrderLine) in the existing `server/db.js` dialect-switch layer; two new Express route files following the `grades.js`/`products.js` patterns; a new Orders view + OrderModal on the client; a Partners section in Settings. Orders are fully decoupled from stock/sales — fulfillment never touches inventory.

**Tech Stack:** Express + Sequelize (SQLite/Postgres), React (Vite), plain CSS in `client/src/app.css`. No test framework exists in this repo; each task verifies with exact curl commands against a throwaway SQLite DB (`SQLITE_PATH=./verify.db`), plus a final browser pass.

**Spec:** `docs/superpowers/specs/2026-07-28-orders-dashboard-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `server/db.js` | Modify | Add Partner/Order/OrderLine models, associations, partner seed |
| `server/routes/partners.js` | Create | Partner CRUD (write = admin, delete blocked while in use) |
| `server/routes/orders.js` | Create | Order + line CRUD, fulfill endpoint, auto-complete logic |
| `server/app.js` | Modify | Mount the two new routers |
| `client/src/ui.jsx` | Modify | Add `orders` (sticky note) and `bolt` icons |
| `client/src/App.jsx` | Modify | Orders tab first, default view `orders` |
| `client/src/views/Orders.jsx` | Create | Dashboard: filters, card grid, fulfill dialog |
| `client/src/views/OrderModal.jsx` | Create | Create/edit order form incl. lines editor, quick-add product, status actions |
| `client/src/views/Settings.jsx` | Modify | Partners section (list, add, edit, delete) |
| `client/src/app.css` | Modify | Orders + swatch styles (appended sections) |

Note: `server/models/index.js` is a leftover Mongoose file that nothing imports — ignore it; all models live in `server/db.js`.

### Server verification harness (used by Tasks 1–3)

Start a throwaway server (run from repo root; kill it when the task is done):

```bash
SQLITE_PATH=./verify.db PORT=3300 node server/local.js &
sleep 2
TOKEN=$(curl -s -X POST localhost:3300/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
echo "TOKEN=$TOKEN"
```

Cleanup after each server task: `kill %1; rm -f verify.db`

---

### Task 1: Models + partner seed

**Files:**
- Modify: `server/db.js`

- [ ] **Step 1: Add the three models to `defineModels`**

In `server/db.js`, inside `defineModels`, after the `StockMovement` definition and before the `return`, add:

```js
  const Partner = sequelize.define('Partner', {
    name: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    color: { type: DataTypes.STRING(20), allowNull: false },              // hex from sticky palette
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { timestamps: false });

  const Order = sequelize.define('Order', {
    clientName: { type: DataTypes.STRING(80), allowNull: false },
    partnerId: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active' }, // active | completed | cancelled
    isRush: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    shipByType: { type: DataTypes.STRING(10), allowNull: true },          // date | day
    shipByValue: { type: DataTypes.STRING(20), allowNull: true },         // ISO date or weekday name
    completedAt: { type: DataTypes.DATE, allowNull: true },
  }, { indexes: [{ fields: ['status'] }] });

  const OrderLine = sequelize.define('OrderLine', {
    orderId: { type: DataTypes.INTEGER, allowNull: false },
    productId: { type: DataTypes.INTEGER, allowNull: true },              // null after product delete
    productName: { type: DataTypes.STRING(120), allowNull: false },       // snapshot
    grades: { type: DataTypes.JSON, allowNull: false, defaultValue: [] }, // ["A","A-"] = any of these
    batteryMin: { type: DataTypes.INTEGER, allowNull: true },             // 80 / 85 / 90 ...
    qtyOrdered: { type: DataTypes.INTEGER, allowNull: false },
    qtyFulfilled: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { indexes: [{ fields: ['orderId'] }] });

  Order.hasMany(OrderLine, { foreignKey: 'orderId', as: 'lines' });
  OrderLine.belongsTo(Order, { foreignKey: 'orderId' });
  Order.belongsTo(Partner, { foreignKey: 'partnerId', as: 'partner' });
```

Change the return statement to include them:

```js
  return { User, Grade, Product, Sale, StockMovement, Partner, Order, OrderLine };
```

- [ ] **Step 2: Seed the three known partners**

In `server/db.js`, below `DEFAULT_GRADES`, add:

```js
const DEFAULT_PARTNERS = [
  ['Noori', '#F59E0B'],
  ['Jaques', '#3B82F6'],
  ['Shiful', '#22C55E'],
];
```

In `seed(models)`, change the destructure to include `Partner`:

```js
  const { User, Grade, Product, StockMovement, Partner } = models;
```

and after the grades seeding block add:

```js
  if ((await Partner.count()) === 0) {
    await Partner.bulkCreate(DEFAULT_PARTNERS.map(([name, color], i) => ({ name, color, sortOrder: i })));
  }
```

- [ ] **Step 3: Verify tables create and seed on a fresh DB**

```bash
rm -f verify.db
SQLITE_PATH=./verify.db node -e "
require('dotenv').config();
const { connectDB, models } = require('./server/db');
connectDB().then(async () => {
  console.log('partners:', await models.Partner.count());
  console.log('orders:', await models.Order.count());
  console.log('lines:', await models.OrderLine.count());
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"
```

Expected output: `partners: 3`, `orders: 0`, `lines: 0`.

Also verify sync is additive on an existing DB (run the same command a second time — must not error).

- [ ] **Step 4: Commit**

```bash
rm -f verify.db
git add server/db.js
git commit -m "feat: add Partner, Order, OrderLine models with partner seed"
```

---

### Task 2: Partners API

**Files:**
- Create: `server/routes/partners.js`
- Modify: `server/app.js`

- [ ] **Step 1: Create `server/routes/partners.js`**

```js
const express = require('express');
const { models } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

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
  if (req.body?.name) partner.name = req.body.name.trim();
  if (req.body?.color) partner.color = req.body.color.trim();
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
```

- [ ] **Step 2: Mount in `server/app.js`**

Add to the requires block:

```js
const partners = require('./routes/partners');
const orders = require('./routes/orders');
```

(Both now — `orders.js` arrives in Task 3; to keep the app bootable at this commit, only add the `partners` line here, and add the `orders` lines in Task 3.)

So in this task add exactly:

```js
const partners = require('./routes/partners');
```

and after `app.use('/api/grades', grades);`:

```js
app.use('/api/partners', partners);
```

- [ ] **Step 3: Verify with curl**

Start the harness (see top of plan), then:

```bash
curl -s localhost:3300/api/partners -H "Authorization: Bearer $TOKEN"
# Expected: [{"id":"1","name":"Noori","color":"#F59E0B",...},{"name":"Jaques",...},{"name":"Shiful",...}]

curl -s -X POST localhost:3300/api/partners -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Test","color":"#EC4899"}'
# Expected: 201 with {"id":"4","name":"Test",...}

curl -s -X DELETE localhost:3300/api/partners/4 -H "Authorization: Bearer $TOKEN" -o /dev/null -w '%{http_code}\n'
# Expected: 204
```

- [ ] **Step 4: Commit**

```bash
kill %1; rm -f verify.db
git add server/routes/partners.js server/app.js
git commit -m "feat: partners API (admin CRUD, delete blocked while in use)"
```

---

### Task 3: Orders API

**Files:**
- Create: `server/routes/orders.js`
- Modify: `server/app.js`

- [ ] **Step 1: Create `server/routes/orders.js`**

```js
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

const INCLUDE = [
  { model: models.OrderLine, as: 'lines' },
  { model: models.Partner, as: 'partner' },
];

function loadOrder(id) {
  return models.Order.findByPk(id, {
    include: INCLUDE,
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
  return { productId: product.id, productName: product.displayName, grades, batteryMin, qtyOrdered: qty };
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
    include: INCLUDE,
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

/* PATCH /api/orders/:id/lines/:lineId — edit grades / battery_min / qty_ordered */
router.patch('/:id/lines/:lineId', async (req, res) => {
  const line = await models.OrderLine.findOne({ where: { id: req.params.lineId, orderId: req.params.id } });
  if (!line) return res.status(404).json({ detail: 'Order line not found' });
  if (req.body?.grades !== undefined) {
    line.grades = Array.isArray(req.body.grades) ? req.body.grades.map(String).filter(Boolean) : [];
  }
  if (req.body?.battery_min !== undefined) {
    line.batteryMin = req.body.battery_min ? parseInt(req.body.battery_min) || null : null;
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
```

- [ ] **Step 2: Mount in `server/app.js`**

Add to requires:

```js
const orders = require('./routes/orders');
```

After `app.use('/api/partners', partners);`:

```js
app.use('/api/orders', orders);
```

- [ ] **Step 3: Verify create → fulfill → auto-complete → reopen with curl**

Start the harness, then:

```bash
# Create an order with 2 lines (products 1 and 2 exist from INITIAL_STOCK seed)
curl -s -X POST localhost:3300/api/orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "clientName":"CV Juan #1","partner_id":1,"isRush":true,"shipByType":"day","shipByValue":"Friday",
  "lines":[{"product_id":1,"grades":["A","A-"],"battery_min":90,"qty":5},{"product_id":2,"grades":["A"],"qty":2}]}'
# Expected: 201, status "active", partnerName "Noori", 2 lines with qtyFulfilled 0

# Partial fulfill line 1 -> stays active
curl -s -X POST localhost:3300/api/orders/1/lines/1/fulfill -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"qty":3}'
# Expected: line 1 qtyFulfilled 3, order status "active"

# Overshoot clamps to qtyOrdered
curl -s -X POST localhost:3300/api/orders/1/lines/1/fulfill -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"qty":99}'
# Expected: line 1 qtyFulfilled 5

# Fill line 2 -> auto-complete
curl -s -X POST localhost:3300/api/orders/1/lines/2/fulfill -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"qty":2}'
# Expected: status "completed", completedAt set

# Default list no longer shows it; done list does
curl -s "localhost:3300/api/orders" -H "Authorization: Bearer $TOKEN"
# Expected: []
curl -s "localhost:3300/api/orders?status=done" -H "Authorization: Bearer $TOKEN"
# Expected: the completed order

# Negative correction reopens
curl -s -X POST localhost:3300/api/orders/1/lines/2/fulfill -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"qty":-1}'
# Expected: status back to "active", completedAt null
```

- [ ] **Step 4: Commit**

```bash
kill %1; rm -f verify.db
git add server/routes/orders.js server/app.js
git commit -m "feat: orders API with partial fulfillment and auto-complete"
```

---

### Task 4: Navigation — Orders tab, icons, stub view

**Files:**
- Modify: `client/src/ui.jsx`
- Modify: `client/src/App.jsx`
- Create: `client/src/views/Orders.jsx` (stub, replaced in Task 5)

- [ ] **Step 1: Add icons to `client/src/ui.jsx`**

In the `paths` object add two entries:

```js
  orders: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/><path d="M8 12h8M8 16h5"/>',
  bolt: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/>',
```

- [ ] **Step 2: Create stub `client/src/views/Orders.jsx`**

```jsx
export default function Orders() {
  return (
    <div className="page-head">
      <div>
        <div className="page-title">Orders</div>
        <div className="page-sub">Coming in the next task</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the tab in `client/src/App.jsx`**

Add the import:

```js
import Orders from './views/Orders';
```

Change `TABS` to put Orders first:

```js
const TABS = [
  { key: 'orders', label: 'Orders' },
  { key: 'stock', label: 'Stock' },
  { key: 'sales', label: 'Sales' },
  { key: 'report', label: 'Report' },
  { key: 'settings', label: 'Settings' },
];
```

Change the initial view state:

```js
const [view, setView] = useState('orders');
```

Add to the `views` map:

```js
    orders: <Orders me={user} />,
```

- [ ] **Step 4: Verify it builds and renders**

```bash
cd client && npm run build
```

Expected: build succeeds. Then `npm run dev` (server) + `npm run dev:client`, sign in at http://localhost:5173 — Orders is the first tab and the landing view; all other tabs still work.

- [ ] **Step 5: Commit**

```bash
git add client/src/ui.jsx client/src/App.jsx client/src/views/Orders.jsx
git commit -m "feat: Orders tab as landing view with sticky-note icon"
```

---

### Task 5: Settings — Partners section

**Files:**
- Modify: `client/src/views/Settings.jsx`
- Modify: `client/src/app.css`

- [ ] **Step 1: Add `PartnerModal` to `client/src/views/Settings.jsx`**

After the `GradeModal` component add:

```jsx
export const PARTNER_PALETTE = ['#F59E0B', '#3B82F6', '#22C55E', '#EF4444', '#A855F7', '#EC4899', '#14B8A6', '#EAB308'];

function PartnerModal({ partner, onClose, onSaved }) {
  const isNew = !partner;
  const toast = useToast();
  const [name, setName] = useState(partner?.name || '');
  const [color, setColor] = useState(partner?.color || PARTNER_PALETTE[0]);
  const save = async () => {
    if (!name.trim()) { toast('Name is required'); return; }
    try {
      if (isNew) await api.post('/api/partners', { name, color });
      else await api.patch(`/api/partners/${partner.id}`, { name, color });
      toast(isNew ? 'Partner added' : 'Saved');
      onSaved();
    } catch (err) { toast(err.message); }
  };
  return (
    <Modal title={isNew ? 'Add partner' : `Edit ${partner.name}`} onClose={onClose}>
      <div className="field" style={{ marginBottom: 14 }}>
        <label>Partner name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Noori" />
      </div>
      <div className="field">
        <label>Note color</label>
        <div className="swatches">
          {PARTNER_PALETTE.map(c => (
            <button key={c} className={`swatch ${color === c ? 'selected' : ''}`}
              style={{ background: c }} aria-label={c} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>{isNew ? 'Add' : 'Save'}</button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Wire partners into the `Settings` component**

Add state next to the existing state hooks:

```js
  const [partners, setPartners] = useState([]);
  const [partnerModal, setPartnerModal] = useState(undefined);
```

In `load()`, extend the initial `Promise.all` to also fetch partners:

```js
      const [g, m, pt] = await Promise.all([
        api.get('/api/grades'), api.get('/api/reports/movements?limit=40'), api.get('/api/partners'),
      ]);
      setGrades(g); setMovements(m); setPartners(pt);
```

Add a delete handler next to `deleteGrade`:

```js
  const deletePartner = async p => {
    if (!confirm(`Delete partner '${p.name}'?`)) return;
    try { await api.del(`/api/partners/${p.id}`); load(); toast('Partner deleted'); }
    catch (err) { toast(err.message); }
  };
```

Add the section JSX after the Grades `settings-section` (before the Team section):

```jsx
      <div className="settings-section">
        <div className="page-head" style={{ marginBottom: 10 }}>
          <div className="side-label" style={{ margin: 0 }}>Partners</div>
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={() => setPartnerModal(null)}>
              <Icon name="plus" /> Add partner
            </button>
          )}
        </div>
        <div className="card">
          <div className="row-list">
            {partners.length ? partners.map(p => (
              <div className="row-item" key={p.id}>
                <span className="pdot" style={{ background: p.color }}></span>
                <div className="row-main">{p.name}</div>
                {isAdmin && (
                  <div className="row-actions">
                    <button className="icon-btn" aria-label="Edit" onClick={() => setPartnerModal(p)}><Icon name="edit" /></button>
                    <button className="icon-btn danger" aria-label="Delete" onClick={() => deletePartner(p)}><Icon name="trash" /></button>
                  </div>
                )}
              </div>
            )) : <div className="empty" style={{ padding: 20 }}><p>No partners yet.</p></div>}
          </div>
        </div>
      </div>
```

And render the modal next to the existing ones at the bottom:

```jsx
      {partnerModal !== undefined && (
        <PartnerModal partner={partnerModal} onClose={() => setPartnerModal(undefined)}
          onSaved={() => { setPartnerModal(undefined); load(); }} />
      )}
```

- [ ] **Step 3: Add swatch styles to `client/src/app.css`**

Append at the end of the SETTINGS section (before `/* movements table */`):

```css
/* partners */
.pdot{display:inline-block;width:12px;height:12px;border-radius:50%;flex-shrink:0}
.swatches{display:flex;gap:9px;flex-wrap:wrap}
.swatch{
  width:30px;height:30px;border-radius:50%;border:2px solid transparent;
  box-shadow:inset 0 0 0 2px rgba(255,255,255,.6);transition:transform .1s;
}
.swatch:hover{transform:scale(1.1)}
.swatch.selected{border-color:var(--ink)}
```

- [ ] **Step 4: Verify in the browser**

With both dev servers running: Settings shows a Partners section with Noori / Jaques / Shiful and their color dots. As admin: add a partner picking a color, rename it, change its color, delete it. Deleting a partner with orders (create one via curl if needed) shows the blocking toast.

- [ ] **Step 5: Commit**

```bash
git add client/src/views/Settings.jsx client/src/app.css
git commit -m "feat: partners management in Settings with color palette"
```

---

### Task 6: Orders dashboard view (cards, filters, fulfill)

**Files:**
- Modify: `client/src/views/Orders.jsx` (replace the stub)
- Modify: `client/src/app.css`

Note: this task imports `OrderModal` from `./OrderModal` — created in Task 7. To keep this commit buildable, Step 1 includes a minimal placeholder `OrderModal.jsx` that Task 7 replaces.

- [ ] **Step 1: Create placeholder `client/src/views/OrderModal.jsx`**

```jsx
import { Modal } from '../ui';

export default function OrderModal({ onClose }) {
  return (
    <Modal title="Order" onClose={onClose}>
      <p style={{ color: 'var(--ink-2)', fontSize: 14 }}>Order form coming in the next task.</p>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Replace `client/src/views/Orders.jsx` with the full view**

```jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon, Modal, useToast } from '../ui';
import OrderModal from './OrderModal';

const WEEKDAY_SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };

export function shipByLabel(o) {
  if (!o.shipByType || !o.shipByValue) return null;
  if (o.shipByType === 'day') return WEEKDAY_SHORT[o.shipByValue] || o.shipByValue;
  const d = new Date(o.shipByValue + 'T00:00:00');
  return isNaN(d) ? o.shipByValue : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function shipByOverdue(o) {
  return o.status === 'active' && o.shipByType === 'date' &&
    o.shipByValue < new Date().toISOString().slice(0, 10);
}

function barClass(line) {
  const p = line.qtyOrdered ? line.qtyFulfilled / line.qtyOrdered : 0;
  if (p >= 1) return 'green';
  if (p >= 1 / 3) return 'blue';
  return 'red';
}

function lineLabel(line) {
  let s = line.productName;
  if (line.grades.length) s += ' · ' + line.grades.join('/');
  if (line.batteryMin) s += ` · ${line.batteryMin}+`;
  return s;
}

function FulfillModal({ order, line, products, grades, onClose, onSaved }) {
  const toast = useToast();
  const remaining = line.qtyOrdered - line.qtyFulfilled;
  const [qty, setQty] = useState(remaining > 0 ? remaining : 0);
  const [busy, setBusy] = useState(false);

  const product = products.find(p => p.id === line.productId);
  const stockHint = product
    ? (line.grades.length
        ? grades.filter(g => line.grades.includes(g.name)).map(g => `${g.name} ${product.counts[g.id] || 0}`).join(' · ')
        : `${product.total} total`)
    : null;

  const save = async () => {
    if (!qty) { toast('Enter a quantity'); return; }
    setBusy(true);
    try {
      await api.post(`/api/orders/${order.id}/lines/${line.id}/fulfill`, { qty });
      toast('Updated');
      onSaved();
    } catch (err) { toast(err.message); setBusy(false); }
  };

  return (
    <Modal title={lineLabel(line)} onClose={onClose}>
      <div className="fulfill-meta">
        <span><b>{line.qtyFulfilled}</b> of <b>{line.qtyOrdered}</b> supplied</span>
        {stockHint && <span className="row-sub">In stock: {stockHint}</span>}
      </div>
      <div className="field">
        <label>Units to add (negative to correct)</label>
        <input type="number" inputMode="numeric" value={qty}
          onChange={e => setQty(parseInt(e.target.value) || 0)}
          onFocus={e => e.target.select()} />
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

export default function Orders({ me }) {
  const toast = useToast();
  const [orders, setOrders] = useState(null);
  const [partners, setPartners] = useState([]);
  const [products, setProducts] = useState([]);
  const [grades, setGrades] = useState([]);
  const [tab, setTab] = useState('active');           // active | done
  const [partnerFilter, setPartnerFilter] = useState('');
  const [editing, setEditing] = useState(undefined);  // undefined=closed, null=new, obj=edit
  const [fulfilling, setFulfilling] = useState(null); // { order, line }

  const loadOrders = async (t = tab, pf = partnerFilter) => {
    try {
      const q = `/api/orders?status=${t}` + (pf ? `&partner_id=${pf}` : '');
      setOrders(await api.get(q));
    } catch (err) { toast(err.message); }
  };

  useEffect(() => {
    (async () => {
      try {
        const [pt, p, g] = await Promise.all([
          api.get('/api/partners'), api.get('/api/products'), api.get('/api/grades'),
        ]);
        setPartners(pt); setProducts(p); setGrades(g);
        await loadOrders();
      } catch (err) { toast(err.message); }
    })();
  }, []);

  const switchTab = t => { setTab(t); setOrders(null); loadOrders(t, partnerFilter); };
  const switchPartner = id => {
    const next = partnerFilter === id ? '' : id;
    setPartnerFilter(next); setOrders(null); loadOrders(tab, next);
  };

  if (!orders) return <div className="loading">Loading…</div>;

  const unitsNeeded = orders.reduce((n, o) =>
    n + (o.status === 'active' ? o.lines.reduce((m, l) => m + Math.max(0, l.qtyOrdered - l.qtyFulfilled), 0) : 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Orders</div>
          <div className="page-sub">
            {tab === 'active' ? `${orders.length} active · ${unitsNeeded} units still needed` : `${orders.length} finished`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing(null)}>
          <Icon name="plus" /> New order
        </button>
      </div>

      <div className="chips" style={{ marginBottom: 16 }}>
        <button className={`chip ${tab === 'active' ? 'selected' : ''}`} onClick={() => switchTab('active')}>Active</button>
        <button className={`chip ${tab === 'done' ? 'selected' : ''}`} onClick={() => switchTab('done')}>Completed</button>
        <span style={{ width: 6 }}></span>
        {partners.map(p => (
          <button key={p.id} className={`chip ${partnerFilter === p.id ? 'selected' : ''}`} onClick={() => switchPartner(p.id)}>
            <span className="pdot" style={{ background: p.color, width: 9, height: 9, marginRight: 6 }}></span>{p.name}
          </button>
        ))}
      </div>

      <div className="orders-grid">
        {orders.length ? orders.map(o => (
          <div className="order-card" key={o.id} style={{ borderLeftColor: o.partnerColor }}>
            <div className="order-head">
              <div className="order-client">{o.clientName}</div>
              {o.isRush && <span className="rush-pill"><Icon name="bolt" size={11} /> Rush</span>}
              {o.status === 'cancelled' && <span className="pill off">cancelled</span>}
              <button className="edit-dot" aria-label="Edit order" onClick={() => setEditing(o)}><Icon name="dots" /></button>
            </div>
            <div className="order-sub">
              via {o.partnerName}
              {shipByLabel(o) && <> · <span className={shipByOverdue(o) ? 'overdue' : ''}>ship by {shipByLabel(o)}</span></>}
            </div>
            {o.lines.map(l => {
              const done = l.qtyFulfilled >= l.qtyOrdered;
              return (
                <div className={`order-line ${done ? 'ol-done' : ''}`} key={l.id} role="button"
                  onClick={() => o.status !== 'cancelled' && setFulfilling({ order: o, line: l })}>
                  <div className="ol-row">
                    <span className="ol-name">{lineLabel(l)}</span>
                    <span className="ol-qty">{l.qtyFulfilled}/{l.qtyOrdered}{done ? ' ✓' : ''}</span>
                  </div>
                  <div className="obar">
                    <i className={barClass(l)} style={{ width: `${Math.min(100, (l.qtyFulfilled / l.qtyOrdered) * 100)}%` }}></i>
                  </div>
                </div>
              );
            })}
          </div>
        )) : (
          <div className="empty" style={{ gridColumn: '1/-1' }}>
            <b>{tab === 'active' ? 'No active orders' : 'Nothing here yet'}</b>
            <p>{tab === 'active' ? 'Tap "New order" to write your first note.' : 'Completed and cancelled orders will appear here.'}</p>
          </div>
        )}
      </div>

      {editing !== undefined && (
        <OrderModal order={editing} me={me} partners={partners} products={products} grades={grades}
          onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); loadOrders(); }}
          onProductsChanged={async () => setProducts(await api.get('/api/products'))} />
      )}
      {fulfilling && (
        <FulfillModal order={fulfilling.order} line={fulfilling.line} products={products} grades={grades}
          onClose={() => setFulfilling(null)}
          onSaved={() => { setFulfilling(null); loadOrders(); }} />
      )}
    </>
  );
}
```

- [ ] **Step 3: Add orders styles to `client/src/app.css`**

Append a new section before the MODAL + TOAST section:

```css
/* ============================================================
   ORDERS
   ============================================================ */
.orders-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px}
@media (max-width:768px){.orders-grid{grid-template-columns:1fr}}
.order-card{
  background:var(--surface);border:1px solid var(--line);border-left-width:5px;
  border-radius:var(--radius);padding:13px 15px;box-shadow:var(--shadow);
}
.order-head{display:flex;align-items:center;gap:8px}
.order-client{font-weight:750;font-size:15.5px;letter-spacing:-.01em;flex:1;min-width:0}
.rush-pill{
  display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:800;
  text-transform:uppercase;letter-spacing:.03em;color:#fff;background:var(--danger);
  border-radius:999px;padding:3px 9px;flex-shrink:0;
}
.rush-pill svg{width:11px;height:11px}
.order-sub{font-size:12px;color:var(--ink-3);font-weight:600;margin:2px 0 6px}
.order-sub .overdue{color:var(--danger)}
.order-line{padding:8px 0 7px;border-top:1px solid var(--line);cursor:pointer;border-radius:6px}
.order-line:hover{background:var(--bg)}
.ol-row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:13.5px;font-weight:600;margin-bottom:5px}
.ol-name{min-width:0}
.ol-qty{color:var(--ink-3);font-variant-numeric:tabular-nums;white-space:nowrap;flex-shrink:0}
.ol-done{opacity:.55}
.ol-done .ol-name{text-decoration:line-through}
.obar{height:4px;border-radius:2px;background:var(--line);overflow:hidden}
.obar i{display:block;height:100%;border-radius:2px;transition:width .2s}
.obar .red{background:#DC2626}
.obar .blue{background:#2563EB}
.obar .green{background:#16A34A}
.fulfill-meta{display:flex;flex-direction:column;gap:3px;font-size:14px;margin-bottom:14px}
```

- [ ] **Step 4: Verify in the browser**

`cd client && npm run build` must pass. Then in the dev app: seed an order via the Task 3 curl commands (or wait for Task 7's form). Confirm: card shows partner color edge, "via Noori · ship by Fri", Rush badge, line rows with red/blue/green bars, ✓ + strikethrough at 100%; tapping a line opens the fulfill dialog with a stock hint; fulfilling all lines moves the order to the Completed chip; partner chips filter; narrow window stacks cards in one column.

- [ ] **Step 5: Commit**

```bash
git add client/src/views/Orders.jsx client/src/views/OrderModal.jsx client/src/app.css
git commit -m "feat: orders dashboard with partner-colored cards and fulfill dialog"
```

---

### Task 7: Order create/edit form

**Files:**
- Modify: `client/src/views/OrderModal.jsx` (replace placeholder)
- Modify: `client/src/app.css`

- [ ] **Step 1: Replace `client/src/views/OrderModal.jsx`**

```jsx
import { useState } from 'react';
import { api } from '../api';
import { Icon, Modal, useToast } from '../ui';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const NEW_PRODUCT = '__new';

let lineKey = 0;
const blankLine = () => ({ key: ++lineKey, id: null, productId: '', newModel: '', newStorage: '', grades: [], batteryMin: '', qty: 1 });

export default function OrderModal({ order, me, partners, products, grades, onClose, onSaved, onProductsChanged }) {
  const isNew = !order;
  const toast = useToast();
  const [clientName, setClientName] = useState(order?.clientName || '');
  const [partnerId, setPartnerId] = useState(order?.partnerId || partners[0]?.id || '');
  const [isRush, setIsRush] = useState(order?.isRush || false);
  const [shipMode, setShipMode] = useState(order?.shipByType || 'none'); // none | date | day
  const [shipDate, setShipDate] = useState(order?.shipByType === 'date' ? order.shipByValue : '');
  const [shipDay, setShipDay] = useState(order?.shipByType === 'day' ? order.shipByValue : 'Friday');
  const [lines, setLines] = useState(() =>
    order
      ? order.lines.map(l => ({
          key: ++lineKey, id: l.id, productId: l.productId || '', productName: l.productName,
          newModel: '', newStorage: '', grades: [...l.grades], batteryMin: l.batteryMin || '', qty: l.qtyOrdered,
        }))
      : [blankLine()]);
  const [removedIds, setRemovedIds] = useState([]);
  const [busy, setBusy] = useState(false);

  const setLine = (key, patch) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = line => {
    if (line.id) setRemovedIds(ids => [...ids, line.id]);
    setLines(ls => ls.filter(l => l.key !== line.key));
  };
  const toggleGrade = (line, name) =>
    setLine(line.key, { grades: line.grades.includes(name) ? line.grades.filter(g => g !== name) : [...line.grades, name] });

  const shipBody = () => ({
    shipByType: shipMode === 'none' ? null : shipMode,
    shipByValue: shipMode === 'date' ? shipDate : shipMode === 'day' ? shipDay : null,
  });

  /* resolve a line's productId, creating the product first for quick-add lines */
  const resolveProduct = async line => {
    if (line.productId !== NEW_PRODUCT) return line.productId;
    const p = await api.post('/api/products', { model: line.newModel, storage: line.newStorage, counts: {} });
    await onProductsChanged();
    return p.id;
  };

  const save = async () => {
    if (!clientName.trim()) { toast('Client name is required'); return; }
    if (!partnerId) { toast('Pick a partner'); return; }
    if (!lines.length) { toast('Add at least one line'); return; }
    for (const l of lines) {
      if (!l.id && !l.productId) { toast('Every line needs a product'); return; }
      if (l.productId === NEW_PRODUCT && !l.newModel.trim()) { toast('Enter the new product model'); return; }
      if (!l.qty || l.qty < 1) { toast('Line quantities must be at least 1'); return; }
    }
    if (shipMode === 'date' && !shipDate) { toast('Pick a ship-by date'); return; }
    setBusy(true);
    try {
      if (isNew) {
        const body = {
          clientName, partner_id: partnerId, isRush, ...shipBody(),
          lines: [],
        };
        for (const l of lines) {
          body.lines.push({ product_id: await resolveProduct(l), grades: l.grades, battery_min: l.batteryMin || null, qty: l.qty });
        }
        await api.post('/api/orders', body);
        toast('Order created');
      } else {
        await api.patch(`/api/orders/${order.id}`, { clientName, partner_id: partnerId, isRush, ...shipBody() });
        for (const id of removedIds) await api.del(`/api/orders/${order.id}/lines/${id}`);
        for (const l of lines) {
          if (l.id) {
            await api.patch(`/api/orders/${order.id}/lines/${l.id}`,
              { grades: l.grades, battery_min: l.batteryMin || null, qty_ordered: l.qty });
          } else {
            await api.post(`/api/orders/${order.id}/lines`,
              { product_id: await resolveProduct(l), grades: l.grades, battery_min: l.batteryMin || null, qty: l.qty });
          }
        }
        toast('Saved');
      }
      onSaved();
    } catch (err) { toast(err.message); setBusy(false); }
  };

  const setStatus = async status => {
    setBusy(true);
    try {
      await api.patch(`/api/orders/${order.id}`, { status });
      toast(status === 'active' ? 'Order reopened' : `Order ${status}`);
      onSaved();
    } catch (err) { toast(err.message); setBusy(false); }
  };

  const remove = async () => {
    if (!confirm(`Delete order for ${order.clientName}? This can't be undone.`)) return;
    setBusy(true);
    try { await api.del(`/api/orders/${order.id}`); toast('Order deleted'); onSaved(); }
    catch (err) { toast(err.message); setBusy(false); }
  };

  return (
    <Modal title={isNew ? 'New order' : `Edit ${order.clientName}`} onClose={onClose}>
      <div className="form-grid">
        <div className="field full">
          <label>Client name</label>
          <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. CV Juan #1" />
        </div>
        <div className="field">
          <label>Partner</label>
          <div className="select-wrap">
            <select value={partnerId} onChange={e => setPartnerId(e.target.value)}>
              {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Rush</label>
          <div className="toggle-row" style={{ border: 'none', padding: '8px 0 0', margin: 0 }}>
            <span style={{ fontSize: 13 }}>⚡ Priority order</span>
            <span className="switch">
              <input type="checkbox" checked={isRush} onChange={e => setIsRush(e.target.checked)} /><i></i>
            </span>
          </div>
        </div>
        <div className="field full">
          <label>Ship by</label>
          <div className="seg" style={{ marginBottom: 8 }}>
            {['none', 'date', 'day'].map(m => (
              <button key={m} className={`seg-btn ${shipMode === m ? 'selected' : ''}`} onClick={() => setShipMode(m)}>
                {m === 'none' ? 'None' : m === 'date' ? 'Date' : 'Day'}
              </button>
            ))}
          </div>
          {shipMode === 'date' && (
            <input type="date" value={shipDate} onChange={e => setShipDate(e.target.value)} />
          )}
          {shipMode === 'day' && (
            <div className="select-wrap">
              <select value={shipDay} onChange={e => setShipDay(e.target.value)}>
                {WEEKDAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="side-label" style={{ margin: '16px 0 8px' }}>Lines</div>
      {lines.map(line => (
        <div className="line-editor" key={line.key}>
          <div className="line-editor-top">
            {line.id ? (
              <div className="line-fixed-name">{line.productName}</div>
            ) : (
              <div className="select-wrap" style={{ flex: 1 }}>
                <select value={line.productId} onChange={e => setLine(line.key, { productId: e.target.value })}>
                  <option value="">Select product…</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                  <option value={NEW_PRODUCT}>+ New product…</option>
                </select>
              </div>
            )}
            <input className="line-qty" type="number" min="1" inputMode="numeric" value={line.qty}
              onChange={e => setLine(line.key, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
              onFocus={e => e.target.select()} aria-label="Quantity" />
            <button className="icon-btn danger" aria-label="Remove line" onClick={() => removeLine(line)}><Icon name="trash" /></button>
          </div>
          {line.productId === NEW_PRODUCT && (
            <div className="line-newprod">
              <input value={line.newModel} onChange={e => setLine(line.key, { newModel: e.target.value })} placeholder="Model, e.g. 17 Pro" />
              <input value={line.newStorage} onChange={e => setLine(line.key, { newStorage: e.target.value })} placeholder="Storage (optional)" />
            </div>
          )}
          <div className="line-editor-bottom">
            <div className="seg">
              {grades.map(g => (
                <button key={g.id} className={`seg-btn seg-sm ${line.grades.includes(g.name) ? 'selected' : ''}`}
                  onClick={() => toggleGrade(line, g.name)}>{g.name}</button>
              ))}
            </div>
            <div className="select-wrap battery-select">
              <select value={line.batteryMin} onChange={e => setLine(line.key, { batteryMin: e.target.value })}>
                <option value="">Battery: any</option>
                {[80, 85, 90, 95].map(b => <option key={b} value={b}>{b}%+</option>)}
              </select>
            </div>
          </div>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => setLines(ls => [...ls, blankLine()])}>
        <Icon name="plus" /> Add line
      </button>

      {!isNew && (
        <div className="order-status-actions">
          {order.status !== 'completed' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus('completed')}>Mark completed</button>}
          {order.status === 'active' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus('cancelled')}>Cancel order</button>}
          {order.status !== 'active' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus('active')}>Reopen</button>}
          {me?.role === 'admin' && <button className="btn btn-danger btn-sm" disabled={busy} onClick={remove}>Delete</button>}
        </div>
      )}

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{isNew ? 'Create order' : 'Save'}</button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Add line-editor styles to `client/src/app.css`**

Append to the ORDERS section:

```css
.line-editor{border:1px solid var(--line);border-radius:var(--radius-sm);padding:10px;margin-bottom:9px;background:var(--bg)}
.line-editor-top{display:flex;align-items:center;gap:8px}
.line-editor-top .field,.line-editor-top .select-wrap{flex:1}
.line-fixed-name{flex:1;font-weight:700;font-size:14px;padding:10px 2px}
.line-qty{width:72px!important;flex-shrink:0;padding:10px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface)}
.line-newprod{display:flex;gap:8px;margin-top:8px}
.line-newprod input{flex:1;padding:9px 11px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface)}
.line-editor-bottom{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}
.seg-sm{padding:5px 10px;font-size:12.5px}
.battery-select{margin-left:auto;min-width:120px}
.battery-select select{padding:7px 26px 7px 10px;font-size:13px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface);width:100%;appearance:none;-webkit-appearance:none}
.order-status-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
```

- [ ] **Step 3: Verify in the browser**

`cd client && npm run build` must pass. In the dev app:
- Create an order matching a real sticky note: client "Augusto", partner Noori, Rush on, ship-by Day → Friday; lines with multi-grade (A + A-), battery 90%+, qty 20; one line using "+ New product…" quick-add.
- Confirm the card appears with everything rendered; the quick-added product exists on the Stock page with zero stock.
- Edit the order: change qty, add a line, remove a line, mark completed, reopen, cancel; as admin, delete it.

- [ ] **Step 4: Commit**

```bash
git add client/src/views/OrderModal.jsx client/src/app.css
git commit -m "feat: order create/edit form with lines editor and quick-add product"
```

---

### Task 8: Final verification pass + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Full clean-database run**

```bash
rm -f verify.db
SQLITE_PATH=./verify.db npm run build && SQLITE_PATH=./verify.db npm start
```

At http://localhost:3000 (login `admin`/`admin123`), walk the whole flow on a fresh DB:
1. Landing view is Orders (empty state)
2. Settings → Partners shows seeded Noori/Jaques/Shiful; add a fourth partner
3. Create two orders (one Rush with ship-by date in the past → red overdue label; one normal with ship-by day)
4. Fulfill partially (red → blue bar), fully (green + ✓ + auto-move to Completed), negative-correct (reopens)
5. Filter by partner chip and by Active/Completed
6. Cancel an order; confirm the cancelled badge under Completed
7. Delete the extra partner — blocked if it has orders, works after deleting them
8. Narrow the window below 768px: 5 bottom tabs, single-column cards, modals slide from bottom
9. Sign in as a staff user: everything works except partner admin buttons and order Delete

Then stop the server and `rm -f verify.db`.

- [ ] **Step 2: Update README features list**

In `README.md`, add to the Features list after the Stock bullet:

```markdown
- **Orders** — client buy orders as partner-colored sticky-note cards; per-line grades ("A or A-"), minimum battery %, rush flag, ship-by date/day; partial fulfillment with progress bars and auto-complete
- **Partners** — internal partners (who orders come through) with their own note color, managed in Settings
```

And in the project structure section, add under `routes/`:

```
│       ├── partners.js    # partner CRUD (write = admin, delete blocked while in use)
│       ├── orders.js      # orders + lines CRUD, fulfill with clamp + auto-complete
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document orders and partners features"
```
