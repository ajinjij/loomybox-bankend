# Loomybox backend (Postgres / Neon)

## Render settings
- Root Directory: leave blank if this folder is the repo root, otherwise the path to this folder
- Build Command: `npm install`
- Start Command: `npm start`

## Environment variables (Render > Environment)
| Key | Notes |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `JWT_SECRET` | long random string — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `COMMISSION_RATE` | not used by the code yet |

Do NOT set `PORT` on Render — it is injected automatically.

## Run locally
```bash
npm install
cp .env.example .env   # then fill in DATABASE_URL and JWT_SECRET
npm start
```
Tables are created and seeded on first start. Seeded vendor password: `vendor123`.

Check it works: `http://localhost:4000/api/health` should return `{"ok":true}`.
