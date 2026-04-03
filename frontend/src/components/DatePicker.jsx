import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

const MONTHS = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}
function toISO(d) { return d.toISOString().slice(0, 10); }

export default function DatePicker({ value, onChange, label, minDate, maxDate }) {
  const [open, setOpen]   = useState(false);
  const [view, setView]   = useState(() => {
    const d = value ? new Date(value + 'T00:00:00') : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const todayStr = toISO(new Date());

  const selectDay = (day) => {
    const selected = new Date(view.year, view.month, day);
    onChange(toISO(selected));
    setOpen(false);
  };

  const prevMonth = () => setView(v => {
    if (v.month === 0) return { year: v.year - 1, month: 11 };
    return { ...v, month: v.month - 1 };
  });
  const nextMonth = () => setView(v => {
    if (v.month === 11) return { year: v.year + 1, month: 0 };
    return { ...v, month: v.month + 1 };
  });

  const daysInMonth  = getDaysInMonth(view.year, view.month);
  const firstDay     = getFirstDayOfMonth(view.year, view.month);
  const selectedDate = value ? new Date(value + 'T00:00:00') : null;

  const isSelected = (day) => {
    if (!selectedDate) return false;
    return selectedDate.getFullYear() === view.year &&
           selectedDate.getMonth() === view.month &&
           selectedDate.getDate() === day;
  };

  const isToday = (day) => {
    const d = new Date(view.year, view.month, day);
    return toISO(d) === todayStr;
  };

  const isDisabled = (day) => {
    const d = toISO(new Date(view.year, view.month, day));
    if (minDate && d < minDate) return true;
    if (maxDate && d > maxDate) return true;
    return false;
  };

  const displayValue = value
    ? new Date(value + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Select date';

  return (
    <div ref={ref} className="dp-wrapper">
      {label && <span className="dp-label">{label}</span>}
      <button className="dp-trigger" onClick={() => setOpen(o => !o)}>
        <Calendar size={14} style={{ opacity: 0.6 }} />
        <span>{displayValue}</span>
      </button>

      {open && (
        <div className="dp-dropdown">
          {/* Header */}
          <div className="dp-header">
            <button className="dp-nav-btn" onClick={prevMonth}><ChevronLeft size={15} /></button>
            <span className="dp-month-label">{MONTHS[view.month]} {view.year}</span>
            <button className="dp-nav-btn" onClick={nextMonth}><ChevronRight size={15} /></button>
          </div>

          {/* Day names */}
          <div className="dp-grid">
            {DAYS.map(d => <div key={d} className="dp-day-name">{d}</div>)}

            {/* Empty cells before first day */}
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}

            {/* Days */}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => (
              <button
                key={day}
                className={`dp-day${isSelected(day) ? ' selected' : ''}${isToday(day) ? ' today' : ''}${isDisabled(day) ? ' disabled' : ''}`}
                onClick={() => !isDisabled(day) && selectDay(day)}
                disabled={isDisabled(day)}
              >
                {day}
              </button>
            ))}
          </div>

          {/* Today shortcut */}
          <div className="dp-footer">
            <button className="dp-today-btn" onClick={() => { onChange(todayStr); setOpen(false); }}>Today</button>
          </div>
        </div>
      )}
    </div>
  );
}
