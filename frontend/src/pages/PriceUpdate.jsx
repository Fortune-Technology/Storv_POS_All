import React, { useState, useEffect } from 'react';
import { Search, Save, RefreshCw, AlertCircle, CheckCircle, Package, ArrowUpRight } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { getProducts, bulkUpdatePrices } from '../services/api';
import { toast } from 'react-toastify';

const PriceUpdate = () => {
  const [products, setProducts] = useState([]);
  const [updates, setUpdates] = useState({}); // { id: newPrice }
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
    <div className="layout-container">
      <Sidebar />
      <main className="main-content animate-fade-in">
        <header style={{ marginBottom: '2.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Price Update Module</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Bulk update prices and sync with MarktPOS API.</p>
          </div>
          <button 
            onClick={handleBulkUpdate} 
            className="btn btn-primary" 
            disabled={syncing || Object.keys(updates).length === 0}
            style={{ padding: '0.875rem 2rem' }}
          >
            {syncing ? <RefreshCw className="animate-spin" /> : <>Save & Sync to POS <Save size={18} style={{ marginLeft: '0.5rem' }} /></>}
          </button>
        </header>

        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', background: 'var(--bg-tertiary)', padding: '0.75rem 1rem', borderRadius: '12px' }}>
            <Search size={20} color="var(--text-muted)" />
            <input 
              type="text" 
              placeholder="Search products by SKU or name..." 
              style={{ background: 'transparent', border: 'none', color: 'white', outline: 'none', width: '100%' }}
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
                  <th style={{ width: '200px' }}>New Price</th>
                  <th>Sync Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                            <Package size={20} />
                        </div>
                        <span style={{ fontWeight: 500 }}>{product.name}</span>
                      </div>
                    </td>
                    <td><code style={{ background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>{product.sku}</code></td>
                    <td><span style={{ color: 'var(--text-secondary)' }}>{product.category || 'Uncategorized'}</span></td>
                    <td style={{ fontWeight: 600 }}>${product.price.toFixed(2)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>$</span>
                        <input 
                          type="number" 
                          step="0.01"
                          className="form-input" 
                          style={{ padding: '0.4rem 0.6rem', background: updates[product.id] ? 'rgba(99, 102, 241, 0.1)' : 'var(--bg-tertiary)' }}
                          placeholder={product.price}
                          value={updates[product.id] || ''}
                          onChange={(e) => handlePriceChange(product.id, e.target.value)}
                        />
                      </div>
                    </td>
                    <td>
                        {product.posSyncStatus === 'synced' ? (
                            <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '13px' }}>
                                <CheckCircle size={14} /> Synced
                            </span>
                        ) : product.posSyncStatus === 'error' ? (
                            <span style={{ color: 'var(--error)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '13px' }}>
                                <AlertCircle size={14} /> Error
                            </span>
                        ) : (
                            <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '13px' }}>
                                <RefreshCw size={14} /> Pending
                            </span>
                        )}
                    </td>
                  </tr>
                ))}
                {products.length === 0 && (
                    <tr>
                        <td colSpan="6" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                            No products found in the database.
                        </td>
                    </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};

export default PriceUpdate;
