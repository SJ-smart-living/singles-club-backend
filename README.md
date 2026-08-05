# Singles Club Backend v1.0.0

Login-route correction while keeping the formal release version at `v1.0.0`.

## Fixes

- Prevents `/api/admin/login` from falling through to the HTML homepage.
- Returns JSON for every unknown `/api/*` route.
- Adds robust content-type handling to the merchant admin.
- Preserves cookie-based admin sessions.
- Adds a separate build marker without changing the product version.

## Verify after deployment

Open:

`https://singles-club-backend.onrender.com/api/health`

Expected response:

```json
{
  "ok": true,
  "service": "singles-club-backend",
  "version": "1.0.0",
  "build": "login-route-fix"
}
```

Then open:

`https://singles-club-backend.onrender.com/api/admin/login`

A browser GET should return:

```json
{
  "error": "Use POST /api/admin/login"
}
```

## Render settings

- Branch: `main`
- Root Directory: blank
- Build Command: `npm install`
- Start Command: `npm start`
