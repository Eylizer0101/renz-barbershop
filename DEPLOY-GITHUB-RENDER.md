# Renz Barbershop: GitHub + Render deployment

## What was changed
- Backend/server.js: bind to 0.0.0.0 automatically in production; localhost default remains for development.
- render.yaml: Render Blueprint with commands and minimum environment variables.
- .gitignore: never commit .env, node_modules, backups or uploaded barber images.
- backend/.env.example: safe template with NO REAL SECRET VALUES.
- No dashboard styles, workflows or API routes were changed.

## 1. Security first
**IMPORTANT:** The uploaded source ZIP contained a real backend/.env. It is deliberately excluded from this package. Rotate any credentials previously shared or published, particularly your MongoDB password, email app/API credentials, JWT secret and staff passwords where applicable. Never upload .env to GitHub.

## 2. Publish to GitHub
1. Extract this ZIP to a new folder, open it in VS Code terminal.
2. Create a private, empty repository on github.com/new (do not pre-add README).
3. In the extracted project directory run:

```sh
git init
git add .
git status
git commit -m "Prepare Renz Barbershop for Render"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Check `git status` before the commit: backend/.env must NOT be listed. This ZIP omits it entirely.

## 3. Atlas database
Your backend uses MongoDB; a stable, reachable MongoDB Atlas deployment is recommended. Set Atlas database user, Network Access and connection string appropriately. Do not put database credentials in git. Review Atlas allowlist rules and secure credentials. Existing data only appears if you use the intended existing database; never blindly seed or restore into a production database.

## 4. Render
Option A: Render Dashboard > New > Blueprint > select GitHub repo > apply `render.yaml`; supply `MONGODB_URI` secret when prompted, confirm plan and other settings.

Option B: Render Dashboard > New > Web Service > connect repo, configure:
- Environment: Node
- Root Directory: leave blank (repository root)
- Build Command: `npm ci --prefix backend`
- Start Command: `npm start --prefix backend`
- Environment variables: `NODE_ENV=production`, `TRUST_PROXY=1`, `TZ=Asia/Manila`, `MONGODB_URI=...`, `JWT_SECRET=...` (min 32 characters), `DB_NAME=barbershop` or your database name.
- Do not set PORT unless necessary; Render provides it.

Configure EMAIL_* or BREVO_* values on Render if email login codes/verification must send. Test with real email delivery.

## 5. Smoke checks after deployment
Open the assigned Render HTTPS URL and check: `/`, `/login.html`, `/admin.html`, `/cashier.html`, `/dashboard.html`. Test sign-in, admin email OTP, bookings, queue, inventory, payments and photos using test records (not real customer data). A route serving HTML does not mean login/data is working; inspect Render logs.

## 6. Major production caveat: barber uploads
The current app writes uploaded barber photos to `backend/uploads/barbers` on the server's filesystem. Render's default ephemeral filesystem does not persist new uploads reliably across redeploys/restarts. Existing uploads were excluded from the GitHub-ready ZIP. **Before real use, move photo storage to persistent object storage (e.g., Cloudinary/S3), or configure a compatible persistent disk on a supported Render paid plan and adjust the image path.** The current code has NOT been migrated to object storage.

## 7. Initial users
The repository contains `backend/seed.js` but it should NOT be run automatically on Render. If creating initial admin/cashier accounts is necessary, securely run seed against the intended database only once with correct environment variables. If accounts already exist in Atlas, seeding is generally unnecessary.

## Notes
- No cloud resources were created or GitHub push was performed automatically.
- Render free tier may sleep when idle and may have other limits. Review plan availability and billing before applying Blueprint.
