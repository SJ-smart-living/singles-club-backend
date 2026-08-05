# Singles Club Backend v1.0.0

Node.js, Express, PostgreSQL, and merchant administration backend.

## Repository

Recommended repository name:

`singles-club-backend`

## Render deployment

Use the included `render.yaml`.

Required environment variables:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `PUBLIC_BASE_URL`
- `FRONTEND_ORIGIN`

Example:

```text
PUBLIC_BASE_URL=https://singles-club-backend.onrender.com
FRONTEND_ORIGIN=https://sj-smart-living.github.io
```

If the frontend is hosted under GitHub Pages, `FRONTEND_ORIGIN` uses the site origin only, without the repository path.

## Admin

```text
https://YOUR-BACKEND.onrender.com/admin.html
```

## API

The frontend connects through:

```text
https://YOUR-BACKEND.onrender.com/api
```

## Included

- PostgreSQL initialization
- merchant authentication
- event management
- post management
- membership plans
- applications
- private application photos
- application status
- Stripe, Zelle, and QR settings
- exact venue release


## Frontend connection

For the current GitHub Pages frontend:

```text
FRONTEND_ORIGIN=https://sj-smart-living.github.io
```

After deployment, copy the Render service URL into the frontend repository's root `config.js`.
