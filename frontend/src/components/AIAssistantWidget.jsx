/**
 * AIAssistantWidget — floating chat panel for the AI Support Assistant.
 *
 * Mounted globally in Layout.jsx. Hidden unless the user has the
 * `ai_assistant.view` permission. Stores conversation id in sessionStorage
 * so a page refresh keeps the current thread.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, X, Send, Plus, ThumbsUp, ThumbsDown, Loader2, LifeBuoy, History, Play, Compass } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import {
  listAiConversations,
  createAiConversation,
  sendAiMessage,
  getAiConversation,
  submitAiFeedback,
  escalateAiConversation,
  listPublicAiTours,
} from '../services/api';
import './AIAssistantWidget.css';

const SESSION_KEY = 'aiAssistantConversationId';

const EXAMPLE_PROMPTS = [
  'How are sales today?',
  "What's running low on stock?",
  'Show me the last 5 transactions',
  'How do I add a new product?',
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
  start_product_tour:           'Recommended tour',
  create_support_ticket:        'Filed support ticket',
};

/** Extract a tour recommendation from the toolCalls trace, if any. */
function findTourRecommendation(toolCalls) {
  if (!Array.isArray(toolCalls)) return null;
  for (const t of toolCalls) {
    if (t.name === 'start_product_tour' && t.output?.success && t.output?.tour?.slug) {
      return t.output.tour;
    }
  }
  return null;
}

/**
 * Minimal safe renderer — escape HTML, then apply **bold**, inline `code`,
 * markdown links [text](url), and line breaks. The escape pass runs first so
 * user-provided text can't inject tags; we reconstruct safe elements after.
 *
 * Links that start with `/portal/` are in-app nav (intercepted on click).
 * External links (http://, https://) open in a new tab with safe rel.
 */
function renderContent(text) {
  if (!text) return '';
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped
    // Links: [label](href) — href is restricted to /portal/* or http(s)://
    .replace(/\[([^\]]+?)\]\((\/portal\/[^)\s]+|https?:\/\/[^)\s]+)\)/g,
      (_m, label, href) => {
        const isInApp = href.startsWith('/portal/');
        const safe = href.replace(/"/g, '&quot;');
        const extra = isInApp ? '' : ' target="_blank" rel="noopener noreferrer"';
        return `<a href="${safe}" class="aiw-link${isInApp ? ' aiw-link--in-app' : ''}"${extra}>${label}</a>`;
      })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
}

export default function AIAssistantWidget() {
  const { can, user } = usePermissions();
  const navigate = useNavigate();
  const [open, setOpen]                 = useState(false);
  const [conversationId, setConvId]     = useState(() => sessionStorage.getItem(SESSION_KEY) || null);
  const [messages, setMessages]         = useState([]);
  const [input, setInput]               = useState('');
  const [sending, setSending]           = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [feedbackFor, setFeedbackFor]   = useState(null); // message id currently in feedback-note mode
  const [feedbackNote, setFeedbackNote] = useState('');
  const [escalating, setEscalating]     = useState(false);
  const [ticketSubject, setTicketSubject] = useState('');
  const [showHistory, setShowHistory]   = useState(false);
  const [historyList, setHistoryList]   = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showTours, setShowTours]       = useState(false);
  const [tourList, setTourList]         = useState([]);
  const [toursLoading, setToursLoading] = useState(false);

  const scrollRef = useRef(null);
  const inputRef  = useRef(null);

  // Auto-scroll on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // Restore existing conversation when opened
  useEffect(() => {
    if (!open || !conversationId) return;
    let cancelled = false;
    (async () => {
      setLoadingHistory(true);
      try {
        const res = await getAiConversation(conversationId);
        if (cancelled) return;
        setMessages(res.conversation?.messages || []);
      } catch (err) {
        // Conversation missing / deleted — reset.
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
  }, [open, conversationId]);

  // Focus input when opening
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
    setShowTours(false);
    setHistoryLoading(true);
    try {
      const res = await listAiConversations();
      setHistoryList(res.conversations || []);
    } catch {
      setHistoryList([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [showHistory]);

  const toggleTours = useCallback(async () => {
    if (showTours) { setShowTours(false); return; }
    setShowTours(true);
    setShowHistory(false);
    setToursLoading(true);
    try {
      const res = await listPublicAiTours();
      setTourList(res.tours || []);
    } catch {
      setTourList([]);
    } finally {
      setToursLoading(false);
    }
  }, [showTours]);

  const launchTour = useCallback((slug) => {
    window.dispatchEvent(new CustomEvent('ai-tour-start', { detail: { slug } }));
    setOpen(false);
    setShowTours(false);
  }, []);

  const loadConversation = useCallback((id) => {
    sessionStorage.setItem(SESSION_KEY, id);
    setConvId(id);
    setShowHistory(false);
    // The `open && conversationId` effect will pick up and fetch messages.
  }, []);

  const send = useCallback(async (textOverride) => {
    const text = (textOverride ?? input).trim();
    if (!text || sending) return;

    setSending(true);
    setInput('');

    // Optimistic append of user message
    const tempUserMsg = { id: `tmp-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      // Ensure we have a conversation
      let cid = conversationId;
      if (!cid) {
        const convRes = await createAiConversation();
        cid = convRes.conversation?.id;
        if (!cid) throw new Error('Failed to create conversation');
        sessionStorage.setItem(SESSION_KEY, cid);
        setConvId(cid);
      }

      // Send the message
      const res = await sendAiMessage(cid, text);

      // Replace temp user message with real ids + append assistant response
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
  }, [input, sending, conversationId]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const rate = async (msgId, kind) => {
    // Optimistic
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, feedback: kind } : m));
    try {
      await submitAiFeedback(msgId, kind);
      if (kind === 'unhelpful') {
        setFeedbackFor(msgId);
        setFeedbackNote('');
      }
    } catch (err) {
      // Rollback on failure
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
      await submitAiFeedback(msgId, 'unhelpful', note);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, feedbackNote: note } : m));
    } catch {/* silent */}
  };

  // Intercept `/portal/*` link clicks in the message area → React Router nav
  // instead of full page load. Supports middle/cmd-click to open in new tab.
  const handleMessageClick = useCallback((e) => {
    const a = e.target.closest('a.aiw-link--in-app');
    if (!a) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (!href) return;
    navigate(href);
    // Close the panel so the user sees the destination screen.
    setOpen(false);
  }, [navigate]);

  const fileTicket = async () => {
    if (!conversationId) return;
    const subj = ticketSubject.trim() || messages.find(m => m.role === 'user')?.content?.slice(0, 80) || 'Help requested';
    setEscalating(true);
    try {
      const res = await escalateAiConversation(conversationId, subj);
      if (res.message) {
        setMessages(prev => [...prev, res.message]);
      }
      setTicketSubject('');
    } catch (err) {
      const errText = err.response?.data?.error || 'Failed to file ticket';
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `⚠ ${errText}`,
        createdAt: new Date().toISOString(),
        _error: true,
      }]);
    } finally {
      setEscalating(false);
    }
  };

  // Don't render at all if user lacks permission
  if (!user || !can('ai_assistant.view')) return null;

  return (
    <>
      {/* Floating action button */}
      {!open && (
        <button
          type="button"
          className="aiw-fab"
          onClick={() => setOpen(true)}
          aria-label="Open AI Assistant"
          title="Storv AI Assistant"
        >
          <Sparkles size={22} />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="aiw-panel" role="dialog" aria-label="AI Assistant">
          <div className="aiw-header">
            <div className="aiw-header-title">
              <span className="aiw-header-icon"><Sparkles size={16} /></span>
              <div>
                <div className="aiw-header-main">Storv AI Assistant</div>
                <div className="aiw-header-sub">Ask me about features or your store data</div>
              </div>
            </div>
            <div className="aiw-header-actions">
              <button type="button" className={`aiw-iconbtn ${showTours ? 'aiw-iconbtn--on' : ''}`} onClick={toggleTours} title="Browse guided tours">
                <Compass size={16} />
              </button>
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

          {showTours && (
            <div className="aiw-history aiw-tours-panel">
              <div className="aiw-history-header">Guided tours</div>
              {toursLoading ? (
                <div className="aiw-loading-row"><Loader2 className="aiw-spin" size={14} /> Loading…</div>
              ) : tourList.length === 0 ? (
                <div className="aiw-history-empty">No tours available.</div>
              ) : (
                tourList.map(t => (
                  <button
                    key={t.slug}
                    type="button"
                    className="aiw-history-item aiw-tour-item"
                    onClick={() => launchTour(t.slug)}
                  >
                    <div className="aiw-history-title">
                      <Play size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                      {t.name}
                    </div>
                    <div className="aiw-history-meta">
                      {t.stepCount} steps · <em>{t.category}</em>
                    </div>
                    {t.description && (
                      <div className="aiw-tour-desc">{t.description.slice(0, 110)}{t.description.length > 110 ? '…' : ''}</div>
                    )}
                  </button>
                ))
              )}
            </div>
          )}

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

          <div ref={scrollRef} className="aiw-messages" onClick={handleMessageClick}>
            {loadingHistory && (
              <div className="aiw-loading-row"><Loader2 className="aiw-spin" size={16} /> Loading conversation…</div>
            )}

            {!loadingHistory && messages.length === 0 && (
              <div className="aiw-greet">
                <div className="aiw-greet-icon"><Sparkles size={28} /></div>
                <div className="aiw-greet-title">Hi {user?.name?.split(' ')[0] || 'there'}!</div>
                <div className="aiw-greet-body">
                  I'm the Storv AI Assistant. I can answer questions, check live store data, or walk you through tasks.
                </div>
                <div className="aiw-prompts">
                  {EXAMPLE_PROMPTS.map(p => (
                    <button key={p} type="button" className="aiw-prompt" onClick={() => send(p)}>
                      {p}
                    </button>
                  ))}
                </div>
                <button type="button" className="aiw-browse-tours" onClick={toggleTours}>
                  <Compass size={14} /> Browse guided tours →
                </button>
              </div>
            )}

            {messages.map(m => {
              const tour = m.role === 'assistant' ? findTourRecommendation(m.toolCalls) : null;
              return (
              <div key={m.id} className={`aiw-msg aiw-msg--${m.role}${m._error ? ' aiw-msg--error' : ''}`}>
                <div
                  className="aiw-msg-bubble"
                  dangerouslySetInnerHTML={{ __html: renderContent(m.content) }}
                />
                {tour && (
                  <button
                    type="button"
                    className="aiw-tour-cta"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('ai-tour-start', { detail: { slug: tour.slug } }));
                      setOpen(false);
                    }}
                  >
                    <Play size={14} />
                    <span>Start guided tour: <strong>{tour.name}</strong></span>
                    <span className="aiw-tour-cta-steps">{tour.stepCount} steps</span>
                  </button>
                )}
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
            ); })}

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
              placeholder="Ask anything about Storv or your store…"
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

          {/* Escalation footer — only visible after the first user message
              so the empty greeting state stays clean. */}
          {conversationId && messages.some(m => m.role === 'user') && (
            <div className="aiw-escalate">
              <LifeBuoy size={12} />
              <span>Need a human?</span>
              <button
                type="button"
                className="aiw-escalate-btn"
                onClick={fileTicket}
                disabled={escalating}
                title="File a support ticket with this conversation attached"
              >
                {escalating ? 'Filing…' : 'File support ticket'}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
