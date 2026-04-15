-- CreateTable
CREATE TABLE "ecom_stores" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "customDomain" TEXT,
    "domainVerified" BOOLEAN NOT NULL DEFAULT false,
    "sslStatus" TEXT NOT NULL DEFAULT 'pending',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "branding" JSONB NOT NULL DEFAULT '{}',
    "seoDefaults" JSONB NOT NULL DEFAULT '{}',
    "socialLinks" JSONB NOT NULL DEFAULT '{}',
    "fulfillmentConfig" JSONB NOT NULL DEFAULT '{}',
    "timezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ecom_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecom_products" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "posProductId" INTEGER NOT NULL,
    "posStoreProductId" INTEGER,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "shortDescription" TEXT,
    "brand" TEXT,
    "imageUrl" TEXT,
    "images" JSONB NOT NULL DEFAULT '[]',
    "tags" TEXT[],
    "departmentName" TEXT,
    "departmentSlug" TEXT,
    "retailPrice" DECIMAL(10,4) NOT NULL,
    "salePrice" DECIMAL(10,4),
    "saleStart" TIMESTAMP(3),
    "saleEnd" TIMESTAMP(3),
    "costPrice" DECIMAL(10,4),
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "quantityOnHand" DECIMAL(10,2),
    "trackInventory" BOOLEAN NOT NULL DEFAULT true,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "taxClass" TEXT,
    "ebtEligible" BOOLEAN NOT NULL DEFAULT false,
    "ageRequired" INTEGER,
    "size" TEXT,
    "weight" DECIMAL(10,4),
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "syncVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ecom_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecom_departments" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "posDepartmentId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ecom_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecom_pages" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "pageType" TEXT NOT NULL,
    "templateId" TEXT,
    "content" JSONB NOT NULL DEFAULT '{}',
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ecom_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecom_carts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "customerId" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "subtotal" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ecom_carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecom_orders" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fulfillmentType" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerId" TEXT,
    "shippingAddress" JSONB,
    "lineItems" JSONB NOT NULL,
    "subtotal" DECIMAL(10,4) NOT NULL,
    "taxTotal" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "deliveryFee" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "tipAmount" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(10,4) NOT NULL,
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "paymentMethod" TEXT,
    "paymentExternalId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "notes" TEXT,
    "posTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ecom_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecom_customers" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "posCustomerId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT,
    "addresses" JSONB NOT NULL DEFAULT '[]',
    "lastOrderAt" TIMESTAMP(3),
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ecom_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_events" (
    "id" SERIAL NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ecom_stores_storeId_key" ON "ecom_stores"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "ecom_stores_slug_key" ON "ecom_stores"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ecom_stores_customDomain_key" ON "ecom_stores"("customDomain");

-- CreateIndex
CREATE INDEX "ecom_stores_orgId_idx" ON "ecom_stores"("orgId");

-- CreateIndex
CREATE INDEX "ecom_products_orgId_storeId_visible_inStock_idx" ON "ecom_products"("orgId", "storeId", "visible", "inStock");

-- CreateIndex
CREATE INDEX "ecom_products_storeId_departmentSlug_idx" ON "ecom_products"("storeId", "departmentSlug");

-- CreateIndex
CREATE UNIQUE INDEX "ecom_products_storeId_posProductId_key" ON "ecom_products"("storeId", "posProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ecom_products_storeId_slug_key" ON "ecom_products"("storeId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ecom_departments_storeId_posDepartmentId_key" ON "ecom_departments"("storeId", "posDepartmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ecom_departments_storeId_slug_key" ON "ecom_departments"("storeId", "slug");

-- CreateIndex
CREATE INDEX "ecom_pages_orgId_storeId_idx" ON "ecom_pages"("orgId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "ecom_pages_storeId_slug_key" ON "ecom_pages"("storeId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ecom_carts_sessionId_key" ON "ecom_carts"("sessionId");

-- CreateIndex
CREATE INDEX "ecom_carts_storeId_sessionId_idx" ON "ecom_carts"("storeId", "sessionId");

-- CreateIndex
CREATE INDEX "ecom_carts_expiresAt_idx" ON "ecom_carts"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ecom_orders_orderNumber_key" ON "ecom_orders"("orderNumber");

-- CreateIndex
CREATE INDEX "ecom_orders_orgId_storeId_status_idx" ON "ecom_orders"("orgId", "storeId", "status");

-- CreateIndex
CREATE INDEX "ecom_orders_storeId_orderNumber_idx" ON "ecom_orders"("storeId", "orderNumber");

-- CreateIndex
CREATE INDEX "ecom_orders_storeId_createdAt_idx" ON "ecom_orders"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "ecom_customers_orgId_storeId_idx" ON "ecom_customers"("orgId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "ecom_customers_storeId_email_key" ON "ecom_customers"("storeId", "email");

-- CreateIndex
CREATE INDEX "sync_events_status_createdAt_idx" ON "sync_events"("status", "createdAt");

-- CreateIndex
CREATE INDEX "sync_events_orgId_entityType_idx" ON "sync_events"("orgId", "entityType");

-- AddForeignKey
ALTER TABLE "ecom_products" ADD CONSTRAINT "ecom_products_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ecom_stores"("storeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecom_departments" ADD CONSTRAINT "ecom_departments_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ecom_stores"("storeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecom_pages" ADD CONSTRAINT "ecom_pages_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ecom_stores"("storeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecom_carts" ADD CONSTRAINT "ecom_carts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ecom_stores"("storeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecom_orders" ADD CONSTRAINT "ecom_orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ecom_stores"("storeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecom_customers" ADD CONSTRAINT "ecom_customers_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ecom_stores"("storeId") ON DELETE CASCADE ON UPDATE CASCADE;

