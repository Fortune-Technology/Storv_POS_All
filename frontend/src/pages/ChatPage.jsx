import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, Send, Plus, X, Loader, Users, Hash, User,
} from 'lucide-react';
import { toast } from 'react-toastify';

import {
  getChatChannels,
  getChatMessages,
  sendChatMessage,
  markChatRead,
  getChatUnread,
  getChatUsers,
} from '../services/api';
import '../styles/portal.css';
import './ChatPage.css';

function fmtTime(d) {
  return new Date(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/* ── Role Badge ─────────────────────────────────────────────────────────── */
const RoleBadge = ({ role }) => {
  const cls = role === 'admin' || role === 'owner'
    ? 'p-badge p-badge-purple'
    : role === 'manager'
      ? 'p-badge p-badge-amber'
      : 'p-badge p-badge-gray';
  return <span className={cls}>{role}</span>;
};

/* ── New DM Modal ───────────────────────────────────────────────────────── */
const NewDMModal = ({ onClose, onSelect }) => {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await getChatUsers();
        setUsers(Array.isArray(data) ? data : data.users || []);
      } catch { toast.error('Failed to load users'); }
      finally { setLoading(false); }
    })();
  }, []);

  const filtered = users.filter(u =>
    (u.name || u.email || '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-modal-overlay" onClick={onClose}>
      <div className="p-modal" onClick={e => e.stopPropagation()}>
        <div className="p-modal-header">
          <h2 className="p-modal-title">New Message</h2>
          <button className="p-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <input
          className="p-input"
          placeholder="Search users..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />

        <div className="ch-user-list">
          {loading && <div className="p-loading"><Loader size={14} className="p-spin" /> Loading...</div>}
          {!loading && filtered.length === 0 && <div className="p-empty">No users found</div>}
          {filtered.map(u => (
            <button
              key={u.id || u._id}
              className="ch-user-item"
              onClick={() => { onSelect(u); onClose(); }}
            >
              <User size={14} />
              <span className="ch-user-name">{u.name || u.email}</span>
              {u.role && <RoleBadge role={u.role} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ── Main Page ──────────────────────────────────────────────────────────── */
const ChatPage = () => {
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

  const [channels, setChannels]         = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages]         = useState([]);
  const [unreadMap, setUnreadMap]        = useState({});
  const [text, setText]                  = useState('');
  const [loading, setLoading]           = useState(true);
  const [sending, setSending]           = useState(false);
  const [showNewDM, setShowNewDM]       = useState(false);

  const messagesEndRef = useRef(null);
  const pollRef        = useRef(null);

  /* ── Load channels ──────────────────────────────────────────────────── */
  const loadChannels = useCallback(async () => {
    try {
      const data = await getChatChannels();
      setChannels(Array.isArray(data) ? data : data.channels || []);
    } catch { /* silent */ }
  }, []);

  const loadUnread = useCallback(async () => {
    try {
      const data = await getChatUnread();
      const map = {};
      if (Array.isArray(data)) {
        data.forEach(u => { map[u.channelId || u.channel_id] = u.count; });
      } else if (data && typeof data === 'object') {
        Object.assign(map, data);
      }
      setUnreadMap(map);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadChannels(), loadUnread()]);
      setLoading(false);
    })();
  }, [loadChannels, loadUnread]);

  /* ── Load messages for active channel ───────────────────────────────── */
  const loadMessages = useCallback(async (channelId) => {
    if (!channelId) return;
    try {
      const data = await getChatMessages({ channelId });
      setMessages(Array.isArray(data) ? data : data.messages || []);
    } catch { toast.error('Failed to load messages'); }
  }, []);

  useEffect(() => {
    if (!activeChannel) return;
    loadMessages(activeChannel.id || activeChannel._id);
    markChatRead({ channelId: activeChannel.id || activeChannel._id }).catch(() => {});
    setUnreadMap(prev => ({ ...prev, [activeChannel.id || activeChannel._id]: 0 }));
  }, [activeChannel, loadMessages]);

  /* ── Poll every 5 s ─────────────────────────────────────────────────── */
  useEffect(() => {
    pollRef.current = setInterval(() => {
      if (activeChannel) loadMessages(activeChannel.id || activeChannel._id);
      loadUnread();
    }, 5000);
    return () => clearInterval(pollRef.current);
  }, [activeChannel, loadMessages, loadUnread]);

  /* ── Auto-scroll ────────────────────────────────────────────────────── */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* ── Send ────────────────────────────────────────────────────────────── */
  const handleSend = async (e) => {
    e.preventDefault();
    if (!text.trim() || !activeChannel) return;
    setSending(true);
    try {
      await sendChatMessage({
        channelId: activeChannel.id || activeChannel._id,
        message: text.trim(),
      });
      setText('');
      await loadMessages(activeChannel.id || activeChannel._id);
    } catch { toast.error('Failed to send message'); }
    finally { setSending(false); }
  };

  /* ── Start DM with user ─────────────────────────────────────────────── */
  const handleStartDM = async (user) => {
    // Check if channel already exists for this user
    const existing = channels.find(c =>
      c.type === 'dm' && (c.memberId === (user.id || user._id) || c.member_id === (user.id || user._id)),
    );
    if (existing) {
      setActiveChannel(existing);
      return;
    }
    // Otherwise create a new DM by sending first message
    try {
      await sendChatMessage({
        recipientId: user.id || user._id,
        message: '(started a conversation)',
      });
      await loadChannels();
      toast.success(`DM started with ${user.name || user.email}`);
    } catch { toast.error('Failed to start conversation'); }
  };

  const chId = (ch) => ch.id || ch._id;

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><MessageSquare size={22} /></div>
          <div>
            <h1 className="p-title">Chat</h1>
            <p className="p-subtitle">Internal messaging</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-loading"><Loader size={14} className="p-spin" /> Loading channels...</div>
      ) : (
        <div className="ch-container">
          {/* ── Left: Channel List ─────────────────────────────────────── */}
          <div className="ch-sidebar">
            <div className="ch-sidebar-header">
              <span className="ch-sidebar-title">Channels</span>
              <button className="p-btn p-btn-sm p-btn-primary" onClick={() => setShowNewDM(true)}>
                <Plus size={13} /> New
              </button>
            </div>

            <div className="ch-channel-list">
              {channels.length === 0 && (
                <div className="ch-empty-channels">No channels yet</div>
              )}
              {channels.map(ch => {
                const id = chId(ch);
                const isActive = activeChannel && chId(activeChannel) === id;
                const unread = unreadMap[id] || 0;
                return (
                  <button
                    key={id}
                    className={`ch-channel-item ${isActive ? 'ch-channel-active' : ''}`}
                    onClick={() => setActiveChannel(ch)}
                  >
                    <span className="ch-channel-icon">
                      {ch.type === 'dm' ? <User size={14} /> : <Hash size={14} />}
                    </span>
                    <div className="ch-channel-info">
                      <span className="ch-channel-name">{ch.name || ch.label || 'Channel'}</span>
                      {ch.lastMessage && (
                        <span className="ch-channel-preview">
                          {typeof ch.lastMessage === 'string'
                            ? ch.lastMessage
                            : ch.lastMessage.message || ch.lastMessage.text || ch.lastMessage.body || ''}
                        </span>
                      )}
                    </div>
                    {unread > 0 && <span className="ch-unread-badge">{unread}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Right: Messages ────────────────────────────────────────── */}
          <div className="ch-messages-panel">
            {!activeChannel ? (
              <div className="ch-no-channel">
                <MessageSquare size={40} strokeWidth={1} />
                <p>Select a channel to start chatting</p>
              </div>
            ) : (
              <>
                <div className="ch-messages-header">
                  <span className="ch-channel-icon">
                    {activeChannel.type === 'dm' ? <User size={15} /> : <Hash size={15} />}
                  </span>
                  <span className="ch-messages-title">
                    {activeChannel.name || activeChannel.label || 'Chat'}
                  </span>
                </div>

                <div className="ch-messages-list">
                  {messages.length === 0 && (
                    <div className="ch-no-messages">No messages yet. Say hello!</div>
                  )}
                  {messages.map((msg, i) => {
                    const isMine = (msg.senderId || msg.sender_id || msg.userId || msg.user_id)
                      === (currentUser.id || currentUser._id || currentUser.userId);
                    const isSystem = msg.type === 'system';

                    if (isSystem) {
                      return (
                        <div key={msg.id || msg._id || i} className="ch-msg-system">
                          {msg.text || msg.message || msg.body}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={msg.id || msg._id || i}
                        className={`ch-msg ${isMine ? 'ch-msg-mine' : 'ch-msg-other'}`}
                      >
                        <div className="ch-msg-meta">
                          <span className="ch-msg-sender">{msg.senderName || msg.sender_name || 'User'}</span>
                          {msg.senderRole || msg.sender_role
                            ? <RoleBadge role={msg.senderRole || msg.sender_role} />
                            : null}
                          <span className="ch-msg-time">{fmtTime(msg.createdAt || msg.created_at || msg.timestamp)}</span>
                        </div>
                        <div className="ch-msg-bubble">
                          {msg.text || msg.message || msg.body}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                <form className="ch-input-bar" onSubmit={handleSend}>
                  <input
                    className="p-input ch-text-input"
                    placeholder="Type a message..."
                    value={text}
                    onChange={e => setText(e.target.value)}
                    disabled={sending}
                  />
                  <button
                    className="p-btn p-btn-primary ch-send-btn"
                    type="submit"
                    disabled={sending || !text.trim()}
                  >
                    {sending ? <Loader size={14} className="p-spin" /> : <Send size={14} />}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {showNewDM && <NewDMModal onClose={() => setShowNewDM(false)} onSelect={handleStartDM} />}
    </div>
  );
};

export default ChatPage;
