# LivingHub · Singles Club Backend v1.1.0

Compatible upgrade based directly on the supplied backend. Existing public/admin API paths and the current Stripe/Zelle/QR payment workflow are retained.

## Important
This release does not implement Stripe Connect or automatic merchant revenue splitting. Payment submission remains a record that requires operator confirmation. Annual membership links can be configured per plan in Club Console.


## Admin authentication repair

The existing admin routes are unchanged. Login now keeps the secure HttpOnly cookie and also returns a short-lived bearer token stored only in the current browser tab session, improving compatibility with browsers that block or discard cookies.


## Admin authentication compatibility

The Render `ADMIN_EMAIL` and `ADMIN_PASSWORD` values are treated as canonical operator credentials. Existing API routes and payment workflows are unchanged.
