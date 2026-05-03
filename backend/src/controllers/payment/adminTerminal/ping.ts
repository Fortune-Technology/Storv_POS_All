/**
 * Admin terminal — live connectivity check.
 *
 * pingTerminal hits Dejavoo via paymentProviderFactory.checkTerminalStatus
 * (which delegates to the SPIn /v2/Payment/Status probe — see
 * services/dejavoo/spin/terminal.ts).
 *
 * Updates the terminal row's `status`, `lastPingedAt`, and `lastPingResult`
 * so the admin UI shows when the device was last verified and what the
 * outcome was.
 */

import type { Request, Response } from 'express';
import prisma from '../../../config/postgres.js';
import { decrypt } from '../../../utils/cryptoVault.js';
import {
  checkTerminalStatus,
  type DecryptedPaymentMerchant,
} from '../../../services/paymentProviderFactory.js';

/**
 * POST /api/admin/payment-terminals/:id/ping
 *
 * Uses the terminal's `overrideTpn` if set, else falls back to the parent
 * merchant's `spinTpn`. Auth key is decrypted once into memory just for
 * the outbound call; nothing about the plaintext is persisted.
 */
export const pingTerminal = async (req: Request, res: Response): Promise<void> => {
  try {
    const terminal = await prisma.paymentTerminal.findUnique({
      where: { id: req.params.id },
      include: { merchant: true },
    });
    if (!terminal) { res.status(404).json({ success: false, error: 'Terminal not found' }); return; }
    if (!terminal.merchant) {
      res.status(400).json({ success: false, error: 'Terminal has no merchant' });
      return;
    }

    const decrypted = {
      ...terminal.merchant,
      spinAuthKey: terminal.merchant.spinAuthKey ? decrypt(terminal.merchant.spinAuthKey) : null,
      spinTpn:     terminal.overrideTpn || terminal.merchant.spinTpn,
    } as unknown as DecryptedPaymentMerchant;

    const status = await checkTerminalStatus(decrypted) as { connected?: boolean; message?: string };

    const updated = await prisma.paymentTerminal.update({
      where: { id: terminal.id },
      data: {
        status:         status.connected ? 'active' : 'inactive',
        lastPingedAt:   new Date(),
        lastPingResult: status.connected ? 'ok' : (status.message || 'Not connected'),
      },
    });

    res.json({ success: !!status.connected, message: status.message, terminal: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pingTerminal]', err);
    res.status(500).json({ success: false, error: message });
  }
};
