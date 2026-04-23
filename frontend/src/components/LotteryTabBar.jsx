/**
 * LotteryTabBar — shared top tab strip for every lottery view.
 *
 * Single source of truth for the /portal/lottery tab navigation. Used by
 * both LotteryBackOffice (the Daily 3-column view) and Lottery.jsx (the
 * "advanced" / legacy tabs — Shift Reports, Weekly Settlement, Reports,
 * Commission, Settings, Ticket Catalog).
 *
 * Each tab is a URL search param (`?tab=daily`, `?tab=settings`, etc.) so
 * a page refresh preserves the user's selected tab — fixing the UX bug
 * reported April 23. Deep links like /portal/lottery?tab=reports&from=...
 * work too.
 *
 * The PERMISSION_DEFS filters tabs by user role — admin-only tabs like
 * Ticket Catalog don't show up for cashier accounts.
 */

import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Ticket, FileText, ListChecks, Settings2, BookOpen, Receipt, BarChart2,
} from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import './LotteryTabBar.css';

// Tab registry. `admin: true` means the tab only renders for users with
// `lottery.manage` (admin/owner/superadmin). Everything else is visible
// to any user with `lottery.view`.
//
// NOTE (April 2026): removed 'Games' — store-level games are managed via
// the Ticket Catalog (admin) + Receive Books flow. A standalone Games
// view would duplicate functionality that already exists elsewhere.
const TABS = [
  { key: 'daily',            label: 'Daily',             icon: Ticket,      admin: false },
  { key: 'shift-reports',    label: 'Shift Reports',     icon: FileText,    admin: false },
  { key: 'weekly',           label: 'Weekly Settlement', icon: ListChecks,  admin: false },
  { key: 'reports',          label: 'Reports',           icon: BarChart2,   admin: false },
  { key: 'commission',       label: 'Commission',        icon: Receipt,     admin: false },
  { key: 'catalog',          label: 'Ticket Catalog',    icon: BookOpen,    admin: true  },
  { key: 'settings',         label: 'Settings',          icon: Settings2,   admin: false },
];

export default function LotteryTabBar({ active }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeKey = active || searchParams.get('tab') || 'daily';
  const { can } = usePermissions();
  const isAdmin = can('lottery.manage');

  const visible = useMemo(
    () => TABS.filter(t => !t.admin || isAdmin),
    [isAdmin]
  );

  const switchTo = (key) => {
    // When switching tabs, keep the store/date if they were set, but drop
    // daily-only params (`pane`, `mode`) that don't apply to other views.
    const next = new URLSearchParams();
    next.set('tab', key);
    const keep = ['date', 'storeId', 'from', 'to'];
    for (const k of keep) {
      const v = searchParams.get(k);
      if (v) next.set(k, v);
    }
    setSearchParams(next);
  };

  return (
    <div className="lotabs" role="tablist" aria-label="Lottery sections">
      {visible.map(t => {
        const Icon = t.icon;
        const isActive = t.key === activeKey;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`lotabs-btn ${isActive ? 'lotabs-btn--active' : ''}`}
            onClick={() => switchTo(t.key)}
          >
            <Icon size={14} />
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export { TABS as LOTTERY_TABS };
