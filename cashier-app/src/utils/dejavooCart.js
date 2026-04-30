/**
 * Build a Dejavoo SPIn `Cart` object from our useCartStore items + totals.
 *
 * The Cart object goes on a /v2/Payment/Sale request and triggers the P17 to
 * display the itemised cart on the customer-facing screen during the card
 * prompt. Format per the Theneo SPIn REST API spec:
 *
 *   POST /v2/Payment/Sale
 *   {
 *     "Cart": {
 *       "Amounts": [
 *         {"Name": "Subtotal", "Value": 19.84},
 *         {"Name": "Taxes",    "Value": 2.75},
 *         {"Name": "Total",    "Value": 22.59}
 *       ],
 *       "CashPrices": [...],   // optional dual-pricing — leave empty for now
 *       "Items": [
 *         {
 *           "Name": "Bottle of Milk",
 *           "Price": 5.18,         // line total
 *           "UnitPrice": 5.18,     // per-unit
 *           "Quantity": 1,
 *           "AdditionalInfo": "",  // brand / SKU / etc.
 *           "CustomInfos": [],
 *           "Modifiers": []
 *         }
 *       ]
 *     }
 *   }
 *
 * Field-name casing matters — Dejavoo's API is case-sensitive.
 *
 * @param {Array}  items   useCartStore.items[] — raw cart line items
 * @param {Object} totals  selectTotals() output { subtotal, taxTotal, depositTotal, grandTotal, ... }
 * @param {Object} opts
 *   chargeAmount {number} — when paying a partial split, the Cart should
 *                           reflect the AMOUNT BEING CHARGED, not the cart
 *                           grand total (otherwise the customer sees $20
 *                           on the prompt while only $5 is being charged
 *                           on this card). Defaults to grandTotal.
 *   maxItems     {number} — cap the items array to avoid huge payloads on
 *                           bulk-scan carts. Defaults to 50.
 *
 * @returns {Object|null} Cart object ready to drop into the Sale body, or
 *   null when the cart is empty / inputs are invalid.
 */
export function buildDejavooCart(items, totals, opts = {}) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const grandTotal = Number(totals?.grandTotal);
  if (!Number.isFinite(grandTotal)) return null;

  const chargeAmount = Number.isFinite(opts.chargeAmount) ? opts.chargeAmount : grandTotal;
  const maxItems     = Number.isInteger(opts.maxItems) ? opts.maxItems : 50;

  // Round helper — Dejavoo expects numbers with up to 2 decimals.
  const r = (n) => Math.round(Number(n) * 100) / 100;

  // Translate one cart line into Dejavoo's Item shape. Skip items that
  // can't be meaningfully displayed (no name, no qty, no price).
  const toCartItem = (line) => {
    const name = String(
      line.name ||
      line.productName ||
      line.label ||
      ''
    ).trim();
    if (!name) return null;
    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty === 0) return null;
    // Use effectivePrice when we have a discount applied, else unitPrice.
    const unit = Number(line.effectivePrice ?? line.unitPrice ?? 0);
    const total = Number(line.lineTotal ?? unit * qty);

    // ── Compact line-item rendering on the customer-facing terminal ──
    //
    // We can't directly control the terminal's rendered font size or row
    // padding — that's Dejavoo's UI on the device. But we CAN reduce the
    // fields we send, which gives the terminal less to render per row.
    //
    // What's REQUIRED per Dejavoo spec (don't omit any of these):
    //   - Name      → required (string)
    //   - Price     → required (number, line total)
    //   - Quantity  → REQUIRED — confirmed live in UAT with StatusCode 2201
    //                 "Quantity field is required for Items in Cart's Items
    //                 List". An earlier compaction attempt dropped Quantity
    //                 for qty==1 items and broke every card sale.
    //
    // What's OPTIONAL (omit when not adding info):
    //   - UnitPrice → drop when qty==1 (UnitPrice equals Price; redundant
    //                 row info that the terminal would render). Keep when
    //                 qty > 1 so the customer sees "$5 × 3 = $15".
    //   - AdditionalInfo → always omit. We previously included brand/UPC
    //                 and it doubled row height. Brand+UPC stay on the
    //                 printed receipt; on the customer display they're
    //                 noise.
    //   - CustomInfos / Modifiers → always omit empty. Empty arrays can
    //                 trigger empty placeholder rows on some firmwares.
    //
    // Name is clipped to 32 chars (was 60). Long names wrapping to two
    // lines was the other space-eater. Terminals add their own ellipsis
    // when truncating, so we don't append one ourselves.
    //
    // Beyond this, further compaction is a Dejavoo terminal config
    // ("compact display mode" — see escalation in email to Rehan).
    const item = {
      Name:     name.slice(0, 32),
      Price:    r(total),
      Quantity: qty,
    };
    // UnitPrice is only meaningful when qty > 1. Sending it for qty=1
    // doubles the row height with no extra info ("$5.00 / $5.00 ×1").
    if (qty !== 1) item.UnitPrice = r(unit);
    return item;
  };

  const dejavooItems = items
    .map(toCartItem)
    .filter(Boolean)
    .slice(0, maxItems);

  if (dejavooItems.length === 0) return null;

  // Cart-level Amounts — kept intentionally minimal per cashier feedback.
  //
  // Just two lines so the customer-facing display is uncluttered:
  //   Cart Total   = pre-tax subtotal (what the items add up to)
  //   Total        = grand total (what's actually deducted from the card —
  //                  includes tax + deposit + fees + surcharge if any)
  //
  // We previously also surfaced Subtotal / Tax / Deposit / "Charging Now"
  // as separate rows. Cashiers found that too noisy on a small terminal
  // screen. The detailed breakdown is still on the printed receipt; on
  // the live cart display, "what items cost" + "what they pay" is enough.
  //
  // When pre-tax and grand-total are equal (no tax, no fees), we collapse
  // to a single "Total" row so the customer doesn't see two identical
  // numbers stacked on top of each other.
  const amounts = [];
  const subtotal = Number(totals?.subtotal);
  const haveSeparateSubtotal = Number.isFinite(subtotal)
    && Math.abs(subtotal - grandTotal) > 0.005;
  if (haveSeparateSubtotal) {
    amounts.push({ Name: 'Cart Total', Value: r(subtotal) });
  }
  amounts.push({ Name: 'Total', Value: r(grandTotal) });

  // Split-tender hint — when this card is paying LESS than the whole cart
  // (e.g. customer is splitting $20 cart between $10 cash already collected
  // and $10 on this card), make that explicit. Otherwise the customer sees
  // the cart Total of $20 but the prompt says "Approve $10" — confusing
  // without context. This single "Charging Now" row clarifies.
  if (Math.abs(chargeAmount - grandTotal) > 0.005) {
    amounts.push({ Name: 'Charging Now', Value: r(chargeAmount) });
  }

  return {
    Amounts:    amounts,
    CashPrices: [],     // empty unless dual-pricing (cash discount) is enabled
    Items:      dejavooItems,
  };
}
