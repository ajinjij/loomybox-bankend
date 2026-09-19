# Loomybox.com backend

A REST API for the event coordinator marketplace: customers post requirements, vendors send quotes, customers book and pay into escrow, vendors deliver and get paid out, and admins approve vendors and handle disputes.

Built with **Node.js + Express + Prisma**, using **SQLite** so it runs locally with no external database setup. Swap the `DATABASE_URL` in `.env` for a Postgres connection string when you're ready for production — Prisma handles the rest.

## Setup

```bash
cd backend
npm install
cp .env.example .env        # then edit JWT_SECRET to something random
npx prisma migrate dev --name init
npm run seed                # creates an admin login: admin@loomybox.com / admin123
npm run dev                 # starts the API on http://localhost:4000
```

Run `npx prisma studio` any time to browse/edit the database in a GUI.

## How the pieces map to the frontend

| Frontend screen | Endpoints it needs |
|---|---|
| Homepage / search results | `GET /api/vendors` |
| Vendor profile page | `GET /api/vendors/:id`, `GET /api/reviews/vendor/:vendorId` |
| Post requirement form | `POST /api/requirements` |
| Compare quotes page | `GET /api/requirements/:id` (includes quotes), `POST /api/quotes/:id/accept` |
| Checkout / booking page | `POST /api/payments/:bookingId/pay` |
| Customer bookings dashboard | `GET /api/bookings/mine`, `POST /api/reviews` |
| Vendor dashboard | `GET /api/requirements/open`, `POST /api/quotes`, `GET /api/bookings/mine`, `POST /api/bookings/:id/complete` |
| Admin panel | `GET /api/admin/stats`, `GET /api/admin/vendors/pending`, `POST /api/admin/vendors/:id/approve`, `GET /api/admin/bookings/disputed` |
| "Plan my event" AI assistant | `POST /api/assistant/plan` |

## "Plan my event" AI assistant

`POST /api/assistant/plan` takes `{ eventType, city, guestCount, budgetMin, budgetMax, servicesNeeded, notes }` and:
1. Calls the Anthropic API to generate a service checklist (which categories this event needs, why, and a suggested % budget split) plus a couple of sentences of planning advice.
2. Cross-references each suggested category against real approved packages in your DB (matching city/budget), so the customer sees actual bookable options next to the AI's advice.
3. Returns a `needsCustomQuote` array — categories the AI suggested but where no ready-made package matched. The frontend uses this to offer posting a custom `Requirement` for those specific categories instead, feeding into the existing quote flow.

Requires `ANTHROPIC_API_KEY` in `.env` (get one at console.anthropic.com). Optional `ANTHROPIC_MODEL` to pin a specific model — check docs.claude.com for the current recommended string. If the key is missing or the API call fails, the route returns a 502 with a friendly error rather than crashing.

## Full booking lifecycle (how the pieces connect)

1. **Customer** registers (`POST /api/auth/register`, role `CUSTOMER`) and posts a requirement (`POST /api/requirements`).
2. **Vendor** registers (role `VENDOR`), fills in their profile (`PUT /api/vendors/me`), and waits for admin approval.
3. **Admin** approves the vendor (`POST /api/admin/vendors/:id/approve`).
4. **Vendor** sees the open requirement (`GET /api/requirements/open`) and sends a quote (`POST /api/quotes`).
5. **Customer** views quotes on their requirement (`GET /api/requirements/:id`) and accepts one (`POST /api/quotes/:id/accept`) — this creates a `Booking` in `PENDING_PAYMENT`.
6. **Customer** pays (`POST /api/payments/:bookingId/pay`) — funds are recorded as `HELD` (escrow) and the booking becomes `CONFIRMED`.
7. **Vendor** delivers the event and marks it done (`POST /api/bookings/:id/complete`) — booking becomes `COMPLETED`.
8. **Admin** releases the escrowed funds to the vendor (`POST /api/payments/:bookingId/release`).
9. **Customer** leaves a review (`POST /api/reviews`) — this automatically recalculates the vendor's average rating.

If something goes wrong at any point after payment, either side can raise a dispute (`POST /api/bookings/:id/dispute`), and the admin resolves it by releasing or refunding the payment.

## Authentication

Every protected route expects:
```
Authorization: Bearer <token>
```
The token comes back from `POST /api/auth/register` or `POST /api/auth/login`, and encodes the user's `id` and `role` (`CUSTOMER`, `VENDOR`, or `ADMIN`). There's no public admin signup — create admin accounts via the seed script or directly in the database.

## Commission

The commission rate is set in `.env` as `COMMISSION_RATE` (default `0.12`, i.e. 12%). It's applied when a quote is accepted: `totalAmount = quote price + commission`. Adjust this per-vendor or per-category later by moving the rate onto the `VendorProfile` model if you need more granular pricing.

## Connecting the frontend

The `frontend` folder that ships alongside this backend is a real, working site — not a mockup. It talks to this API directly:

- **Browse & search** (`index.html`) → `GET /api/packages`
- **Sign in / sign up** (`auth.html`) → `POST /api/auth/login` and `/api/auth/register`
- **Vendor dashboard** (`vendor-dashboard.html`) → vendors edit their profile and add/edit/delete packages with photos (stored as base64 for local dev)
- **Cart** (`cart.html`) → `GET/POST/PUT/DELETE /api/cart/...` and `POST /api/cart/checkout` (the "Buy Now" moment — creates bookings and captures payment into escrow in one step)
- **Bookings** (`bookings.html`) → `GET /api/bookings/mine`, reviews, disputes

Before opening the frontend, open `frontend/assets/api.js` and check the `API_BASE` constant — it defaults to `http://localhost:4000/api`. Once your backend is deployed somewhere public, update that one line to point at the deployed URL instead.

To run the frontend locally, just open `frontend/index.html` in a browser once the backend is running — no build step needed. If your browser blocks `file://` pages from calling `fetch`, serve the folder instead: `npx serve frontend` (or any static file server) and open the URL it gives you.

### The direct-purchase (cart) path vs. the quote path

This backend actually supports two ways to book, side by side:
1. **Direct purchase (what the frontend above uses)** — customer browses fixed-price packages and buys instantly, like a normal e-commerce checkout. This is the Flipkart-style flow.
2. **Quote-based (built earlier, still live in the API)** — customer posts a custom requirement, vendors send quotes, customer accepts one. Endpoints: `POST /api/requirements`, `POST /api/quotes`, `POST /api/quotes/:id/accept`. There's no frontend page wired to this path yet — only the cart path is connected — but the API is ready if you want to add it later for large/custom events like weddings that need negotiation.

## Important before going live

- **Payments are simulated.** `POST /api/payments/:bookingId/pay` immediately marks funds as held — it does not call a real payment gateway. Before launch, integrate a provider that supports split/held payments (Razorpay Route, Stripe Connect) and only mark a payment `HELD` after the gateway's webhook confirms the charge.
- **Switch to Postgres** for production — SQLite is great for local development but not for concurrent production traffic.
- **Add rate limiting and input sanitization** on public endpoints before exposing this to the internet.
- **Rotate `JWT_SECRET`** and never commit `.env` to version control.
