/**
 * TasksPanel — Slide-in panel for cashier to view/update tasks + checklist.
 * Accessible from the POS ActionBar.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  X, CheckSquare, Square, Clock, AlertCircle, ChevronDown, ChevronUp,
  MessageSquare, RefreshCw, Loader,
} from 'lucide-react';
import api from '../../api/client.js';
import './TasksPanel.css';

const PRIORITY_COLORS = { urgent: '#ef4444', high: '#f59e0b', normal: '#3b82f6', low: '#64748b' };
const STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', completed: 'Done', cancelled: 'Cancelled' };

export default function TasksPanel({ onClose }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [noteInputs, setNoteInputs] = useState({});
  const [saving, setSaving] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/tasks/my');
      setTasks(res.data?.tasks || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleChecklist = async (taskId, checklistIdx) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const checklist = [...(task.checklist || [])];
    const item = { ...checklist[checklistIdx] };
    item.done = !item.done;
    item.completedAt = item.done ? new Date().toISOString() : null;
    checklist[checklistIdx] = item;

    setSaving(s => ({ ...s, [taskId]: true }));
    try {
      await api.put(`/tasks/${taskId}`, { checklist });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, checklist } : t));
    } catch { /* ignore */ }
    finally { setSaving(s => ({ ...s, [taskId]: false })); }
  };

  const updateStatus = async (taskId, status) => {
    setSaving(s => ({ ...s, [taskId]: true }));
    try {
      await api.put(`/tasks/${taskId}`, { status });
      if (status === 'completed') {
        setTasks(prev => prev.filter(t => t.id !== taskId));
      } else {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
      }
    } catch { /* ignore */ }
    finally { setSaving(s => ({ ...s, [taskId]: false })); }
  };

  const addNote = async (taskId) => {
    const note = noteInputs[taskId]?.trim();
    if (!note) return;
    const task = tasks.find(t => t.id === taskId);
    const newDesc = (task?.description || '') + `\n[${new Date().toLocaleString()}] ${note}`;
    setSaving(s => ({ ...s, [taskId]: true }));
    try {
      await api.put(`/tasks/${taskId}`, { description: newDesc });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, description: newDesc } : t));
      setNoteInputs(prev => ({ ...prev, [taskId]: '' }));
    } catch { /* ignore */ }
    finally { setSaving(s => ({ ...s, [taskId]: false })); }
  };

  const openCount = tasks.filter(t => t.status === 'open' || t.status === 'in_progress').length;
  const checklistProgress = (checklist) => {
    if (!Array.isArray(checklist) || checklist.length === 0) return null;
    const done = checklist.filter(i => i.done).length;
    return { done, total: checklist.length, pct: Math.round((done / checklist.length) * 100) };
  };

  return (
    <div className="tp-overlay" onClick={onClose}>
      <div className="tp-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="tp-header">
          <div className="tp-header-left">
            <CheckSquare size={16} color="var(--green)" />
            <span className="tp-header-title">My Tasks</span>
            {openCount > 0 && <span className="tp-badge">{openCount}</span>}
          </div>
          <div className="tp-header-right">
            <button className="tp-icon-btn" onClick={load}><RefreshCw size={14} /></button>
            <button className="tp-icon-btn" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        {/* Tasks list */}
        <div className="tp-body">
          {loading && <div className="tp-loading"><Loader size={14} className="tp-spin" /> Loading tasks...</div>}

          {!loading && tasks.length === 0 && (
            <div className="tp-empty">
              <CheckSquare size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
              <div>No tasks assigned to you</div>
            </div>
          )}

          {tasks.map(task => {
            const isExpanded = expandedId === task.id;
            const progress = checklistProgress(task.checklist);
            const prColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.normal;

            return (
              <div key={task.id} className="tp-task" style={{ borderLeftColor: prColor }}>
                {/* Task header */}
                <div className="tp-task-header" onClick={() => setExpandedId(isExpanded ? null : task.id)}>
                  <div className="tp-task-info">
                    <div className="tp-task-title">{task.title}</div>
                    <div className="tp-task-meta">
                      <span className="tp-priority" style={{ color: prColor }}>{task.priority}</span>
                      {task.category && <span>· {task.category}</span>}
                      {task.stationName && <span>· {task.stationName}</span>}
                      {task.dueDate && <span>· Due {new Date(task.dueDate).toLocaleDateString()}</span>}
                    </div>
                    {progress && (
                      <div className="tp-progress">
                        <div className="tp-progress-bar">
                          <div className="tp-progress-fill" style={{ width: `${progress.pct}%` }} />
                        </div>
                        <span className="tp-progress-text">{progress.done}/{progress.total}</span>
                      </div>
                    )}
                  </div>
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="tp-task-detail">
                    {/* Description */}
                    {task.description && (
                      <div className="tp-description">{task.description}</div>
                    )}

                    {/* Checklist */}
                    {Array.isArray(task.checklist) && task.checklist.length > 0 && (
                      <div className="tp-checklist">
                        {task.checklist.map((item, idx) => (
                          <label key={item.id || idx} className={`tp-check-item ${item.done ? 'tp-check-item--done' : ''}`}>
                            <input
                              type="checkbox"
                              checked={item.done}
                              onChange={() => toggleChecklist(task.id, idx)}
                              className="tp-check-cb"
                            />
                            <span className={item.done ? 'tp-check-text--done' : ''}>{item.text}</span>
                          </label>
                        ))}
                      </div>
                    )}

                    {/* Add note */}
                    <div className="tp-note-row">
                      <input
                        className="tp-note-input"
                        placeholder="Add a note..."
                        value={noteInputs[task.id] || ''}
                        onChange={e => setNoteInputs(prev => ({ ...prev, [task.id]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && addNote(task.id)}
                      />
                      <button className="tp-note-btn" onClick={() => addNote(task.id)} disabled={!noteInputs[task.id]?.trim()}>
                        <MessageSquare size={12} />
                      </button>
                    </div>

                    {/* Status actions */}
                    <div className="tp-actions">
                      {task.status === 'open' && (
                        <button className="tp-action-btn tp-action-btn--progress" onClick={() => updateStatus(task.id, 'in_progress')}>
                          Start Working
                        </button>
                      )}
                      {(task.status === 'open' || task.status === 'in_progress') && (
                        <button className="tp-action-btn tp-action-btn--complete" onClick={() => updateStatus(task.id, 'completed')} disabled={saving[task.id]}>
                          {saving[task.id] ? <Loader size={12} className="tp-spin" /> : <CheckSquare size={12} />}
                          Mark Complete
                        </button>
                      )}
                    </div>

                    <div className="tp-assigned-by">
                      Assigned by {task.assignerName || 'Manager'}
                      {task.isRecurring && <span className="tp-recurring-tag">🔁 Recurring</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
