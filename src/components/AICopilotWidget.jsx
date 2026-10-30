import { useState, useRef, useEffect } from 'react';
import { Sparkles, MessageSquare, Send, X, Bot, TrendingUp, ShieldCheck, ChevronRight, Minimize2 } from 'lucide-react';
import { marketApi } from '../services/api';

const suggestedPrompts = [
  'What is the NIFTY 50 intraday outlook?',
  'What are the key support & resistance levels for RELIANCE?',
  'What is the recommended balanced portfolio allocation rule?',
];

const AICopilotWidget = ({ currentStock = null }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: 'ai',
      text: 'Hello! I am your **ShareMarket AI Copilot**. Ask me anything about Indian markets, technical trends, support & resistance levels, or portfolio allocation strategies.',
      time: 'Just now',
    },
  ]);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [messages, isOpen]);

  const handleSend = async (textToSend) => {
    const query = (textToSend || input).trim();
    if (!query || loading) return;

    const userMsg = {
      id: Date.now(),
      sender: 'user',
      text: query,
      time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const context = currentStock ? {
        symbol: currentStock.symbol,
        price: currentStock.price,
        change: currentStock.changePercent,
      } : {};

      const response = await marketApi.askAICopilot(query, context);
      const aiReply = response.reply || 'Market analysis completed.';

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'ai',
          text: aiReply,
          provider: response.provider,
          time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'ai',
          text: 'Unable to reach market intelligence server. Please check backend connection.',
          time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="ai-copilot-container"
      style={{
        position: 'fixed',
        bottom: '28px',
        right: '28px',
        zIndex: 999999,
        pointerEvents: 'auto',
      }}
    >
      {/* Floating Trigger Button */}
      {!isOpen && (
        <button
          type="button"
          className="ai-copilot-fab"
          onClick={() => setIsOpen(true)}
          aria-label="Open AI Trading Copilot"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 18px',
            borderRadius: '999px',
            background: 'linear-gradient(135deg, #0d6f4e 0%, #00D09C 100%)',
            color: '#ffffff',
            border: '2px solid rgba(255, 255, 255, 0.4)',
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(0, 208, 156, 0.45), 0 0 16px rgba(0, 208, 156, 0.35)',
            fontSize: '0.9rem',
            fontWeight: 700,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#ffffff',
              boxShadow: '0 0 8px #ffffff',
              display: 'inline-block',
            }}
          />
          <Sparkles size={18} />
          <span>AI Copilot</span>
        </button>
      )}

      {/* Floating AI Chat Window */}
      {isOpen && (
        <div className="ai-chat-window">
          {/* Header */}
          <div className="ai-chat-header">
            <div className="ai-header-info">
              <div className="ai-bot-avatar">
                <Bot size={20} color="#ffffff" />
              </div>
              <div>
                <strong className="ai-chat-title">ShareMarket AI</strong>
                <span className="ai-online-badge"><span className="ai-pulse-dot" /> Live Market Analyst</span>
              </div>
            </div>
            <button
              type="button"
              className="ai-close-btn"
              onClick={() => setIsOpen(false)}
              aria-label="Close"
            >
              <Minimize2 size={18} />
            </button>
          </div>

          {/* Active Context Banner */}
          {currentStock && (
            <div className="ai-context-banner">
              <TrendingUp size={14} color="#00D09C" />
              <span>Analyzing: <b>{currentStock.symbol}</b> ({currentStock.isDemo && Number(currentStock.price) > 0 ? `demo ₹${currentStock.price.toFixed(2)} · not real` : currentStock.isLive && Number(currentStock.price) > 0 ? `₹${currentStock.price.toFixed(2)}` : 'live quote unavailable'})</span>
            </div>
          )}

          {/* Messages Body */}
          <div className="ai-messages-body">
            {messages.map((m) => (
              <div key={m.id} className={`ai-message-row ${m.sender === 'user' ? 'user-row' : 'ai-row'}`}>
                {m.sender === 'ai' && (
                  <div className="ai-msg-avatar">
                    <Sparkles size={14} color="#00D09C" />
                  </div>
                )}
                <div className={`ai-bubble ${m.sender === 'user' ? 'user-bubble' : 'ai-bubble'}`}>
                  <div className="ai-bubble-content" style={{ whiteSpace: 'pre-line' }}>
                    {m.text}
                  </div>
                  <div className="ai-bubble-footer">
                    <span className="ai-msg-time">{m.time}</span>
                    {m.provider && <span className="ai-provider-tag">{m.provider}</span>}
                  </div>
                </div>
              </div>
            ))}

            {loading && (
              <div className="ai-message-row ai-row">
                <div className="ai-msg-avatar">
                  <Sparkles size={14} color="#00D09C" />
                </div>
                <div className="ai-bubble ai-bubble ai-loading-bubble">
                  <span className="ai-typing-dot" />
                  <span className="ai-typing-dot" />
                  <span className="ai-typing-dot" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompts */}
          <div className="ai-quick-prompts" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 14px' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted, #94a3b8)', fontWeight: 600 }}>Suggested Questions:</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {suggestedPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="ai-prompt-chip"
                  onClick={() => handleSend(prompt)}
                  style={{ whiteSpace: 'normal', textAlign: 'left', lineHeight: 1.3 }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          {/* Chat Input */}
          <form
            className="ai-input-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
          >
            <input
              type="text"
              className="ai-input-field"
              placeholder="Ask about stocks, trends, Nifty..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              type="submit"
              className="ai-send-btn"
              disabled={!input.trim() || loading}
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default AICopilotWidget;
