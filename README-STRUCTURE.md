# Barbershop — restored existing code + new folder structure

The original application logic is PRESERVED, not replaced with placeholders.

## Files with working code (moved/renamed)
- `frontend/admin/AdminPage.js` ← original `js/admin.js`
- `frontend/cashier/CashierPage.js` ← original `js/cashier.js`
- `frontend/cashier/QueueManagement.js` ← original `js/desk.js` (used by admin and cashier)
- `frontend/customer/CustomerPage.js` ← original `js/dashboard.js`
- `frontend/auth/Login.js` ← original `js/login.js`
- `frontend/auth/VerifyEmail.js` ← original `js/verify.js`
- `frontend/shared/common.js` ← original `js/common.js`
- `frontend/display/display.js` ← original `js/display.js`
- `frontend/shared/router.js` and `frontend/index.html` preserve the original screen markup and old page URLs; no duplicated HTML pages.
- All original backend source (routes, middleware, utils, seed, scripts, tests) is preserved.

## New placeholder files
`AdminDashboard.js`, `ManageBarbers.js`, `ManageServices.js`, `ManageInventory.js`, `AdminAnalytics.js`, `WalkIn.js`, `Appointments.js`, `Payments.js`, `Register.js`, `Booking.js`, `HaircutGallery.js`, `QueueStatus.js`, `BookingHistory.js`, `ForgotPassword.js`, `shared/api.js`, `shared/Navbar.js`, `main.js` are placeholder-only until actual features are implemented. Do not assume these work yet.

## Local setup
1. Run `npm install` within `backend`.
2. Copy `backend/.env.example` to a private `backend/.env` and configure credentials (never share this file).
3. Run `npm run dev` in `backend`, then visit `http://localhost:3000`.
4. Do not run destructive tests against your live MongoDB Atlas data.

**No live MongoDB CRUD test was run.** Role-based functionality is the original project, not the future 3-role requirements. Backend still includes legacy role flows.

**Security note:** Windows Defender previously flagged the source dashboard HTML in ZIP downloads. This package retains equivalent original markup embedded in `shared/router.js`; it has not been malware-cleared. Do not bypass antivirus warnings. Seek a security review if blocked again.
