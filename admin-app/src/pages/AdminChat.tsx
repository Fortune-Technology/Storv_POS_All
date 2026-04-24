/**
 * AdminChat — Super-admin chat page.
 * Supports channels (store-wide + DMs) with real-time polling.
 */

import { useState, useEffect, useRef, useCallback, FormEvent } from 'react';
import {
  MessageSquare, Send, Plus, X, Loader, User, Hash,
} from 'lucide-react';
import { toast } from 'react-toastify';
import api from '../services/api';
import './AdminChat.css';

function fmtTime(d: string | number | Date): string {
  return new Date(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

interface ChatUser {
  id?: string | number;
  _id?: string | number;
  name?: string;
  email?: string;
  role?: string;
}

interface Channel {
  id?: string | number;
  _id?: string | number;
  type?: string; // 'dm' | 'store' | ...
  name?: string;
  label?: string;
  memberId?: string | number;
  member_id?: string | number;
  unreadCount?: number;
  lastMessage?: string | { message?: string; text?: string };
}

interface ChatMessage {
  id?: string | number;
  _id?: string | number;
  senderId?: string | number;
  sender_id?: string | number;
  userId?: string | number;
  senderName?: string;
  sender_name?: string;
  senderRole?: string;
  sender_role?: string;
  createdAt?: string;
  created_at?: string;
  timestamp?: string;
  message?: string;
  text?: string;
  body?: string;
}

interface CurrentUser {
  id?: string | number;
  _id?: string | number;
  userId?: string | number;
  [key: string]: unknown;
}

interface RoleBadgeProps { role: string }
const RoleBadge = ({ role }: RoleBadgeProps) => {
  const cls = role === 'admin' || role === 'superadmin'
    ? 'ach-badge ach-badge-purple'
    : role === 'manager' || role === 'owner'
      ? 'ach-badge ach-badge-amber'
      : 'ach-badge ach-badge-gray';
  return <span className={cls}>{role}</span>;
};

/* ── New DM Modal ──────────────────────────────────────────────────────── */
interface NewDMModalProps {
  onClose: () => void;
  onSelect: (user: ChatUser) => void;
}

const NewDMModal = ({ onClose, onSelect }: NewDMModalProps) => {
  const [users, setUsers]     = useState<ChatUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');

  useEffect(() => {
    api.get('/chat/users')
      .then(res => setUsers(Array.isArray(res.data) ? res.data : res.data?.users || []))
      .catch(() => toast.error('Failed to load users'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = users.filter(u =>
    (u.name || u.email || '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="ach-modal-overlay" onClick={onClose}>
      <div className="ach-modal" onClick={e => e.stopPropagation()}>
        <div className="ach-modal-header">
          <h2 className="ach-modal-title">New Message</h2>
          <button className="ach-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <input
          className="ach-search"
          placeholder="Search users..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
        <div className="ach-user-list">
          {loading && <div className="ach-loading"><Loader size={14} className="ach-spin" /> Loading...</div>}
          {!loading && filtered.length === 0 && <div className="ach-empty">No users found</div>}
          {filtered.map(u => (
            <button key={u.id || u._id} className="ach-user-item" onClick={() => { onSelect(u); onClose(); }}>
              <User size={14} />
              <span className="ach-user-name">{u.name || u.email}</span>
              {u.role && <RoleBadge role={u.role} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ── Main Page ─────────────────────────────────────────────────────────── */
const AdminChat = () => {
  const currentUser: CurrentUser = JSON.parse(localStorage.getItem('admin_user') || '{}');

  const [channels, setChannels]             = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel]   = useState<Channel | null>(null);
  const [messages, setMessages]             = useState<ChatMessage[]>([]);
  const [unreadMap, setUnreadMap]           = useState<Record<string, number>>({});
  const [text, setText]                     = useState('');
  const [loading, setLoading]               = useState(true);
  const [sending, setSending]               = useState(false);
  const [showNewDM, setShowNewDM]           = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const pollRef        = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadChannels = useCallback(async () => {
    try {
      const res = await api.get('/chat/channels');
      const data = res.data;
      const list: Channel[] = Array.isArray(data) ? data : data.channels || [];
      setChannels(list);
      const map: Record<string, number> = {};
      list.forEach(ch => {
        const key = String(ch.id ?? ch._id ?? '');
        if (ch.unreadCount) map[key] = ch.unreadCount;
      });
      setUnreadMap(prev => ({ ...prev, ...map }));
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadChannels();
      setLoading(false);
    })();
  }, [loadChannels]);

  const loadMessages = useCallback(async (channelId: string | number | undefined) => {
    if (!channelId) return;
    try {
      const res = await api.get('/chat/messages', { params: { channelId } });
      const data = res.data;
      setMessages(Array.isArray(data) ? data : data.messages || []);
    } catch { toast.error('Failed to load messages'); }
  }, []);

  useEffect(() => {
    if (!activeChannel) return;
    const id = activeChannel.id || activeChannel._id;
    loadMessages(id);
    api.post('/chat/read', { channelId: id }).catch(() => {});
    setUnreadMap(prev => ({ ...prev, [String(id)]: 0 }));
  }, [activeChannel, loadMessages]);

  useEffect(() => {
    pollRef.current = setInterval(() => {
      if (activeChannel) loadMessages(activeChannel.id || activeChannel._id);
      loadChannels();
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeChannel, loadMessages, loadChannels]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !activeChannel) return;
    setSending(true);
    try {
      await api.post('/chat/messages', {
        channelId: activeChannel.id || activeChannel._id,
        message: text.trim(),
      });
      setText('');
      await loadMessages(activeChannel.id || activeChannel._id);
    } catch { toast.error('Failed to send message'); }
    finally { setSending(false); }
  };

  const handleStartDM = async (user: ChatUser) => {
    const existing = channels.find(c =>
      c.type === 'dm' && (c.memberId === (user.id || user._id) || c.member_id === (user.id || user._id)),
    );
    if (existing) { setActiveChannel(existing); return; }
    try {
      await api.post('/chat/messages', {
        recipientId: user.id || user._id,
        message: '(started a conversation)',
      });
      await loadChannels();
      toast.success(`DM started with ${user.name || user.email}`);
    } catch { toast.error('Failed to start conversation'); }
  };

  const chId = (ch: Channel): string | number => (ch.id ?? ch._id ?? '');

  return (
    <div className="ach-page">
      <div className="ach-header">
        <div className="admin-header-icon"><MessageSquare size={22} /></div>
        <div>
          <h1 className="ach-title">Chat</h1>
          <p className="ach-subtitle">Cross-org messaging</p>
        </div>
      </div>

      {loading ? (
        <div className="ach-loading"><Loader size={14} className="ach-spin" /> Loading channels...</div>
      ) : (
        <div className="ach-container">
          {/* Left: Channel List */}
          <div className="ach-sidebar">
            <div className="ach-sidebar-header">
              <span className="ach-sidebar-title">Channels</span>
              <button className="ach-new-btn" onClick={() => setShowNewDM(true)}>
                <Plus size={13} /> New
              </button>
            </div>
            <div className="ach-channel-list">
              {channels.length === 0 && <div className="ach-empty">No channels yet</div>}
              {channels.map(ch => {
                const id = chId(ch);
                const isActive = !!activeChannel && chId(activeChannel) === id;
                const unread = unreadMap[String(id)] || 0;
                return (
                  <button key={String(id)} className={`ach-channel ${isActive ? 'ach-channel-active' : ''}`} onClick={() => setActiveChannel(ch)}>
                    <span className="ach-channel-icon">
                      {ch.type === 'dm' ? <User size={14} /> : <Hash size={14} />}
                    </span>
                    <div className="ach-channel-info">
                      <span className="ach-channel-name">{ch.name || ch.label || 'Channel'}</span>
                      {ch.lastMessage && (
                        <span className="ach-channel-preview">
                          {typeof ch.lastMessage === 'string' ? ch.lastMessage : (ch.lastMessage.message || ch.lastMessage.text || '')}
                        </span>
                      )}
                    </div>
                    {unread > 0 && <span className="ach-unread">{unread}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Messages */}
          <div className="ach-messages-panel">
            {!activeChannel ? (
              <div className="ach-no-channel">
                <MessageSquare size={40} strokeWidth={1} />
                <p>Select a channel to start chatting</p>
              </div>
            ) : (
              <>
                <div className="ach-messages-header">
                  <span className="ach-channel-icon">
                    {activeChannel.type === 'dm' ? <User size={15} /> : <Hash size={15} />}
                  </span>
                  <span className="ach-messages-title">
                    {activeChannel.name || activeChannel.label || 'Chat'}
                  </span>
                </div>

                <div className="ach-messages-list">
                  {messages.length === 0 && <div className="ach-no-messages">No messages yet. Say hello!</div>}
                  {messages.map((msg, i) => {
                    const isMine = (msg.senderId || msg.sender_id || msg.userId)
                      === (currentUser.id || currentUser._id || currentUser.userId);
                    return (
                      <div key={msg.id || msg._id || i} className={`ach-msg ${isMine ? 'ach-msg-mine' : 'ach-msg-other'}`}>
                        <div className="ach-msg-meta">
                          <span className="ach-msg-sender">{msg.senderName || msg.sender_name || 'User'}</span>
                          {(msg.senderRole || msg.sender_role) && <RoleBadge role={(msg.senderRole || msg.sender_role) as string} />}
                          <span className="ach-msg-time">{fmtTime(msg.createdAt || msg.created_at || msg.timestamp || '')}</span>
                        </div>
                        <div className="ach-msg-bubble">{msg.message || msg.text || msg.body}</div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                <form className="ach-input-bar" onSubmit={handleSend}>
                  <input
                    className="ach-text-input"
                    placeholder="Type a message..."
                    value={text}
                    onChange={e => setText(e.target.value)}
                    disabled={sending}
                  />
                  <button className="ach-send-btn" type="submit" disabled={sending || !text.trim()}>
                    {sending ? <Loader size={14} className="ach-spin" /> : <Send size={14} />}
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

export default AdminChat;
