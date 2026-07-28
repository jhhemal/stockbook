# StockBook

Wholesale stock & sales tracking with WhatsApp-format text reports.
**Express + Sequelize + React (Vite)** — SQLite locally, **Supabase Postgres** in production, deploys to **Vercel**.

## Features

- **Stock** — products (model + storage) with per-grade quantities, quick +/− adjustments, search
- **Orders** — client buy orders as partner-colored sticky-note cards; per-line grades ("A or A-"), minimum battery %, rush flag, ship-by date/day; partial fulfillment with progress bars and auto-complete
- **Partners** — internal partners (who orders come through) with their own note color, managed in Settings
- **Dynamic grades** — A, A-, AB, B, Z, Genuine by default; admins can add/rename/delete any grade
- **Sales** — recording a sale decrements stock automatically; deleting a sale restores it; oversell blocked
- **Reports** — exact WhatsApp text format, filterable to any grade combination, plus "sold today / yesterday"; one-tap copy and direct wa.me share
- **Team** — admin and staff roles; every sale and stock change is attributed to the user who made it
- **Audit trail** — every stock movement (adjust / sale / revert) logged
- **Responsive** — web-app layout on desktop, bottom-tab app layout on mobile (WebView-ready)

## How the database works

`server/db.js` switches dialect on one env var:

| `DATABASE_URL` | Database used |
|---|---|
| not set | **SQLite** file `./stockbook.db` — perfect for local dev, nothing to install |
| `postgresql://...` | **Postgres** (Supabase) — required on Vercel, since Vercel's filesystem is wiped between requests |

Same code, same models, no query changes. Tables are created and seeded automatically on first run.

## Deploy: Supabase + Vercel (10 minutes)

**1. Supabase (free):** https://supabase.com → New project → set a database password.
Then click **Connect** (top bar) → copy the **Transaction pooler** connection string:

```
postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:6543/postgres
```

> Use the **Transaction pooler** (port 6543), not the direct connection — the direct one is IPv6-only and serverless platforms like Vercel need the pooler. Replace `[YOUR-PASSWORD]` with your actual password.

**2. GitHub:** push this folder to a repo (see below if you haven't before).

**3. Vercel:** https://vercel.com → Add New → Project → import the repo. The included `vercel.json` configures everything. Add environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Transaction pooler string from step 1 |
| `JWT_SECRET` | long random string (`openssl rand -hex 32`) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | optional, defaults `admin` / `admin123` |

**4. Deploy.** The first request creates all tables in Supabase and seeds grades, initial stock, and the admin account. Sign in and change the admin password (Settings → Team). You can watch the tables appear in Supabase's Table Editor.

## Local development

```bash
npm install
cd client && npm install && cd ..
cp .env.example .env        # SQLite by default — no DATABASE_URL needed

npm run dev                 # API on :3000 (terminal 1)
npm run dev:client          # React on :5173, proxies /api (terminal 2)
```

Or production-style single server: `npm run build && npm start` → http://localhost:3000
Default login: `admin` / `admin123`.

Want to develop against your real Supabase data? Just put the pooler `DATABASE_URL` in `.env` — same app, live database.

## Project structure

```
├── vercel.json            # build + rewrite config for Vercel
├── api/index.js           # Vercel serverless entry (wraps the Express app)
├── server/
│   ├── app.js             # Express app: JSON parsing, DB middleware, routes
│   ├── local.js           # local dev server (also serves client/dist)
│   ├── db.js              # Sequelize: dialect switch, models, seeding, serverless caching
│   ├── middleware/auth.js # JWT sign/verify, admin guard
│   └── routes/
│       ├── authUsers.js   # /api/auth (login, me) + /api/users (admin CRUD)
│       ├── grades.js      # grade CRUD (write = admin, delete protected while in use)
│       ├── orders.js      # orders + lines CRUD, fulfill with clamp + auto-complete
│       ├── partners.js    # partner CRUD (write = admin, delete blocked while in use)
│       ├── products.js    # product CRUD + /adjust + /set stock
│       ├── sales.js       # create / list / delete-with-restore
│       └── reports.js     # /stock, /sold, /movements
└── client/                # React (Vite) — Stock, Sales, Report, Settings views
```

## Key API endpoints

| Endpoint | What it does |
|---|---|
| `GET /api/reports/stock` | Full stock report text |
| `GET /api/reports/stock?grades=A,A-` | Only the listed grades |
| `GET /api/reports/sold?day=today` | What sold today (also `yesterday` or `YYYY-MM-DD`) |
| `GET /api/reports/movements` | Audit trail |
| `POST /api/products/:id/adjust` | `{grade_id, change}` quick +/− |
| `POST /api/sales` | `{product_id, grade_id, qty}` — validates availability |

## First time pushing to GitHub?

```bash
git init
git add .
git commit -m "Initial commit: StockBook"
# create an empty private repo at github.com/new, then:
git remote add origin https://github.com/YOUR_USERNAME/stockbook.git
git branch -M main
git push -u origin main
```

## Notes

- Timestamps are UTC; "sold today" uses the server's day boundary. If it feels off for your timezone, pin the Vercel function region (e.g. `bom1`) in project settings.
- Supabase also gives you Auth, Storage, and Realtime — good future upgrades (e.g. replace JWT auth with Supabase Auth, live-updating stock across devices).

## Roadmap ideas

Pricing & profit per sale · purchase/intake with supplier tracking · customer ledger & dues · low-stock alerts · scheduled auto-reports · CSV/Excel export · multi-warehouse · Bengali language toggle
