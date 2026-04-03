export const fmt$ = (n) =>
  n == null ? '—' : '$' + Number(n).toFixed(2);

export const fmtQty = (n) =>
  Number.isInteger(n) ? String(n) : Number(n).toFixed(2);

export const fmtDate = (d) => {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const fmtTime = (d) => {
  const date = d ? (d instanceof Date ? d : new Date(d)) : new Date();
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

export const fmtTxNumber = (n) => n || '—';
