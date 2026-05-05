/**
 * Admin-app AIAssistantWidget — floating chat for superadmins.
 *
 * Same UX as the portal widget, with one extra: superadmins can chat
 * cross-tenant. No tenant header is sent by default — Claude answers feature
 * questions from the KB. When the admin wants data about a specific org,
 * they can mention its id/name and (future) pick it from a dropdown.
 */

import { useEffect, useRef, useState, useCallback, KeyboardEvent } from 'react';
import { Sparkles, X, Send, Plus, ThumbsUp, ThumbsDown, Loader2, History, Building2, Download } from 'lucide-react';
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

const EXAMPLE_PROMPTS: string[] = [
  'How do I approve a pending user?',
  'Explain the RBAC model',
  "What's in the review queue?",
  'Summarize the KB categories',
];

const TOOL_LABELS: Record<string, string> = {
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

interface AdminUser {
  name?: string;
  token?: string;
  role?: string;
  permissions?: string[];
  [key: string]: unknown;
}

interface ToolCall {
  name: string;
  input?: unknown;
  output?: unknown;
}

interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  toolCalls?: ToolCall[];
  feedback?: 'helpful' | 'unhelpful' | null;
  feedbackNote?: string;
  _error?: boolean;
}

interface AiConversationSummary {
  id: string;
  title?: string;
  lastMessageAt: string;
}

interface OrgSummary {
  id: string | number;
  name: string;
}

function renderContent(text: string): string {
  if (!text) return '';
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped
    // Admin-app lives on its own origin — portal links open in a new tab.
    .replace(/\[([^\]]+?)\]\((\/portal\/[^)\s]+|https?:\/\/[^)\s]+)\)/g,
      (_m, label: string, href: string) => {
        const isPortal = href.startsWith('/portal/');
        const finalHref = isPortal ? `${PORTAL_BASE}${href}` : href;
        const safe = finalHref.replace(/"/g, '&quot;');
        return `<a href="${safe}" class="aiw-link${isPortal ? ' aiw-link--portal' : ''}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
}

// ── F24 — Conversation export to markdown (admin variant) ────────────────
// Identical contract to the portal / cashier-app versions: pure function
// builds markdown from messages[], blob-downloads via createObjectURL.
// Kept as 3 sibling copies because each app builds independently and there
// is no shared workspace package between them. Drift between copies is
// covered by the smoke test `_smoke_s79c_f24_conversation_export.mjs`.
interface ExportMessage {
  role: 'user' | 'assistant';
  content?: string;
  createdAt?: string | Date;
  toolCalls?: Array<{ name: string; input?: unknown; output?: unknown }> | null;
  ticketId?: string | null;
  feedback?: 'helpful' | 'unhelpful' | null;
  feedbackNote?: string | null;
}
function buildConversationMarkdown(
  conversation: { title?: string } | null,
  messages: ExportMessage[],
  opts: { toolLabels?: Record<string, string> } = {},
): string {
  const toolLabels = opts.toolLabels || {};
  const lines: string[] = [];
  const title = conversation?.title || 'AI Assistant Conversation';
  const exportDate = new Date().toLocaleString();
  const count = Array.isArray(messages) ? messages.length : 0;

  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`_Exported ${exportDate} · ${count} message${count === 1 ? '' : 's'}_`);
  lines.push('');
  lines.push('---');
  lines.push('');

  if (count === 0) {
    lines.push('_(empty conversation)_');
  } else {
    for (const m of messages) {
      const ts = m.createdAt ? new Date(m.createdAt).toLocaleString() : '';
      const heading = m.role === 'user'
        ? `## 👤 You${ts ? ' · ' + ts : ''}`
        : `## 🤖 Assistant${ts ? ' · ' + ts : ''}`;
      lines.push(heading);
      lines.push('');
      lines.push((m.content || '').trim() || '_(empty message)_');

      if (Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
        const labels = m.toolCalls
          .map(t => toolLabels[t.name] || t.name)
          .filter(Boolean);
        if (labels.length > 0) {
          lines.push('');
          lines.push(`_Tools used: ${labels.join(', ')}_`);
        }
      }

      if (m.ticketId) {
        lines.push('');
        lines.push(`_Filed support ticket: ${m.ticketId}_`);
      }

      if (m.feedback === 'helpful' || m.feedback === 'unhelpful') {
        lines.push('');
        lines.push(`_Feedback: ${m.feedback === 'helpful' ? '👍' : '👎'}${m.feedbackNote ? ' — ' + m.feedbackNote : ''}_`);
      }

      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  lines.push('');
  lines.push('_Generated by StoreVeu AI Assistant_');
  return lines.join('\n');
}

function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: filename,
  });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, 0);
}

function buildExportFilename(conversationId: string | null): string {
  const idSuffix = (conversationId || '').slice(-6) || 'session';
  const date = new Date().toISOString().slice(0, 10);
  return `ai-conversation-${idSuffix}-${date}.md`;
}

export default function AIAssistantWidget() {
  const user: AdminUser | null = (() => {
    try { return JSON.parse(localStorage.getItem('admin_user') || 'null'); } catch { return null; }
  })();

  const [open, setOpen]                 = useState(false);
  const [conversationId, setConvId]     = useState<string | null>(() => sessionStorage.getItem(SESSION_KEY) || null);
  const [messages, setMessages]         = useState<AiMessage[]>([]);
  const [input, setInput]               = useState('');
  const [sending, setSending]           = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [feedbackFor, setFeedbackFor]   = useState<string | null>(null);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [showHistory, setShowHistory]   = useState(false);
  const [historyList, setHistoryList]   = useState<AiConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [orgs, setOrgs]                 = useState<OrgSummary[]>([]);
  const [targetOrgId, setTargetOrgId]   = useState<string>(() => sessionStorage.getItem(ORG_KEY) || '');

  // Header object to pass into API helpers — X-Tenant-Id if a target org is set.
  const apiHeaders: Record<string, string> = targetOrgId ? { 'X-Tenant-Id': targetOrgId } : {};

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef  = useRef<HTMLTextAreaElement | null>(null);

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
      } catch {
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
        const list: OrgSummary[] = res.organizations || res.data || [];
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

  // F24 — Export current conversation as markdown.
  const exportConversation = useCallback(() => {
    if (!messages || messages.length === 0) return;
    const md = buildConversationMarkdown(
      { title: 'StoreVeu Admin AI Conversation' },
      messages as ExportMessage[],
      { toolLabels: TOOL_LABELS },
    );
    downloadMarkdown(buildExportFilename(conversationId), md);
  }, [messages, conversationId]);

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

  const loadConversation = useCallback((id: string) => {
    sessionStorage.setItem(SESSION_KEY, id);
    setConvId(id);
    setShowHistory(false);
  }, []);

  const changeOrg = useCallback((orgId: string) => {
    setTargetOrgId(orgId);
    if (orgId) sessionStorage.setItem(ORG_KEY, orgId);
    else       sessionStorage.removeItem(ORG_KEY);
    // Switching orgs invalidates the current conversation scope — start fresh.
    sessionStorage.removeItem(SESSION_KEY);
    setConvId(null);
    setMessages([]);
    setShowHistory(false);
  }, []);

  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || sending) return;

    setSending(true);
    setInput('');

    const tempUserMsg: AiMessage = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
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
        const merged: AiMessage[] = [...base];
        if (res.userMessage)      merged.push(res.userMessage);
        if (res.assistantMessage) merged.push(res.assistantMessage);
        return merged;
      });
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: string } }; message?: string };
      const errText = axiosErr.response?.data?.error || axiosErr.message || 'Something went wrong.';
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

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const rate = async (msgId: string, kind: 'helpful' | 'unhelpful' | null) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, feedback: kind } : m));
    try {
      // Widget treats `null` as a clear; API semantics: null means no change so
      // we only call when there's a value.
      if (kind) {
        await submitAiFeedback(msgId, kind, null, apiHeaders);
        if (kind === 'unhelpful') {
          setFeedbackFor(msgId);
          setFeedbackNote('');
        }
      }
    } catch {
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
              {/* F24 — Export conversation as markdown. */}
              <button
                type="button"
                className="aiw-iconbtn"
                onClick={exportConversation}
                disabled={messages.length === 0}
                title={messages.length === 0 ? 'No conversation to export' : 'Export conversation (.md)'}
              >
                <Download size={16} />
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
                <option key={String(o.id)} value={String(o.id)}>{o.name}</option>
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
