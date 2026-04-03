-- Remove IT Retail / MarketPOS specific fields
ALTER TABLE "products" DROP COLUMN IF EXISTS "itRetailUpc";
ALTER TABLE "products" DROP COLUMN IF EXISTS "itRetailPlu";
ALTER TABLE "stores" DROP COLUMN IF EXISTS "itRetailStoreId";
ALTER TABLE "stores" DROP COLUMN IF EXISTS "itRetailTenantId";
ALTER TABLE "users" DROP COLUMN IF EXISTS "marktPOSUsername";
ALTER TABLE "users" DROP COLUMN IF EXISTS "marktPOSPassword";
