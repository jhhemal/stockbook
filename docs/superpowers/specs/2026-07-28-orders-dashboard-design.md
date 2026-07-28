# Orders Dashboard — Design Spec

Date: 2026-07-28
Status: approved design, pending implementation

## Problem

Wholesale buy orders are currently tracked on paper sticky notes: one note per client
(e.g. "CV Juan #1", "Global Cell #2", "Augusto"), each line an item request such as
`13 Pro 256 A- ×20` or `15 PM 256 90+ ×15`, crossed out in red when fulfilled.
Replace the paper notes with a digital Orders dashboard inside StockBook.

## Concept

A new **Orders** tab becomes the first tab and the landing view after login.
Each order renders as a card in its partner's color. Existing tabs (Stock, Sales,
Report, Settings) are unchanged; products remain on the Stock page.

Orders are independent of inventory: fulfilling an order line never changes stock
counts and never records a Sale.

## Data model

New Sequelize models in `server/db.js`, following existing patterns
(JSON columns work on both SQLite and Postgres):

### Partner
| Field | Type | Notes |
|---|---|---|
| name | STRING(50), unique, required | e.g. Noori, Jaques, Shiful |
| color | STRING(20), required | hex value chosen from a fixed sticky palette (~8 colors: yellow, orange, pink, green, blue, purple, teal, red) |
| sortOrder | INTEGER, default 0 | display order |

### Order
| Field | Type | Notes |
|---|---|---|
| clientName | STRING(80), required | free text, e.g. "CV Juan #1" |
| partnerId | INTEGER FK → Partner, required | card takes this partner's color |
| status | STRING(20), default `active` | `active` / `completed` / `cancelled` |
| isRush | BOOLEAN, default false | rush orders sort to top with a red ⚡ badge |
| shipByType | STRING(10), nullable | `date` or `day`; null = no ship-by |
| shipByValue | STRING(20), nullable | ISO date (`2026-08-02`) when type=`date`; weekday name (`Friday`) when type=`day` |
| completedAt | DATE, nullable | set when status becomes `completed` |

### OrderLine
| Field | Type | Notes |
|---|---|---|
| orderId | INTEGER FK → Order, required | cascade delete with order |
| productId | INTEGER, nullable | link to Product; null after product delete |
| productName | STRING(120), required | snapshot ("13 Pro 256"), survives product deletes |
| grades | JSON, default [] | array of grade names, e.g. `["A","A-"]` — multi-grade means "any of these acceptable" |
| batteryMin | INTEGER, nullable | minimum battery %, e.g. 80 / 85 / 90 |
| qtyOrdered | INTEGER, required, ≥1 | |
| qtyFulfilled | INTEGER, default 0 | 0 ≤ qtyFulfilled ≤ qtyOrdered, enforced server-side |

## API

New route files following existing auth middleware conventions:

### `server/routes/partners.js`
- `GET /api/partners` — list (any authenticated user)
- `POST /api/partners` — create (admin)
- `PATCH /api/partners/:id` — rename / recolor (admin)
- `DELETE /api/partners/:id` — admin; blocked while the partner has any orders

### `server/routes/orders.js`
- `GET /api/orders?status=active&partner_id=N` — list with lines included; default
  returns active; sorted rush-first, then newest
- `POST /api/orders` — `{ clientName, partnerId, isRush, shipByType, shipByValue, lines: [...] }`;
  creates order + lines in one call
- `PATCH /api/orders/:id` — edit clientName / partner / rush / ship-by / status
  (manual complete, cancel, reopen). Setting status to `completed` stamps `completedAt`
- `DELETE /api/orders/:id` — admin only
- `POST /api/orders/:id/lines` — add a line to an existing order
- `PATCH /api/orders/:id/lines/:lineId` — edit a line (product, grades, batteryMin, qtyOrdered)
- `DELETE /api/orders/:id/lines/:lineId` — remove a line
- `POST /api/orders/:id/lines/:lineId/fulfill` — `{ qty }` (positive to add, negative
  to correct); server clamps so 0 ≤ qtyFulfilled ≤ qtyOrdered. When all lines of the
  order reach qtyOrdered, the order auto-completes (status → `completed`, `completedAt` set).
  If a fulfilled order is edited so a line is no longer full, it reverts to `active`.

## UI

### Orders view (`client/src/views/Orders.jsx`) — new landing tab
- Header: title, subtitle stats ("N active · M units still needed"), **+ New order** button
- Filter chips: **Active** / **Completed** (cancelled shown under Completed with a
  "Cancelled" badge), plus one chip per partner with its color dot
- Card grid: responsive (auto-fill columns on desktop, single column on mobile)

### Order card (style approved from mockup: clean card, partner-color left edge)
- Header: client name; ⚡ Rush badge when `isRush`
- Subtitle: "via <partner> · ship by Fri" (or "Aug 2"); for `date` type the ship-by
  turns red when the date has passed and the order is still active (a weekday
  recurs, so `day` type never turns red)
- One row per line: `productName · grades · battery` + `fulfilled/ordered`, with a
  progress bar underneath:
  - **red** when progress < ⅓
  - **blue** from ⅓ to 99%
  - **green** at 100%, with the line text struck through and dimmed
- Tapping a line opens the **fulfill dialog**: current stock of the product shown
  as a hint, numeric input for units supplied now (+/−), Save
- Card menu (⋯): edit order, mark completed, cancel, reopen, delete (admin)

### New-order form (modal, same pattern as ProductModal)
- Client name (text), partner (dropdown), Rush toggle
- Ship-by: segmented toggle **Date | Day** → date input or weekday picker; optional
- Lines editor: searchable product picker with **inline quick-add** (typing an unknown
  model offers "Add '17 Pro 256' as new product" — creates it with zero stock),
  grade multi-select chips (from existing grades), optional battery-min field,
  quantity input; add/remove rows

### Settings → Partners section (`client/src/views/Settings.jsx`)
- New "Partners" card next to Team: list partners with color swatch, add / rename /
  recolor (fixed sticky palette picker), delete (blocked while partner has orders)
- Admin-only writes, consistent with grades/team

### Navigation (`client/src/App.jsx`)
- TABS becomes: **Orders**, Stock, Sales, Report, Settings; default view `orders`
- New sticky-note icon added to `ui.jsx` icon set
- Mobile bottom tab bar gets the same 5 tabs

## Seeding

Seed the three known partners (Noori, Jaques, Shiful) with distinct colors when the
Partner table is empty, mirroring how grades are seeded. No sample orders.

## Error handling

- Fulfill/edit endpoints validate ownership chain (line belongs to order) and clamp
  quantities server-side; client shows toast on error (existing pattern)
- Deleting a product leaves order lines intact via the productName snapshot
  (productId set null); fulfill dialog simply omits the stock hint
- Partner delete blocked with a clear message while orders reference it

## Testing

The repo has no automated test setup. Verification is manual, against local SQLite:
create partners in Settings → create an order with multi-grade + battery + rush +
ship-by → fulfill lines partially and fully → confirm auto-complete and reopen →
filter chips → mobile layout at narrow width. Also verify `sequelize.sync()` creates
the new tables on a fresh database and on an existing one.

## Out of scope

- Any coupling between order fulfillment and stock counts or Sales
- Matching/reserving stock against orders (the stock hint in the fulfill dialog is
  display-only)
- Notifications/reminders for ship-by dates
- WhatsApp-format export of orders (possible later, mirrors Reports)
