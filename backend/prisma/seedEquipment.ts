/**
 * Seed the EquipmentProduct catalog (Billing → Equipment tab).
 *
 * Idempotent: upserts by `slug`. Existing rows are NOT overwritten unless
 * --force is passed (so admin edits to price/description/images survive
 * re-runs of the seeder during deploys).
 *
 * Image files already exist at backend/uploads/devices/*.png. The seeder
 * only writes RELATIVE paths (`/uploads/devices/...`) to the DB. The
 * frontend prefixes the API base URL when rendering.
 *
 * Usage:
 *   cd backend
 *   npx tsx prisma/seedEquipment.ts
 *   npx tsx prisma/seedEquipment.ts --force   # overwrite existing rows
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedDevice {
  name: string;
  slug: string;
  category: string;
  description: string;
  price: number;
  images: string[];
  specs?: Record<string, unknown>;
  stockQty?: number;
  trackStock?: boolean;
  sortOrder: number;
}

// Image filenames in backend/uploads/devices/ (kept as filename so the
// raw file on disk maps 1:1; the URL path is built below).
const FILE_FOR: Record<string, string> = {
  'pos-terminal':      'POS Terminal.png',
  'receipt-printer':   'Receipt Printer.png',
  'cash-drawer':       'Cash Drawer.png',
  'barcode-scanner':   'Barcode Scanner.png',
  'card-terminal':     'Card Terminal.png',
  'customer-display':  'Customer Display.png',
  'label-printer':     'Label Printer.png',
};

const imagePath = (slug: string): string => {
  const file = FILE_FOR[slug];
  if (!file) return '';
  // Encode spaces — browsers + express.static both handle %20 fine.
  return `/uploads/devices/${encodeURIComponent(file)}`;
};

const DEVICES: SeedDevice[] = [
  {
    name: 'POS Terminal',
    slug: 'pos-terminal',
    category: 'Register',
    description: '15" all-in-one touchscreen POS terminal pre-configured to run the Storeveu cashier app. Quad-core CPU, capacitive multi-touch, 1024×768 display, dual gigabit ethernet, 4 USB ports, integrated cash-drawer trigger.',
    price: 899.00,
    images: [imagePath('pos-terminal')],
    specs: {
      cpu: 'Intel Celeron J6412 quad-core',
      ram: '4 GB DDR4',
      storage: '128 GB SSD',
      display: '15" capacitive touchscreen',
      resolution: '1024×768',
      ports: 'USB ×4, RJ-45 ×2, RJ-11 (cash drawer), HDMI ×1',
      os: 'Windows 11 IoT or Android 11',
      warranty: '2 years',
    },
    stockQty: 50,
    trackStock: true,
    sortOrder: 1,
  },
  {
    name: 'Receipt Printer',
    slug: 'receipt-printer',
    category: 'Printer',
    description: '80mm thermal receipt printer with auto-cutter. USB + LAN + serial connectivity, integrated cash-drawer trigger (RJ-11), 250 mm/sec print speed, paper-low sensor.',
    price: 199.00,
    images: [imagePath('receipt-printer')],
    specs: {
      printType: 'Direct thermal',
      paperWidth: '80 mm (3 in)',
      printSpeed: '250 mm/sec',
      cutter: 'Auto guillotine',
      connectivity: 'USB + LAN + Serial',
      drawerTrigger: 'RJ-11 (24V)',
      mtbf: '70 million lines',
      warranty: '2 years',
    },
    stockQty: 100,
    trackStock: true,
    sortOrder: 2,
  },
  {
    name: 'Cash Drawer',
    slug: 'cash-drawer',
    category: 'Register',
    description: '16" heavy-duty steel cash drawer. Removable till with 5 bill compartments + 8 coin compartments, three-position lock, opens automatically via printer-pulse trigger.',
    price: 119.00,
    images: [imagePath('cash-drawer')],
    specs: {
      dimensions: '16 in × 16.5 in × 4 in',
      construction: 'Heavy-gauge steel',
      tillSlots: '5 bill / 8 coin',
      lock: 'Three-position (Open / Auto / Locked)',
      trigger: 'RJ-11 24V from receipt printer',
      mediaSlot: 'Yes (cheques / large bills)',
      warranty: '5 years',
    },
    stockQty: 100,
    trackStock: true,
    sortOrder: 3,
  },
  {
    name: 'Barcode Scanner',
    slug: 'barcode-scanner',
    category: 'Scanner',
    description: '2D omnidirectional handheld barcode scanner. USB plug-and-play, reads UPC-A/E, EAN-8/13, Code-128/39/93, QR, Data Matrix, GS1 DataBar. 6 ft cable, drop-tested to 5 ft.',
    price: 159.00,
    images: [imagePath('barcode-scanner')],
    specs: {
      type: 'Handheld 2D imager',
      symbologies: 'UPC-A/E, EAN-8/13, Code-128, Code-39, QR, Data Matrix, GS1 DataBar',
      scanRate: '60 scans/sec',
      depthOfField: '0–17 in',
      connectivity: 'USB-A (HID)',
      cable: '6 ft coiled',
      drop: '5 ft to concrete',
      warranty: '3 years',
    },
    stockQty: 75,
    trackStock: true,
    sortOrder: 4,
  },
  {
    name: 'Card Terminal',
    slug: 'card-terminal',
    category: 'Payments',
    description: 'Dejavoo Spin card terminal. EMV chip + contactless (Apple Pay / Google Pay / tap), PIN debit, EBT food + cash benefit, signature capture, integrated to Storeveu via SPIn protocol.',
    price: 349.00,
    images: [imagePath('card-terminal')],
    specs: {
      model: 'Dejavoo Z11 / Spin',
      paymentMethods: 'EMV, NFC contactless, magstripe, PIN debit, EBT',
      connectivity: 'Ethernet + Wi-Fi',
      pciVersion: 'PCI PTS 5.x',
      printer: 'Built-in 58 mm thermal',
      integration: 'Dejavoo SPIn (cashier-app native)',
      certifications: 'EMV L1+L2, PCI PTS 5.x, RoHS',
      warranty: '1 year',
    },
    stockQty: 40,
    trackStock: true,
    sortOrder: 5,
  },
  {
    name: 'Customer Display',
    slug: 'customer-display',
    category: 'Register',
    description: '10" customer-facing display showing live cart, line items, totals, change due, and a branded thank-you screen post-sale. VESA mount, USB-powered, glare-resistant matte finish.',
    price: 229.00,
    images: [imagePath('customer-display')],
    specs: {
      display: '10" IPS LCD',
      resolution: '1024×600',
      brightness: '300 nits',
      finish: 'Anti-glare matte',
      mount: 'VESA 75 + counter stand',
      power: 'USB-C (5V/3A)',
      connectivity: 'HDMI + USB',
      warranty: '2 years',
    },
    stockQty: 40,
    trackStock: true,
    sortOrder: 6,
  },
  {
    name: 'Label Printer',
    slug: 'label-printer',
    category: 'Printer',
    description: 'Thermal shelf-label printer. Zebra ZPL compatible. 4" wide print area, roll feed, peeler module, USB + LAN. Supports 1.25"–4" label widths for shelf tags, price stickers, and barcode labels.',
    price: 279.00,
    images: [imagePath('label-printer')],
    specs: {
      printType: 'Direct thermal',
      printWidth: '4.09 in (104 mm)',
      printSpeed: '6 in/sec',
      resolution: '203 dpi',
      labelLanguage: 'Zebra ZPL II',
      connectivity: 'USB + LAN + Serial',
      mediaSizes: '1.25"–4" wide',
      warranty: '2 years',
    },
    stockQty: 30,
    trackStock: true,
    sortOrder: 7,
  },
];

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const d of DEVICES) {
    const existing = await prisma.equipmentProduct.findUnique({ where: { slug: d.slug } });

    if (!existing) {
      const data: Prisma.EquipmentProductCreateInput = {
        name: d.name,
        slug: d.slug,
        category: d.category,
        description: d.description,
        price: d.price,
        images: d.images,
        stockQty: d.stockQty ?? 0,
        trackStock: d.trackStock ?? false,
        isActive: true,
        sortOrder: d.sortOrder,
      };
      // Prisma Json columns can't accept a raw null — omit when empty.
      if (d.specs) (data as { specs?: Prisma.InputJsonValue }).specs = d.specs as Prisma.InputJsonValue;
      await prisma.equipmentProduct.create({ data });
      created++;
      console.log(`  ✓ created    ${d.slug.padEnd(20)} ${d.name}`);
    } else if (force) {
      const updateData: Prisma.EquipmentProductUpdateInput = {
        name: d.name,
        category: d.category,
        description: d.description,
        price: d.price,
        images: d.images,
        stockQty: d.stockQty ?? 0,
        trackStock: d.trackStock ?? false,
        sortOrder: d.sortOrder,
        isActive: true,
      };
      // Same Json caveat as create — only set specs when present.
      if (d.specs) (updateData as { specs?: Prisma.InputJsonValue }).specs = d.specs as Prisma.InputJsonValue;
      await prisma.equipmentProduct.update({ where: { slug: d.slug }, data: updateData });
      updated++;
      console.log(`  ↻ updated    ${d.slug.padEnd(20)} ${d.name}  (force)`);
    } else {
      skipped++;
      console.log(`  • skipped    ${d.slug.padEnd(20)} (already exists; use --force to overwrite)`);
    }
  }

  console.log(`\n  Done — ${created} created, ${updated} updated, ${skipped} skipped.\n`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
