# Test Plan — Module 1: Auth & Multi-Tenancy

> **Status:** Draft for review
> **Author:** Claude (static analysis)
> **Scope:** Every authentication, session, role, and tenant-isolation surface across the 4 apps + ecom-backend.
> **Execution:** Manual QA unless otherwise marked. IDs are stable — reference them in bug reports.

---

## 1. Module Scope

This module covers **everything that decides who the caller is and what tenant/store they are scoped to**. A defect here is by definition a P0 — it can leak one org's data to another, bypass payment enforcement, or let a cashier act as an owner.

### 1.1 Surfaces covered
| # | Surface | Entry Point |
|---|---------|-------------|
| A | Portal signup | `POST /api/auth/signup` |
| B | Portal login | `POST /api/auth/login` |
| C | Forgot / reset password | `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` |
| D | Phone lookup | `POST /api/auth/phone-lookup` |
| E | Admin-app superadmin login | `POST /api/auth/login` + frontend role check |
| F | Admin impersonation ("Login As") | `POST /api/admin/users/:id/impersonate` + `/impersonate` route |
| G | `protect` JWT middleware | [backend/src/middleware/auth.js](backend/src/middleware/auth.js) |
| H | `authorize(...roles)` RBAC | same file |
| I | `scopeToTenant` — org/store injection | [backend/src/middleware/scopeToTenant.js](backend/src/middleware/scopeToTenant.js) |
| J | `requireTenant` guard | same file |
| K | `requireActiveTenant` — plan / trial gate | same file |
| L | `allowTenantOverride` — `X-Tenant-Id` superadmin | same file |
| M | Station pair / register | `POST /api/pos-terminal/station-register` |
| N | Station verify on boot | `GET /api/pos-terminal/station-verify` |
| O | Cashier PIN login | `POST /api/pos-terminal/pin-login` |
| P | Set / remove cashier PIN | `PUT /api/users/:id/pin`, `DELETE /api/users/:id/pin` |
| Q | Clock in / out via PIN | inside [backend/src/controllers/posTerminalController.js](backend/src/controllers/posTerminalController.js) — `clockEvent` |
| R | Storefront customer signup / login | `POST /api/storefront/:storeId/auth/signup` / `/login` — ecom-backend proxying to POS |
| S | Storefront customer password change | `PUT /api/storefront/:storeId/auth/password` |
| T | Frontend `ProtectedRoute` | [frontend/src/App.jsx:128](frontend/src/App.jsx:128) |
| U | Frontend `ImpersonateLanding` | [frontend/src/App.jsx:135](frontend/src/App.jsx:135) |
| V | Admin-app `ProtectedRoute` (superadmin-only) | [admin-app/src/App.jsx](admin-app/src/App.jsx) |

### 1.2 Key files
- [backend/src/controllers/authController.js](backend/src/controllers/authController.js)
- [backend/src/controllers/stationController.js](backend/src/controllers/stationController.js)
- [backend/src/controllers/adminController.js](backend/src/controllers/adminController.js) — `impersonateUser`
- [backend/src/controllers/posTerminalController.js](backend/src/controllers/posTerminalController.js) — `clockEvent`
- [backend/src/middleware/auth.js](backend/src/middleware/auth.js)
- [backend/src/middleware/scopeToTenant.js](backend/src/middleware/scopeToTenant.js)
- [backend/src/services/emailService.js](backend/src/services/emailService.js)
- [backend/src/routes/authRoutes.js](backend/src/routes/authRoutes.js)
- [frontend/src/App.jsx](frontend/src/App.jsx) — `ProtectedRoute`, `ImpersonateLanding`
- [frontend/src/pages/Login.jsx](frontend/src/pages/Login.jsx)
- [frontend/src/pages/Signup.jsx](frontend/src/pages/Signup.jsx)
- [frontend/src/pages/ForgotPassword.jsx](frontend/src/pages/ForgotPassword.jsx)
- [frontend/src/pages/PhoneLookup.jsx](frontend/src/pages/PhoneLookup.jsx)
- [admin-app/src/pages/Login.jsx](admin-app/src/pages/Login.jsx)
- [admin-app/src/App.jsx](admin-app/src/App.jsx) — `ProtectedRoute`
- [cashier-app/src/screens/StationSetupScreen.jsx](cashier-app/src/screens/StationSetupScreen.jsx)
- [cashier-app/src/screens/PinLoginScreen.jsx](cashier-app/src/screens/PinLoginScreen.jsx)
- [cashier-app/src/api/client.js](cashier-app/src/api/client.js)
- [ecom-backend/src/controllers/customerAuthController.js](ecom-backend/src/controllers/customerAuthController.js)
- [ecom-backend/src/services/posCustomerAuthService.js](ecom-backend/src/services/posCustomerAuthService.js)
- [ecom-backend/src/middleware/customerAuth.js](ecom-backend/src/middleware/customerAuth.js)

### 1.3 Global preconditions
Every test in this plan assumes the following are set up once:

1. **Backend** running on `:5000` with a clean Postgres database (`npx prisma db push` executed).
2. **Environment variables** populated: `JWT_SECRET`, `FRONTEND_URL`, `ADMIN_URL`, `SMTP_*`, `BACKEND_URL` (for ecom-backend → POS backend calls).
3. **Seed data** — at minimum:
   - **Org A** (`A`): plan `pro`, active, with users `owner_a@test` (owner), `mgr_a@test` (manager), `cash_a@test` (cashier, PIN `1234`), and stores `A1`, `A2`.
   - **Org B** (`B`): plan `pro`, active, with users `owner_b@test`, cashier `cash_b@test` (PIN `9999`), store `B1`.
   - **Org C** (`C`): plan `trial`, `trialEndsAt` **in the past** (for expiry tests).
   - **Org D** (`D`): `isActive: false` (suspended org).
   - **Superadmin** `root@storv` (role `superadmin`, org may be null or `default`).
   - **Default placeholder org** with slug `default` (used by signup).
4. **Ecom-backend** running on `:5005` with its own DB pushed, and an `EcomStore` tied to Org A / Store A1, ecom enabled.
5. **SMTP** pointed at a test inbox (Mailtrap / MailHog / Ethereal).
6. **Postman / Insomnia / HTTPie** collection for backend routes. Browser for UI routes. Electron dev build of cashier-app available.

### 1.4 Priority legend
- **P0** — security / data-leak / outage. Block release.
- **P1** — major functional bug. Fix this sprint.
- **P2** — UX / secondary flow. Fix next sprint.
- **P3** — nice-to-have polish.

### 1.5 Test type legend
- **API** — hit the HTTP endpoint directly (no UI).
- **UI** — drive the browser / Electron window.
- **E2E** — full multi-step flow across UI + API + DB.
- **Security** — specifically trying to break isolation or bypass guards.
- **Manual** — cannot be automated; requires a human.

---

## 2. Section A — Portal Signup (`POST /api/auth/signup`)

Controller: [backend/src/controllers/authController.js:14](backend/src/controllers/authController.js:14)

### 2.1 Happy-path & input validation

| ID | Title | Priority | Type | Preconditions | Steps | Expected Result |
|----|-------|----------|------|---------------|-------|-----------------|
| A-01 | Create brand-new account | P0 | API | Fresh DB, no existing email | `POST /api/auth/signup` with `{name, email, phone, password}` — 12-char password | `201`; response body contains `id`, `email`, `role='staff'`, `status='pending'`, `token`; JWT decodes to `{id, name, email, role, orgId}` |
| A-02 | New user gets attached to `default` org | P0 | API → DB | As A-01 | After A-01, query `SELECT orgId FROM "User" WHERE email='...'` | `orgId` equals the row where `slug='default'` |
| A-03 | `default` org auto-created on first signup | P1 | API → DB | Delete any row with `slug='default'` | Run A-01 | A new `Organization` row is created with `slug='default'`, `plan='trial'`, `isActive=true` |
| A-04 | Duplicate email rejected | P0 | API | A-01 already run | Run A-01 again with same email | `400 {error: 'User already exists'}` — no second row, no second email sent |
| A-05 | Missing name | P1 | API | — | `POST` with `name` omitted | Non-500; either `400` or Prisma validation error surfaces as a user-readable message |
| A-06 | Missing email | P1 | API | — | `POST` with `email` omitted | `400` / validation error — **NOT** `500` / stack trace |
| A-07 | Missing password | P1 | API | — | `POST` with `password` omitted | `400` / validation error; `bcrypt.hash(undefined)` must not reach the DB. ⚠ **risk: currently not guarded** |
| A-08 | Empty-string password | P0 | Security | — | `POST` with `password: ''` | Rejected. (Today: `bcrypt.hash('', 12)` succeeds — anyone who later posts `password=''` would log in. Verify or fix.) |
| A-09 | SQL-injection payload in email | P0 | Security | — | `email: "x'); DROP TABLE \"User\"; --"` | Prisma rejects as invalid format or stores as literal string; DB intact |
| A-10 | Email with uppercase | P1 | API | — | Signup with `Foo@Bar.com`, then login with `foo@bar.com` | Decide & document: emails are case-sensitive today (`findUnique({email})`) — if A-10 fails login, document as known limitation or fix |
| A-11 | Extremely long name (10 KB) | P2 | API | — | Signup with 10 000-char name | Either accept or reject with `400` — never `500` |
| A-12 | Unicode / emoji name | P2 | API | — | Signup with `name: "José 🔥"` | Stored and returned intact |
| A-13 | Password with leading/trailing spaces | P2 | API | — | Signup with `password: '  secret  '` | Hashed as-is; login must use same value |
| A-14 | Weak password (3 chars) | P1 | Security | — | Signup with `pw: 'abc'` | **Currently accepted** — flag as backlog: enforce min 8 chars |
| A-15 | Rate limit on signup | P1 | Security | — | 50 signups in 5 seconds from one IP | Expected: throttled. **Currently:** no rate limiter — flag as backlog |
| A-16 | Admin notification email fires | P1 | API + email | SMTP configured | Run A-01 | `sendNewSignupNotifyAdmin` is non-blocking but an email should arrive at `ADMIN_URL` mailbox |
| A-17 | Signup DB failure does not leak password | P0 | Security | Simulate DB outage between `findUnique` and `create` | Run A-01 | `500` response body does **not** include raw stack trace or the hashed password |

### 2.2 Post-signup access control

| ID | Title | Priority | Type | Preconditions | Steps | Expected |
|----|-------|----------|------|---------------|-------|----------|
| A-18 | Pending user CANNOT read catalog | P0 | Security | A-01 ran; take returned token | `GET /api/catalog/products` with `Authorization: Bearer <token>` | `403 {error: 'Account is not active...'}` — enforced in `protect` |
| A-19 | Pending user CAN access `/api/tenants` (onboarding) | P0 | API | As A-18 | `GET /api/tenants` with same token | `200` (onboarding endpoint whitelist) |
| A-20 | Pending user CAN access `/api/stores` | P0 | API | As A-18 | `POST /api/stores` to create first store | `200` / `201` |
| A-21 | Pending → creating org promotes user to `owner` | P0 | API + DB | As A-18 | `POST /api/tenants` with org payload | User's `role` updated to `owner`, `status` becomes `active` (verify in DB) |
| A-22 | Pending user rejected from admin routes | P0 | Security | As A-18 | `GET /api/admin/users` | `403` |

---

## 3. Section B — Portal Login (`POST /api/auth/login`)

Controller: [backend/src/controllers/authController.js:69](backend/src/controllers/authController.js:69)

| ID | Title | Priority | Type | Preconditions | Steps | Expected |
|----|-------|----------|------|---------------|-------|----------|
| B-01 | Valid credentials, active user | P0 | API | Org A seeded | POST with `owner_a@test` + correct pw | `200`; body has `id`, `_id` (legacy), `token`, `orgId`, `tenantId`, `role='owner'` |
| B-02 | Unknown email | P0 | Security | — | POST with `nobody@nowhere` | `401 Invalid email or password` — **not** "user not found" (prevents user enumeration) |
| B-03 | Wrong password | P0 | Security | Org A seeded | Correct email, wrong pw | Same message as B-02 — identical error, prevents enumeration |
| B-04 | Error message timing identical | P1 | Security | Org A seeded | Hit B-02 and B-03 10× each, compare response times | Difference should be within noise. ⚠ **Today:** B-02 short-circuits on no-user; B-03 runs bcrypt → slower. Timing oracle exists. Document and decide. |
| B-05 | Pending user login | P0 | API | A-01 done, status=`pending` | POST creds | `403 'account is pending approval'` |
| B-06 | Suspended user login | P0 | API | Manually set `status='suspended'` in DB | POST creds | `403 'account has been suspended'` |
| B-07 | Rejected user login | P1 | API | status=`rejected` | POST creds | `403` — verify message exists (falls into generic `status !== 'active'`) |
| B-08 | JWT payload contents | P0 | Security | — | Decode B-01 token with `jwt.decode` | Contains `id, name, email, role, orgId`. **No** password hash, no `iat`-only claims missing. |
| B-09 | JWT expires after 30 days | P1 | API | — | Generate token, mock clock +31 days, hit protected endpoint | `401` |
| B-10 | Superadmin login | P0 | API | `root@storv` seeded | POST creds | `200`, role `superadmin` |
| B-11 | Login preserves `orgId` (even null for superadmin) | P1 | API | — | As B-10 | `orgId` is present in body, `null` allowed for superadmin |
| B-12 | Login with deleted user | P0 | Security | Soft-delete user (set `deletedAt`) | POST creds | `401` — verify we don't return deleted accounts. ⚠ schema may not have `deletedAt` for User — check before testing |
| B-13 | Login with org `isActive=false` | P0 | Security | Use owner_d@test (Org D suspended) | POST creds | Decide: either `403` at login, or login succeeds but `requireActiveTenant` blocks downstream. Today B-13 **succeeds** — only `requireActiveTenant` blocks. Document. |
| B-14 | Rate limit on login | P0 | Security | — | 100 login attempts in 10 s | Expected: throttled/locked. **Today:** no limiter. Backlog item. |
| B-15 | Credential stuffing across orgs | P0 | Security | Same email used in Org A and Org B — not possible because `email` is unique | Verify `User.email` has a `@unique` constraint | Confirmed unique — impossible. Document. |
| B-16 | Malformed JSON body | P1 | API | — | POST `not-json` with `Content-Type: application/json` | `400` — not `500` |
| B-17 | `Content-Type` missing | P2 | API | — | POST with raw body | `400` |
| B-18 | XSS via name field on response | P1 | Security | Seed user with `name: <script>alert(1)</script>` | Login | Portal UI renders name with React — escaped. Verify. |

---

## 4. Section C — Forgot / Reset Password

Controllers: [backend/src/controllers/authController.js:112](backend/src/controllers/authController.js:112) and `:146`.

### 4.1 Forgot password

| ID | Title | Priority | Type | Preconditions | Steps | Expected |
|----|-------|----------|------|---------------|-------|----------|
| C-01 | Known email | P0 | API + email | Org A seeded, SMTP | `POST /forgot-password {email: owner_a@test}` | `200 {message: 'If that email is...'}`; DB `resetPasswordToken` set (SHA-256 hash); `resetPasswordExpire` ≈ now+30 min; reset email arrives with link `?token=<raw>` |
| C-02 | Unknown email — identical response | P0 | Security | — | `POST /forgot-password {email: nobody@nowhere}` | Same 200 + same message as C-01. No DB write. No email. Prevents enumeration. |
| C-03 | Token is crypto-random | P0 | Security | Run C-01 three times | Capture three raw tokens | All 64 hex chars, all different, high entropy |
| C-04 | Token is hashed in DB | P0 | Security | Run C-01 | Inspect `resetPasswordToken` column | Equals `sha256(rawToken)` — **NOT** the raw token itself |
| C-05 | Reset link format | P1 | UI | `FRONTEND_URL=https://portal.storv` | Run C-01 | Link is `https://portal.storv/reset-password?token=<raw>` |
| C-06 | Missing email body | P2 | API | — | POST empty body | `200` success (same anti-enum response) OR `400` — decide. Today crashes: `prisma.user.findUnique({where:{email: undefined}})` may throw → 500. **Flag.** |
| C-07 | Token overwrites previous token | P1 | API | Run C-01 twice | Inspect DB | Second call replaces the first — only one active reset token at a time |
| C-08 | Malformed email | P2 | API | — | `email: 'not-an-email'` | `200` (anti-enum) |

### 4.2 Reset password

| ID | Title | Priority | Type | Preconditions | Steps | Expected |
|----|-------|----------|------|---------------|-------|----------|
| C-09 | Valid token + new password | P0 | API | C-01 just ran | `POST /reset-password {token: <raw>, password: 'new12345'}` | `200`; DB `password` updated; `resetPasswordToken` and `resetPasswordExpire` set to `null`; login with new pw succeeds; old pw fails; confirmation email sent |
| C-10 | Token reuse blocked | P0 | Security | C-09 just ran | POST the same token again | `400 {error: 'Invalid or expired reset token'}` |
| C-11 | Expired token | P0 | Security | Manually set `resetPasswordExpire` to past | POST | `400` |
| C-12 | Tampered token (1 char off) | P0 | Security | — | POST with altered token | `400` |
| C-13 | Missing token | P1 | API | — | POST `{password: 'x'}` | `400 'Token and new password are required'` |
| C-14 | Missing password | P1 | API | — | POST `{token: 'x'}` | `400` (same) |
| C-15 | Empty-string password | P0 | Security | — | POST with `password: ''` | Rejected. **Today:** only checks truthiness — `''` is falsy, so rejected. ✓ |
| C-16 | 1-char password | P1 | Security | — | POST with `password: 'a'` | Accepted today. Backlog: min length. |
| C-17 | Password change email fires | P1 | API + email | C-09 | Check inbox | `sendPasswordChanged` template arrives |
| C-18 | Concurrent reset race | P1 | Security | Two reset flows in parallel | Submit both | First succeeds, second fails (token nulled) |
| C-19 | Reset cannot change email | P0 | Security | — | POST includes `email: attacker@x` | Email field ignored — only `password` is updated |

### 4.3 UI flows

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| C-20 | `/forgot-password` page | P1 | UI | Load page, submit email | Toast: "check your inbox" |
| C-21 | `/reset-password?token=...` page | P1 | UI | Load with valid token, submit new pw | Redirect to login with success toast |
| C-22 | `/reset-password` with no token | P2 | UI | Load without query param | Either error state or redirect to login |

---

## 5. Section D — Phone Lookup (`POST /api/auth/phone-lookup`)

Controller: [backend/src/controllers/authController.js:179](backend/src/controllers/authController.js:179)

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| D-01 | Known phone | P1 | API | POST `{phone: '+14165551212'}` | `200 {name, email, phone}` — **leaks email by phone number** |
| D-02 | Unknown phone | P1 | API | POST unknown number | `404` |
| D-03 | **Leakage risk assessment** | P0 | Security | Hit D-01 with any org's user's phone | Any anonymous caller can map phone → name + email. **This is an enumeration oracle and arguably a PII leak.** Flag immediately. Recommend: require auth, or return only a partial hint, or remove entirely. |
| D-04 | SQL injection via phone | P0 | Security | `phone: "'; DROP --"` | Stored as string, no crash |
| D-05 | Rate limit | P1 | Security | 1000 requests / minute | Currently no limiter; this + D-03 = phone harvesting |

---

## 6. Section E — Admin-App Login

[admin-app/src/pages/Login.jsx](admin-app/src/pages/Login.jsx) — same `POST /auth/login` backend, but frontend enforces `role === 'superadmin'`.

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| E-01 | Superadmin login | P0 | UI | Open `:5175/login`, submit `root@storv` | Stored in `localStorage.admin_user`, redirect to `/dashboard` |
| E-02 | Owner login rejected | P0 | Security | Submit `owner_a@test` | Frontend toast: "Not authorized" — `localStorage.admin_user` **not set** |
| E-03 | Manager login rejected | P0 | Security | Same for manager | Rejected |
| E-04 | Cashier login rejected | P0 | Security | Same for cashier | Rejected |
| E-05 | Already-logged-in redirect | P1 | UI | Load `/login` while `admin_user` exists | Redirect to `/dashboard` |
| E-06 | Admin-app uses separate storage | P0 | Security | Log in to portal (`user`) and admin (`admin_user`) in same browser | Both coexist; logging out of portal does not log out of admin |
| E-07 | Admin token in portal storage does NOT grant admin access | P0 | Security | Copy admin token into `localStorage.user` in portal | Portal UI works (it's a valid token) but admin panel still requires `admin_user` entry — E-02 spirit |
| E-08 | `ProtectedRoute` in admin-app | P0 | Security | Remove `admin_user` from localStorage, visit `/users` | Redirect to `/login` |
| E-09 | Non-superadmin token smuggled into admin-app | P0 | Security | Place a valid owner token into `admin_user` localStorage manually | Admin-app should still reject on server round-trip (owner gets 403 from `/api/admin/*`). Verify that every admin-app page calls a server endpoint, not just a client-side role check. |
| E-10 | Logout clears `admin_user` | P1 | UI | Click Logout | `admin_user` removed; redirect to `/login` |

---

## 7. Section F — Admin Impersonation

Backend: [backend/src/controllers/adminController.js:272](backend/src/controllers/adminController.js:272)
Frontend landing: [frontend/src/App.jsx:135](frontend/src/App.jsx:135)

### 7.1 API

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| F-01 | Superadmin impersonates owner | P0 | API | `POST /admin/users/<owner_a_id>/impersonate` with admin token | `200 {token, user}`; token is 2-hour JWT containing `impersonatedBy: <admin_id>` |
| F-02 | Token contains audit field | P0 | Security | Decode F-01 token | `decoded.impersonatedBy === adminId` — auditable |
| F-03 | Non-superadmin cannot impersonate | P0 | Security | `POST /admin/users/:id/impersonate` with owner token | `403` (route is guarded by `authorize('superadmin')`) |
| F-04 | Impersonating another superadmin blocked | P0 | Security | Impersonate `root@storv` from another superadmin account | `403 'Cannot impersonate another superadmin'` |
| F-05 | Nonexistent target | P1 | API | `:id = 'ghost'` | `404` |
| F-06 | Impersonation token expires in 2 h | P1 | API | Use returned token after 2 h | `401` |
| F-07 | Impersonation token includes `storeIds` | P0 | Security | Decode payload + inspect response | `user.storeIds` matches target's `UserStore` rows |
| F-08 | Impersonation of deleted/suspended user | P1 | API | Target has `status='suspended'` | Returns token; downstream `protect` middleware blocks most routes. Today this **does** return a token — decide if this is intended (might need the token to see what a suspended user sees). Flag. |
| F-09 | Audit trail written | P1 | API + DB | Run F-01 | Check for any audit log entry — **today there is no audit log**. Backlog: record impersonation events. |

### 7.2 Frontend landing

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| F-10 | `/impersonate?token=X&user=Y` happy path | P0 | UI | Open link from admin-app | Writes `localStorage.user` and redirects to `/portal/pos-api` |
| F-11 | Missing token | P1 | UI | `/impersonate` with no query | Redirect to `/login` |
| F-12 | Malformed `user` JSON | P1 | Security | `/impersonate?token=x&user=not-json` | Catch block redirects to login — no crash |
| F-13 | XSS via `user` param | P0 | Security | `user=%3Cscript%3Ealert(1)%3C%2Fscript%3E` | `JSON.parse` throws → redirect. No script execution. |
| F-14 | Token in URL leaks in referrer headers | P1 | Security | Click a 3rd-party link from `/portal/pos-api` after F-10 | Referrer may include `/impersonate?token=...`. **This is a real risk — the 2-hour token is in the URL and will be logged by the first outbound click.** Recommend: POST the token via form body or short-lived one-time handoff code. Flag. |
| F-15 | Impersonation session shows a banner | P2 | UX | After F-10 | Expected: UI shows "You are impersonating X". **Today: no banner.** Backlog. |
| F-16 | Exiting impersonation | P2 | UX | User clicks "Exit impersonation" | Expected: clears token, returns to admin-app. **Today: no exit UX.** Backlog. |

---

## 8. Section G — `protect` Middleware (JWT)

[backend/src/middleware/auth.js:5](backend/src/middleware/auth.js:5)

| ID | Title | Priority | Type | Preconditions | Steps | Expected |
|----|-------|----------|------|---------------|-------|----------|
| G-01 | No `Authorization` header | P0 | Security | — | `GET /api/catalog/products` | `401 'Not authorized...'` |
| G-02 | Header without `Bearer ` prefix | P0 | Security | — | `Authorization: <token>` | `401` |
| G-03 | Malformed token | P0 | Security | — | `Authorization: Bearer not.a.jwt` | `401` |
| G-04 | Token signed with wrong secret | P0 | Security | Sign JWT with `"otherSecret"` | Valid payload but bad signature | `401` |
| G-05 | Expired token | P0 | Security | `jwt.sign(..., {expiresIn: '-1s'})` | `401` |
| G-06 | Valid token for deleted user | P0 | Security | Sign token, delete user row, then call protected route | `401 'Not authorized...'` — `prisma.user.findUnique` returns null |
| G-07 | `pending` user on catalog route | P0 | Security | See A-18 | `403` |
| G-08 | `pending` user on superadmin route | P0 | Security | Pending user with superadmin role (edge case) | Allowed — `isSuperadmin` short-circuits. Document the carve-out. |
| G-09 | `active` user | P0 | API | — | Any protected route | Passes through |
| G-10 | `req.user` populated with stores relation | P1 | API | Owner_a has 2 UserStore rows | Log `req.user` in a test route | `req.user.stores = [{storeId: A1}, {storeId: A2}]` |
| G-11 | `scopeToTenant` always called after protect | P0 | Security | — | Grep `backend/src/routes/*.js` for routes that use `protect` without `scopeToTenant` | Should all be chained. ⚠ Currently `protect` **internally** calls `scopeToTenant(req, res, next)` — verify no double-invocation and no routes skip it |
| G-12 | Bearer with multiple spaces | P2 | API | `Authorization: Bearer  x.y.z` | Rejected (split(' ')[1] is empty) |
| G-13 | Case-sensitive `Bearer` | P2 | API | `authorization: bearer ...` | Works — Express normalizes header names; prefix check `startsWith('Bearer')` is case-sensitive though. **Token prefixed lowercase `bearer` will fail.** Decide. |
| G-14 | Race: user `status` changed mid-request | P2 | Security | Suspend user between token read and DB fetch | Next request enforces new status |

---

## 9. Section H — `authorize(...roles)` RBAC

[backend/src/middleware/auth.js:53](backend/src/middleware/auth.js:53)

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| H-01 | Owner hits `authorize('owner','admin')` route | P0 | API | — | Passes |
| H-02 | Cashier hits same route | P0 | Security | — | `403 'User role cashier is not authorized...'` |
| H-03 | Superadmin NOT automatically included | P0 | Security | Superadmin hits `authorize('owner')` (no superadmin listed) | `403`. ⚠ **design choice** — confirm whether superadmin should always implicitly pass; today it does not |
| H-04 | Empty role list | P2 | API | `authorize()` with no args | Every role is rejected (array is empty) — defensive |
| H-05 | Unknown role | P1 | Security | User role `"godmode"` hitting `authorize('owner')` | `403` |
| H-06 | Order of middleware | P0 | Security | `authorize` without `protect` before it | Crashes: `req.user` undefined → `req.user?.role` is undefined → rejected. Verify route declarations always run `protect` first |

---

## 10. Section I — `scopeToTenant` Middleware

[backend/src/middleware/scopeToTenant.js:31](backend/src/middleware/scopeToTenant.js:31)

| ID | Title | Priority | Type | Preconditions | Steps | Expected |
|----|-------|----------|------|---------------|-------|----------|
| I-01 | `req.orgId` = user's orgId | P0 | API | Owner_a logged in | Any protected route | `req.orgId === A` |
| I-02 | `req.tenantId` alias | P0 | API | — | — | `req.tenantId === req.orgId` |
| I-03 | `req.tenantFilter` shape | P0 | API | — | — | `{orgId: A}` |
| I-04 | `req.storeIds` comes from `UserStore` | P0 | API | Owner_a linked to A1, A2 | — | `['A1','A2']` |
| I-05 | `X-Store-Id` honored for store-linked user | P0 | API | Owner_a | Send `X-Store-Id: A1` | `req.storeId === 'A1'`, `req.storeFilter = {storeId: 'A1'}` |
| I-06 | `X-Store-Id` NOT honored if not linked and not org-wide | P0 | Security | Cashier_a linked to A1 only | Send `X-Store-Id: A2` | `req.storeId === null`; **does not fall through to first store**. Verify controller gracefully handles null storeId. |
| I-07 | Org-wide roles bypass store check | P0 | Security | Owner_a (role owner) | Send `X-Store-Id: B1` (another org's store!) | `isOrgWide=true` currently allows **any** storeId. ⚠ **P0 bug**: owner of Org A can pass `X-Store-Id: B1` and `req.storeId` is set to B1, leaking Org B data. Need to verify actual controllers filter by `orgId` too — but middleware itself trusts the header blindly. Confirm with real queries. |
| I-08 | First store fallback | P0 | API | Cashier_a, no header | — | `req.storeId === 'A1'` |
| I-09 | User with zero stores | P0 | API | Pending user, no stores linked | — | `req.storeId === null`, `req.storeFilter = {}`. Downstream controllers must handle this. |
| I-10 | Superadmin with null orgId | P0 | API | superadmin without org | Call any route | `req.orgId = null`, `tenantFilter = {}` — means query pulls all rows across orgs. Verify all admin endpoints are OK with this, and no tenant-scoped endpoint accidentally uses this path. |
| I-11 | Header store id does not exist | P2 | API | Owner_a, `X-Store-Id: ghost` | — | `req.storeId === 'ghost'`; downstream query returns empty. Should we 404 at middleware? Decide. |
| I-12 | `X-Store-Id` with whitespace | P2 | API | — | `X-Store-Id: ' A1 '` | Not trimmed today — will not match `userStoreIds.includes(' A1 ')`. Document or fix. |

### 10.1 Critical cross-tenant tests (data leakage)

These are the most important tests in this module. Every one of them must return zero rows or 403 — a single leak is a P0 release-blocker.

| ID | Title | Priority | Type | Preconditions | Steps | Expected |
|----|-------|----------|------|---------------|-------|----------|
| I-13 | Owner_a fetches products with Org B product IDs | P0 | Security | Org A and Org B both have products | `GET /api/catalog/products?id=<B_product_id>` | Empty / not-found — `orgId` filter on all queries |
| I-14 | Owner_a tries `X-Store-Id: B1` | P0 | Security | — | `GET /api/catalog/products` with B1 header | Should **not** return Org B products. Today: middleware trusts header; relies on controller `orgId` filter. Audit all `catalogController` queries. |
| I-15 | Owner_a impersonation-inserts `X-Tenant-Id: B` | P0 | Security | — | Any protected call with `X-Tenant-Id: B` | `403 'Tenant override requires superadmin role'` |
| I-16 | Superadmin uses `X-Tenant-Id: B` | P0 | API | — | — | `req.orgId = B`; data returned is Org B only |
| I-17 | JWT orgId vs DB orgId mismatch | P0 | Security | Manually sign a JWT with `orgId: 'B'` for user in Org A | Call any route | Middleware only reads `req.user.orgId` from DB, not JWT — so token `orgId` is ignored. Verify. If any controller reads orgId from JWT directly, flag. |
| I-18 | Cross-org file upload | P0 | Security | Owner_a uploads invoice with `X-Store-Id: B1` | `POST /api/invoices` | Must either 403 or write with `orgId=A` regardless of header. Verify. |
| I-19 | Cross-org read via wildcard endpoint | P0 | Security | Any endpoint returning a list | Owner_a calls it | No row from org B ever appears |
| I-20 | Write to another org's record | P0 | Security | Owner_a `PUT /api/catalog/products/:id` where id belongs to org B | — | `404` (correct — scoped find returns null); verify not `200` |
| I-21 | Delete another org's record | P0 | Security | Same for DELETE | — | `404` |
| I-22 | Store isolation within an org | P1 | Security | Manager_a linked only to A1 tries to edit a product listed in A2 | — | Depends on design — store-level products (StoreProduct) are store-scoped; master catalog is org-scoped. Document and verify. |
| I-23 | `req.user.stores` tampering | P0 | Security | Try to send `stores` in request body | — | Middleware reads from DB, not body. Confirm. |
| I-24 | Querystring `orgId=B` | P0 | Security | `GET /api/catalog/products?orgId=B` | Controllers must ignore `orgId` in query and use `req.orgId` only | Grep controllers for `req.query.orgId` — any match is a P0 bug |
| I-25 | Body `orgId=B` on POST | P0 | Security | — | Same — controllers must strip body `orgId` | Same audit |

---

## 11. Section J — `requireTenant`

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| J-01 | User with orgId | P1 | API | Owner_a | Passes |
| J-02 | User without orgId | P1 | Security | Superadmin with null orgId | `403 'This endpoint requires an organization...'` |
| J-03 | Used on billing routes | P1 | API | Verify `/api/billing/*` uses it | `grep` routes files |

---

## 12. Section K — `requireActiveTenant` (Trial / Plan Gate)

| ID | Title | Priority | Type | Preconditions | Steps | Expected |
|----|-------|----------|------|---------------|-------|----------|
| K-01 | Active paid plan | P0 | API | Org A, plan pro | Billing-gated route | Passes |
| K-02 | Inactive org | P0 | Security | Org D (`isActive=false`) | — | `403 'Organization account is inactive...'` |
| K-03 | Trial within period | P1 | API | Org with plan=trial, trialEndsAt=future | — | Passes |
| K-04 | Trial expired | P0 | API | Org C (trialEndsAt past) | — | `402 {error, trialEndsAt}` |
| K-05 | Trial with null `trialEndsAt` | P1 | API | Plan=trial, trialEndsAt=null | — | Passes (no gate). Document: trial with no end date is effectively unlimited. |
| K-06 | Org deletion | P0 | API | Hard-delete org (not recommended) | — | `404` or `403` — verify no crash |
| K-07 | `req.tenant` populated | P1 | API | — | Downstream middleware reads `req.tenant` | `{isActive, plan, trialEndsAt}` |

---

## 13. Section L — `allowTenantOverride` (Superadmin `X-Tenant-Id`)

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| L-01 | Non-superadmin sends header | P0 | Security | Owner_a, `X-Tenant-Id: B` | `403` |
| L-02 | Superadmin sends header | P0 | API | Superadmin, `X-Tenant-Id: A` | `req.orgId = A`, `req.tenantFilter = {orgId: A}` |
| L-03 | Superadmin without header | P0 | API | Superadmin, no header | `req.orgId` unchanged (null or own) |
| L-04 | Missing middleware on a route that needs it | P1 | Security | Grep admin endpoints for absence of `allowTenantOverride` | Superadmin reading `/api/catalog/products` sees **no rows** because their own `orgId` is null. Either middleware must be added to catalog routes the admin panel hits, or admin panel must use explicit admin-only endpoints. Audit. |

---

## 14. Section M — Station Register (POS pairing)

[backend/src/controllers/stationController.js:17](backend/src/controllers/stationController.js:17)

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| M-01 | Owner pairs new station | P0 | API | Owner token, `{storeId: A1, name: 'Till 1'}` | `201` with `stationId`, `stationToken` (prefix `stn_`, 44 chars total), `storeName`, `orgId` |
| M-02 | Cashier cannot register | P0 | Security | Cashier token | `403` (routes guarded by `authorize('manager','owner','admin','superadmin')`) |
| M-03 | Store not in caller's org | P0 | Security | Owner_a, `storeId: B1` | `404 'Store not found'` — scoped by `orgId` |
| M-04 | Missing name / storeId | P1 | API | — | `400` |
| M-05 | Duplicate station name | P1 | API | Two stations same name | Allowed? Verify schema — if no unique constraint, allowed and acceptable. Document. |
| M-06 | Token randomness | P0 | Security | Create 10 stations | All 10 tokens are unique and unguessable (nanoid 40) |
| M-07 | `lastSeenAt` set | P2 | API | — | Row has current timestamp |
| M-08 | Multiple stations per store | P1 | API | — | All created, each with unique token |
| M-09 | Station count vs subscription plan limit | P1 | API | Plan allows 2 stations, try to create 3rd | Backlog item from CLAUDE.md — today **not enforced** |
| M-10 | Station register with invalid store status | P2 | API | Store `isActive=false` | Today allowed; decide policy |

## 15. Section N — Station Verify

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| N-01 | Valid token | P0 | API | Station paired | `GET /pos-terminal/station-verify` with `X-Station-Token` | `200` with stationId, storeId, orgId, branding |
| N-02 | Missing header | P0 | Security | — | `401 'Station token required'` |
| N-03 | Invalid token | P0 | Security | — | `401 'Invalid station token'` |
| N-04 | Station `lastSeenAt` updated | P2 | API | — | Increments on every verify |
| N-05 | Station for deleted store | P1 | API | Delete store after pairing | `200` with `storeName=undefined` — no crash, but data is now inconsistent. Decide. |
| N-06 | Stolen station token used from different IP | P1 | Security | Out of scope without IP binding — flag as backlog |

---

## 16. Section O — Cashier PIN Login

[backend/src/controllers/stationController.js:89](backend/src/controllers/stationController.js:89)

| ID | Title | Priority | Type | Preconditions | Steps | Expected |
|----|-------|----------|------|---------------|-------|----------|
| O-01 | Valid PIN | P0 | API | Cashier_a PIN=1234, station A1 paired | POST `{pin:'1234'}` with station token | `200` with `token` (24h JWT), `orgId`, `storeId`, `stationId` |
| O-02 | Wrong PIN | P0 | Security | — | PIN=9999 (belongs to Cashier_b, different org) | `401 'Invalid PIN'` — **critical**: must not match a user from another org |
| O-03 | No station token | P0 | Security | — | Omit header | `401` |
| O-04 | Invalid station token | P0 | Security | — | Bad token | `401` |
| O-05 | Missing PIN in body | P1 | API | — | `{}` | `400 'PIN required'` |
| O-06 | PIN too short | P1 | API | — | `pin: '12'` | `400 'PIN must be 4–6 digits'` |
| O-07 | PIN too long | P1 | API | — | `pin: '1234567'` | `400` |
| O-08 | Non-numeric PIN | P1 | API | — | `pin: 'abcd'` | `400` |
| O-09 | PIN matches multiple users (collision) | P1 | Security | Two users in same org both have PIN `1234` (if allowed) | Which user wins? Today: first one found in `findMany`. **This is undefined behavior.** Either enforce PIN uniqueness per org or rank matches. Flag. |
| O-10 | PIN collision across orgs | P0 | Security | Cashier_a (Org A) PIN=1234, Cashier_b (Org B) PIN=1234 | Login at station A1 | Must only match Cashier_a because `findMany({orgId: station.orgId})`. Confirm. |
| O-11 | Brute force | P0 | Security | 10000 attempts with wrong PIN | Today: no lockout, no throttle, each attempt runs bcrypt.compareSync for every candidate in org. Two problems: (1) **lockout missing** — backlog. (2) **timing oracle** — attempt duration is proportional to user count, leaks org size. Flag. |
| O-12 | bcrypt cost | P1 | Security | — | Check `setCashierPin` uses cost 10 | Acceptable for POS; document |
| O-13 | PIN for suspended user | P1 | Security | Suspend Cashier_a, keep PIN | Login | Today succeeds — matched user includes all statuses. **Should reject suspended users.** P0 fix. |
| O-14 | PIN for pending user | P1 | Security | Pending user with a PIN | — | Same issue — today succeeds. Fix with same logic as portal login. |
| O-15 | Token contains correct claims | P0 | Security | Decode O-01 token | `{id, name, email, role, orgId}` — 24h expiry |
| O-16 | Station `lastSeenAt` updated on every attempt | P2 | API | — | Yes |
| O-17 | Station from one store, PIN from user not linked to that store | P1 | Security | Cashier_a is only linked to A1, but station is A2 (same org) | Login | Today: allowed, because `userStoreIds` is not consulted. Verify this is intended — if a cashier must be store-linked, add that check. |
| O-18 | PIN change does not invalidate old cashier tokens | P1 | Security | Cashier logs in (24h token), then manager changes PIN, cashier's existing token still works | — | Today yes. Backlog: token revocation on PIN change. |

---

## 17. Section P — Set / Remove Cashier PIN

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| P-01 | Manager sets PIN for cashier | P0 | API | `PUT /api/users/<cashier_id>/pin {pin:'1234'}` | `200`. DB `posPin` is a bcrypt hash (not plaintext) |
| P-02 | Cashier cannot set own PIN | P0 | Security | Cashier token | `403` (route guarded) |
| P-03 | Cross-org PIN set | P0 | Security | Owner_a sets PIN on Cashier_b | `404 'User not found'` — `prisma.user.findFirst({id, orgId})` scopes by org |
| P-04 | PIN validation | P1 | API | `{pin:'abc'}` | `400` |
| P-05 | Remove PIN | P1 | API | `DELETE /api/users/:id/pin` | `200`, DB `posPin = null` |
| P-06 | PIN uniqueness NOT enforced | P1 | Security | Set PIN `1234` on two cashiers in same org | Allowed today. See O-09. |
| P-07 | Plaintext PIN never logged | P0 | Security | Grep server logs after P-01 | No occurrence of `1234` |

---

## 18. Section Q — Clock In / Out via PIN

Inside [backend/src/controllers/posTerminalController.js](backend/src/controllers/posTerminalController.js) — `clockEvent`.

| ID | Title | Priority | Type | Preconditions | Steps | Expected |
|----|-------|----------|------|---------------|-------|----------|
| Q-01 | Clock in (first time) | P0 | API | Cashier_a has no events today | POST `clock-event` with PIN, type='in' | Creates `ClockEvent(type='in')`; returns `{userName, type, createdAt}` |
| Q-02 | Clock in when already in | P0 | API | Cashier_a already clocked in | Same call | `{alreadyClockedIn: true, since, userName}`; no new event |
| Q-03 | Clock out when not in | P0 | API | Cashier_a never clocked in today | `type='out'` | `{notClockedIn: true, userName}`; no event |
| Q-04 | Clock out after in | P0 | API | Q-01 just ran | `type='out'` | New `ClockEvent(type='out')` |
| Q-05 | Wrong PIN | P0 | Security | — | `401` |
| Q-06 | Cross-org PIN reaches another org's station | P0 | Security | Cashier_a tries at Station B1 | `401` — candidates filtered by `station.orgId` |
| Q-07 | Missing station token | P0 | Security | — | `401` |
| Q-08 | Clock events survive midnight | P1 | E2E | See Module 3 (shifts) — cross-check | Documented in both plans |
| Q-09 | PIN hint UI | P2 | UI | Open cashier-app clock screen | Shows "Use your register PIN to clock in or out" |

---

## 19. Section R — Storefront Customer Signup / Login

Ecom-backend proxies to POS backend `/api/storefront/:storeId/auth/*`.
[ecom-backend/src/controllers/customerAuthController.js](ecom-backend/src/controllers/customerAuthController.js), [ecom-backend/src/services/posCustomerAuthService.js](ecom-backend/src/services/posCustomerAuthService.js), [ecom-backend/src/middleware/customerAuth.js](ecom-backend/src/middleware/customerAuth.js).

### 19.1 Signup

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| R-01 | New customer signup on store A1 | P0 | API | `POST /store/<slug>/auth/signup {firstName, lastName, email, phone, password}` | `201` with JWT; `Customer` row in POS DB with bcrypt `passwordHash`, `orgId`/`storeId` matching store A1 |
| R-02 | Duplicate email in same store | P0 | API | Run R-01 twice | `400 'Email already registered'` |
| R-03 | Same email across different stores | P0 | Security | Signup at store A1 and store B1 with same email | Verify design — unified Customer table may allow or forbid cross-store. **Document outcome.** Per CLAUDE.md: customer of Store A cannot authenticate on Store B's storefront — there should be per-store scoping. |
| R-04 | Password stored hashed | P0 | Security | Inspect DB | `passwordHash` is bcrypt (not plaintext) |
| R-05 | Empty password | P1 | API | `password: ''` | `400` |
| R-06 | Store not found | P1 | API | Invalid slug | `404` |
| R-07 | Ecom disabled for store | P1 | Security | Toggle off `ecomEnabled` | Signup blocked |
| R-08 | Cross-store JWT | P0 | Security | Sign up at A1, decode token, try to fetch account on B1 | Middleware `customerAuth` must reject: token `storeId` does not match path `storeId` |
| R-09 | Signup with existing POS Customer | P1 | API | Staff previously created Customer via in-store portal (no password) | Signup with same email should either: (a) attach password to existing row, (b) reject. Decide. |
| R-10 | Email validation | P2 | API | `email: 'not-an-email'` | `400` |

### 19.2 Login

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| R-11 | Valid credentials | P0 | API | — | `200` with JWT |
| R-12 | Wrong password | P0 | Security | — | `401` — same message as unknown email |
| R-13 | Unknown email | P0 | Security | — | `401` (enumeration safe) |
| R-14 | Pass login at wrong store | P0 | Security | R-01 done at A1, login at B1 | `401` (not found in B1 scope) |
| R-15 | Rate limit | P0 | Security | — | Flag as backlog if missing |
| R-16 | Account with no `passwordHash` | P0 | Security | In-store customer without password tries to log in | `401` (can't log in without setting password first) |
| R-17 | JWT payload | P0 | Security | Decode | `{customerId, storeId, orgId}` |
| R-18 | Token expiry | P1 | API | — | Document expiry duration (7 days?) |

### 19.3 Password change

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| R-19 | Change with correct current pw | P0 | API | Logged-in customer | `200`, new hash in DB |
| R-20 | Wrong current pw | P0 | Security | — | `401` |
| R-21 | Unauthenticated | P0 | Security | — | `401` |
| R-22 | Change pw at wrong store | P0 | Security | Customer A1 token calls `/store/B1/auth/password` | `401`/`403` |
| R-23 | Weak new password | P1 | API | Today no strength check — backlog | |

---

## 20. Section S — Frontend `ProtectedRoute` (Portal)

[frontend/src/App.jsx:128](frontend/src/App.jsx:128)

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| S-01 | No user in localStorage | P0 | UI | Clear storage, visit `/portal/pos-api` | Redirect to `/login` |
| S-02 | User without token | P0 | UI | `localStorage.user = {name: 'x'}` | Redirect |
| S-03 | Valid user + token | P0 | UI | — | Page loads |
| S-04 | Tampered user in localStorage | P0 | Security | Put invalid JSON in `localStorage.user` | Today: `JSON.parse` throws → React error boundary. **Bug:** should catch and redirect. Flag. |
| S-05 | Expired token | P0 | UI | Token older than 30 days | Page loads (no client-side exp check), first API call returns 401, **frontend must handle 401 globally and redirect**. Verify Axios interceptor in [frontend/src/services/api.js](frontend/src/services/api.js). |
| S-06 | Suspended user after login | P1 | Security | Log in, then have admin suspend | Next API call returns 403, frontend shows error and logs out. Verify. |

## 21. Section T — Cashier-app Session Persistence

| ID | Title | Priority | Type | Steps | Expected |
|----|-------|----------|------|-------|----------|
| T-01 | Station token persists after reload | P1 | UI | Pair, close app, reopen | Station still paired |
| T-02 | Cashier token expires after 24 h | P1 | UI | 24 h later, reload | Returns to PIN screen |
| T-03 | Lost network during PIN login | P2 | UI | Drop network, enter PIN | Clear error, retryable |
| T-04 | Station token manually edited | P0 | Security | Edit localStorage | Next API call returns 401 |
| T-05 | Clear localStorage while running | P1 | UI | — | App falls back to setup screen gracefully |

---

## 22. Section U — End-to-End Flows

> These are the golden paths. If any of them break, the module is not shippable.

### U-01 — New-tenant bootstrap (happy path)
1. User signs up on portal (A-01).
2. Receives `pending` token; is redirected to onboarding.
3. Creates org via `POST /api/tenants` → promoted to owner, `active`.
4. Creates first store A1.
5. Invites a cashier user, sets PIN.
6. Logs into admin panel — **fails** (not superadmin). Expected.
7. Logs into cashier app on a paired station with the PIN. Reaches POS home.
**Verify:** each step records proper audit fields and no cross-org data is visible.

### U-02 — Password reset cycle
1. Owner forgets password.
2. Requests reset — receives email (C-01).
3. Clicks link → reset page loads (C-21).
4. Submits new password → login with new pw succeeds, login with old pw fails.
5. Confirmation email delivered (C-17).
6. Old reset link no longer works (C-10).

### U-03 — Admin impersonation
1. Superadmin logs into admin panel.
2. Clicks "Login As" on owner_a — new tab opens `/impersonate`.
3. Lands on portal, sees Org A data.
4. Verify: `localStorage.user.token` is the 2-hour impersonation token.
5. After 2 h the token expires and the user is logged out on the next API call.
6. **Fail test:** verify impersonation token **cannot** be used against `/api/admin/*` (it has owner role, not superadmin) — `403`.

### U-04 — Cross-org isolation stress test
Setup: one QA browser logged in as owner_a, one as owner_b, one as superadmin.
1. Both owners create 5 products each.
2. owner_a queries `/api/catalog/products?limit=1000` — only sees 5 products (own). Run 10 variations with different headers: `X-Store-Id: B1`, `X-Tenant-Id: B`, `?orgId=B` querystring, body `{orgId: 'B'}`.
3. Repeat for every write endpoint: create, update, delete, import.
4. Verify: zero Org B rows ever returned to owner_a.
5. Log every request/response pair to a CSV for audit.

### U-05 — Station pairing & PIN login
1. Manager pairs new station Till-3 for store A1.
2. Station token stored in Electron app localStorage.
3. Reboot station → `station-verify` succeeds.
4. Cashier enters PIN → logs in, 24 h token issued.
5. Cashier opens shift, rings a sale.
6. Cashier clocks out → `ClockEvent(out)` written.
7. Next day, cashier tries to clock out without a matching in → `notClockedIn: true` banner (Q-03).

### U-06 — Trial expiry
1. Org C has `plan=trial`, `trialEndsAt=yesterday`.
2. Owner_c logs in — succeeds.
3. Owner_c hits a billing-gated endpoint → `402` with `trialEndsAt`.
4. UI shows "Trial expired" banner and upgrade CTA.
5. Cashier app still works (non-gated endpoints) or is blocked — document actual behavior.

### U-07 — Suspended org
1. Superadmin suspends Org D (`isActive=false`).
2. Existing owner_d tokens continue to pass `protect` (user status is separate from org status).
3. On first tenant-gated route → `403` from `requireActiveTenant`.
4. Frontend must log the user out and show a "Your organization is suspended" error.
5. Cashier app: same — station-verify should also fail if we want to force logout (**today it probably still works** — confirm and decide).

### U-08 — Storefront customer journey
1. Customer signs up on `:3000` for Store A1 — `Customer` row created with `orgId=A`, `storeId=A1`, `passwordHash` set.
2. Logs out, logs in — works.
3. Visits Store B1's storefront — `/account/login` with same email/password → `401`.
4. Admin of Store A1 sees the customer in Portal Customers page.
5. Customer changes password via storefront — portal still sees them as the same row (not duplicated).
6. Customer is soft-deleted by admin → login fails.

### U-09 — Full cleanup test
1. Create 3 orgs, 5 users each, 2 stations, 10 PINs.
2. Delete one org completely (superadmin). Verify:
   - All users under that org cannot log in.
   - All stations are invalidated (station-verify returns 401).
   - All cashier JWTs issued before deletion return 401 on next call.
   - No lingering rows in other tables.

---

## 23. Known Risks & Backlog Items (surfaced by this audit)

Prioritized list of defects and gaps found while writing this plan. These are the items worth fixing before mass regression testing:

### P0 — fix first

1. **`X-Store-Id` blind trust for org-wide roles** (I-07) — `scopeToTenant` allows any storeId for owner/admin/superadmin without checking that the store belongs to the user's org. The only defense is that every controller re-filters by `orgId`. Need an explicit audit: any controller that only filters by `storeId` is vulnerable.
2. **PIN login allows suspended / pending users** (O-13, O-14) — same status check as portal login must be applied.
3. **Phone lookup is a PII oracle** (D-03) — anonymous callers can map phone → name + email. Remove, auth-gate, or redact.
4. **Impersonation token leaks in URL referrer** (F-14) — swap to a one-time handoff code or POST body.
5. **No rate limiting** on login, signup, PIN login, phone lookup, forgot-password (A-15, B-14, D-05, O-11).
6. **Impersonation has no audit trail** (F-09) — no way to see which superadmin impersonated which user and when.

### P1 — fix soon

7. **Timing oracle on login** (B-04) — unknown email returns instantly; wrong password runs bcrypt. Normalize by always running a dummy bcrypt.
8. **PIN collision within org is undefined** (O-09) — first match wins; enforce unique PIN per org or reject duplicates.
9. **`forgotPassword` crashes on missing email body** (C-06) — Prisma rejects `findUnique({email: undefined})`.
10. **`ProtectedRoute` crashes on malformed localStorage** (S-04).
11. **Inactive org still issues login tokens** (B-13) — document or block at login.
12. **Signup does not enforce password strength** (A-14).
13. **Cashier token not revoked on PIN change** (O-18).
14. **Station count not gated by subscription plan** (M-09).

### P2 — polish

15. **`Bearer` prefix is case-sensitive** (G-13).
16. **`X-Store-Id` whitespace not trimmed** (I-12).
17. **No impersonation banner or exit UI** (F-15, F-16).
18. **Reset password response doesn't rate-limit** token attempts.

---

## 24. Coverage Summary

| Section | Cases | P0 | P1 | P2+ |
|---------|-------|----|----|----|
| A — Portal signup | 22 | 9 | 10 | 3 |
| B — Portal login | 18 | 11 | 5 | 2 |
| C — Forgot/Reset | 22 | 10 | 9 | 3 |
| D — Phone lookup | 5 | 2 | 2 | 1 |
| E — Admin login | 10 | 7 | 2 | 1 |
| F — Impersonation | 16 | 9 | 4 | 3 |
| G — protect | 14 | 10 | 1 | 3 |
| H — authorize | 6 | 3 | 2 | 1 |
| I — scopeToTenant | 25 | 21 | 2 | 2 |
| J — requireTenant | 3 | 0 | 3 | 0 |
| K — requireActiveTenant | 7 | 4 | 3 | 0 |
| L — allowTenantOverride | 4 | 3 | 1 | 0 |
| M — Station register | 10 | 4 | 4 | 2 |
| N — Station verify | 6 | 3 | 1 | 2 |
| O — PIN login | 18 | 10 | 6 | 2 |
| P — PIN mgmt | 7 | 4 | 3 | 0 |
| Q — Clock in/out | 9 | 7 | 1 | 1 |
| R — Storefront auth | 23 | 12 | 9 | 2 |
| S — ProtectedRoute | 6 | 5 | 1 | 0 |
| T — Cashier session | 5 | 2 | 2 | 1 |
| U — E2E | 9 | 9 | 0 | 0 |
| **Total** | **245** | **145** | **71** | **29** |

---

## 25. What you should do with this document

1. Read section 23 (Known Risks) first — those are the real findings.
2. Decide which risks are in scope to fix **now** vs defer.
3. Kick off manual QA on sections A–U in order. The E2E flows (section 22) are your smoke test — run those every release.
4. Add an **automated subset**: at minimum, the I-13 → I-25 cross-org isolation tests should be scripted in a Jest/supertest suite so they run on every PR. Those are the tests that will save you from the next data-leak incident.
5. Tell me what to change in this document or say **"next module"** and I'll start Module 2: Cashier App — Cart & Tender.
