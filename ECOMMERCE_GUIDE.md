# E-Commerce Module — Summary & Setup Guide

## What Was Built Today

A complete e-commerce add-on module for the Storv POS platform, enabling any organization to launch a branded online store for their retail stores.

### Architecture

```
Portal (frontend/)     :5173  → Manage online store config, pages, orders
POS Backend (backend/)  :5000  → Source of truth for products; emits sync events
Ecom Backend (ecom-backend/) :5005  → E-commerce API, orders, customer auth
Storefront (storefront/)     :3000  → Customer-facing Next.js online store
Redis (optional)              :6379  → BullMQ queue + inventory cache
```

### New Directories Created

| Directory | Files | Purpose |
|-----------|-------|---------|
| `ecom-backend/` | 24+ | Express API with own PostgreSQL database |
| `storefront/` | 47+ | Next.js storefront with ISR |
| `packages/redis/` | 2 | Shared ioredis client singleton |
| `packages/queue/` | 3 | BullMQ queue definitions + HTTP fallback producers |

### Database (8 Prisma models in `ecom-backend/prisma/schema.prisma`)

- **EcomStore** — per-store config (slug, domain, branding, fulfillment)
- **EcomProduct** — synced from POS MasterProduct
- **EcomDepartment** — synced from POS Department
- **EcomPage** — CMS pages (website builder with templates)
- **EcomCart** — server-side shopping cart
- **EcomOrder** — online orders with full lifecycle
- **EcomCustomer** — online store customer accounts
- **SyncEvent** — sync pipeline audit trail

### Features Implemented

**Portal (localhost:5173) — "Online Store" sidebar group:**
- Store Setup (enable/disable, branding, fulfillment, SEO, social)
- Website Pages (5 templates per page type, section editor with image upload)
- Online Orders (list, filter, detail view, status management)
- Custom Domain (connect domain, DNS instructions, verification)
- Sync Products (one-click full sync from POS catalog)

**Storefront (localhost:3000):**
- 15 premium templates (5 Home, 5 About, 5 Contact)
- Product listing with department filtering, search, sort, pagination
- Product detail page with qty selector + add to cart
- Shopping cart (drawer + full page)
- Checkout flow (customer info, pickup/delivery, order placement)
- Order confirmation page
- Customer auth (signup, login, my account, order history)
- Dynamic branding (colors, fonts from portal config)
- Multi-tenant (each store has its own URL/data)
- Contact form with backend submission

**Sync Pipeline:**
- Redis + BullMQ (when Redis available)
- HTTP fallback (when Redis unavailable — direct POST to ecom-backend)
- Products auto-sync on create/update/delete in POS portal
- Full sync button in portal for initial bulk sync

---

## Developer Setup Guide

### Prerequisites

- Node.js 18+
- PostgreSQL 16
- Git

### 1. Clone & Install

```bash
git clone https://github.com/Fortune-Technology/Fortune_POS_Platform.git
cd Fortune_POS_Platform
npm run install:all
```

### 2. Database Setup

**POS Database** (already exists):
```bash
cd backend
cp .env.example .env
# Edit .env — set DATABASE_URL to your PostgreSQL
npx prisma db push
```

**Ecom Database** (new):
```bash
cd ecom-backend
cp .env.example .env
# Edit .env:
#   DATABASE_URL = postgresql://user:pass@localhost:5432/storeveu_ecom
#   POS_BACKEND_URL = http://localhost:5000
#   JWT_SECRET = (same as backend/.env JWT_SECRET)
npx prisma db push
```

### 3. Environment Variables

**ecom-backend/.env:**
```env
PORT=5005
DATABASE_URL="postgresql://user:pass@localhost:5432/storeveu_ecom"
POS_BACKEND_URL=http://localhost:5000
JWT_SECRET=<same as backend>
CORS_ORIGIN=http://localhost:5173,http://localhost:3000
REDIS_URL=redis://127.0.0.1:6379   # optional
REVALIDATE_SECRET=any-random-string
```

**storefront/.env.local:**
```env
ECOM_API_URL=http://localhost:5005/api
NEXT_PUBLIC_ECOM_API_URL=http://localhost:5005/api
NEXT_PUBLIC_ECOM_URL=http://localhost:5005
REVALIDATE_SECRET=any-random-string
```

### 4. Start Development

```bash
# From root — starts all 6 apps
npm run dev
```

Apps:
- Backend: http://localhost:5000
- Frontend Portal: http://localhost:5173
- Cashier App: http://localhost:5174
- Admin Panel: http://localhost:5175
- **Ecom Backend: http://localhost:5005**
- **Storefront: http://localhost:3000**

### 5. Initial Setup Flow

1. Login to portal (localhost:5173)
2. Select a store in the store switcher
3. Go to **Online Store → Store Setup**
4. Click **"Enable E-Commerce"** — enter store name
5. Go to **General tab → "Sync Products Now"** — pulls all POS products
6. Go to **Branding tab** — set colors, logo, font
7. Go to **Pages tab** — create Home, About, Contact pages with templates
8. Go to **Fulfillment tab** — enable pickup/delivery
9. Visit `localhost:3000?store=<your-slug>` to see the live storefront

### 6. Redis (Optional)

Redis enables BullMQ for async sync. Without Redis, sync works via HTTP fallback.

```bash
# Docker
cd backend && docker compose up redis -d

# Or install natively
# Windows: https://github.com/microsoftarchive/redis/releases
# Mac: brew install redis && brew services start redis
# Linux: sudo apt install redis-server
```

---

## Production Deployment Guide

### 1. Server Requirements

- Linux VPS (Ubuntu 22.04+)
- Node.js 18+
- PostgreSQL 16
- Nginx
- PM2
- Redis (recommended for production)

### 2. Domain Setup

| Service | Domain | Nginx Target |
|---------|--------|-------------|
| POS API | `api-pos.yourdomain.com` | → localhost:5000 |
| Portal | `dashboard.yourdomain.com` | → Vite build (static) |
| Cashier | `pos.yourdomain.com` | → Vite build (static) |
| Admin | `admin.yourdomain.com` | → Vite build (static) |
| **Ecom API** | `api-ecom.yourdomain.com` | → localhost:5005 |
| **Storefront** | `*.shop.yourdomain.com` | → localhost:3000 |

### 3. Build & Deploy

```bash
# Build frontend apps
cd frontend && npm run build
cd admin-app && npm run build
cd cashier-app && npm run build
cd storefront && npm run build

# Start backends with PM2
pm2 start backend/src/server.js --name storv-backend
pm2 start ecom-backend/src/server.js --name storv-ecom
pm2 start storefront/.next/standalone/server.js --name storv-storefront
pm2 save
```

### 4. Nginx Configuration (Ecom Backend)

```nginx
server {
    listen 443 ssl;
    server_name api-ecom.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    client_max_body_size 5M;

    location / {
        proxy_pass http://127.0.0.1:5005;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /uploads {
        alias /var/www/Storv_POS_All/ecom-backend/uploads;
        expires 30d;
    }
}
```

### 5. Nginx Configuration (Storefront)

```nginx
server {
    listen 443 ssl;
    server_name *.shop.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 6. Production Environment Variables

**ecom-backend/.env (production):**
```env
PORT=5005
NODE_ENV=production
DATABASE_URL="postgresql://user:pass@localhost:5432/storeveu_ecom"
POS_BACKEND_URL=http://localhost:5000
JWT_SECRET=<production-secret>
CORS_ORIGIN=https://dashboard.yourdomain.com,https://*.shop.yourdomain.com
REDIS_URL=redis://127.0.0.1:6379
STOREFRONT_URL=http://127.0.0.1:3000
REVALIDATE_SECRET=<random-secret>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=app-password
SMTP_FROM=noreply@yourdomain.com
```

### 7. Custom Domains (Cloudflare for SaaS)

For production custom domain support:
1. Set up Cloudflare for SaaS on your zone
2. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` to ecom-backend .env
3. Wildcard DNS: `*.shop.yourdomain.com` → your server IP
4. SSL via Cloudflare (automatic for custom hostnames)

### 8. CI/CD

Add to `.github/workflows/deploy.yml`:
```yaml
- name: Deploy ecom-backend
  run: |
    cd /var/www/Storv_POS_All/ecom-backend
    npm ci
    npx prisma generate
    npx prisma db push
    pm2 restart storv-ecom

- name: Deploy storefront
  run: |
    cd /var/www/Storv_POS_All/storefront
    npm ci
    npm run build
    pm2 restart storv-storefront
```

---

## File Map

### ecom-backend/
```
src/
  server.js                          — Express app entry
  config/postgres.js                 — Prisma client (ecom DB)
  config/redis.js                    — Redis cache helpers
  middleware/auth.js                 — POS JWT validation
  middleware/customerAuth.js         — Customer JWT (signup/login)
  middleware/storeResolver.js        — Resolve store from URL slug
  middleware/requireEcomEnabled.js   — Guard: ecom must be enabled
  controllers/storefrontController.js — Public product/dept/page APIs
  controllers/orderController.js     — Cart + checkout + orders
  controllers/ecomStoreController.js — Store setup/config
  controllers/productManageController.js — Product visibility
  controllers/pageController.js      — CMS page CRUD
  controllers/domainController.js    — Custom domain management
  controllers/customerAuthController.js — Customer signup/login/profile
  controllers/syncController.js      — Sync status
  routes/publicRoutes.js             — Public API + contact form
  routes/manageRoutes.js             — Portal management API
  routes/customerAuthRoutes.js       — Customer auth routes
  routes/uploadRoutes.js             — Image upload (multer)
  routes/syncRoutes.js               — Direct sync + full sync
  routes/internalRoutes.js           — Health check
  services/stockCheckService.js      — POS stock check at checkout
  services/revalidationService.js    — Next.js ISR revalidation
  workers/syncWorker.js              — BullMQ sync consumer
prisma/schema.prisma                 — 8 ecom models
prisma/seed.js                       — Demo data seeder
prisma/syncFromPOS.js                — Manual POS→ecom sync script
```

### storefront/
```
pages/
  _app.js                            — App wrapper (auth, cart, branding)
  _document.js                       — HTML document
  index.js                           — Home (template-driven + real products)
  cart.js                            — Shopping cart
  checkout.js                        — Checkout flow
  [slug].js                          — CMS pages (about, contact, custom)
  products/index.js                  — Product listing (SSR, filtered)
  products/[slug].js                 — Product detail
  order/[id].js                      — Order confirmation
  account/login.js                   — Customer login
  account/signup.js                  — Customer signup
  account/index.js                   — My account + order history
  api/revalidate.js                  — ISR revalidation endpoint
components/
  layout/Header.js, Footer.js        — Store header/footer
  products/ProductCard.js            — Product card with add-to-cart
  cart/CartDrawer.js                 — Slide-in cart panel
  templates/TemplateRenderer.js      — Maps templateId → component
  templates/HomeCenteredHero.js      — Home: centered hero
  templates/HomeSplitHero.js         — Home: split screen
  templates/HomeMinimal.js           — Home: minimal
  templates/HomeOverlay.js           — Home: image overlay
  templates/HomeTypography.js        — Home: bold typography
  templates/AboutStoryMission.js     — About: story + mission
  templates/AboutTimeline.js         — About: timeline
  templates/AboutCards.js            — About: card values
  templates/AboutOverlay.js          — About: image + stats
  templates/AboutMultiSection.js     — About: multi-section
  templates/ContactSplit.js          — Contact: split + form
  templates/ContactCards.js          — Contact: cards + form
  templates/ContactMinimal.js        — Contact: minimal form
  templates/ContactMapForm.js        — Contact: map + form
  templates/ContactFloating.js       — Contact: floating card
lib/
  api.js                             — Ecom-backend API client
  cart.js                            — Cart context (localStorage + server)
  auth.js                            — Customer auth context
  store.js                           — Store context (branding)
  resolveStore.js                    — Multi-tenant store resolver
styles/
  globals.css                        — Premium global styles
  cart-drawer.css                    — Cart drawer styles
  templates.css                      — All template layout styles
middleware.js                        — Hostname → store slug routing
next.config.js                       — Next.js config (standalone output)
```

### Portal additions (frontend/src/)
```
pages/EcomSetup.jsx + .css           — Store setup (5-tab wizard + sync)
pages/EcomOrders.jsx + .css          — Order management
pages/EcomPages.jsx + .css           — Page management
pages/EcomDomain.jsx + .css          — Custom domain setup
```
