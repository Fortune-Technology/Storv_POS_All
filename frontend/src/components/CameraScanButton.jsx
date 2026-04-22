/**
 * CameraScanButton — Drop-in camera scan button for any product-search input.
 *
 * Usage:
 *   <CameraScanButton onScan={(code) => { setQuery(code); ... }} />
 *
 * Renders a camera icon button + mounts the BarcodeScannerModal on click.
 * Consistent UI across every product-listing page (Catalog, Inventory Count,
 * Promotions, Price Update, Vendor Orders, Invoice Import, etc).
 *
 * Props:
 *   - onScan(code: string)  — called when a barcode is detected
 *   - title?: string        — tooltip (default: "Scan barcode with camera")
 *   - size?: number         — icon size in px (default: 16)
 *   - variant?: 'icon' | 'chip'  — icon-only (default) or chip with label
 */
import React, { useState } from 'react';
import { Camera } from 'lucide-react';
import BarcodeScannerModal from './BarcodeScannerModal';
import './CameraScanButton.css';

export default function CameraScanButton({
  onScan,
  title = 'Scan barcode with camera',
  size = 16,
  variant = 'icon',
  className = '',
  label = 'Scan',
  disabled = false,
}) {
  const [open, setOpen] = useState(false);

  const handleDetected = (code) => {
    if (typeof onScan === 'function' && code) onScan(code);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={title}
        aria-label={title}
        className={`cam-scan-btn cam-scan-btn--${variant} ${className}`}
      >
        <Camera size={size} />
        {variant === 'chip' && <span>{label}</span>}
      </button>

      <BarcodeScannerModal
        open={open}
        onClose={() => setOpen(false)}
        onDetected={handleDetected}
      />
    </>
  );
}
