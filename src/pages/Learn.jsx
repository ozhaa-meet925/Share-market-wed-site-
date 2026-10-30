import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  GraduationCap,
  BookOpen,
  CheckCircle,
  HelpCircle,
  TrendingUp,
  Award,
  ChevronRight,
  ShieldAlert,
  BarChart2,
  PieChart,
} from 'lucide-react';

const courses = [
  {
    id: 'c1',
    category: 'Beginner Basics',
    title: 'Understanding Indian Stock Exchanges: NSE & BSE',
    readTime: '4 min read',
    summary:
      'Learn how the National Stock Exchange (NSE) and Bombay Stock Exchange (BSE) operate, including market timing (9:15 AM to 3:30 PM), order matching engines, and clearing corporations (NSCCL).',
    takeaways: [
      'Nifty 50 tracks top 50 diversified large-cap companies listed on NSE.',
      'BSE Sensex represents 30 established bellwether equities across 14 economic sectors.',
      'T+1 settlement cycle ensures shares and funds credit within 24 hours of trade execution.',
    ],
  },
  {
    id: 'c2',
    category: 'Technical Analysis',
    title: 'Mastering Candlestick Patterns & Price Action',
    readTime: '6 min read',
    summary:
      'Every candlestick tells a psychological story between buyers (bulls) and sellers (bears). Grasp OHLC (Open, High, Low, Close) components, wicks, and trend reversal setups.',
    takeaways: [
      'Bullish Hammer: Long lower shadow showing strong intraday buyer rejection of lower prices.',
      'Bearish Engulfing: A large red candle fully swallowing previous green body at key resistance.',
      'Doji: Open and Close are identical, signaling market indecision before breakout.',
    ],
  },
  {
    id: 'c3',
    category: 'Fundamental Analysis',
    title: 'Core Valuation Metrics: P/E, EPS & ROE',
    readTime: '5 min read',
    summary:
      'Evaluate if a company is trading at fair value, discount, or premium. Analyze quarterly earnings releases, Debt-to-Equity ratios, and Return on Equity (ROE).',
    takeaways: [
      'P/E (Price-to-Earnings): Market price per share divided by annual earnings per share.',
      'High P/E suggests high market growth expectations or potential valuation stretch.',
      'Consistent ROCE above 15% indicates superior capital allocation efficiency.',
    ],
  },
  {
    id: 'c4',
    category: 'Risk Management',
    title: 'Position Sizing & The 1% Portfolio Risk Rule',
    readTime: '5 min read',
    summary:
      'Capital preservation is the #1 rule in trading. Never risk more than 1% to 2% of total trading capital on any single trade setup, regardless of conviction.',
    takeaways: [
      'Position Size = (Total Capital × 1%) ÷ (Entry Price - Stop Loss Price).',
      'Never trade without a pre-calculated stop-loss order placed in the market.',
      'Risk-to-Reward ratio should always be at least 1:2 to ensure positive mathematical expectancy.',
    ],
  },
  {
    id: 'c5',
    category: 'IPO Investing',
    title: 'How to Analyze Mainboard & SME IPOs',
    readTime: '4 min read',
    summary:
      'Decipher Red Herring Prospectuses (DRHP), anchor investor allocations, price bands, lot sizes, and Grey Market Premium (GMP) before bidding.',
    takeaways: [
      'Review Promoter holding pre and post-issue; heavy dilution warrants caution.',
      'Examine whether IPO proceeds fund expansion (capex) vs existing investor exits (OFS).',
      'Check QIB (Qualified Institutional Buyers) subscription figures on Day 3.',
    ],
  },
];

const quizQuestions = [
  {
    question: 'What does a long lower wick on a daily candlestick typically indicate?',
    options: [
      'Sellers strongly overpowered buyers at market close',
      'Buyers rejected lower prices and pushed price back up before close',
      'The company announced unexpected stock split',
      'Trading volume was completely zero',
    ],
    answer: 1,
  },
  {
    question: 'According to sound risk management, what is the maximum recommended risk per trade?',
    options: ['10% to 15% of total capital', '50% of total capital', '1% to 2% of total capital', '25% with 5x leverage'],
    answer: 2,
  },
  {
    question: 'What is the current standard trade settlement cycle in Indian equity markets?',
    options: ['T+5 days', 'T+3 days', 'T+1 day', 'Instant blockchain only'],
    answer: 2,
  },
];

const Learn = () => {
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  const categories = ['ALL', 'Beginner Basics', 'Technical Analysis', 'Fundamental Analysis', 'Risk Management', 'IPO Investing'];

  const filteredCourses = courses.filter((c) =>
    selectedCategory === 'ALL' ? true : c.category === selectedCategory
  );

  const handleSelectAnswer = (qIndex, oIndex) => {
    if (quizSubmitted) return;
    setQuizAnswers((prev) => ({ ...prev, [qIndex]: oIndex }));
  };

  const calculateScore = () => {
    let score = 0;
    quizQuestions.forEach((q, idx) => {
      if (quizAnswers[idx] === q.answer) score++;
    });
    return score;
  };

  return (
    <div className="page learn-page">
      <div className="page-title learn-header-title">
        <div>
          <span>ShareMarket Academy</span>
          <h1>Master Market Analysis & Trading</h1>
        </div>
        <div className="learn-badge-pill">
          <GraduationCap size={18} />
          <span>Professional Certification Curriculum</span>
        </div>
      </div>

      {/* Categories Bar */}
      <section className="panel category-nav-panel">
        <div className="category-pill-list">
          {categories.map((cat) => (
            <button
              key={cat}
              className={`cat-pill-btn ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </section>

      {/* Courses Grid */}
      <section className="academy-courses-grid">
        {filteredCourses.map((course) => (
          <article className="panel academy-course-card" key={course.id}>
            <div className="course-card-top">
              <span className="course-category-tag">{course.category}</span>
              <span className="course-read-time">{course.readTime}</span>
            </div>
            <h2>{course.title}</h2>
            <p className="course-summary-text">{course.summary}</p>
            <div className="course-takeaways">
              <strong>Key Principles:</strong>
              <ul>
                {course.takeaways.map((item, i) => (
                  <li key={i}>
                    <CheckCircle size={14} className="check-bullet" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="course-footer-cta">
              <Link to="/paper-trading" className="practice-link">
                Practice in Paper Trading <ChevronRight size={14} />
              </Link>
            </div>
          </article>
        ))}
      </section>

      {/* Interactive Market IQ Quiz */}
      <section className="panel market-quiz-panel">
        <div className="section-heading">
          <div>
            <h3>
              <HelpCircle size={18} /> Interactive Market IQ Assessment
            </h3>
            <span>Test your knowledge of price action, position sizing, and exchange mechanics</span>
          </div>
          {quizSubmitted && (
            <div className="quiz-score-badge">
              <Award size={18} />
              <b>
                Score: {calculateScore()} / {quizQuestions.length}
              </b>
            </div>
          )}
        </div>

        <div className="quiz-questions-list">
          {quizQuestions.map((q, qIdx) => {
            const chosen = quizAnswers[qIdx];
            return (
              <div className="quiz-question-box" key={qIdx}>
                <h4>
                  Question {qIdx + 1}: {q.question}
                </h4>
                <div className="quiz-options-grid">
                  {q.options.map((opt, oIdx) => {
                    const isSelected = chosen === oIdx;
                    let optionClass = '';
                    if (quizSubmitted) {
                      if (oIdx === q.answer) optionClass = 'correct-opt';
                      else if (isSelected && isSelected !== q.answer) optionClass = 'wrong-opt';
                    } else if (isSelected) {
                      optionClass = 'selected-opt';
                    }

                    return (
                      <button
                        type="button"
                        key={oIdx}
                        className={`quiz-opt-btn ${optionClass}`}
                        onClick={() => handleSelectAnswer(qIdx, oIdx)}
                      >
                        <span className="opt-letter">{String.fromCharCode(65 + oIdx)}</span>
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="quiz-action-bar">
          {!quizSubmitted ? (
            <button
              type="button"
              className="primary-button submit-quiz-btn"
              disabled={Object.keys(quizAnswers).length < quizQuestions.length}
              onClick={() => setQuizSubmitted(true)}
            >
              Submit Quiz Answers
            </button>
          ) : (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setQuizAnswers({});
                setQuizSubmitted(false);
              }}
            >
              Retake Assessment
            </button>
          )}
        </div>
      </section>
    </div>
  );
};

export default Learn;
