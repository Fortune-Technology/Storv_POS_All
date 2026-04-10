/**
 * BagFeeRow — compact bag counter that sits above payment buttons.
 * [ Bags  (−) 0 (+)  $0.00 ]
 */

import React from 'react';
import { ShoppingBag, Minus, Plus } from 'lucide-react';
import { fmt$ } from '../../utils/formatters.js';

export default function BagFeeRow({ bagCount, onIncrement, onDecrement, bagPrice, bagTotal }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0.5rem 0.875rem',
      borderTop: '1px solid var(--border)',
    }}>
      {/* Label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <ShoppingBag size={14} color="var(--text-muted)" />
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Bags
        </span>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
          ({fmt$(bagPrice)} ea)
        </span>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onDecrement}
          disabled={bagCount <= 0}
          style={{
            width: 26, height: 26, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--border)',
            background: bagCount <= 0 ? 'transparent' : 'var(--bg-hover)',
            color: bagCount <= 0 ? 'var(--text-muted)' : 'var(--text-primary)',
            cursor: bagCount <= 0 ? 'default' : 'pointer',
            opacity: bagCount <= 0 ? 0.4 : 1,
            transition: 'all 0.15s',
          }}
        >
          <Minus size={13} />
        </button>

        <span style={{
          minWidth: 24, textAlign: 'center',
          fontSize: '0.95rem', fontWeight: 700,
          color: bagCount > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
        }}>
          {bagCount}
        </span>

        <button
          onClick={onIncrement}
          style={{
            width: 26, height: 26, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--accent-primary)',
            background: 'rgba(122, 193, 67, 0.1)',
            color: 'var(--accent-primary)',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <Plus size={13} />
        </button>

        {/* Total */}
        <span style={{
          minWidth: 52, textAlign: 'right',
          fontSize: '0.85rem', fontWeight: 700,
          color: bagTotal > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
        }}>
          {fmt$(bagTotal)}
        </span>
      </div>
    </div>
  );
}
