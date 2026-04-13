# E-Commerce Module — Complete Guide

## Overview

A complete e-commerce add-on module for the Storeveu POS platform, enabling any organization to launch a branded online store for their retail stores.

### Architecture

```
Portal (frontend/)         :5173  → Manage online store, pages, orders, analytics, customers
POS Backend (backend/)     :5000  → Source of truth for products; emits sync events
Ecom Backend (ecom-backend/) :5005  → E-commerce API, orders, customer auth, sync
Storefront (storefront/)   :3000  → Customer-facing Next.js online store
Redis (optional)           :6379  → BullMQ queue + inventory cache
```

### Key Features

| Feature | Description |
|---------|-------------|
| **Store Discovery** | Browse all stores at `localhost:3000` (no store param) with search |
| **15 Premium Templates** | 5 Home, 5 About, 5 Contact — each with section editor + image upload |
| **Dynamic Branding** | Colors, fonts (Google Fonts), logo — configured in portal, applied on storefront |
| **Product Sync** | Auto-sync from POS via BullMQ (Redis) or HTTP fallback (no Redis) |
| **Shopping Cart** | Cart drawer + full page, localStorage + server sync |
| **Checkout** | Requires login, pickup/delivery, stock check with POS |
| **Unified Customer Auth** | POS `Customer` table is the single source of truth; storefront auth (signup/login) proxies through ecom-backend to POS backend. Supports profile edit (first/last name, phone), saved addresses, and password change |
| **Order Management** | Portal: status progression, customer detail. Storefront: order history + detail |
| **Email Notifications** | Contact form, order confirmation, status updates via SMTP |
| **Order Alerts** | Real-time polling (15s) with MP3 sound + toast notification in portal |
| **Custom Domains** | Connect domain, DNS verification, Cloudflare for SaaS ready |
| **Analytics** | Revenue, orders, customers, AOV KPIs + revenue chart + top products |
| **Responsive** | Full mobile/tablet/desktop support across all pages |

---

## Developer Setup Guide

### Prerequisites

- Node.js 18+
- PostgreSQL 16
- Git
- Redis (optional — sync works via HTTP fallback without it)

### 1. Clone & Install

```bash
git clone https://github.com/Fortune-Technology/Fortune_POS_Platform.git
cd Fortune_POS_Platform
npm run install:all
```

### 2. Database Setup

**POS Database** (main):
```bash
cd backend
cp .env.example .env
# Edit .env — set DATABASE_URL, JWT_SECRET, SMTP settings
npx prisma db push
```

**Ecom Database** (separate):
```bash
cd ecom-backend
cp .env.example .env
# Edit .env:
#   DATABASE_URL = postgresql://user:pass@localhost:5432/storeveu_ecom
#   JWT_SECRET = <MUST be same as backend/.env>
#   POS_BACKEND_URL = http://localhost:5000
npx prisma db push
```

**Storefront** (optional .env):
```bash
cd storefront
cp .env.example .env.local
# Defaults work for local dev — no changes needed
```

### 3. Environment Variables

**backend/.env** (key vars):
```env
DATABASE_URL="postgresql://user:pass@localhost:5432/storeveu_pos"
JWT_SECRET=your_secret_here
CORS_ORIGIN=http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5005
ECOM_BACKEND_URL=http://localhost:5005
FRONTEND_URL=http://localhost:5173
ADMIN_URL=http://localhost:5175
# SMTP settings for emails (optional)
```

**ecom-backend/.env** (key vars):
```env
DATABASE_URL="postgresql://user:pass@localhost:5432/storeveu_ecom"
JWT_SECRET=<SAME as backend>
POS_BACKEND_URL=http://localhost:5000
CORS_ORIGIN=http://localhost:5173,http://localhost:3000
REVALIDATE_SECRET=any_random_string
# SMTP settings for order emails (optional)
```

**CRITICAL:** `JWT_SECRET` must be identical in both `backend/.env` and `ecom-backend/.env`.

### 4. Start Development

```bash
# From root — starts all 6 apps
npm run dev
```

| App | Port | URL |
|-----|------|-----|
| POS Backend | 5000 | http://localhost:5000 |
| Portal | 5173 | http://localhost:5173 |
| Cashier App | 5174 | http://localhost:5174 |
| Admin Panel | 5175 | http://localhost:5175 |
| **Ecom Backend** | 5005 | http://localhost:5005 |
| **Storefront** | 3000 | http://localhost:3000 |

### 5. Initial E-Commerce Setup Flow

1. Login to portal → select a store in the store switcher
2. Go to **Online Store → Store Setup**
3. Click **"Enable E-Commerce"** → enter store name
4. **General tab** → upload store logo/banner → click **"Sync Products Now"**
5. **Branding tab** → pick primary color, font, logo text
6. **Pages tab** → create Home, About, Contact pages (pick templates)
7. **Fulfillment tab** → enable pickup/delivery, set hours/fees
8. **Save All Changes**
9. Visit `http://localhost:3000?store=<your-slug>` to see the live storefront

### 6. Redis (Optional)

Redis enables BullMQ for async sync + inventory caching. Without Redis, everything still works via HTTP fallback.

```bash
# Docker
cd backend && docker compose up redis -d

# Native install
# Mac: brew install redis && brew services start redis
# Ubuntu: sudo apt install redis-server
# Windows: https://github.com/microsoftarchive/redis/releases
```

---

## Production Deployment Guide

### Server Requirements

- Linux VPS (Ubuntu 22.04+)
- Node.js 18+, PostgreSQL 16, Redis, Nginx, PM2

### Domain Setup

| Service | Domain | Nginx Target |
|---------|--------|-------------|
| POS API | `api-pos.yourdomain.com` | → localhost:5000 |
| Portal | `dashboard.yourdomain.com` | → Vite build (static) |
| Admin | `admin.yourdomain.com` | → Vite build (static) |
| **Ecom API** | `api-ecom.yourdomain.com` | → localhost:5005 |
| **Storefront** | `*.shop.yourdomain.com` | → localhost:3000 |

### Build & Deploy

```bash
# Build frontend apps
cd frontend && npm run build
cd admin-app && npm run build
cd storefront && npm run build

# Start backends with PM2
pm2 start backend/src/server.js --name storv-backend
pm2 start ecom-backend/src/server.js --name storv-ecom
pm2 start storefront/.next/standalone/server.js --name storv-storefront
pm2 save
```

### Nginx — Ecom Backend

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

### Nginx — Storefront

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

### CI/CD Addition (`.github/workflows/deploy.yml`)

```yaml
- name: Deploy ecom-backend
  run: |
    cd /var/www/Storv_POS_All/ecom-backend
    npm ci && npx prisma generate && npx prisma db push
    pm2 restart storv-ecom

- name: Deploy storefront
  run: |
    cd /var/www/Storv_POS_All/storefront
    npm ci && npm run build
    pm2 restart storv-storefront
```

### Production Environment Variables

**ecom-backend/.env:**
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
SUPPORT_EMAIL=support@yourdomain.com
```

---

## File Map

### ecom-backend/ (28 files)
```
src/server.js                          — Express app + BullMQ worker startup
src/config/postgres.js                 — Prisma client (ecom DB)
src/config/redis.js                    — Redis cache helpers
src/middleware/auth.js                 — POS JWT validation
src/middleware/customerAuth.js         — Customer JWT (signup/login)
src/middleware/storeResolver.js        — Resolve store from URL slug
src/middleware/requireEcomEnabled.js   — Guard: ecom must be enabled
src/controllers/storefrontController.js — Public product/dept/page APIs
src/controllers/orderController.js     — Cart + checkout + orders + email
src/controllers/ecomStoreController.js — Store setup/config
src/controllers/productManageController.js — Product visibility
src/controllers/pageController.js      — CMS page CRUD
src/controllers/domainController.js    — Custom domain management
src/controllers/customerAuthController.js — Signup/login/profile/orders
src/controllers/analyticsController.js — KPIs, revenue trend, top products
src/controllers/customerManageController.js — Portal customer list/detail
src/controllers/syncController.js      — Sync pipeline status
src/routes/publicRoutes.js             — Public API + store directory + contact form
src/routes/manageRoutes.js             — Portal management API
src/routes/customerAuthRoutes.js       — Customer auth routes
src/routes/uploadRoutes.js             — Image upload (multer)
src/routes/syncRoutes.js               — Direct sync + full sync (HTTP fallback)
src/routes/internalRoutes.js           — Health check
src/services/stockCheckService.js      — POS stock check at checkout
src/services/revalidationService.js    — Next.js ISR revalidation
src/services/emailService.js           — Contact, order confirmation, status emails
src/workers/syncWorker.js              — BullMQ sync consumer
prisma/schema.prisma                   — 8 ecom models
```

### storefront/ (50+ files)
```
pages/_app.js                          — App wrapper (auth, cart, branding, Google Fonts)
pages/index.js                         — Store discovery OR store home (template-driven)
pages/products/index.js                — Product listing (SSR, filtered)
pages/products/[slug].js               — Product detail
pages/cart.js                          — Shopping cart
pages/checkout.js                      — Checkout (requires auth)
pages/[slug].js                        — CMS pages (about, contact, custom)
pages/order/[id].js                    — Order confirmation
pages/account/login.js                 — Customer login
pages/account/signup.js                — Customer signup
pages/account/index.js                 — My account (profile, orders, addresses tabs)
pages/account/orders/[id].js           — Order detail with status timeline
pages/api/revalidate.js                — ISR revalidation endpoint
components/layout/Header.js, Footer.js
components/products/ProductCard.js     — Product card with category placeholders
components/cart/CartDrawer.js          — Slide-in cart panel
components/icons.js                    — Shared Lucide icon mappings
components/templates/TemplateRenderer.js — Maps templateId → component
components/templates/Home*.js          — 5 home templates
components/templates/About*.js         — 5 about templates
components/templates/Contact*.js       — 5 contact templates (with form)
lib/api.js                             — Ecom-backend API client
lib/cart.js                            — Cart context (localStorage + server)
lib/auth.js                            — Customer auth context
lib/store.js                           — Store context (branding)
lib/resolveStore.js                    — Multi-tenant store resolver
styles/globals.css                     — Premium global + responsive styles
styles/cart-drawer.css                 — Cart drawer styles
styles/templates.css                   — Template layout styles
middleware.js                          — Hostname → store slug routing
```

### Portal additions (frontend/src/)
```
pages/EcomSetup.jsx + .css             — Store setup (5-tab wizard + sync + templates)
pages/EcomOrders.jsx + .css            — Order management with polling notifications
pages/EcomDomain.jsx + .css            — Custom domain setup
pages/EcomAnalytics.jsx                — Analytics dashboard (KPIs, charts, top products)
pages/EcomCustomers.jsx                — Customer management (list, search, detail)
components/EcomOrderNotifier.jsx       — Global order notification (polling + MP3 sound)
public/sounds/ordernotification.mp3    — Order notification sound file
```

### Shared packages
```
packages/redis/index.js                — Shared ioredis client singleton
packages/queue/index.js                — BullMQ queue definitions
packages/queue/producers.js            — Sync producers (BullMQ + HTTP fallback)
```
