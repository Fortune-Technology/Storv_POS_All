import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckSquare, Plus, X, Loader, Trash2, ChevronDown, ChevronUp,
  AlertTriangle, Clock, Circle, CheckCircle, XCircle, Calendar,
  RefreshCw, List,
} from 'lucide-react';
import { toast } from 'react-toastify';

import {
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  getTaskCounts,
  getStoreEmployees,
  getTenantUsers,
} from '../services/api';
import { fmtDate } from '../utils/formatters';
import '../styles/portal.css';
import './TasksPage.css';

/* ── Helpers ────────────────────────────────────────────────────────────── */

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const PRIORITY_META = {
  urgent: { label: 'Urgent', cls: 'p-badge-red' },
  high:   { label: 'High',   cls: 'p-badge-amber' },
  normal: { label: 'Normal', cls: 'p-badge-blue' },
  low:    { label: 'Low',    cls: 'p-badge-gray' },
};

const STATUS_META = {
  open:        { label: 'Open',        cls: 'p-badge-blue',  icon: <Circle size={11} /> },
  in_progress: { label: 'In Progress', cls: 'p-badge-amber', icon: <Clock size={11} /> },
  completed:   { label: 'Completed',   cls: 'p-badge-green', icon: <CheckCircle size={11} /> },
  cancelled:   { label: 'Cancelled',   cls: 'p-badge-gray',  icon: <XCircle size={11} /> },
};

const CATEGORIES = ['Cleaning', 'Stocking', 'Display', 'Inventory', 'Other'];
const STATUSES   = ['open', 'in_progress', 'completed', 'cancelled'];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const RECUR_TYPES = [
  { value: 'daily',    label: 'Daily' },
  { value: 'weekly',   label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-Weekly' },
  { value: 'monthly',  label: 'Monthly' },
];
const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/* ── Checklist Progress Bar (inline) ──────────────────────────────────── */
const ChecklistProgress = ({ checklist }) => {
  if (!checklist || checklist.length === 0) return null;
  const done = checklist.filter(i => i.done).length;
  const total = checklist.length;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="tk-checklist-progress">
      <div className="tk-checklist-progress-bar">
        <div className="tk-checklist-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="tk-checklist-progress-text">{done}/{total} completed</span>
    </div>
  );
};

/* ── New / Edit Task Modal ──────────────────────────────────────────────── */
const TaskModal = ({ task, onClose, onSaved, employees }) => {
  const isEdit = !!task;
  const [form, setForm] = useState({
    title:       task?.title || '',
    description: task?.description || '',
    priority:    task?.priority || 'normal',
    category:    task?.category || 'Other',
    assigneeId:  task?.assigneeId || task?.assignee_id || '',
    dueDate:     task?.dueDate ? task.dueDate.slice(0, 10) : task?.due_date ? task.due_date.slice(0, 10) : '',
    storeId:     task?.storeId || task?.store_id || '',
  });
  const [saving, setSaving] = useState(false);

  /* Checklist state */
  const [checklist, setChecklist] = useState(
    task?.checklist ? task.checklist.map(item => ({ ...item })) : []
  );
  const [newItemText, setNewItemText] = useState('');

  /* Recurring state */
  const [isRecurring, setIsRecurring] = useState(task?.isRecurring || false);
  const [recurType, setRecurType] = useState(task?.recurType || 'daily');
  const [recurDays, setRecurDays] = useState(task?.recurDays || []);
  const [recurTime, setRecurTime] = useState(task?.recurTime || '09:00');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  /* Checklist handlers */
  const addChecklistItem = () => {
    const text = newItemText.trim();
    if (!text) return;
    setChecklist(prev => [...prev, { id: genId(), text, done: false, completedAt: null, completedBy: null }]);
    setNewItemText('');
  };

  const removeChecklistItem = (itemId) => {
    setChecklist(prev => prev.filter(i => i.id !== itemId));
  };

  const handleChecklistKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); }
  };

  /* Recurring day toggle */
  const toggleRecurDay = (day) => {
    setRecurDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        checklist,
        isRecurring,
        ...(isRecurring ? { recurType, recurDays, recurTime, recurDayOfMonth: form.recurDayOfMonth || null } : { recurType: null, recurDays: [], recurTime: null, recurDayOfMonth: null }),
      };
      if (isEdit) {
        await updateTask(task.id || task._id, payload);
        toast.success('Task updated');
      } else {
        await createTask(payload);
        toast.success('Task created');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save task');
    } finally { setSaving(false); }
  };

  return (
    <div className="p-modal-overlay" onClick={onClose}>
      <div className="p-modal p-modal-lg" onClick={e => e.stopPropagation()}>
        <div className="p-modal-header">
          <h2 className="p-modal-title">{isEdit ? 'Edit Task' : 'New Task'}</h2>
          <button className="p-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-field">
            <label className="p-field-label">Title *</label>
            <input className="p-input" value={form.title} onChange={e => set('title', e.target.value)} required />
          </div>

          <div className="p-field">
            <label className="p-field-label">Description</label>
            <textarea className="p-input tk-textarea" rows={3} value={form.description} onChange={e => set('description', e.target.value)} />
          </div>

          <div className="p-field-row">
            <div className="p-field">
              <label className="p-field-label">Priority</label>
              <select className="p-select" value={form.priority} onChange={e => set('priority', e.target.value)}>
                {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
              </select>
            </div>
            <div className="p-field">
              <label className="p-field-label">Category</label>
              <select className="p-select" value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="p-field-row">
            <div className="p-field">
              <label className="p-field-label">Assign To</label>
              <select className="p-select" value={form.assigneeId} onChange={e => set('assigneeId', e.target.value)}>
                <option value="">Unassigned</option>
                {employees.map(emp => (
                  <option key={emp.id || emp._id} value={emp.id || emp._id}>
                    {emp.name || emp.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="p-field">
              <label className="p-field-label">Due Date</label>
              <input className="p-input" type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
            </div>
          </div>

          {/* ── Checklist Section ────────────────────────────────────── */}
          <div className="p-field tk-modal-section">
            <label className="p-field-label"><List size={13} /> Checklist</label>
            <div className="tk-checklist-add-row">
              <input
                className="p-input tk-checklist-input"
                placeholder="Add checklist item..."
                value={newItemText}
                onChange={e => setNewItemText(e.target.value)}
                onKeyDown={handleChecklistKeyDown}
              />
              <button type="button" className="p-btn p-btn-sm p-btn-primary" onClick={addChecklistItem}>Add</button>
            </div>
            {checklist.length > 0 && (
              <ul className="tk-checklist-edit-list">
                {checklist.map((item) => (
                  <li key={item.id} className="tk-checklist-edit-item">
                    <span className="tk-checklist-edit-text">{item.text}</span>
                    <button type="button" className="tk-checklist-remove-btn" onClick={() => removeChecklistItem(item.id)}>
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Recurring Schedule Section ───────────────────────────── */}
          <div className="p-field tk-modal-section">
            <label className="p-field-label"><RefreshCw size={13} /> Schedule</label>
            <div className="tk-recurring-toggle">
              <label className="tk-toggle-label">
                <input
                  type="checkbox"
                  className="tk-toggle-checkbox"
                  checked={isRecurring}
                  onChange={e => setIsRecurring(e.target.checked)}
                />
                <span className="tk-toggle-switch" />
                <span className="tk-toggle-text">Recurring Task</span>
              </label>
            </div>

            {isRecurring && (
              <div className="tk-recurring-options">
                <div className="p-field-row">
                  <div className="p-field">
                    <label className="p-field-label">Frequency</label>
                    <select className="p-select" value={recurType} onChange={e => setRecurType(e.target.value)}>
                      {RECUR_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                  <div className="p-field">
                    <label className="p-field-label">Time</label>
                    <input className="p-input" type="time" value={recurTime} onChange={e => setRecurTime(e.target.value)} />
                  </div>
                </div>

                {(recurType === 'weekly' || recurType === 'biweekly') && (
                  <div className="p-field">
                    <label className="p-field-label">Days</label>
                    <div className="tk-day-checkboxes">
                      {DAYS_OF_WEEK.map(day => (
                        <label key={day} className={`tk-day-chip ${recurDays.includes(day) ? 'tk-day-chip-active' : ''}`}>
                          <input
                            type="checkbox"
                            checked={recurDays.includes(day)}
                            onChange={() => toggleRecurDay(day)}
                            className="tk-day-hidden-cb"
                          />
                          {day.slice(0, 3)}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {recurType === 'monthly' && (
                  <div className="p-field">
                    <label className="p-field-label">Day of Month</label>
                    <select className="p-select" value={form.recurDayOfMonth || 1}
                      onChange={e => set('recurDayOfMonth', parseInt(e.target.value))}>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                        <option key={d} value={d}>{d}{d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-form-actions">
            <button type="button" className="p-btn p-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="p-btn p-btn-primary" disabled={saving}>
              {saving ? <><Loader size={13} className="p-spin" /> Saving...</> : isEdit ? 'Update Task' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* ── Main Page ──────────────────────────────────────────────────────────── */
const TasksPage = () => {
  const [tasks, setTasks]           = useState([]);
  const [counts, setCounts]         = useState({ open: 0, in_progress: 0, urgent: 0, my: 0 });
  const [employees, setEmployees]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [statusFilter, setStatusFilter]     = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showTemplates, setShowTemplates]   = useState(false);
  const [expandedId, setExpandedId]         = useState(null);
  const [showModal, setShowModal]           = useState(false);
  const [editTask, setEditTask]             = useState(null);

  /* ── Load data ──────────────────────────────────────────────────────── */
  const loadTasks = useCallback(async () => {
    try {
      const params = {};
      if (statusFilter !== 'all')   params.status   = statusFilter;
      if (priorityFilter !== 'all') params.priority  = priorityFilter;
      if (categoryFilter !== 'all') params.category  = categoryFilter;
      const data = await getTasks(params);
      setTasks(Array.isArray(data) ? data : data.tasks || []);
    } catch { toast.error('Failed to load tasks'); }
  }, [statusFilter, priorityFilter, categoryFilter]);

  const loadCounts = useCallback(async () => {
    try {
      const data = await getTaskCounts();
      setCounts({
        open:        data.open || 0,
        in_progress: data.in_progress || data.inProgress || 0,
        urgent:      data.urgent || 0,
        my:          data.my || data.myTasks || 0,
      });
    } catch { /* silent */ }
  }, []);

  const loadEmployees = useCallback(async () => {
    try {
      let data;
      try { data = await getStoreEmployees(); } catch { data = await getTenantUsers(); }
      const list = Array.isArray(data) ? data : data.employees || data.users || [];
      setEmployees(list);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadTasks(), loadCounts(), loadEmployees()]);
      setLoading(false);
    })();
  }, [loadTasks, loadCounts, loadEmployees]);

  /* ── Actions ────────────────────────────────────────────────────────── */
  const handleStatusChange = async (task, newStatus) => {
    try {
      await updateTask(task.id || task._id, { status: newStatus });
      toast.success('Status updated');
      loadTasks();
      loadCounts();
    } catch { toast.error('Failed to update status'); }
  };

  const handleDelete = async (task) => {
    if (!window.confirm('Delete this task?')) return;
    try {
      await deleteTask(task.id || task._id);
      toast.success('Task deleted');
      loadTasks();
      loadCounts();
    } catch { toast.error('Failed to delete task'); }
  };

  const handleChecklistToggle = async (task, itemId) => {
    const checklist = (task.checklist || []).map(item =>
      item.id === itemId
        ? { ...item, done: !item.done, completedAt: !item.done ? new Date().toISOString() : null }
        : item
    );
    try {
      await updateTask(task.id || task._id, { checklist });
      loadTasks();
    } catch { toast.error('Failed to update checklist'); }
  };

  const handleSaved = () => { loadTasks(); loadCounts(); };

  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id);

  /* ── Derived: filter for templates ──────────────────────────────────── */
  const displayTasks = showTemplates ? tasks.filter(t => t.isRecurring) : tasks;

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="p-page">
      {/* Header */}
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><CheckSquare size={22} /></div>
          <div>
            <h1 className="p-title">Tasks</h1>
            <p className="p-subtitle">Assign and manage store tasks</p>
          </div>
        </div>
        <div className="p-header-actions">
          <button className="p-btn p-btn-primary" onClick={() => { setEditTask(null); setShowModal(true); }}>
            <Plus size={14} /> New Task
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="p-stat-grid">
        <div className="p-stat-card">
          <div className="p-stat-label">Open</div>
          <div className="p-stat-value">{counts.open}</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-label">In Progress</div>
          <div className="p-stat-value">{counts.in_progress}</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-label">Urgent</div>
          <div className="p-stat-value" style={{ color: 'var(--error)' }}>{counts.urgent}</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-label">My Tasks</div>
          <div className="p-stat-value">{counts.my}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="tk-filter-bar">
        <select className="p-select tk-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <select className="p-select tk-filter-select" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
          <option value="all">All Priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
        </select>
        <select className="p-select tk-filter-select" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="all">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button
          className={`p-btn p-btn-sm ${showTemplates ? 'p-btn-primary' : 'p-btn-ghost'}`}
          onClick={() => setShowTemplates(prev => !prev)}
        >
          <RefreshCw size={13} /> Templates
        </button>
      </div>

      {/* Task List */}
      {loading ? (
        <div className="p-loading"><Loader size={14} className="p-spin" /> Loading tasks...</div>
      ) : displayTasks.length === 0 ? (
        <div className="p-empty">
          <CheckSquare size={36} />
          {showTemplates ? 'No recurring templates found.' : 'No tasks found. Create one to get started.'}
        </div>
      ) : (
        <div className="tk-task-list">
          {displayTasks.map(task => {
            const id = task.id || task._id;
            const isExpanded = expandedId === id;
            const pri  = PRIORITY_META[task.priority] || PRIORITY_META.normal;
            const st   = STATUS_META[task.status] || STATUS_META.open;
            const cl   = task.checklist || [];

            return (
              <div key={id} className={`tk-task-card p-card ${isExpanded ? 'tk-expanded' : ''}`}>
                <div className="tk-task-header" onClick={() => toggleExpand(id)}>
                  <div className="tk-task-left">
                    <div className="tk-task-title-row">
                      <span className="tk-task-title">{task.title}</span>
                      {task.isRecurring && <span className="tk-recurring-badge">Recurring</span>}
                    </div>
                    {task.templateId && (
                      <span className="tk-instance-note">Instance of recurring task</span>
                    )}
                    <div className="tk-task-badges">
                      <span className={`p-badge ${pri.cls}`}>{pri.label}</span>
                      <span className={`p-badge ${st.cls}`}>{st.icon} {st.label}</span>
                      {task.category && <span className="p-badge p-badge-brand">{task.category}</span>}
                    </div>
                    {cl.length > 0 && <ChecklistProgress checklist={cl} />}
                  </div>
                  <div className="tk-task-right">
                    {task.assigneeName || task.assignee_name
                      ? <span className="tk-assignee">{task.assigneeName || task.assignee_name}</span>
                      : null}
                    {(task.dueDate || task.due_date) && (
                      <span className="tk-due"><Calendar size={11} /> {fmtDate(task.dueDate || task.due_date)}</span>
                    )}
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="tk-task-body">
                    {task.description && (
                      <p className="tk-description">{task.description}</p>
                    )}

                    {/* Checklist items */}
                    {cl.length > 0 && (
                      <div className="tk-checklist-section">
                        <div className="tk-checklist-header">Checklist</div>
                        <ul className="tk-checklist-items">
                          {cl.map(item => (
                            <li key={item.id} className={`tk-checklist-item ${item.done ? 'tk-checklist-done' : ''}`}>
                              <label className="tk-checklist-label">
                                <input
                                  type="checkbox"
                                  className="tk-checklist-cb"
                                  checked={!!item.done}
                                  onChange={() => handleChecklistToggle(task, item.id)}
                                />
                                <span className="tk-checklist-text">{item.text}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="tk-actions">
                      {task.status !== 'completed' && (
                        <button
                          className="p-btn p-btn-sm p-btn-success"
                          onClick={() => handleStatusChange(task, 'completed')}
                        >
                          <CheckCircle size={12} /> Mark Complete
                        </button>
                      )}

                      <select
                        className="p-select tk-status-select"
                        value={task.status}
                        onChange={e => handleStatusChange(task, e.target.value)}
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                      </select>

                      <button
                        className="p-btn p-btn-sm p-btn-ghost"
                        onClick={() => { setEditTask(task); setShowModal(true); }}
                      >
                        Edit
                      </button>

                      <button
                        className="p-btn p-btn-sm p-btn-danger"
                        onClick={() => handleDelete(task)}
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <TaskModal
          task={editTask}
          onClose={() => { setShowModal(false); setEditTask(null); }}
          onSaved={handleSaved}
          employees={employees}
        />
      )}
    </div>
  );
};

export default TasksPage;
