# Loomybox

A multi-category events & booking marketplace (photography, catering, hampers,
tourist buses, weddings, birthday parties, and local events) — customers book
directly, vendors manage their own requests.

This project has two parts that run independently:

- **backend/** — Node.js + Express + SQLite REST API
- **frontend/** — plain HTML/CSS/JS (no build step) that talks to the API

## Quick start

### 1. Run the backend

```bash
cd backend
cp .env.example .env      # optional — defaults work fine for local dev
npm install
npm start
```

The API starts on `http://localhost:4000`. On first run it creates
`backend/loomybox.db` (SQLite) and seeds it with 7 categories and 5 demo
vendors. Every seeded vendor's password is `vendor123` (see the table below).

### 2. Run the frontend

The frontend is static files — serve them with anything, e.g.:

```bash
cd frontend
python3 -m http.server 8080
```

Then open `http://localhost:8080/index.html` in your browser.

If your backend runs somewhere other than `localhost:4000`, change
`API_BASE` at the top of `frontend/js/api.js`.

## Demo vendor logins

Open `frontend/vendor.html` (or click "Vendor sign in" / "Become a vendor" on
the homepage) and sign in as any of these to see the vendor dashboard:

| Email | Category | Password |
|---|---|---|
| layla@example.com | Photography | vendor123 |
| noor@example.com | Catering | vendor123 |
| coach@example.com | Tourist bus | vendor123 |
| sands@example.com | Hampers | vendor123 |
| aisha@example.com | Wedding | vendor123 |

## What's real vs. mocked

**Real:** categories, vendors, and bookings are stored in an actual SQLite
database. Creating a booking, vendor login (JWT-based), and accepting or
declining a request all persist and reload correctly.

**Mocked, on purpose, so you can wire in your own provider later:**
- Payments — `POST /api/bookings/:id/pay` just records that money arrived,
  it doesn't call a real payment gateway (Stripe, Tabby, PayFort, etc.)
- Email/SMS notifications — nothing is actually sent when a booking is
  created or a vendor responds
- Vendor sign-up — there's no self-serve registration form yet; vendors are
  currently added via `backend/db.js`'s seed data or directly in SQLite

## API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/categories` | — | List categories and their deposit rules |
| GET | `/api/vendors?category=slug` | — | List vendors, optionally filtered |
| GET | `/api/vendors/:id` | — | Single vendor |
| POST | `/api/vendors/login` | — | `{ email, password }` → `{ token, vendor }` |
| POST | `/api/bookings` | — | Customer creates a booking request |
| GET | `/api/bookings/mine` | vendor token | Bookings for the logged-in vendor |
| PATCH | `/api/bookings/:id/status` | vendor token | `{ status: "accepted" \| "declined" }` |
| POST | `/api/bookings/:id/pay` | — | `{ amount }` — mock payment |

## Suggested next steps

- Add a real payment gateway integration on `POST /api/bookings/:id/pay`
- Add vendor self-registration (currently seed-only)
- Add email notifications when a booking is created or its status changes
- Add per-vendor calendar/availability so double-booking a date is prevented
- Swap SQLite for Postgres if/when you need multi-server deployment
