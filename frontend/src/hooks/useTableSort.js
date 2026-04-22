/**
 * useTableSort — tiny utility for up/down sortable table columns.
 *
 * Usage:
 *   const { sortKey, sortDir, toggleSort, sorted } = useTableSort(rows, {
 *     initial: 'name',
 *     accessors: {
 *       name:   (r) => r.name,
 *       total:  (r) => Number(r.grandTotal || 0),
 *       date:   (r) => new Date(r.createdAt),
 *     },
 *   });
 *   <SortableHeader label="Name"  sortKey="name"  tableSort={{ sortKey, sortDir, toggleSort }} />
 *   {sorted.map(r => ...)}
 *
 * If `accessors` is omitted, the hook falls back to reading `row[sortKey]` directly.
 *
 * Session 39 Round 3 — user asked for up/down-arrow column sort on every table
 * across the platform. This hook + the `SortableHeader` component are the
 * shared building blocks; each table wires them up in one or two lines.
 */

import { useMemo, useState } from 'react';

export function useTableSort(rows, opts = {}) {
  const {
    initial = null,
    initialDir = 'asc',
    accessors,
    // Session 39 Round 4 — when true, the hook manages state only; the
    // caller is responsible for re-fetching sorted data from the server.
    // `sorted` is returned unchanged. Use this on paginated tables where
    // client-side sort would only cover the current page.
    serverSide = false,
  } = opts;
  const [sortKey, setSortKey] = useState(initial);
  const [sortDir, setSortDir] = useState(initialDir);

  const toggleSort = (key) => {
    if (key === sortKey) {
      // Same column tapped — flip asc ↔ desc. Third tap clears the sort.
      if (sortDir === 'asc')  { setSortDir('desc'); }
      else if (sortDir === 'desc') { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    // `serverSide` accepts a boolean OR a (sortKey) → boolean function so
    // callers can opt-in per-column (e.g. Products does server-side sort
    // for name/pack/cost/retail/dept/vendor but client-side for margin/onHand).
    const serverActive = typeof serverSide === 'function' ? serverSide(sortKey) : !!serverSide;
    if (serverActive) return rows; // Backend already sorted; don't re-sort.
    if (!sortKey || !Array.isArray(rows) || rows.length === 0) return rows;
    const get = (r) => (accessors && accessors[sortKey])
      ? accessors[sortKey](r)
      : (r && r[sortKey]);
    const sign = sortDir === 'desc' ? -1 : 1;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      // null/undefined always sort last regardless of direction
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
      if (av instanceof Date && bv instanceof Date)         return (av - bv) * sign;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * sign;
    });
    return copy;
  }, [rows, sortKey, sortDir, accessors, serverSide]);

  return { sortKey, sortDir, toggleSort, sorted };
}
