/**
 * seedProductTours.js — Seed 5 canonical narrated walkthroughs.
 *
 * Idempotent: matches by (orgId=null, slug) and updates in place.
 *
 * Run: cd backend && node prisma/seedProductTours.js
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TOURS = [
  {
    slug: 'add-product',
    name: 'Add your first product',
    description: 'A step-by-step walkthrough for creating a single product in the catalog, scannable at the POS immediately after save.',
    category: 'onboarding',
    triggers: [
      'how do I add a product',
      'walk me through adding a product',
      'guide me to create a product',
      'new product setup',
    ],
    steps: [
      {
        title: '1. Open the Products page',
        body: 'We\'ll work from the catalog. Tap the button below to navigate there now.',
        url: '/portal/catalog/products',
      },
      {
        title: '2. Click "Add Product"',
        body: 'This button (highlighted on the page) opens a blank product form.',
        url: '/portal/catalog/products',
        selector: '[data-tour="products-new-btn"]',
      },
      {
        title: '3. Fill in the required fields',
        body: '**Product Name** and **Department** are both mandatory. If the department you need doesn\'t exist yet, click "Manage departments" to create it first.',
      },
      {
        title: '4. Add pricing',
        body: 'Enter the **Retail Price** (what customers pay). **Cost Price** is optional but lets reports compute profit margins.',
      },
      {
        title: '5. Add one or more barcodes',
        body: 'Scroll to **Additional UPCs / Barcodes**. Scan a barcode or type it in. You can add multiple UPCs if the product has pack variants.',
      },
      {
        title: '6. Optional: pack sizes',
        body: 'If the product comes in multiple sizes (single / 6-pack / case), use the **Pack Sizes** section. Each size can have its own price. The cashier sees a picker when they scan it.',
      },
      {
        title: '7. Save',
        body: 'Click **Save** at the bottom. You\'ll bounce back to the catalog with your new product at the top. Try scanning it on the cashier app — it should ring up immediately.',
      },
      {
        title: '✓ All done!',
        body: 'You\'ve added your first product. Tell me if you want help with **bulk CSV import**, **pricing rules**, or **setting up promotions** next.',
      },
    ],
  },
  {
    slug: 'set-age-verification',
    name: 'Set up age verification for tobacco and alcohol',
    description: 'Configure the per-store age limits the cashier app uses to prompt age-check on scan.',
    category: 'onboarding',
    triggers: [
      'how do I set tobacco age',
      'configure age verification',
      'set alcohol age limit',
      'walk me through age verification',
    ],
    steps: [
      {
        title: '1. Open Store Settings',
        body: 'Age verification is configured per store. Tap below to go to the Stores tab.',
        url: '/portal/account?tab=stores',
      },
      {
        title: '2. Pick your store',
        body: 'If you manage multiple stores, click the store you want to configure. For single-store setups, you\'ll be there already.',
      },
      {
        title: '3. Find the Age Verification Policy section',
        body: 'We\'ve highlighted the **Age Verification Policy** section. It has two coloured chips for tobacco and alcohol limits.',
        url: '/portal/account?tab=stores',
        selector: '[data-tour="age-verification-section"]',
      },
      {
        title: '4. Set the Tobacco age limit',
        body: 'Enter the minimum age for tobacco/nicotine products. Typical: **21** in the US and most Canadian provinces.',
      },
      {
        title: '5. Set the Alcohol age limit',
        body: 'Enter the minimum age for alcohol. **21** in the US; **18** in Québec; **19** in most other Canadian provinces.',
      },
      {
        title: '6. Save',
        body: 'Click **Save** at the bottom of the settings. The cashier app picks up the new limits within 5 minutes (or immediately after a refresh).',
      },
      {
        title: '💡 Pro tip: apply state defaults',
        body: 'At the top of Store Settings, pick your **State** and click **Apply State Defaults**. This auto-fills tobacco/alcohol limits + sales tax + deposit rules with legal minimums for that state.',
      },
      {
        title: '✓ All set!',
        body: 'When a cashier scans a tobacco or alcohol product, the Age Verification modal will show your configured limit and require the cashier to confirm the customer\'s date of birth.',
      },
    ],
  },
  {
    slug: 'invite-user',
    name: 'Invite a team member',
    description: 'Send an invitation email so a new cashier, manager, or owner can create an account and access your store.',
    category: 'onboarding',
    triggers: [
      'how do I invite a user',
      'add a team member',
      'invite cashier',
      'invite manager',
      'walk me through inviting someone',
    ],
    steps: [
      {
        title: '1. Open the Users tab',
        body: 'Team management lives under Account Settings. Tap below to open it.',
        url: '/portal/account?tab=users',
      },
      {
        title: '2. Click "Invite user"',
        body: 'The highlighted button opens the invite form. Alternatively, use **Account → Invitations** for the full invitation management page.',
        url: '/portal/account?tab=users',
        selector: '[data-tour="invite-user-btn"]',
      },
      {
        title: '3. Enter the invitee\'s details',
        body: 'Required: **Email** and **Name**. Optional: phone (for SMS delivery if Twilio is configured).',
      },
      {
        title: '4. Pick a role',
        body: '**Cashier** — POS only, limited inventory/customer access\n**Manager** — day-to-day ops, inventory, reports, refunds\n**Owner** — full access to organisation',
      },
      {
        title: '5. Restrict to specific stores (optional)',
        body: 'For cashiers in multi-store orgs, check only the stores they should access. Managers and owners see all stores by default.',
      },
      {
        title: '6. Send invitation',
        body: 'Click **Send Invitation**. StoreVeu emails them a 7-day link. They click → create account (or sign in) → land in the portal with your store visible in their StoreSwitcher.',
      },
      {
        title: '💡 Track it',
        body: 'Go to **Account → Invitations** to see pending invites, resend emails, or revoke access. You\'ll also see accepted/expired status here.',
      },
      {
        title: '✓ Done!',
        body: 'Your new team member will appear in the Users list the moment they accept. You can change their role or store access any time by clicking their row.',
      },
    ],
  },
  {
    slug: 'configure-receipt-printer',
    name: 'Set up the receipt printer',
    description: 'Connect a thermal receipt printer to the cashier app — USB via QZ Tray, or network via TCP/IP.',
    category: 'onboarding',
    triggers: [
      'how do I set up the printer',
      'configure receipt printer',
      'connect my printer',
      'walk me through printer setup',
    ],
    steps: [
      {
        title: '1. Open Receipt Settings',
        body: 'Receipt customization lives in the POS Configuration hub.',
        url: '/portal/pos-config?tab=receipt',
      },
      {
        title: '2. Configure what prints',
        body: 'Toggle the fields you want on each receipt: **Store logo**, **Address**, **Tax breakdown**, **Cashier name**, **Shift ID**, **Phone**, **Marketing footer**. Live preview on the right updates as you toggle.',
      },
      {
        title: '3. Save receipt settings',
        body: 'Click **Save** at the bottom. These settings apply to every receipt printed from any station at this store.',
      },
      {
        title: '4. Open the cashier app',
        body: 'Switch to the POS machine (or open the cashier app in a new tab if you\'re testing). Sign in with your PIN.',
      },
      {
        title: '5. Open Hardware Settings',
        body: 'In the cashier app, tap the **gear icon** (top-right) or use **ActionBar → Settings → Hardware**.',
      },
      {
        title: '6. Pick a print method',
        body: '**QZ Tray (USB)** — for Windows POS terminals with a USB printer. Install QZ Tray from qz.io, then select the printer from the dropdown.\n**Network (TCP)** — enter printer IP + port (usually 9100 for Epson/Star).\n**Browser Print** — fallback using the browser print dialog.',
      },
      {
        title: '7. Test print',
        body: 'Click **Test Print** to verify. A receipt with a test pattern should print immediately. If nothing prints, check the USB cable (for QZ Tray) or the IP/port (for network).',
      },
      {
        title: '✓ All set!',
        body: 'Every sale from now on will auto-print a receipt. If the cash drawer is connected to the printer via RJ11, it\'ll also pop open on cash sales.',
      },
    ],
  },
  {
    slug: 'setup-fuel-type',
    name: 'Set up a fuel type',
    description: 'For gas stations — add a new fuel grade (Regular, Premium, Diesel) so cashiers can ring up pump sales.',
    category: 'onboarding',
    triggers: [
      'how do I add a fuel type',
      'set up gas pump',
      'configure fuel',
      'walk me through fuel setup',
    ],
    steps: [
      {
        title: '1. Open the Fuel module',
        body: 'Fuel lives in its own sidebar group. Tap below to open it.',
        url: '/portal/fuel',
      },
      {
        title: '2. Enable the Fuel module',
        body: 'Click the **Settings** tab. Toggle **Enable Fuel Module** on. This makes the Fuel Sale and Fuel Refund buttons appear in the cashier ActionBar.',
      },
      {
        title: '3. Set defaults',
        body: 'Pick the **Default Entry Mode** — most cashiers use **Amount** (customer wants $20 of gas). You can also toggle **Cash Only** and **Allow Refunds** here.',
      },
      {
        title: '4. Switch to Fuel Types tab',
        body: 'Click the **Fuel Types** tab at the top of the page.',
      },
      {
        title: '5. Click "Add Fuel Type"',
        body: 'The highlighted button opens a blank fuel-type form.',
        url: '/portal/fuel',
        selector: '[data-tour="fuel-new-btn"]',
      },
      {
        title: '6. Fill in the details',
        body: '**Name** (e.g., Regular 87), **Grade Label** (87 Octane), **Price per Gallon** (3-decimal precision like $3.999), **Color** (shown in the cashier modal). Toggle **Default** for the most common grade.',
      },
      {
        title: '7. Save + repeat',
        body: 'Click **Save**. Repeat steps 5-7 for each fuel grade you sell (typical: Regular 87, Mid 89, Premium 91/93, Diesel).',
      },
      {
        title: '✓ Fuel is live!',
        body: 'Cashiers will now see **Fuel Sale** and **Fuel Refund** buttons in the ActionBar. Prices are locked to your configured values — cashiers cannot override them.',
      },
    ],
  },
];

async function upsertTour(tour) {
  // Find by (orgId=null, slug) for idempotent upsert.
  const existing = await prisma.productTour.findFirst({
    where: { orgId: null, slug: tour.slug },
    select: { id: true },
  });
  if (existing) {
    await prisma.productTour.update({
      where: { id: existing.id },
      data: {
        name: tour.name,
        description: tour.description,
        category: tour.category,
        triggers: tour.triggers,
        steps: tour.steps,
        active: true,
      },
    });
    return 'updated';
  }
  await prisma.productTour.create({
    data: {
      orgId: null,
      slug: tour.slug,
      name: tour.name,
      description: tour.description,
      category: tour.category,
      triggers: tour.triggers,
      steps: tour.steps,
    },
  });
  return 'created';
}

async function main() {
  console.log(`✓ Seeding product tours: ${TOURS.length} tours`);
  let created = 0, updated = 0;
  for (const [i, t] of TOURS.entries()) {
    process.stdout.write(`  [${i + 1}/${TOURS.length}] ${t.name.slice(0, 60)}…`);
    const result = await upsertTour(t);
    if (result === 'created') { created++; process.stdout.write(' ✓ new\n'); }
    else                      { updated++; process.stdout.write(' ✓ updated\n'); }
  }
  console.log(`\n✓ Done: ${created} created, ${updated} updated`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
