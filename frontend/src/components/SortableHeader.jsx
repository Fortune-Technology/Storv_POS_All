/**
 * SortableHeader — renders a `<th>` whose label toggles sort on click.
 * Partner to `useTableSort` hook. Modern/simple up-down arrow design.
 *
 * Usage in a table:
 *   const sort = useTableSort(rows, { accessors });
 *   <thead><tr>
 *     <SortableHeader label="Name"   sortKey="name"  sort={sort} />
 *     <SortableHeader label="Total"  sortKey="total" sort={sort} align="right" />
 *   </tr></thead>
 *   <tbody>{sort.sorted.map(...)}</tbody>
 *
 * Pass `sortable={false}` to render a plain non-interactive header cell
 * (useful for action columns).
 */

import React from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import './SortableHeader.css';

export default function SortableHeader({
  label,
  sortKey,
  sort,
  align = 'left',
  sortable = true,
  children,
  style,
}) {
  if (!sortable || !sort) {
    return (
      <th className={`sth-th sth-th--${align}`} style={style}>
        {label}
        {children}
      </th>
    );
  }

  const active = sort.sortKey === sortKey;
  const Icon = !active ? ArrowUpDown
    : sort.sortDir === 'asc' ? ArrowUp
    : ArrowDown;

  return (
    <th
      className={`sth-th sth-th--${align} sth-th--sortable${active ? ' sth-th--active' : ''}`}
      onClick={() => sort.toggleSort(sortKey)}
      style={style}
      title={active
        ? (sort.sortDir === 'asc' ? 'Sorted ascending — click to sort descending' : 'Sorted descending — click to clear sort')
        : 'Click to sort'}
    >
      <span className="sth-th-inner">
        <span className="sth-th-label">{label}</span>
        <Icon size={12} className={`sth-th-icon${active ? ' sth-th-icon--active' : ''}`} />
      </span>
      {children}
    </th>
  );
}
