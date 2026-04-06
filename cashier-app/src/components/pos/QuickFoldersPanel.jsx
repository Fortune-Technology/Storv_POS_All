/**
 * QuickFoldersPanel — POS screen quick access folder browser.
 * Shows folder tiles; tap a folder to see its products; tap a product to add to cart.
 */
import React, { useState } from 'react';
import { ChevronLeft, LayoutGrid } from 'lucide-react';
import { useCartStore } from '../../stores/useCartStore.js';
import { fmt$ } from '../../utils/formatters.js';
import './QuickFoldersPanel.css';

export default function QuickFoldersPanel({ folders = [] }) {
  const [activeFolder, setActiveFolder] = useState(null);
  const addProduct = useCartStore(s => s.addProduct);

  if (!folders || folders.length === 0) {
    return (
      <div className="qfp-wrap">
        <div className="qfp-empty">
          <LayoutGrid size={28} style={{ opacity: 0.3 }} />
          <span>No quick access folders configured.</span>
          <span style={{ fontSize: '0.72rem' }}>Set them up in Back Office → Quick Access.</span>
        </div>
      </div>
    );
  }

  // Viewing a folder's products
  if (activeFolder) {
    const folder = folders.find(f => f.id === activeFolder);
    if (!folder) { setActiveFolder(null); return null; }
    const items = folder.items || [];

    const handleAddProduct = (item) => {
      addProduct({
        id:         item.productId,
        name:       item.name,
        retailPrice: item.price,
        unitPrice:  item.price,
        upc:        item.barcode || '',
        qty:        1,
      });
    };

    return (
      <div className="qfp-wrap">
        <div className="qfp-back-bar">
          <button className="qfp-back-btn" onClick={() => setActiveFolder(null)}>
            <ChevronLeft size={13} /> Back
          </button>
          <span className="qfp-folder-title">
            <span>{folder.emoji}</span>
            {folder.name}
          </span>
        </div>
        {items.length === 0 ? (
          <div className="qfp-empty">No products in this folder yet.</div>
        ) : (
          <div className="qfp-products">
            {items.map(item => (
              <button
                key={item.productId}
                className="qfp-product-btn"
                onClick={() => handleAddProduct(item)}
              >
                <span className="qfp-product-name">{item.name}</span>
                <span className="qfp-product-price">{fmt$(item.price)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Folder grid view
  return (
    <div className="qfp-wrap">
      <div className="qfp-folders">
        {folders.map(folder => {
          const bgColor = (folder.color || '#34d399') + '18';
          const borderColor = (folder.color || '#34d399') + '44';
          return (
            <button
              key={folder.id}
              className="qfp-folder-btn"
              style={{ background: bgColor, borderColor: borderColor }}
              onClick={() => setActiveFolder(folder.id)}
            >
              <span className="qfp-folder-emoji">{folder.emoji || '📦'}</span>
              <span className="qfp-folder-name">{folder.name}</span>
              <span className="qfp-folder-count">{(folder.items || []).length} items</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
