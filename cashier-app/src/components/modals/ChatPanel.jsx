/**
 * ChatPanel — Slide-in chat for cashier ↔ back-office messaging.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, MessageSquare, RefreshCw, Loader } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useStationStore } from '../../stores/useStationStore.js';
import api from '../../api/client.js';
import './ChatPanel.css';

export default function ChatPanel({ onClose }) {
  const cashier = useAuthStore(s => s.cashier);
  const station = useStationStore(s => s.station);
  const storeId = station?.storeId;
  const userId = cashier?.id;
  const channelId = storeId ? `store:${storeId}` : null;

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const pollRef = useRef(null);

  const loadMessages = useCallback(async () => {
    if (!channelId) return;
    try {
      const res = await api.get('/chat/messages', { params: { channelId, limit: 80 } });
      setMessages(res.data?.messages || []);
      // Mark as read
      api.post('/chat/read', { channelId }).catch(() => {});
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [channelId]);

  useEffect(() => {
    loadMessages();
    pollRef.current = setInterval(loadMessages, 5000);
    return () => clearInterval(pollRef.current);
  }, [loadMessages]);

  // Auto-scroll
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  const handleSend = async () => {
    if (!input.trim() || !channelId) return;
    setSending(true);
    try {
      await api.post('/chat/messages', { channelId, message: input.trim() });
      setInput('');
      loadMessages();
    } catch { /* ignore */ }
    finally { setSending(false); }
  };

  const isMine = (msg) => msg.senderId === userId;

  return (
    <div className="cp-overlay" onClick={onClose}>
      <div className="cp-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="cp-header">
          <div className="cp-header-left">
            <MessageSquare size={16} color="var(--green)" />
            <span className="cp-header-title">Store Chat</span>
          </div>
          <div className="cp-header-right">
            <button className="cp-icon-btn" onClick={loadMessages}><RefreshCw size={14} /></button>
            <button className="cp-icon-btn" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        {/* Messages */}
        <div className="cp-messages" ref={listRef}>
          {loading && <div className="cp-loading"><Loader size={14} className="cp-spin" /> Loading...</div>}

          {!loading && messages.length === 0 && (
            <div className="cp-empty">No messages yet. Start the conversation!</div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className={`cp-msg ${isMine(msg) ? 'cp-msg--mine' : 'cp-msg--other'}`}>
              {!isMine(msg) && (
                <div className="cp-msg-sender">
                  {msg.senderName}
                  {msg.senderRole && <span className="cp-msg-role">{msg.senderRole}</span>}
                </div>
              )}
              <div className={`cp-bubble ${isMine(msg) ? 'cp-bubble--mine' : 'cp-bubble--other'}`}>
                {msg.message}
              </div>
              <div className={`cp-msg-time ${isMine(msg) ? 'cp-msg-time--mine' : ''}`}>
                {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
        </div>

        {/* Input */}
        <div className="cp-input-bar">
          <input
            className="cp-input"
            placeholder="Type a message..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            autoFocus
          />
          <button className="cp-send-btn" onClick={handleSend} disabled={!input.trim() || sending}>
            {sending ? <Loader size={14} className="cp-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
