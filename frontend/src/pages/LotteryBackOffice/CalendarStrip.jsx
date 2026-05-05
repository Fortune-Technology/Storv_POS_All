// CalendarStrip — scrollable horizontally, past dates only.
// Extracted from LotteryBackOffice (May 2026 split).
import React, { useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { toDateStr } from './utils.js';

export default function CalendarStrip({ value, onChange }) {
  const [offset, setOffset] = useState(0);   // days from today (0 = today)
  const DAYS_VISIBLE = 14;                   // ~ one scrolling window
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Build DAYS_VISIBLE days ending at today-offset
  const days = useMemo(() => {
    const arr = [];
    for (let i = DAYS_VISIBLE - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - (offset + i));
      arr.push(d);
    }
    return arr;
  }, [offset, today]);

  const canForward = offset > 0;

  return (
    <div className="lbo-cal-strip">
      <button className="lbo-cal-nav" onClick={() => setOffset(o => o + DAYS_VISIBLE)} title="Earlier">
        <ChevronLeft size={14} />
      </button>
      <div className="lbo-cal-days">
        {days.map(d => {
          const str = toDateStr(d);
          const isSel = str === value;
          const dow = d.toLocaleDateString(undefined, { weekday: 'short' });
          const month = d.toLocaleDateString(undefined, { month: 'short' });
          return (
            <button
              key={str}
              className={`lbo-cal-day ${isSel ? 'sel' : ''} ${str === toDateStr(today) ? 'today' : ''}`}
              onClick={() => onChange(str)}
              title={`${dow}, ${month} ${d.getDate()}`}
            >
              <span className="lbo-cal-dow">{dow}</span>
              <span className="lbo-cal-date">{d.getDate()}</span>
            </button>
          );
        })}
      </div>
      <button className="lbo-cal-nav" onClick={() => setOffset(o => Math.max(0, o - DAYS_VISIBLE))} disabled={!canForward} title="Later">
        <ChevronRight size={14} />
      </button>
      <div className="lbo-cal-today-btn">
        <button onClick={() => { setOffset(0); onChange(toDateStr(today)); }} title="Jump to today">
          <Calendar size={13} /> Today
        </button>
      </div>
    </div>
  );
}
