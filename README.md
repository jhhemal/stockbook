# StockBook (MERN)

Wholesale stock & sales tracking with WhatsApp-format text reports. MongoDB + Express + React + Node, ready for one-click Vercel deployment.

## Features

- **Stock** — products (model + storage) with per-grade quantities, quick +/− adjustments, search
- **Dynamic grades** — A, A-, AB, B, Z, Genuine by default; admins can add/rename/delete any grade
- **Sales** — recording a sale decrements stock automatically; deleting a sale restores it; oversell blocked
- **Reports** — exact WhatsApp text format, filterable to any combination of grades, plus "sold today / yesterday"; one-tap copy and direct `wa.me` share
- **Team** — admin and staff roles; admins manage users and grades
- **Audit trail** — every stock change (adjust / sale / revert) logged with who and when
- **Responsive** — web-app layout on desktop, bottom-tab app layout on mobile (WebView-ready)

## Deploy to Vercel (5 minutes)

1. **Create a free MongoDB Atlas cluster** at https://www.mongodb.com/cloud/atlas
   - Create a database user, and under *Network Access* allow `0.0.0.0/0` (Vercel's IPs are dynamic)
   - Copy the connection string, e.g. `mongodb+srv://user:pass@cluster.mongodb.net/stockbook`

2. **Push this folder to a GitHub repo**, then in Vercel: *Add New Project* → import the repo. The included `vercel.json` handles everything (React build → static, Express → serverless function).

3. **Set environment variables** in the Vercel project settings:
   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | your Atlas connection string |
   | `JWT_SECRET` | a long random string (`openssl rand -hex 32`) |
   | `ADMIN_USERNAME` | optional, default `admin` |
   | `ADMIN_PASSWORD` | optional, default `admin123` |

4. **Deploy.** First request seeds the default grades, initial stock, and the admin account. Sign in and change the admin password (Settings → Team).

## Local development

```bash
npm install                # server deps
cd client && npm install   # client deps
cp .env.example .env       # fill in MONGODB_URI

# terminal 1 — API on :3000
npm run dev
# terminal 2 — React dev server on :5173 (proxies /api → :3000)
npm run dev:client
```

Or production-style single server: `npm run build && npm start` → http://localhost:3000

## Project structure

```
stockbook-mern/
├── vercel.json            # build + rewrite config for Vercel
├── api/
│   └── index.js           # Vercel serverless entry (wraps the Express app)
├── server/
│   ├── app.js             # Express app: JSON, DB middleware, routes
│   ├── local.js           # local dev server (also serves client/dist)
│   ├── db.js              # cached Mongoose connection + first-run seeding
│   ├── models/index.js    # User, Grade, Product, Sale, StockMovement
│   ├── middleware/auth.js # JWT sign/verify, admin guard
│   └── routes/
│       ├── authUsers.js   # /api/auth (login, me) + /api/users (admin CRUD)
│       ├── grades.js      # grade CRUD (write = admin)
│       ├── products.js    # product CRUD + /adjust + /set stock
│       ├── sales.js       # create / list / delete-with-restore
│       └── reports.js     # /stock, /sold, /movements
└── client/                # React (Vite)
    └── src/
        ├── App.jsx        # auth flow, shell, tab routing
        ├── api.js         # fetch wrapper + JWT
        ├── ui.jsx         # icons, toast, modal, helpers
        ├── app.css        # design system
        └── views/         # Stock, Sales, Report, Settings
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

## Notes for serverless

- The Mongoose connection is cached in `global` so warm Vercel invocations reuse it
- Seeding runs once per cold start and is idempotent (checks counts before inserting)
- Timestamps are stored in UTC; "sold today" uses the server's day boundary — if your team is in a very different timezone from Vercel's region, pin the function region in Vercel settings (e.g. `bom1` for South Asia)

## Roadmap ideas

Pricing & profit per sale · purchase/intake entries with supplier tracking · customer ledger & dues · low-stock alerts · scheduled auto-reports · CSV/Excel export · multi-warehouse · Bengali language toggle
