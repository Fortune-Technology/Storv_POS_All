/**
 * Dejavoo SPIn — public types.
 *
 * `DejavooSpinMerchant` is the shape every SPIn function expects: a decrypted
 * snapshot of the row from PaymentMerchant. The caller is responsible for
 * decrypting `spinAuthKey` before passing it in (see paymentProviderFactory).
 *
 * `SpinOpts` is the catch-all options bag passed to each transaction
 * function. Most fields are optional and only used by specific calls
 * (e.g. `tipAmount` only by tipAdjust, `originalReferenceId` by void/refund).
 */

export interface DejavooSpinMerchant {
  spinTpn: string;
  spinAuthKey: string;
  spinBaseUrl?: string | null;
  // RegisterId from iPOSpays portal: TPN → Edit Parameter → Integration.
  // Required by /v2/Payment/Status, /v2/Payment/Sale, etc. — Dejavoo returns
  // 400 without it. One TPN can have multiple lanes; each lane has its own RegisterId.
  spinRegisterId?: string | null;
  spinTimeout?: number;
  environment?: 'uat' | 'prod' | string;
}

export interface SpinOpts {
  registerId?: string;
  printReceipt?: string;
  getReceipt?: string;
  proxyTimeout?: number;
  amount?: number | string;
  paymentType?: string;
  referenceId?: string;
  invoiceNumber?: string;
  captureSignature?: boolean;
  originalReferenceId?: string;
  tipAmount?: number | string;
  // userInput-only fields
  title?: string;
  prompt?: string;
  inputType?: string;
  minLength?: number;
  maxLength?: number;
  timeoutSec?: number;
}
