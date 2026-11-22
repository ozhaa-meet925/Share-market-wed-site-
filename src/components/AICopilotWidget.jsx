import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Sparkles, Send, Bot, TrendingUp, ChevronRight, Minimize2, Languages } from 'lucide-react';
import { marketApi } from '../services/api';

const suggestedPrompts = [
  { label: 'RELIANCE 10Y high/low', prompt: '10-year high and low of RELIANCE' },
  { label: 'Analyze TCS', prompt: 'Analyze TCS' },
  { label: 'INFOSYS up or down?', prompt: 'Will INFOSYS go up or down?' },
  { label: 'Compare TCS & Infosys', prompt: 'Compare TCS and Infosys' },
  { label: 'NIFTY trend today', prompt: 'What is the NIFTY trend today?' },
];

const INDEX_ROUTES = {
  '/nifty': { symbol: 'NIFTY', name: 'NIFTY 50' },
  '/sensex': { symbol: 'SENSEX', name: 'BSE SENSEX' },
};

const renderMessageText = (text) => String(text || '')
  .split(/(\*\*[^*]+\*\*)/g)
  .map((part, index) => (part.startsWith('**') && part.endsWith('**') && part.length > 4
    ? <strong key={index}>{part.slice(2, -2)}</strong>
    : part));

const AICopilotWidget = ({ currentStock = null }) => {
  const location = useLocation();
  const routeStock = (() => {
    if (INDEX_ROUTES[location.pathname]) return { ...INDEX_ROUTES[location.pathname], exchange: 'NSE' };
    const match = location.pathname.match(/^\/stocks\/([^/]+)/);
    if (!match) return null;
    const symbol = decodeURIComponent(match[1]).toUpperCase();
    return { symbol, name: symbol, exchange: 'NSE' };
  })();
  const activeStock = currentStock || routeStock;

  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('en');
  const [aiStatus, setAIStatus] = useState(null);
  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: 'ai',
      text: 'Hello! I am your **ShareMarket AI Copilot**. I read up to 10 years of verified NSE/BSE daily data — never invented prices. Try "10-year high and low of RELIANCE".',
      time: 'Just now',
    },
  ]);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  useEffect(() => {
    let active = true;
    marketApi.getAIStatus()
      .then((status) => { if (active) setAIStatus(status); })
      .catch(() => { if (active) setAIStatus(null); });
    return () => { active = false; };
  }, []);

  const handleSend = async (textToSend) => {
    const query = (textToSend || input).trim();
    if (!query || loading) return;

    const userMsg = {
      id: Date.now(),
      sender: 'user',
      text: query,
      time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    };

    const history = messages
      .filter((message) => message.sender === 'user' || message.id !== 1)
      .slice(-8)
      .map((message) => ({ role: message.sender === 'user' ? 'user' : 'assistant', content: message.text }));

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const context = activeStock ? {
        symbol: activeStock.symbol,
        exchange: activeStock.exchange || 'NSE',
        price: activeStock.price,
        change: activeStock.changePercent,
        language,
      } : { language };

      const response = await marketApi.askAICopilot(query, context, history);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'ai',
          text: response.reply || 'No answer was returned for this question.',
          provider: response.provider,
          grounding: response.grounding,
          disclaimer: response.disclaimer,
          time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'ai',
          text: `${err.message || 'The AI copilot request failed.'}\n\nNo estimated prices were generated. Please retry once the research provider is reachable.`,
          time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-copilot-container" style={{ pointerEvents: 'auto' }}>
      {!isOpen && (
        <button
          type="button"
          className="ai-copilot-fab"
          onClick={() => setIsOpen(true)}
          aria-label="Open AI Copilot chat"
        >
          <span className="ai-fab-icon" aria-hidden="true">
            <Sparkles size={17} />
          </span>
          <span className="ai-fab-label">AI Copilot</span>
        </button>
      )}

      {isOpen && (
        <div className="ai-chat-window">
          <div className="ai-chat-header">
            <div className="ai-header-info">
              <div className="ai-bot-avatar">
                <Bot size={20} color="#ffffff" />
              </div>
              <div>
                <strong className="ai-chat-title">ShareMarket AI</strong>
                <span className="ai-online-badge">
                  <span className="ai-pulse-dot" />
                  {aiStatus?.llmConfigured ? 'LLM · research data' : 'Research API · rules-based'}
                </span>
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

          {activeStock && (
            <div className="ai-context-banner">
              <TrendingUp size={14} color="#00D09C" />
              <span>
                Context: <b>{activeStock.symbol}</b>
                {Number(activeStock.price) > 0 ? ` · ₹${Number(activeStock.price).toFixed(2)}` : ''}
                <span className="ai-context-note"> · research data</span>
              </span>
            </div>
          )}

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
                    {renderMessageText(m.text)}
                  </div>
                  {m.grounding && (
                    <div className="ai-grounding-tag">
                      {m.grounding.dataProvider} · delayed, not live
                      {Array.isArray(m.grounding.symbols) && m.grounding.symbols.length
                        ? ` · ${m.grounding.symbols.join(', ')}`
                        : ''}
                    </div>
                  )}
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

          <div className="ai-quick-prompts">
            <div className="ai-quick-header">
              <span>Suggested questions</span>
              <button
                type="button"
                className="ai-lang-toggle"
                onClick={() => setLanguage((current) => (current === 'en' ? 'hi' : 'en'))}
                title="Switch reply language"
              >
                <Languages size={12} />
                {language === 'en' ? 'EN' : 'हिं'}
              </button>
            </div>
            <div className="ai-quick-chip-row">
              {suggestedPrompts.map((item) => (
                <button
                  key={item.prompt}
                  type="button"
                  className="ai-prompt-chip"
                  onClick={() => handleSend(item.prompt)}
                  title={item.prompt}
                >
                  <span className="ai-prompt-chip-text">{item.label}</span>
                  <ChevronRight size={11} />
                </button>
              ))}
            </div>
          </div>

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
              placeholder={language === 'hi' ? 'Stocks, trend, Nifty ke baare mein poochhein...' : 'Ask about stocks, trends, Nifty...'}
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

          <div className="ai-disclaimer">
            Research data (delayed). Analysis only — not investment advice.
          </div>
        </div>
      )}
    </div>
  );
};

export default AICopilotWidget;
