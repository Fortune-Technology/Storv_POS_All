/**
 * seedAiKnowledge.js — Seed the AI Support Assistant's knowledge base with
 * curated how-to articles covering StoreVeu POS's core feature set.
 *
 * Idempotent: re-running updates articles with the same title (matched per
 * source='seed' + orgId=null). Safe to run after schema changes.
 *
 * Requires OPENAI_API_KEY to be set (for embedding generation).
 *
 * Run: cd backend && node prisma/seedAiKnowledge.js
 */

import { PrismaClient } from '@prisma/client';
import { generateEmbedding } from '../src/services/kbService.js';

const prisma = new PrismaClient();

const ARTICLES = [
  {
    category: 'how-to',
    title: 'Add a new product to the catalog',
    tags: ['products', 'catalog', 'inventory'],
    content: `To add a product in StoreVeu:

1. Go to **Catalog → Products** in the portal sidebar.
2. Click the **+ New Product** button in the top right.
3. Fill in required fields: **Product Name** and **Department**. Both are mandatory.
4. Add pricing: **Retail Price** (selling price), optional **Cost Price**.
5. Scroll to the **Additional UPCs / Barcodes** section and add one or more barcodes. You can add as many as needed — multiple UPCs for the same product (e.g., pack variants) are fully supported.
6. If the product comes in multiple pack sizes (e.g., single can, 6-pack, case), use the **Pack Sizes (Cashier Picker)** section to define each with its own price. The cashier will see a picker at scan time.
7. Upload a product image (optional). Images auto-populate from the global UPC image cache when available.
8. Click **Save**.

The product will appear on the POS immediately after save. If a cashier scans the barcode, they'll add it to the cart instantly.`,
  },
  {
    category: 'how-to',
    title: 'Bulk import products from a CSV',
    tags: ['products', 'import', 'csv', 'bulk'],
    content: `To import many products at once:

1. Go to **Catalog → Bulk Import** in the portal sidebar.
2. Download the template CSV or prepare a file with these columns (case-insensitive headers): **Name**, **UPC**, **Department**, **Retail Price**, **Cost Price**, optional **Brand**, **Image URL**, **Unit Pack**, **Pack in Case**, **Deposit per Unit**.
3. Click **Upload CSV**. The system previews the first 10 rows for you to verify column mapping.
4. Confirm → the import runs in the background. You'll see progress and any errors in the import history table below.
5. Image URLs in the CSV auto-populate the product image on save.

Tip: the Sante template is also supported — download it from the portal and StoreVeu will auto-map Sante column headers.`,
  },
  {
    category: 'how-to',
    title: 'Run an inventory count (cycle count)',
    tags: ['inventory', 'count', 'stock'],
    content: `To perform a cycle count:

1. Go to **Catalog → Inventory Count** in the portal.
2. Click **+ Start New Count**. Choose a scope: whole store, single department, or a product list.
3. On the cashier app (or the portal count sheet), scan each product's barcode and enter the counted quantity.
4. When finished, click **Finalize Count**.
5. StoreVeu compares counted quantity to system quantity on hand (QOH). Any variance is logged to the **Inventory Adjustments** history with a reason code of "Cycle Count".
6. The QOH for each product updates automatically — no manual adjustment needed.

Tip: for high-value items like cigarettes or liquor, run a weekly spot count rather than full annual counts. This catches shrinkage faster.`,
  },
  {
    category: 'how-to',
    title: 'Adjust inventory manually (damage, theft, transfer)',
    tags: ['inventory', 'adjustment', 'shrinkage'],
    content: `When product is lost, damaged, or moved between stores, record an inventory adjustment:

1. Go to **Catalog → Products**, find the product, and open it.
2. Alternatively, go to **Catalog → Inventory Count → Adjustments** for a bulk adjustment page.
3. Click **Adjust Stock**. Enter the quantity change (negative to remove, positive to add).
4. Pick a reason: **Damage**, **Theft**, **Store Transfer**, **Receiving Error**, **Other**.
5. Add an optional note (e.g., "dropped 6-pack during restocking").
6. Save. The adjustment is logged in the Audit Log and affects your live inventory immediately.

All adjustments require manager+ role. The full audit trail (who, when, why) is available in **Reports → Audit Log**.`,
  },
  {
    category: 'how-to',
    title: 'Open a shift (cash drawer)',
    tags: ['shift', 'drawer', 'cashier'],
    content: `Cashiers must open a shift before they can ring up sales:

1. On the cashier app, sign in with your PIN.
2. The **Open Cash Drawer** modal appears automatically.
3. Count your physical starting cash (the float) and enter the total.
4. Click **Open Shift**. The drawer opens and the POS is now ready.

If you come in and see an amber banner warning "This shift was opened before midnight", that means the previous cashier left a shift open from yesterday. Close it first (manager PIN required) then open a new one.

For owners: you can set a default float amount per store in **POS Configuration**.`,
  },
  {
    category: 'how-to',
    title: 'Close a shift and reconcile the drawer',
    tags: ['shift', 'close', 'reconciliation', 'cashier'],
    content: `At end of shift:

1. Tap **End of Shift** in the ActionBar on the cashier app (manager PIN may be required).
2. Count your physical cash and enter it into the **Cash Count** field.
3. StoreVeu shows the **Expected** amount: Opening + Cash Sales + Cash In − Drops − Cash Out = Expected.
4. **Variance** is automatically calculated (counted − expected). Significant variance triggers a manager review.
5. Optional: tap **Print EoD Receipt** to print the end-of-day summary with tender breakdown.
6. Click **Close Shift**.

If the lottery module is enabled and Scan Mandate is on, you must first reconcile all active lottery boxes (scan end ticket numbers) before the shift can close.`,
  },
  {
    category: 'how-to',
    title: 'Void a transaction at the register',
    tags: ['transactions', 'void', 'cashier'],
    content: `Voiding removes a just-completed transaction as if it never happened:

1. On the cashier app, tap **Void** in the ActionBar. Manager PIN required.
2. The most recent transactions for today are shown. Tap the one to void.
3. Confirm. StoreVeu reverses the transaction, restores inventory, and voids any lottery sales.
4. If the original transaction was paid by cash, the cash drawer opens automatically.

Voided transactions still appear in reports but with status="voided" and don't count toward sales totals.

For transactions from a previous day, use **Refund** instead — void is for same-shift corrections only.`,
  },
  {
    category: 'how-to',
    title: 'Process a refund',
    tags: ['transactions', 'refund', 'cashier'],
    content: `For returns and refunds:

1. On the cashier app, tap **Refund** in the ActionBar. Manager PIN required.
2. Search for the original transaction by date, amount, or receipt number.
3. Select the transaction. You'll see the original line items.
4. Check the items being refunded, enter quantities (partial refunds allowed).
5. Choose refund method: same tender as original, or cash.
6. Confirm. StoreVeu creates a refund transaction with status="refund", restores inventory, and opens the drawer for cash refunds.

Refunds appear in reports with REF prefix on the transaction number and subtract from gross sales. The End of Day report shows both refund count and amount separately.`,
  },
  {
    category: 'how-to',
    title: 'Set up the lottery module',
    tags: ['lottery', 'setup'],
    content: `To enable lottery sales in your store:

1. Go to **Lottery → Settings** in the portal.
2. Toggle **Enable Lottery Module** on.
3. Set your state/province (e.g., Ontario, Massachusetts). This filters which games are visible — each state has its own game catalog.
4. Set **Commission Rate** — your percentage of ticket sales (e.g., 5% = 0.05).
5. Configure optional rules:
   - **Cash Only**: forces cash payment when the cart has lottery items.
   - **Scan Mandate**: requires cashiers to scan each active box's end ticket at shift close.
6. Go to **Lottery → Inventory** and receive your first box of tickets (record the game, serial range, and pack size).
7. Go to **Lottery → Active Tickets** and activate the box when you put it on display.

Cashiers will now see a **Lottery** button in the ActionBar. They pick a game, enter quantity, and the price is locked to the game's ticket price (they cannot override it).`,
  },
  {
    category: 'how-to',
    title: 'End-of-day lottery reconciliation',
    tags: ['lottery', 'shift', 'scan'],
    content: `At end of shift (if Scan Mandate is enabled):

1. Tap **Lotto Shift** in the ActionBar (orange button). This opens the Lottery Shift modal.
2. For each active box, scan or type the **end ticket number**.
3. StoreVeu calculates tickets sold = end − start, and the expected dollar amount.
4. Variance is compared against your cart lottery transactions for that shift.
5. Save the report. If Scan Mandate is on and any box is unscanned, the shift cannot close until reconciled.

The **Lottery → Shift Reports** tab shows the full history of EoD reconciliations with variance notes.`,
  },
  {
    category: 'how-to',
    title: 'Sell fuel at the register',
    tags: ['fuel', 'cashier'],
    content: `If fuel is enabled for your store:

1. On the cashier app, tap **Fuel Sale** in the ActionBar.
2. Pick a fuel type (Regular 87, Premium 91, Diesel, etc.).
3. Choose entry mode: **Amount** (customer wants $20 of gas) or **Gallons** (customer wants 5 gallons).
4. Enter the amount/gallons on the numpad. StoreVeu calculates the other side live.
5. Tap **Add to Cart** — then set the pump at the attached hardware.
6. Complete the transaction normally.

Fuel refunds work the same way: tap **Fuel Refund** (amber button). The fuel type's price is locked to what's configured in **Fuel → Fuel Types** — cashiers cannot override it.`,
  },
  {
    category: 'how-to',
    title: 'Record a vendor payout (paid-out)',
    tags: ['vendor', 'payouts', 'cash'],
    content: `When paying a vendor from the register (e.g., a delivery driver):

1. On the cashier app, tap **Paid Out** in the ActionBar.
2. Select the vendor from the dropdown (or enter a free-text vendor name).
3. Enter the amount on the numpad.
4. Pick a type: **Expense** or **Merchandise**.
5. Pick tender method (Cash, Cheque, Bank Transfer — configurable per store).
6. Add an optional note / invoice number.
7. Confirm. The cash drawer opens for cash payouts.

This is a shift-scoped event — it reduces the expected drawer cash at shift close.

For back-office vendor payments (e.g., historical entries or payments from a separate bank account), use **Vendors → Vendor Payouts** in the portal instead.`,
  },
  {
    category: 'how-to',
    title: 'Invite a new user to your store',
    tags: ['users', 'invitation', 'team'],
    content: `To add a team member:

1. Go to **Account Settings → Users** in the portal.
2. Click **+ Invite User**.
3. Enter their email, name, role (Cashier, Manager, Owner), and optional phone.
4. Optionally scope to specific stores (for multi-store orgs).
5. Click **Send Invitation**. StoreVeu emails them a link that expires in 7 days.

Alternative: go to **Account → Invitations** for the full invitation management page (resend, revoke, track acceptance).

The invitee opens the link, signs in (existing user) or creates an account inline. They see their assigned stores in the StoreSwitcher immediately.`,
  },
  {
    category: 'how-to',
    title: 'Create a custom role with specific permissions',
    tags: ['roles', 'permissions', 'users'],
    content: `The built-in roles (Owner, Admin, Manager, Cashier, Staff) cover most cases, but you can create custom roles:

1. Go to **Account → Roles & Permissions** (owner role required).
2. Click **+ New Role**.
3. Name the role (e.g., "Shift Lead", "Inventory Clerk").
4. Check the specific permissions — grouped by module (Products, Transactions, Reports, etc.). Click a module heading to toggle all its actions.
5. Save.
6. Go to **Account → Users**, open a user, click **Roles** button, and assign the new role.

Users can hold multiple roles — the effective permission set is the union. A user with both "Cashier" and your custom "Shift Lead" role has both permission sets combined.`,
  },
  {
    category: 'how-to',
    title: 'Design custom Quick Buttons (POS shortcuts)',
    tags: ['pos', 'quick-buttons', 'shortcuts'],
    content: `Quick Buttons give cashiers instant-tap access to products, folders, and actions on the POS screen:

1. Go to **Point of Sale → Quick Buttons** in the portal.
2. Use the palette on the left to add tiles: **Product**, **Folder**, **Action**, **Text Label**, **Image**.
3. Drag tiles around the canvas to position them. Resize by dragging the bottom-right corner.
4. Click a tile to edit: label, emoji, background color (13 presets + custom color picker), image upload.
5. For **Product** tiles: search and pick a product. For **Action** tiles: choose from 19 actions (discount, void, open drawer, lottery sale, etc.).
6. **Folders** can hold up to one level of children — drill in by double-clicking. Use folders for category groupings like "Produce" or "Beer".
7. Adjust grid columns (3-12) and tile height (40-160px) in the palette.
8. Click **Save** — changes appear on the cashier app on next data refresh (within 5 minutes).

The cashier app shows a BUTTONS tab above the product grid when a layout exists.`,
  },
  {
    category: 'how-to',
    title: 'Configure tax rules for your store',
    tags: ['tax', 'rules', 'setup'],
    content: `To set up sales tax:

1. Go to **Point of Sale → Rules & Fees → Tax Rules**.
2. Click **+ New Tax Rule**.
3. Name it (e.g., "State Sales Tax"), enter the rate as a decimal (6.25% = 0.0625).
4. Choose scope: **Store-wide** (default), or **Department-specific** (e.g., 8% on prepared food only).
5. Toggle **Tax-exempt on EBT**: when a customer pays with EBT, the rule is skipped.
6. Save.

Products inherit tax rules from their department unless overridden individually. To exempt a specific product (e.g., unprepared grocery), open it in **Catalog → Products**, scroll to **Flags**, and toggle **Tax Exempt** off.

Quickstart: set your store's state in **Store Settings**, then click **Apply State Defaults** — StoreVeu auto-creates the tax rule with your state's default rate.`,
  },
  {
    category: 'how-to',
    title: 'Set up bottle deposit rules (CRV / redemption)',
    tags: ['deposit', 'crv', 'bottles'],
    content: `For states with bottle deposit laws:

1. Go to **Point of Sale → Rules & Fees → Deposit Rules**.
2. Add rules per container type and size:
   - **Container Type**: Can, Bottle, Carton
   - **Material**: Aluminum, Plastic, Glass
   - **Volume Range**: minVol and maxVol in fl oz
   - **Deposit Amount**: e.g., $0.05, $0.10
3. Save.

Products marked as beverages (via department flag) auto-match to the appropriate deposit rule based on container type + volume. The deposit appears as a separate line item at checkout.

For bottle returns (customer returns empties for refund):

- On the cashier app, tap **Bottle Return** in the ActionBar.
- Tap the container rule, enter quantity on the numpad (e.g., 50 cans), tap **Add to Cart (-$2.50)**.
- The negative line item reduces the total, or creates a cash refund if the cart is otherwise empty.`,
  },
  {
    category: 'how-to',
    title: 'Add customers and track loyalty',
    tags: ['customers', 'loyalty', 'house-account'],
    content: `To add a customer:

1. **From the portal**: go to **Customers** and click **+ Add Customer**. Fill in name, phone, email (all optional except name), optional loyalty card number, discount %, and house-account settings.
2. **From the cashier app**: tap **Customer** in the ActionBar. Search by name/phone/email. If not found, tap **Add new?** in the search results — fill a minimal form (first/last/phone) and the customer is created and auto-attached to the current cart.

For loyalty programs:

1. Go to **Customers → Loyalty Program** to set accrual rules (points per dollar, excluded departments).
2. Customers earn points on every purchase automatically.
3. At checkout, redeem points for discounts via the **Discount** action.
4. View individual customer point balance + history by opening their profile.

House accounts: toggle **Charge Account** on a customer, set a balance limit. They can charge purchases to their account (negative balance on closeout).`,
  },
  {
    category: 'how-to',
    title: 'View the End of Day report',
    tags: ['reports', 'eod', 'reconciliation'],
    content: `The End of Day report is the comprehensive shift/day summary:

1. Go to **Reports & Analytics → End of Day** in the portal.
2. Pick a scope: single shift (enter shift ID), single day, or date range.
3. Optional filters: cashier, station, store.
4. View the 4 sections:
   - **Payouts**: 9 categories (cashback, loans, pickups, paid-in, paid-out, received on account, refunds, tips, voids) with count + amount
   - **Tender Details**: 9 tender types (cash, card, EBT, check, etc.) with count + amount
   - **Transactions**: average, net sales, gross sales, tax collected, cash collected
   - **Fuel Sales** (if enabled): per fuel-type breakdown
   - **Reconciliation** (shift scope only): opening + cash in − cash out = expected vs counted

Export via **CSV**, **PDF**, or **Print** buttons. The cashier app also has an End of Day modal that prints the same report to a thermal receipt printer.`,
  },
  {
    category: 'how-to',
    title: 'Look up a past transaction',
    tags: ['transactions', 'search', 'history'],
    content: `To find a specific transaction:

1. Go to **Reports & Analytics → Transactions** in the portal.
2. Use the filter bar: date range, cashier, station, amount range, status (complete / refund / voided), tender method.
3. Click a transaction row to open the receipt modal — shows line items, tender, cashier, customer, timestamps.
4. From the modal you can **Print receipt** or **Void/Refund** (with manager permission).

Quick search: the search box at the top accepts transaction number (e.g., TXN-20260418-000042), customer name/phone, or product UPC.

For live monitoring during the day, check **Operations → Live Dashboard** — it shows the feed of recent transactions as they happen.`,
  },
  {
    category: 'how-to',
    title: 'Auto-generate vendor purchase orders',
    tags: ['vendors', 'vendor-orders', 'auto-order'],
    content: `StoreVeu's 14-factor auto-order engine suggests reorder quantities based on live sales velocity:

1. Go to **Vendors → Vendor Orders**.
2. Click **Generate Suggestions** — the engine analyzes 90 days of sales, lead times, weather forecasts, holidays, and stockout history to compute optimal reorder quantities per product per vendor.
3. Review the Suggestions tab: urgency color-coded (Critical / High / Medium / Low), factor badges (trend, weather, holiday).
4. Click **Create PO** for a single vendor or **Create All POs** for all.
5. The draft PO appears in the Purchase Orders tab. Edit quantities if needed.
6. Click **Submit to Vendor** — the PO is sent (email/print) and inventory quantityOnOrder is incremented.
7. When the delivery arrives, click **Receive** on the PO and enter actual quantities received. Inventory updates automatically.

Tune the engine in each vendor's profile: **Lead Time (days)**, **Order Frequency**, **Delivery Days**, **Minimum Order**.`,
  },
  {
    category: 'how-to',
    title: 'Import a vendor invoice via OCR',
    tags: ['invoices', 'ocr', 'vendor'],
    content: `To quickly capture received invoice data:

1. Go to **Vendors → Invoice Import**.
2. Preselect the vendor (optional — StoreVeu will auto-resolve by name if omitted).
3. Upload a PDF, JPG, or PNG of the invoice. Multi-page PDFs supported.
4. OCR runs in the background (~30 seconds per page). The invoice appears in the pending list.
5. Click the invoice to open the review panel. StoreVeu auto-matches line items to your products via distributor itemCode (vendor-scoped for accuracy) + UPC + fuzzy description matching.
6. For each line, verify the matched product, toggle **Cases vs Units** (5 cases of 24-pack = 120 units), and edit quantity/cost if needed.
7. Click **Confirm Invoice** — products receive the cases × packUnits quantity into inventory.

If matching is poor (lots of unmatched items), click **Re-run matching** with a specific vendor selected.`,
  },
  {
    category: 'how-to',
    title: 'Clock in and clock out',
    tags: ['clock', 'timesheet', 'employees'],
    content: `To track your work hours:

1. On the cashier app, from the sign-in screen, tap **Clock In/Out** (below the PIN field).
2. Enter your register PIN (same PIN as sign-in) and tap **Clock In**.
3. At the end of your shift, do the same and tap **Clock Out**.

If you try to clock in while already clocked in (or vice versa), StoreVeu shows a friendly warning instead of duplicating the event.

Managers can:
- View timesheets in **Reports & Analytics → Employees → Timesheet**
- Manually edit/add/delete clock sessions in the **Manage Shifts** tab (owner role required)
- Export employee timesheets as PDF for payroll`,
  },
  {
    category: 'troubleshoot',
    title: 'Cash drawer is not opening',
    tags: ['hardware', 'drawer', 'printer'],
    content: `The cash drawer is printer-driven — it opens via an ESC/POS "kick" command sent through the receipt printer's RJ11 port.

Common fixes:

1. **Check the cable**: the RJ11 cable from the drawer plugs into the **printer**, NOT a phone jack. It should click into the dedicated "DK" port on the back of the printer.
2. **Verify printer connection**: on the cashier app, go to POS Configuration → Receipt Printer and run **Test Print**. If the test doesn't print, the drawer won't open either.
3. **Check printer driver**: on Windows, make sure the correct printer is set in **Hardware Settings**. For USB, the driver name usually starts with "EPSON TM" or "Star".
4. **Manual test**: tap **No Sale** in the ActionBar (manager PIN required). The drawer should pop open. If not, the kick command isn't reaching the printer.

If all fails, unplug the printer, wait 10 seconds, plug it back in, and restart the cashier app.`,
  },
  {
    category: 'troubleshoot',
    title: 'Barcode scan adds the wrong product',
    tags: ['scan', 'products', 'upc'],
    content: `This usually means one UPC is assigned to multiple products (duplicate barcode):

1. On the portal, go to **Catalog → Products**.
2. Search by the barcode in the top search bar.
3. If 2+ products come back, one of them has the barcode assigned in error.
4. Open the incorrect product, go to **Additional UPCs / Barcodes**, and delete the offending UPC.
5. Save.

StoreVeu now enforces per-org UPC uniqueness at the database level, so new duplicates can't be created. This only happens with legacy data imported before the constraint was added.

For cashiers scanning on the go: if a scan adds the wrong item, tap the line item and change quantity to 0 (or tap the × to remove), then scan again or look up manually.`,
  },
  {
    category: 'troubleshoot',
    title: 'Cashier app says "offline" or shows stale data',
    tags: ['offline', 'sync', 'network'],
    content: `The cashier app is offline-first — it works without internet, but syncs changes when reconnected:

1. Check the status bar at the top of the POS screen. If it shows a red "offline" indicator, your cashier is disconnected from the server.
2. Verify the POS machine has internet (try opening a browser).
3. If online but still "offline" in the app, restart the cashier app.
4. Transactions queued while offline are stored in IndexedDB and uploaded automatically when the connection returns.

For stale product data (e.g., "I added a product but it's not showing on POS"):

- The cashier app syncs catalog every 15 minutes, on sign-in, and when the manual **Refresh Catalog** button is tapped.
- Force a refresh from the ActionBar → Settings (gear icon) → **Refresh Catalog**.
- Newly created or updated products should appear within seconds.`,
  },
  {
    category: 'troubleshoot',
    title: 'Sales report totals don\'t match the end of day report',
    tags: ['reports', 'reconciliation', 'accuracy'],
    content: `Both reports use the same status filter (complete + refund transactions only) and the same sign convention (refunds subtract from gross/net). Common discrepancy sources:

1. **Date range mismatch**: the Sales Analytics page uses calendar day boundaries in your store's local timezone; End of Day's "date" scope is the same. But End of Day's "shift" scope spans shift open→close times, which may cross a calendar day boundary.

2. **Voided transactions**: EoD by default does NOT count voids in gross. Sales Analytics by default also excludes them. If you see a difference, check your filters.

3. **Cash tender "pending" status** (fixed April 2026): historical transactions before April 2026 may have status='pending' for offline-queue cash sales. Run the one-time backfill to correct: \`UPDATE transactions SET status='complete' WHERE status='pending';\`

If numbers still don't match, compare the transaction counts, not just the dollars. A single discrepancy usually points at one transaction sitting in a non-standard status.`,
  },
  {
    category: 'faq',
    title: 'What does "Net Sales" mean vs "Gross Sales"?',
    tags: ['reports', 'accounting', 'terminology'],
    content: `StoreVeu defines these per the user's accounting convention (April 2026):

- **Gross Sales** = Σ grandTotal — includes tax. This is what customers paid you (the tender total). Refunds subtract.

- **Net Sales** = Σ subtotal — pre-tax, post-discount. This is your actual sales revenue before handing sales tax to the state.

- **Tax Collected** = Σ taxTotal — the amount you owe the state as sales tax.

Gross = Net + Tax (roughly; exact equality depends on tax-exempt items and rounding).

All sales-reporting surfaces (Live Dashboard, Sales Analytics, End of Day, Reports Hub) use these same definitions so numbers match everywhere.`,
  },
  {
    category: 'faq',
    title: 'Do I have to use the Back Office Portal, or is the cashier app enough?',
    tags: ['portal', 'cashier-app', 'usage'],
    content: `The cashier app (register) handles:

- Sales, refunds, voids
- Cash drops, vendor payouts, no-sales
- Lottery sales, fuel sales, bottle returns
- Customer lookup / quick-add
- End of Shift reconciliation

The back-office portal handles everything else:

- Product catalog management (add/edit/delete/bulk import)
- Reports, analytics, predictions
- Vendor management and purchase orders
- Invoice OCR and import
- User and role management
- POS configuration (layouts, receipts, quick buttons)
- Integrations (delivery platforms, e-commerce)
- Support tickets

You need both. The cashier app runs at the register; the portal runs on any web browser (desktop, tablet, or phone). A manager can do everything from the portal except actually ring up a sale.`,
  },
  {
    category: 'faq',
    title: 'How do I contact StoreVeu support?',
    tags: ['support', 'tickets'],
    content: `For help beyond what this assistant can answer:

1. Open a support ticket: **Support & Billing → Support Tickets** in the portal, then click **+ New Ticket**. Describe your issue; the StoreVeu support team will respond.
2. You can also ask the AI assistant to file a ticket for you — just say "file a ticket" or agree when the assistant suggests it. The conversation context is attached automatically.
3. For urgent issues: email support@storeveu.com.
4. For system status: check https://status.storeveu.com.

Tickets are tracked in **Support Tickets** — you'll see admin replies there and can continue the conversation.`,
  },
  {
    category: 'how-to',
    title: 'Set up age verification for tobacco and alcohol',
    tags: ['age-verification', 'tobacco', 'alcohol', 'compliance', 'store-settings'],
    content: `StoreVeu has per-store age limits for tobacco and alcohol, used by the cashier app to prompt age-verification on scan.

**Where to configure:**

1. Go to **[Account → Store Settings](/portal/account?tab=stores)** in the portal, then pick your store.
2. Scroll to the **Age Verification Policy** section.
3. Set the two limits:
   - **Tobacco Age Limit** — 21 in most US states and Canadian provinces
   - **Alcohol Age Limit** — 21 in the US; 18 in Québec; 19 in Ontario, Manitoba, Alberta, Saskatchewan, BC
4. Click **Save**.

**What the cashier sees:**
- When a product in the *tobacco* or *alcohol* tax class is scanned, the POS shows the age-verification modal with the correct store-configured limit (e.g., "Born on or before Apr 20, 2005 for tobacco 21+").
- The cashier confirms the customer's date of birth (drivers-license scan or manual entry) before the item is added to the cart.

**Quick start — use your state's defaults:**
1. In Store Settings, pick your **State** from the dropdown (e.g., Massachusetts).
2. Click **Apply State Defaults**.
3. This auto-fills the tobacco and alcohol age limits with the state's legal minimum.

Override settings per store if multiple stores in different jurisdictions.`,
  },
  {
    category: 'how-to',
    title: 'Configure general store settings (name, hours, timezone)',
    tags: ['store-settings', 'general', 'onboarding'],
    content: `To update general store information:

1. Go to **[Account → Store Settings](/portal/account?tab=stores)** in the portal.
2. Pick the store you want to edit (if you have multiple stores, use the dropdown).
3. Update fields:
   - **Store Name** — customer-facing display name
   - **Address** — street, city, state/province, ZIP/postal code
   - **Phone** — main store phone
   - **Email** — primary contact (for receipts, customer emails)
   - **Timezone** — affects shift cutoffs, EoD reports, and local-time date filters
   - **Hours of Operation** — per-day open/close times (used by the e-commerce storefront and delivery-platform integrations)
4. Click **Save**.

**Why timezone matters:** the shift auto-close scheduler and EoD report both use the store's local midnight as the day boundary. A wrong timezone makes reports span the wrong 24-hour window.

Changes apply immediately. Cashier app picks up within 5 minutes via the POS config polling, or after a page refresh.`,
  },
  {
    category: 'how-to',
    title: 'Set up a new fuel type',
    tags: ['fuel', 'setup', 'pump'],
    content: `For gas-station stores running the Fuel module:

1. First enable the Fuel module: **[Fuel → Settings](/portal/fuel)** → toggle **Enable Fuel Module** on.
2. Go to the **Fuel Types** tab.
3. Click **+ New Fuel Type**.
4. Fill in:
   - **Name** — e.g., "Regular 87", "Premium 91", "Diesel"
   - **Grade Label** — shown to cashiers, e.g., "87 Octane"
   - **Price per Gallon** — 3-decimal precision (e.g., $3.999/gal)
   - **Color** — visual accent shown in the cashier fuel modal
   - **Default fuel type** — toggle on if this is the most common sale (pre-selects in the modal)
   - **Taxable** + **Tax Rate** — if fuel is taxed separately (varies by state)
5. Save.

**What cashiers see:**
- "Fuel Sale" and "Fuel Refund" buttons appear in the ActionBar (only when Fuel is enabled).
- Tapping opens the modal with the fuel-type chip selector, Amount/Gallons mode toggle, and a locked price — cashiers cannot override it.

**Settings to know:**
- **Cash Only** — forces cash payment when the cart has fuel items.
- **Allow Refunds** — enables the Fuel Refund button.
- **Default Entry Mode** — Amount (most common) or Gallons.`,
  },
  {
    category: 'how-to',
    title: 'Launch an online store (e-commerce storefront)',
    tags: ['ecom', 'storefront', 'online', 'setup'],
    content: `To launch a branded online store that syncs from your POS catalog:

1. Go to **[Online Store → Store Setup](/portal/ecom/setup)** in the portal.
2. **General tab**:
   - Enter store display name, short description, contact email
   - Click **Sync Products Now** to pull your POS catalog into the ecom DB (auto-syncs on future product changes)
3. **Branding tab**: logo upload, primary color (picker + 10 preset swatches), font selector, live preview
4. **Pages tab**: pick from 15 premium templates (5 per page type) for Home, About, Contact
5. **Fulfillment tab**:
   - Toggle **Pickup** and/or **Delivery**
   - Set hours, fees, minimum order
   - Delivery area radius
6. **SEO tab**: meta title, description, Instagram/Facebook/Twitter links

**To connect a custom domain:**
- **[Online Store → Custom Domain](/portal/ecom/domain)** → enter your domain
- DNS verification walkthrough shown on screen (CNAME record)
- SSL auto-provisioned

**Your store URL:**
- Default subdomain: \`yourstore.storv.app\`
- Custom domain after verification

**Online orders** appear in **[Online Store → Orders](/portal/ecom/orders)** with status progression (pending → confirmed → preparing → ready → completed). You get a sound notification on new orders.`,
  },
  {
    category: 'how-to',
    title: 'Set up loyalty program and points',
    tags: ['loyalty', 'customers', 'points'],
    content: `To reward repeat customers with points:

1. Go to **[Customers → Loyalty Program](/portal/customers?tab=loyalty)** tab.
2. Toggle **Enable Loyalty Program** on.
3. Configure earn rules:
   - **Points per dollar** — e.g., 1 point per $1 spent (or 10 points per $1 for inflated values)
   - **Minimum spend** to earn (optional — e.g., $5 minimum purchase)
   - **Excluded departments** — lottery, fuel, gift cards typically excluded
4. Configure redemption:
   - **Points-to-dollar ratio** — e.g., 100 points = $1 discount
   - **Minimum points to redeem** (e.g., 500 points = $5)
5. Save.

**Cashier side:**
- At checkout, tap the **Customer** button → search/add → points balance visible.
- Points accrue automatically on sale completion.
- To redeem: use the **Discount** action during checkout and pick "Loyalty Points".

**Customer-facing:**
- Online store: customer login page shows points balance.
- Receipt: "You earned X points today! Total: Y points."

**Reports:** track points issued vs redeemed in **[Analytics → Customers](/portal/ecom/customers)**.`,
  },
  {
    category: 'how-to',
    title: 'Configure the receipt printer',
    tags: ['hardware', 'printer', 'receipt', 'setup'],
    content: `To set up receipt printing on the cashier app:

1. On the cashier app, tap the gear icon at the top-right (or use ActionBar → Settings → Hardware).
2. Select your printer method:
   - **QZ Tray (USB)** — recommended for Windows POS terminals with a USB-connected receipt printer (e.g., EPSON TM-T20III, Star TSP143III)
   - **Network (TCP/IP)** — for Ethernet or Wi-Fi printers (e.g., shared lane printer, kitchen printer)
   - **Browser Print** — fallback; uses the browser's print dialog
3. For QZ Tray:
   - Install QZ Tray from qz.io on the POS machine
   - Pick the printer from the dropdown
   - Click **Test Print** to verify
4. For Network:
   - Enter the printer's IP and port (usually 9100 for Epson/Star ESC/POS printers)
   - Click **Test Print**

**Receipt customization:**
- Go to **[POS Configuration → Receipt Settings](/portal/pos-config?tab=receipt)** in the portal
- Toggle which fields print: store logo, address, tax breakdown, cashier name, shift ID, phone, URL, marketing footer
- Live preview on the right

**Paper size:** 80mm (42 chars) is the standard; 58mm (32 chars) is supported for smaller printers.`,
  },
  {
    category: 'how-to',
    title: 'Set up the Dejavoo payment terminal',
    tags: ['payment', 'dejavoo', 'card', 'terminal'],
    content: `To connect a Dejavoo (Skyzer) payment terminal:

1. Go to **Admin → Payment Terminals** (superadmin only).
2. Click **+ New Terminal** and fill in:
   - **Merchant ID** — from your payment processor
   - **Terminal ID** — printed on the Dejavoo device
   - **API endpoint** (iPOSpays gateway URL)
   - **Auth key** (processor-issued)
3. Assign the terminal to a **Store** and optionally a specific **Station**.
4. **Test Connection** — should return the terminal's current status.
5. Save.

**On the cashier app:**
- Tap **Card** at checkout → the Dejavoo terminal prompts the customer to insert/tap/swipe.
- Transaction status polls every second until approval/decline.
- On approval, the sale completes; on decline, the cashier can retry or switch tender.

**Batch close / settle:**
- End of day: from the cashier End of Day modal, tap **Close Batch on Terminal**.
- Or from the portal: **POS Configuration → Terminals** → **Settle** button.
- Dejavoo returns a batch report with totals per card type.

**Supported card networks:** Visa, Mastercard, Amex, Discover, Interac (Canada), debit, EBT (US).`,
  },
  {
    category: 'how-to',
    title: 'Invite team members and assign roles',
    tags: ['users', 'team', 'invitation', 'roles'],
    content: `To add cashiers, managers, or other staff:

1. Go to **[Account → Users](/portal/account?tab=users)** in the portal.
2. Click **+ Invite User**.
3. Fill in:
   - **Email** (required — invite link sent here)
   - **Name** (required)
   - **Role** — Cashier, Manager, Owner, or a custom role you've created
   - **Phone** (optional — if SMS delivery configured)
   - For Cashiers: pick which **Stores** they can access
4. Click **Send Invitation**.

The invitee receives an email with a 7-day link. They click → create their account (or sign in) → land in the portal with their assigned stores visible.

**Managing pending invitations:**
- **[Account → Invitations](/portal/invitations)** — resend, revoke, track acceptance status

**Changing a user's role:**
- In **Users** tab, click the user → **Edit** → pick a new role → Save.
- Role changes apply on the user's next page load (or within 5 minutes of any open tabs).

**Custom roles:**
- See **[Account → Roles & Permissions](/portal/roles)** to create tailored roles (e.g., "Shift Lead", "Inventory Clerk") with specific permissions.`,
  },
  {
    category: 'how-to',
    title: 'Transfer store ownership to another user',
    tags: ['transfer', 'ownership', 'sale', 'store'],
    content: `If you're selling your store or transferring it to a new owner:

1. Go to **[Account → Stores](/portal/account?tab=stores)** in the portal.
2. Find the store you want to transfer and click the orange **ShieldAlert** (transfer) button.
3. A warning modal appears explaining what transfer does:
   - The new owner gets full access to all products, transactions, vendors, reports
   - You (and all current staff) lose access to this store
   - All historical data stays with the store (not deleted)
4. Enter the buyer's **email** and optionally their **phone**.
5. **Type "TRANSFER"** (exact case) to confirm — this is a destructive action.
6. Click **Send Transfer Invitation**.

**What the buyer sees:**
- Email with a 7-day link with a red warning banner
- They sign up (new account) or sign in (existing) → accept ownership → become the sole owner

**What happens at accept:**
- Buyer becomes the single UserOrg member (role=owner) of the organisation
- Seller's UserOrg row is deleted
- \`Store.ownerId\` flips to the buyer
- Seller's \`User.orgId\` is cleared (they can still sign in but see no stores unless they own others)
- You can't undo this — both the seller and StoreVeu admins cannot reverse ownership

For multi-store orgs, transferring one store transfers the whole organisation. If you want to move just one store to a new org, contact support for a store-split operation.`,
  },
  {
    category: 'troubleshoot',
    title: "AI assistant says 'The service is temporarily unavailable'",
    tags: ['ai-assistant', 'troubleshoot', 'setup'],
    content: `If the AI assistant returns one of these messages:

- **"⚠ The AI service is temporarily unavailable — the provider account is out of credits"** — the Anthropic (Claude) account funding the assistant is at $0 balance. Contact your StoreVeu administrator to top up at console.anthropic.com.

- **"⚠ The AI service is misconfigured (invalid API key)"** — the \`ANTHROPIC_API_KEY\` env variable on the backend is wrong, missing, or revoked. StoreVeu admin needs to generate a new key in the Anthropic console and update the server \`.env\` file.

- **"⚠ The AI service is being rate-limited"** — too many queries in a short window. Wait 1-2 minutes and try again. If persistent, contact support; the account may need a higher tier.

- **"⚠ Anthropic's service is temporarily overloaded"** — Anthropic's infrastructure is under load. This is usually transient — wait a minute and retry.

**These messages don't mean StoreVeu is broken** — they're signals from the AI provider. Your POS, inventory, reports, and all normal operations continue working. The assistant will resume once the underlying issue is fixed.`,
  },
];

async function upsertArticle(article) {
  const embedding = await generateEmbedding(`${article.title}\n\n${article.content}`);
  if (!embedding) {
    console.warn(`  ⚠  Skipping "${article.title}" — no embedding (OPENAI_API_KEY unset or call failed)`);
    return null;
  }

  // Find-by-title (within orgId=null, source=seed) for idempotent upserts.
  const existing = await prisma.aiKnowledgeArticle.findFirst({
    where: { orgId: null, source: 'seed', title: article.title },
    select: { id: true },
  });

  if (existing) {
    await prisma.aiKnowledgeArticle.update({
      where: { id: existing.id },
      data: {
        category: article.category,
        content:  article.content,
        embedding,
        tags:     article.tags,
        active:   true,
      },
    });
    return 'updated';
  }

  await prisma.aiKnowledgeArticle.create({
    data: {
      orgId:    null,
      category: article.category,
      title:    article.title,
      content:  article.content,
      embedding,
      source:   'seed',
      tags:     article.tags,
    },
  });
  return 'created';
}

async function main() {
  console.log(`✓ Seeding AI knowledge base: ${ARTICLES.length} articles`);

  let created = 0, updated = 0, skipped = 0;
  for (const [i, article] of ARTICLES.entries()) {
    process.stdout.write(`  [${i + 1}/${ARTICLES.length}] ${article.title.slice(0, 60)}…`);
    const result = await upsertArticle(article);
    if      (result === 'created')  { created++; process.stdout.write(' ✓ new\n');     }
    else if (result === 'updated')  { updated++; process.stdout.write(' ✓ updated\n'); }
    else                            { skipped++; process.stdout.write(' ⚠ skipped\n'); }
  }

  console.log(`\n✓ Done: ${created} created, ${updated} updated, ${skipped} skipped`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
