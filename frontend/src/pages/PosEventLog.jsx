/**
 * PosEventLog.jsx — Back-office view of all POS business events.
 *
 * Events are written by the cashier app (No Sale, etc.) and stored
 * in the pos_logs table (method = 'EVENT').
 *
 * Filters: date range, event type, cashier name (text), store
 * Table:   Date/Time | Event | Store | Cashier | Station | Note
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Sidebar from '../components/Sidebar';
import { useSetupStatus } from '../hooks/useSetupStatus';
import { getPosEvents } from '../services/api';
import {
  ClipboardList, Search, RefreshCw, ChevronLeft,
  ChevronRight, AlertCircle,
} from 'lucide-react';
import './PosEventLog.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

const toLocalDateStr = (d = new Date()) => {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

const shiftDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
};

const EVENT_LABELS = {
  no_sale: 'No Sale',
};

const EVENT_CLASS = (type) => {
  if (type === 'no_sale') return 'pel-event-no-sale';
  return 'pel-event-default';
};

const PER_PAGE = 50;

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PosEventLog({ embedded }) {
  const today   = toLocalDateStr();
  const setup   = useSetupStatus();

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [dateFrom,   setDateFrom]   = useState(shiftDays(today, -6));
  const [dateTo,     setDateTo]     = useState(today);
  const [search,     setSearch]     = useState('');
  const [fEventType, setFEventType] = useState('');
  const [fStoreId,   setFStoreId]   = useState('');

  // ── Data ──────────────────────────────────────────────────────────────────────
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);

  // ── Load ──────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPage(1);
    try {
      const params = { dateFrom, dateTo, limit: 500 };
      if (fEventType) params.eventType = fEventType;
      if (fStoreId)   params.storeId   = fStoreId;

      const data = await getPosEvents(params);
      const list = Array.isArray(data) ? data : (data.events || []);
      setEvents(list);
      setTotal(data.total || list.length);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to load events');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, fEventType, fStoreId]);

  useEffect(() => { load(); }, [load]);

  // ── Client-side text search ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return events;
    const q = search.toLowerCase();
    return events.filter(e =>
      (e.cashierName  || '').toLowerCase().includes(q) ||
      (e.stationName  || '').toLowerCase().includes(q) ||
      (e.stationId    || '').toLowerCase().includes(q) ||
      (e.storeName    || '').toLowerCase().includes(q) ||
      (e.note         || '').toLowerCase().includes(q) ||
      (EVENT_LABELS[e.eventType] || e.eventType || '').toLowerCase().includes(q)
    );
  }, [events, search]);

  // ── Summary ───────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:   filtered.length,
    noSale:  filtered.filter(e => e.eventType === 'no_sale').length,
    stores:  [...new Set(filtered.map(e => e.storeId).filter(Boolean))].length,
    cashiers:[...new Set(filtered.map(e => e.cashierName).filter(Boolean))].length,
  }), [filtered]);

  // ── Pagination ────────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // ── Presets ───────────────────────────────────────────────────────────────────
  const setPreset = (n) => { setDateFrom(shiftDays(today, n)); setDateTo(today); setPage(1); };

  const content = (
    <>

        {/* Header */}
        <div className="pel-header">
          <div className="pel-header-left">
            <ClipboardList size={22} className="pel-header-icon" />
            <div>
              <h1 className="pel-title">POS Event Log</h1>
              <p className="pel-subtitle">Cash drawer openings, No Sale, and other POS events</p>
            </div>
          </div>
          <button className="pel-btn" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'pel-spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {/* Filter bar */}
        <div className="pel-filter-bar">

          {/* Text search */}
          <div className="pel-search-wrap">
            <Search size={13} className="pel-search-icon" />
            <input
              className="pel-input"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search cashier, station, note…"
            />
          </div>

          {/* Date range */}
          <input
            type="date" className="pel-date-input"
            value={dateFrom} max={today}
            onChange={e => { setDateFrom(e.target.value); setPage(1); }}
          />
          <span className="pel-date-sep">→</span>
          <input
            type="date" className="pel-date-input"
            value={dateTo} min={dateFrom} max={today}
            onChange={e => { setDateTo(e.target.value); setPage(1); }}
          />

          {/* Presets */}
          <button className="pel-btn" onClick={() => setPreset(0)}>Today</button>
          <button className="pel-btn" onClick={() => setPreset(-6)}>7 days</button>
          <button className="pel-btn" onClick={() => setPreset(-29)}>30 days</button>

          {/* Event type */}
          <select
            className="pel-select"
            value={fEventType}
            onChange={e => { setFEventType(e.target.value); setPage(1); }}
          >
            <option value="">All Events</option>
            <option value="no_sale">No Sale</option>
          </select>

          {/* Store filter */}
          {setup.stores?.length > 1 && (
            <select
              className="pel-select"
              value={fStoreId}
              onChange={e => { setFStoreId(e.target.value); setPage(1); }}
            >
              <option value="">All Stores</option>
              {setup.stores.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="pel-error">
            <AlertCircle size={15} /> {error}
          </div>
        )}

        {/* Summary cards */}
        <div className="pel-summary">
          <div className="pel-summary-card">
            <div className="pel-summary-label">Total Events</div>
            <div className="pel-summary-value accent">{stats.total}</div>
          </div>
          <div className="pel-summary-card">
            <div className="pel-summary-label">No Sale</div>
            <div className="pel-summary-value">{stats.noSale}</div>
          </div>
          <div className="pel-summary-card">
            <div className="pel-summary-label">Cashiers</div>
            <div className="pel-summary-value">{stats.cashiers}</div>
          </div>
          {setup.stores?.length > 1 && (
            <div className="pel-summary-card">
              <div className="pel-summary-label">Stores</div>
              <div className="pel-summary-value">{stats.stores}</div>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="pel-table-card">
          {loading ? (
            <div className="pel-empty">
              <div className="pel-empty-icon"><RefreshCw size={28} className="pel-spin" /></div>
              Loading events…
            </div>
          ) : paginated.length === 0 ? (
            <div className="pel-empty">
              <div className="pel-empty-icon"><ClipboardList size={32} /></div>
              {events.length === 0 ? 'No events found for this period.' : 'No results match your search.'}
            </div>
          ) : (
            <>
              <div className="pel-table-header">
                <span>Date / Time</span>
                <span>Event</span>
                <span>Store</span>
                <span>Cashier</span>
                <span>Station</span>
                <span>Note</span>
              </div>

              {paginated.map(ev => (
                <div key={ev.id} className="pel-table-row">
                  <div>
                    <div className="pel-cell-time">
                      {new Date(ev.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </div>
                    <div className="pel-cell-time">
                      {new Date(ev.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                  </div>
                  <div>
                    <span className={`pel-event-badge ${EVENT_CLASS(ev.eventType)}`}>
                      {EVENT_LABELS[ev.eventType] || ev.eventType}
                    </span>
                  </div>
                  <div className="pel-cell-text">{ev.storeName || ev.storeId || '—'}</div>
                  <div className="pel-cell-text">{ev.cashierName || '—'}</div>
                  <div className="pel-cell-text">{ev.stationName || ev.stationId || '—'}</div>
                  <div className="pel-cell-note">{ev.note || '—'}</div>
                </div>
              ))}

              {totalPages > 1 && (
                <div className="pel-pagination">
                  <button
                    className="pel-btn pel-btn-icon"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="pel-page-info">
                    Page {page} of {totalPages} · {filtered.length} results
                  </span>
                  <button
                    className="pel-btn pel-btn-icon"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

    </>
  );

  if (embedded) return <div className="p-tab-content">{content}</div>;

  return (
    <div className="layout-container">
      <Sidebar />
      <div className="main-content pel-page">
        {content}
      </div>
    </div>
  );
}
