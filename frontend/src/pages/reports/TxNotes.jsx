/**
 * TxNotes — list of transactions where the cashier left a note.
 *
 * Extracted from the legacy ReportsHub→Notes tab (Session 64). Mounted as
 * a 5th tab in POSReports. Useful for spotting unusual transactions
 * (price overrides, voided items, customer complaints) by their notes.
 * `embedded` prop strips the page wrapper.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Download, FileText, RefreshCw, Loader, MessageSquare,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { getReportNotes } from '../../services/api';
import { downloadCSV, downloadPDF } from '../../utils/exportUtils';
import '../../styles/portal.css';
import './reports-shared.css';

const fmt    = (n) => n == null ? '--' : `$${Number(n).toFixed(2)}`;
const fmtNum = (n) => n == null ? '--' : Number(n).toLocaleString();
const txt    = (v) => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') return v.name || v.label || v.code || v.id || '';
  return String(v);
};

const toDateStr  = (d) => d.toISOString().slice(0, 10);
const todayStr   = () => toDateStr(new Date());
const daysAgoStr = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toDateStr(d); };

function StatCard({ label, value }) {
  return (
    <div className="p-stat-card">
      <div className="p-stat-card-label">{label}</div>
      <div className="p-stat-card-value">{value}</div>
    </div>
  );
}

export default function TxNotes({ embedded = false }) {
  const [from, setFrom] = useState(daysAgoStr(7));
  const [to,   setTo]   = useState(todayStr());
  const [notesData, setNotesData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchNotes = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getReportNotes({ from, to });
      setNotesData(data);
    } catch (err) {
      toast.error(`Failed to load notes: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    fetchNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notes = notesData?.notes || [];

  const notesCols = [
    { key: 'date',     label: 'Date' },
    { key: 'txNumber', label: 'Tx#' },
    { key: 'total',    label: 'Amount' },
    { key: 'notes',    label: 'Notes' },
    { key: 'cashierId', label: 'Cashier' },
  ];

  const Body = (
    <>
      <div className="rh-controls">
        <div className="p-field">
          <label className="p-field-label">From</label>
          <input type="date" className="p-input" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="p-field">
          <label className="p-field-label">To</label>
          <input type="date" className="p-input" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <button className="p-btn p-btn-primary p-btn-sm" onClick={fetchNotes} disabled={loading}>
          {loading ? <><Loader size={14} className="p-spin" /> Running…</> : <><RefreshCw size={14} /> Run</>}
        </button>
      </div>

      {!notesData && !loading && (
        <div className="p-empty">No data loaded yet.</div>
      )}
      {loading && !notesData && (
        <div className="p-loading"><Loader size={16} className="p-spin" /> Loading notes…</div>
      )}

      {notesData && (
        <>
          <div className="p-stat-grid">
            <StatCard label="Transactions with Notes" value={fmtNum(notes.length)} />
            <StatCard label="Total Amount"            value={fmt(notesData.total)} />
          </div>

          <div className="rh-section">
            <div className="rh-section-title">Transaction Notes</div>
            <div className="p-table-wrap">
              <table className="p-table">
                <thead>
                  <tr><th>Date</th><th>Tx#</th><th>Amount</th><th>Notes</th><th>Cashier</th></tr>
                </thead>
                <tbody>
                  {notes.map((n, i) => (
                    <tr key={i}>
                      <td>{txt(n.date)}</td>
                      <td className="p-td-strong">{txt(n.txNumber)}</td>
                      <td>{fmt(n.total)}</td>
                      <td>{txt(n.notes)}</td>
                      <td>{txt(n.cashierId)}</td>
                    </tr>
                  ))}
                  {!notes.length && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No transaction notes found</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rh-export-row">
            <button className="p-btn p-btn-ghost p-btn-sm" onClick={() => downloadCSV(notes, notesCols, 'tx-notes')}>
              <Download size={14} /> CSV
            </button>
            <button className="p-btn p-btn-ghost p-btn-sm" onClick={() => downloadPDF({
              title: 'Transaction Notes', subtitle: `${from} to ${to}`,
              summary: [
                { label: 'Total Notes',  value: fmtNum(notes.length) },
                { label: 'Total Amount', value: fmt(notesData.total) },
              ],
              data: notes, columns: notesCols, filename: 'tx-notes',
            })}>
              <FileText size={14} /> PDF
            </button>
          </div>
        </>
      )}
    </>
  );

  if (embedded) return Body;

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><MessageSquare size={22} /></div>
          <div>
            <h1 className="p-title">Transaction Notes</h1>
            <p className="p-subtitle">All transactions where a note was attached</p>
          </div>
        </div>
      </div>
      {Body}
    </div>
  );
}
