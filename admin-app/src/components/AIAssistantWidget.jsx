/**
 * Admin-app AIAssistantWidget — floating chat for superadmins.
 *
 * Same UX as the portal widget, with one extra: superadmins can chat
 * cross-tenant. No tenant header is sent by default — Claude answers feature
 * questions from the KB. When the admin wants data about a specific org,
 * they can mention its id/name and (future) pick it from a dropdown.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Sparkles, X, Send, Plus, ThumbsUp, ThumbsDown, Loader2, History, Building2 } from 'lucide-react';
import {
  listAiConversations,
  createAiConversation,
  sendAiMessage,
  getAiConversation,
  submitAiFeedback,
  getAdminOrganizations,
} from '../services/api';
import './AIAssistantWidget.css';

const SESSION_KEY = 'adminAiConversationId';
const ORG_KEY     = 'adminAiTargetOrgId';

const EXAMPLE_PROMPTS = [
  'How do I approve a pending user?',
  'Explain the RBAC model',
  "What's in the review queue?",
  'Summarize the KB categories',
];

const TOOL_LABELS = {
  get_store_summary:            'Sales summary',
  get_inventory_status:         'Inventory check',
  get_recent_transactions:      'Recent transactions',
  search_transactions:          'Transaction search',
  get_lottery_summary:          'Lottery stats',
  get_fuel_summary:             'Fuel stats',
  get_employee_hours:           'Employee hours',
  get_end_of_day_report:        'End-of-day report',
  get_sales_predictions:        'Sales forecast',
  lookup_customer:              'Customer lookup',
  get_vendor_order_suggestions: 'Reorder suggestions',
  list_open_shifts:             'Open shifts',
  create_support_ticket:        'Filed support ticket',
};

const PORTAL_BASE = import.meta.env.VITE_PORTAL_URL || 'http://localhost:5173';

function renderContent(text) {
  if (!text) return '';
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped
    // Admin-app lives on its own origin — portal links open in a new tab.
    .replace(/\[([^\]]+?)\]\((\/portal\/[^)\s]+|https?:\/\/[^)\s]+)\)/g,
      (_m, label, href) => {
        const isPortal = href.startsWith('/portal/');
        const finalHref = isPortal ? `${PORTAL_BASE}${href}` : href;
        const safe = finalHref.replace(/"/g, '&quot;');
        return `<a href="${safe}" class="aiw-link${isPortal ? ' aiw-link--portal' : ''}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
}

export default function AIAssistantWidget() {
  const user = (() => {
    try { return JSON.parse(localStorage.getItem('admin_user') || 'null'); } catch { return null; }
  })();

  const [open, setOpen]                 = useState(false);
  const [conversationId, setConvId]     = useState(() => sessionStorage.getItem(SESSION_KEY) || null);
  const [messages, setMessages]         = useState([]);
  const [input, setInput]               = useState('');
  const [sending, setSending]           = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [feedbackFor, setFeedbackFor]   = useState(null);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [showHistory, setShowHistory]   = useState(false);
  const [historyList, setHistoryList]   = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [orgs, setOrgs]                 = useState([]);
  const [targetOrgId, setTargetOrgId]   = useState(() => sessionStorage.getItem(ORG_KEY) || '');

  // Header object to pass into API helpers — X-Tenant-Id if a target org is set.
  const apiHeaders = targetOrgId ? { 'X-Tenant-Id': targetOrgId } : {};

  const scrollRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  useEffect(() => {
    if (!open || !conversationId) return;
    let cancelled = false;
    (async () => {
      setLoadingHistory(true);
      try {
        const res = await getAiConversation(conversationId, apiHeaders);
        if (cancelled) return;
        setMessages(res.conversation?.messages || []);
      } catch (err) {
        if (!cancelled) {
          setConvId(null);
          sessionStorage.removeItem(SESSION_KEY);
          setMessages([]);
        }
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, conversationId, targetOrgId]); // eslint-disable-line

  // Load orgs once when panel opens. Filter to active non-deleted orgs only.
  useEffect(() => {
    if (!open || orgs.length) return;
    (async () => {
      try {
        const res = await getAdminOrganizations({ status: 'active', limit: 200 });
        const list = res.organizations || res.data || [];
        setOrgs(list);
      } catch { setOrgs([]); }
    })();
  }, [open, orgs.length]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  const startNewConversation = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setConvId(null);
    setMessages([]);
    setInput('');
    setFeedbackFor(null);
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const toggleHistory = useCallback(async () => {
    if (showHistory) { setShowHistory(false); return; }
    setShowHistory(true);
    setHistoryLoading(true);
    try {
      const res = await listAiConversations(apiHeaders);
      setHistoryList(res.conversations || []);
    } catch {
      setHistoryList([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [showHistory, apiHeaders]); // eslint-disable-line

  const loadConversation = useCallback((id) => {
    sessionStorage.setItem(SESSION_KEY, id);
    setConvId(id);
    setShowHistory(false);
  }, []);

  const changeOrg = useCallback((orgId) => {
    setTargetOrgId(orgId);
    if (orgId) sessionStorage.setItem(ORG_KEY, orgId);
    else       sessionStorage.removeItem(ORG_KEY);
    // Switching orgs invalidates the current conversation scope — start fresh.
    sessionStorage.removeItem(SESSION_KEY);
    setConvId(null);
    setMessages([]);
    setShowHistory(false);
  }, []);

  const send = useCallback(async (textOverride) => {
    const text = (textOverride ?? input).trim();
    if (!text || sending) return;

    setSending(true);
    setInput('');

    const tempUserMsg = { id: `tmp-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      let cid = conversationId;
      if (!cid) {
        const convRes = await createAiConversation(apiHeaders);
        cid = convRes.conversation?.id;
        if (!cid) throw new Error('Failed to create conversation');
        sessionStorage.setItem(SESSION_KEY, cid);
        setConvId(cid);
      }

      const res = await sendAiMessage(cid, text, apiHeaders);

      setMessages(prev => {
        const base = prev.filter(m => m.id !== tempUserMsg.id);
        const merged = [...base];
        if (res.userMessage)      merged.push(res.userMessage);
        if (res.assistantMessage) merged.push(res.assistantMessage);
        return merged;
      });
    } catch (err) {
      const errText = err.response?.data?.error || err.message || 'Something went wrong.';
      setMessages(prev => [
        ...prev.filter(m => m.id !== tempUserMsg.id),
        tempUserMsg,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `⚠ ${errText}`,
          createdAt: new Date().toISOString(),
          _error: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [input, sending, conversationId, targetOrgId]); // eslint-disable-line

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const rate = async (msgId, kind) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, feedback: kind } : m));
    try {
      await submitAiFeedback(msgId, kind, null, apiHeaders);
      if (kind === 'unhelpful') {
        setFeedbackFor(msgId);
        setFeedbackNote('');
      }
    } catch (err) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, feedback: null } : m));
    }
  };

  const submitNote = async () => {
    if (!feedbackFor) return;
    const msgId = feedbackFor;
    const note = feedbackNote.trim();
    setFeedbackFor(null);
    setFeedbackNote('');
    if (!note) return;
    try {
      await submitAiFeedback(msgId, 'unhelpful', note, apiHeaders);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, feedbackNote: note } : m));
    } catch {/* silent */}
  };

  if (!user) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          className="aiw-fab"
          onClick={() => setOpen(true)}
          aria-label="Open AI Assistant"
          title="StoreVeu AI Assistant"
        >
          <Sparkles size={22} />
        </button>
      )}

      {open && (
        <div className="aiw-panel" role="dialog" aria-label="AI Assistant">
          <div className="aiw-header">
            <div className="aiw-header-title">
              <span className="aiw-header-icon"><Sparkles size={16} /></span>
              <div>
                <div className="aiw-header-main">StoreVeu AI Assistant</div>
                <div className="aiw-header-sub">Admin panel · cross-tenant access</div>
              </div>
            </div>
            <div className="aiw-header-actions">
              <button type="button" className={`aiw-iconbtn ${showHistory ? 'aiw-iconbtn--on' : ''}`} onClick={toggleHistory} title="Conversation history">
                <History size={16} />
              </button>
              <button type="button" className="aiw-iconbtn" onClick={startNewConversation} title="New conversation">
                <Plus size={16} />
              </button>
              <button type="button" className="aiw-iconbtn" onClick={() => setOpen(false)} title="Close">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Org picker — only shown for superadmin-style cross-tenant chat */}
          <div className="aiw-org-picker">
            <Building2 size={12} />
            <span className="aiw-org-label">Target org:</span>
            <select
              className="aiw-org-select"
              value={targetOrgId}
              onChange={e => changeOrg(e.target.value)}
            >
              <option value="">— Platform (no org context) —</option>
              {orgs.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>

          {showHistory && (
            <div className="aiw-history">
              <div className="aiw-history-header">Recent conversations</div>
              {historyLoading ? (
                <div className="aiw-loading-row"><Loader2 className="aiw-spin" size={14} /> Loading…</div>
              ) : historyList.length === 0 ? (
                <div className="aiw-history-empty">No past conversations yet.</div>
              ) : (
                historyList.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    className={`aiw-history-item ${c.id === conversationId ? 'aiw-history-item--current' : ''}`}
                    onClick={() => loadConversation(c.id)}
                  >
                    <div className="aiw-history-title">{c.title || 'Untitled conversation'}</div>
                    <div className="aiw-history-meta">{new Date(c.lastMessageAt).toLocaleString()}</div>
                  </button>
                ))
              )}
            </div>
          )}

          <div ref={scrollRef} className="aiw-messages">
            {loadingHistory && (
              <div className="aiw-loading-row"><Loader2 className="aiw-spin" size={16} /> Loading conversation…</div>
            )}

            {!loadingHistory && messages.length === 0 && (
              <div className="aiw-greet">
                <div className="aiw-greet-icon"><Sparkles size={28} /></div>
                <div className="aiw-greet-title">Hi {user?.name?.split(' ')[0] || 'Admin'}!</div>
                <div className="aiw-greet-body">
                  I'm the StoreVeu AI Assistant — platform edition. I can answer questions about features, RBAC, org operations, and the review queue.
                </div>
                <div className="aiw-prompts">
                  {EXAMPLE_PROMPTS.map(p => (
                    <button key={p} type="button" className="aiw-prompt" onClick={() => send(p)}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(m => (
              <div key={m.id} className={`aiw-msg aiw-msg--${m.role}${m._error ? ' aiw-msg--error' : ''}`}>
                <div
                  className="aiw-msg-bubble"
                  dangerouslySetInnerHTML={{ __html: renderContent(m.content) }}
                />
                {m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0 && (
                  <div className="aiw-tool-chips">
                    {m.toolCalls.map((t, i) => (
                      <span key={i} className="aiw-tool-chip" title={JSON.stringify(t.input || {})}>
                        {TOOL_LABELS[t.name] || t.name}
                      </span>
                    ))}
                  </div>
                )}
                {m.role === 'assistant' && !m._error && (
                  <div className="aiw-msg-actions">
                    <button
                      type="button"
                      className={`aiw-rate ${m.feedback === 'helpful' ? 'aiw-rate--on' : ''}`}
                      onClick={() => rate(m.id, m.feedback === 'helpful' ? null : 'helpful')}
                      title="Helpful"
                    >
                      <ThumbsUp size={13} />
                    </button>
                    <button
                      type="button"
                      className={`aiw-rate ${m.feedback === 'unhelpful' ? 'aiw-rate--on-neg' : ''}`}
                      onClick={() => rate(m.id, m.feedback === 'unhelpful' ? null : 'unhelpful')}
                      title="Not helpful"
                    >
                      <ThumbsDown size={13} />
                    </button>
                  </div>
                )}
                {feedbackFor === m.id && (
                  <div className="aiw-feedback-box">
                    <textarea
                      className="aiw-feedback-input"
                      placeholder="What would've been a better answer? (optional — helps us improve)"
                      value={feedbackNote}
                      onChange={e => setFeedbackNote(e.target.value)}
                      rows={2}
                      autoFocus
                    />
                    <div className="aiw-feedback-actions">
                      <button type="button" className="aiw-feedback-skip" onClick={() => { setFeedbackFor(null); setFeedbackNote(''); }}>
                        Skip
                      </button>
                      <button type="button" className="aiw-feedback-submit" onClick={submitNote} disabled={!feedbackNote.trim()}>
                        Send
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {sending && (
              <div className="aiw-msg aiw-msg--assistant">
                <div className="aiw-msg-bubble aiw-thinking">
                  <span className="aiw-dot" /><span className="aiw-dot" /><span className="aiw-dot" />
                </div>
              </div>
            )}
          </div>

          <div className="aiw-composer">
            <textarea
              ref={inputRef}
              className="aiw-input"
              placeholder="Ask anything about StoreVeu or an org…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              disabled={sending}
              maxLength={4000}
            />
            <button
              type="button"
              className="aiw-send"
              onClick={() => send()}
              disabled={!input.trim() || sending}
              aria-label="Send"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
