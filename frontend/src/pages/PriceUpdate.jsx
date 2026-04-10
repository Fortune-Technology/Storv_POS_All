import React, { useState, useEffect } from 'react';
import { Search, Save, RefreshCw, AlertCircle, CheckCircle, Package, ArrowUpRight, DollarSign } from 'lucide-react';
import { getProducts, bulkUpdatePrices } from '../services/api';
import { toast } from 'react-toastify';
import './PriceUpdate.css';

const PriceUpdate = () => {
  const [products, setProducts] = useState([]);
  const [updates, setUpdates] = useState({});
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const { data } = await getProducts();
      setProducts(data);
    } catch (error) {
      toast.error('Error fetching products');
    }
  };

  const handlePriceChange = (id, price) => {
    setUpdates({ ...updates, [id]: parseFloat(price) });
  };

  const handleBulkUpdate = async () => {
    if (Object.keys(updates).length === 0) return;
    setSyncing(true);
    const updateArray = Object.keys(updates).map(id => ({ id: id, price: updates[id] }));

    try {
      const { data } = await bulkUpdatePrices(updateArray);
      const failed = data.results.filter(r => r.status === 'error' || r.status === 'failed');
      if (failed.length === 0) {
        toast.success(`Successfully updated and synced ${updateArray.length} products`);
      } else {
        toast.warning(`Updates saved, but ${failed.length} products failed to sync with POS`);
      }
      setUpdates({});
      fetchProducts();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Error updating prices');
    } finally {
      setSyncing(false);
    }
  };

  return (
      <div className="p-page animate-fade-in">
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <DollarSign size={22} />
            </div>
            <div>
              <h1 className="p-title">Price Update Module</h1>
              <p className="p-subtitle">Bulk update prices and sync with MarktPOS API.</p>
            </div>
          </div>
          <div className="p-header-actions">
            <button
              onClick={handleBulkUpdate}
              className="btn btn-primary pu-sync-btn"
              disabled={syncing || Object.keys(updates).length === 0}
            >
              {syncing ? <RefreshCw className="animate-spin" /> : <>Save & Sync to POS <Save size={18} className="pu-save-icon" /></>}
            </button>
          </div>
        </div>

        <div className="glass-card pu-card">
          <div className="pu-search-bar">
            <Search size={20} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Search products by SKU or name..."
              className="pu-search-input"
            />
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Category</th>
                  <th>Current Price</th>
                  <th className="pu-th-price">New Price</th>
                  <th>Sync Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <div className="pu-product-cell">
                        <div className="pu-product-icon">
                            <Package size={20} />
                        </div>
                        <span className="pu-product-name">{product.name}</span>
                      </div>
                    </td>
                    <td><code className="pu-sku-code">{product.sku}</code></td>
                    <td><span className="pu-category">{product.category || 'Uncategorized'}</span></td>
                    <td className="pu-current-price">${product.price.toFixed(2)}</td>
                    <td>
                      <div className="pu-price-input-row">
                        <span className="pu-dollar-sign">$</span>
                        <input
                          type="number"
                          step="0.01"
                          className={`form-input pu-price-input ${updates[product.id] ? 'pu-price-input--active' : 'pu-price-input--default'}`}
                          placeholder={product.price}
                          value={updates[product.id] || ''}
                          onChange={(e) => handlePriceChange(product.id, e.target.value)}
                        />
                      </div>
                    </td>
                    <td>
                        {product.posSyncStatus === 'synced' ? (
                            <span className="pu-sync-status pu-sync-status--synced">
                                <CheckCircle size={14} /> Synced
                            </span>
                        ) : product.posSyncStatus === 'error' ? (
                            <span className="pu-sync-status pu-sync-status--error">
                                <AlertCircle size={14} /> Error
                            </span>
                        ) : (
                            <span className="pu-sync-status pu-sync-status--pending">
                                <RefreshCw size={14} /> Pending
                            </span>
                        )}
                    </td>
                  </tr>
                ))}
                {products.length === 0 && (
                    <tr>
                        <td colSpan="6" className="pu-empty">
                            No products found in the database.
                        </td>
                    </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
  );
};

export default PriceUpdate;
