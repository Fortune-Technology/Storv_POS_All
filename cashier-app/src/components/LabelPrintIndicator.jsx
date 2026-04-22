/**
 * LabelPrintIndicator
 *
 * Small pill shown in the cashier-app when this station is routing Zebra
 * print jobs. Communicates: (a) the feature is active, (b) current
 * activity (polling/printing/error), (c) how many labels printed today.
 * Collapses entirely when the station is not opted in.
 */

import React from 'react';
import { Printer, AlertTriangle, Loader, CheckCircle2 } from 'lucide-react';
import { useLabelPrintJobPoller } from '../hooks/useLabelPrintJobPoller.js';
import './LabelPrintIndicator.css';

export default function LabelPrintIndicator() {
  const { enabled, status, error, lastJobAt, printedToday } = useLabelPrintJobPoller();

  if (!enabled) return null;

  const fmtLast = (d) => {
    if (!d) return null;
    const diff = Math.max(0, Date.now() - d.getTime());
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    return `${Math.floor(diff / 3_600_000)}h ago`;
  };

  let icon, color, text;
  if (status === 'printing') {
    icon = <Loader size={13} className="lpi-spin" />;
    color = 'var(--brand-primary, #3d56b5)';
    text = 'Printing label…';
  } else if (status === 'error') {
    icon = <AlertTriangle size={13} />;
    color = 'var(--error, #ef4444)';
    text = error ? `Label printer: ${error.slice(0, 40)}` : 'Label printer error';
  } else if (lastJobAt && (Date.now() - lastJobAt.getTime()) < 5000) {
    icon = <CheckCircle2 size={13} />;
    color = 'var(--success, #10b981)';
    text = 'Label printed';
  } else {
    icon = <Printer size={13} />;
    color = 'var(--text-muted, #64748b)';
    text = `Label printer ready · ${printedToday} today`;
  }

  return (
    <div className="lpi-root" style={{ borderColor: color, color }} title={lastJobAt ? `Last job ${fmtLast(lastJobAt)}` : 'Awaiting print jobs'}>
      {icon}
      <span className="lpi-text">{text}</span>
    </div>
  );
}
