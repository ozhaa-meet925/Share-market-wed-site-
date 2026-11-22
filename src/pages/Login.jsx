import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ShieldCheck,
  Smartphone,
  ScanFace,
  CheckCircle2,
  TrendingUp,
  BarChart2,
  Sparkles,
  ArrowRight,
  Lock,
} from 'lucide-react';
import { requestOtp, verifyOtp, loginWithPin, loginWithFace } from '../services/auth';
import BrandLogo from '../components/BrandLogo';
import FaceScanner from '../components/FaceScanner';
import './AuthModern.css';

const Login = () => {
  const navigate = useNavigate();

  // Mode: 'credentials' (Mobile/OTP/PIN) or 'face' (Biometric Face ID)
  const [authMethod, setAuthMethod] = useState('credentials');

  // Credentials steps: 'phone' -> 'otp' -> 'pin'
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [resendTimer, setResendTimer] = useState(30);
  const [demoOtp, setDemoOtp] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [faceSuccess, setFaceSuccess] = useState(false);

  const otpRefs = useRef([]);
  const pinRefs = useRef([]);

  const startResendTimer = () => {
    setResendTimer(30);
    let count = 30;
    const interval = setInterval(() => {
      count -= 1;
      setResendTimer(count);
      if (count <= 0) clearInterval(interval);
    }, 1000);
  };

  const sendOtp = async (rawPhone = phone) => {
    const target = String(rawPhone).replace(/\D/g, '').slice(-10);
    setError('');
    setBusy(true);
    try {
      const payload = await requestOtp(target);
      setDemoOtp(payload?.demoOtp || '');
      setOtp(['', '', '', '', '', '']);
      setStep('otp');
      startResendTimer();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handlePhoneSubmit = (e) => {
    e.preventDefault();
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      setError('Please enter a valid 10-digit Indian mobile number');
      return;
    }
    setPhone(cleanPhone);
    sendOtp(cleanPhone);
  };

  const applyOtpDigits = (index, raw) => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return;
    const next = [...otp];
    digits.slice(0, 6 - index).split('').forEach((digit, offset) => {
      next[index + offset] = digit;
    });
    setOtp(next);
    otpRefs.current[Math.min(index + digits.length, 5)]?.focus();
  };

  const handleOtpChange = (index, value) => {
    const digits = String(value).replace(/\D/g, '');
    if (!digits) return;
    if (digits.length > 1) {
      applyOtpDigits(index, digits);
      return;
    }
    const newOtp = [...otp];
    newOtp[index] = digits;
    setOtp(newOtp);
    if (index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const enteredOtp = otp.join('');
    if (enteredOtp.length !== 6) {
      setError('Please enter the full 6-digit OTP');
      return;
    }
    setBusy(true);
    try {
      const payload = await verifyOtp(phone, enteredOtp);
      setVerificationToken(payload.verificationToken);
      setPin(['', '', '', '']);
      setStep('pin');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const applyPinDigits = (index, raw) => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return;
    const next = [...pin];
    digits.slice(0, 4 - index).split('').forEach((digit, offset) => {
      next[index + offset] = digit;
    });
    setPin(next);
    pinRefs.current[Math.min(index + digits.length, 3)]?.focus();
  };

  const handlePinChange = (index, value) => {
    const digits = String(value).replace(/\D/g, '');
    if (!digits) return;
    if (digits.length > 1) {
      applyPinDigits(index, digits);
      return;
    }
    const newPin = [...pin];
    newPin[index] = digits;
    setPin(newPin);
    if (index < 3) pinRefs.current[index + 1]?.focus();
  };

  const handlePinKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      pinRefs.current[index - 1]?.focus();
    }
  };

  const handlePinSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const enteredPin = pin.join('');
    if (enteredPin.length !== 4) {
      setError('Please enter your 4-digit Trading PIN');
      return;
    }
    setBusy(true);
    try {
      await loginWithPin({ phone, pin: enteredPin, verificationToken });
      navigate('/profile');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Handle Biometric Face Scan Success
  const handleFaceScanSuccess = async (biometricData) => {
    setError('');
    setBusy(true);
    try {
      await loginWithFace({ phone });
      setFaceSuccess(true);
      setTimeout(() => {
        navigate('/profile');
      }, 1000);
    } catch (err) {
      setError(err.message || 'Face ID match could not be confirmed. Try mobile PIN.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-modern-wrapper">
      <div className="auth-split-container">
        {/* Left Branding Sidebar */}
        <aside className="auth-brand-sidebar">
          <div>
            <div className="auth-sidebar-brand">
              <BrandLogo size="medium" showTagline={false} />
            </div>
            <h2 className="auth-sidebar-title">
              Trade India's Markets with <span>Precision.</span>
            </h2>
            <p className="auth-sidebar-desc">
              Access real-time tick streaming, Level 2 depth, zero-risk paper trading, and institutional-grade charting.
            </p>

            <div className="auth-perks-list">
              <div className="auth-perk-item">
                <div className="auth-perk-icon">
                  <TrendingUp size={16} />
                </div>
                <div>
                  <strong>₹5,00,000 Paper Trading Funds</strong>
                  <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.74rem' }}>Zero risk capital for practicing strategies</div>
                </div>
              </div>

              <div className="auth-perk-item">
                <div className="auth-perk-icon">
                  <BarChart2 size={16} />
                </div>
                <div>
                  <strong>Live Candlestick Terminal</strong>
                  <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.74rem' }}>VWAP, Supertrend &amp; Renko studies</div>
                </div>
              </div>

              <div className="auth-perk-item">
                <div className="auth-perk-icon">
                  <ScanFace size={16} />
                </div>
                <div>
                  <strong>Biometric Face ID Unlock</strong>
                  <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.74rem' }}>Fast 1-tap facial recognition login</div>
                </div>
              </div>
            </div>
          </div>

          <div className="auth-sidebar-footer">
            <ShieldCheck size={16} style={{ color: '#22c97e' }} />
            <span>CDSL Demat · SEBI Compliant · Salted SHA-256</span>
          </div>
        </aside>

        {/* Right Form Card */}
        <main className="auth-form-card">
          {/* Method Switcher: Mobile PIN vs Biometric Face Scan */}
          <div className="auth-mode-toggle" role="tablist">
            <button
              type="button"
              className={`auth-mode-btn ${authMethod === 'credentials' ? 'active' : ''}`}
              onClick={() => {
                setAuthMethod('credentials');
                setError('');
              }}
            >
              <Smartphone size={15} /> Mobile &amp; PIN
            </button>
            <button
              type="button"
              className={`auth-mode-btn ${authMethod === 'face' ? 'active' : ''}`}
              onClick={() => {
                setAuthMethod('face');
                setError('');
              }}
            >
              <ScanFace size={15} /> Biometric Face ID
            </button>
          </div>

          {/* ══════════ METHOD 1: BIOMETRIC FACE ID SCAN ══════════ */}
          {authMethod === 'face' && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <span className="home-section-kicker">NEURAL FACE VERIFICATION</span>
                <h1 className="auth-title">Face ID Login</h1>
                <p className="auth-subtitle">Look directly into your camera to verify your investor identity</p>
              </div>

              {error && <div className="auth-error-banner">{error}</div>}

              {faceSuccess ? (
                <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                  <CheckCircle2 size={56} color="#22c55e" style={{ margin: '0 auto 12px' }} />
                  <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#22c55e' }}>Facial Match Confirmed!</h3>
                  <p style={{ color: 'var(--text-3)', fontSize: '0.85rem', marginTop: 4 }}>Redirecting to your investor desk…</p>
                </div>
              ) : (
                <FaceScanner onSuccess={handleFaceScanSuccess} mode="login" />
              )}

              <div className="auth-card-footer">
                Prefer password?{' '}
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--brand)', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                  onClick={() => setAuthMethod('credentials')}
                >
                  Switch to Mobile &amp; PIN
                </button>
              </div>
            </div>
          )}

          {/* ══════════ METHOD 2: MOBILE OTP & TRADING PIN ══════════ */}
          {authMethod === 'credentials' && (
            <div>
              {/* STEP 1: ENTER PHONE */}
              {step === 'phone' && (
                <div>
                  <span className="home-section-kicker">SECURE DEMAT ACCESS</span>
                  <h1 className="auth-title">Welcome to ShareMarket</h1>
                  <p className="auth-subtitle">Enter your registered mobile number to sign in</p>

                  <form onSubmit={handlePhoneSubmit}>
                    <div className="auth-phone-wrap">
                      <span className="auth-phone-prefix">+91</span>
                      <input
                        type="tel"
                        autoFocus
                        className="auth-phone-field"
                        placeholder="10-digit mobile number"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(-10))}
                      />
                    </div>

                    {error && <div className="auth-error-banner" style={{ marginTop: 14 }}>{error}</div>}

                    <button
                      type="submit"
                      className="auth-submit-btn"
                      disabled={phone.length < 10 || busy}
                    >
                      {busy ? 'Requesting OTP…' : 'Continue to Verify'} <ArrowRight size={16} />
                    </button>
                  </form>

                  <div className="auth-card-footer">
                    New to ShareMarket? <Link to="/register">Open Demat Account</Link>
                  </div>
                </div>
              )}

              {/* STEP 2: ENTER OTP */}
              {step === 'otp' && (
                <div>
                  <button
                    type="button"
                    className="groww-back-link"
                    onClick={() => setStep('phone')}
                    style={{ marginBottom: 12 }}
                  >
                    <ArrowLeft size={15} /> Edit mobile number
                  </button>

                  <h1 className="auth-title">Enter Verification Code</h1>
                  <p className="auth-subtitle">
                    Enter the 6-digit OTP sent to <b>+91 {phone}</b>
                  </p>

                  {demoOtp && (
                    <div className="auth-demo-banner">
                      <Sparkles size={16} />
                      <span>Demo Mode active: Your verification OTP is <b>{demoOtp}</b></span>
                    </div>
                  )}

                  <form onSubmit={handleOtpSubmit}>
                    <div className="auth-digit-grid">
                      {otp.map((digit, idx) => (
                        <input
                          key={idx}
                          ref={(el) => (otpRefs.current[idx] = el)}
                          type="text"
                          inputMode="numeric"
                          maxLength={1}
                          className="auth-digit-box"
                          value={digit}
                          autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                          onChange={(e) => handleOtpChange(idx, e.target.value)}
                          onPaste={(e) => {
                            e.preventDefault();
                            applyOtpDigits(idx, e.clipboardData.getData('text'));
                          }}
                          onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                          autoFocus={idx === 0}
                        />
                      ))}
                    </div>

                    {error && <div className="auth-error-banner">{error}</div>}

                    <button
                      type="submit"
                      className="auth-submit-btn"
                      disabled={otp.some((d) => !d) || busy}
                    >
                      {busy ? 'Validating…' : 'Verify & Next'} <ArrowRight size={16} />
                    </button>
                  </form>

                  <div className="auth-card-footer">
                    {resendTimer > 0 ? (
                      <span>Resend code in <b>{resendTimer}s</b></span>
                    ) : (
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', color: 'var(--brand)', fontWeight: 700, cursor: 'pointer' }}
                        onClick={() => sendOtp()}
                        disabled={busy}
                      >
                        Resend OTP
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 3: ENTER 4-DIGIT PIN */}
              {step === 'pin' && (
                <div>
                  <button
                    type="button"
                    className="groww-back-link"
                    onClick={() => setStep('otp')}
                    style={{ marginBottom: 12 }}
                  >
                    <ArrowLeft size={15} /> Back
                  </button>

                  <h1 className="auth-title">Enter Trading PIN</h1>
                  <p className="auth-subtitle">
                    Enter your 4-digit security PIN to access Demat portfolio
                  </p>

                  <form onSubmit={handlePinSubmit}>
                    <div className="auth-digit-grid">
                      {pin.map((digit, idx) => (
                        <input
                          key={idx}
                          ref={(el) => (pinRefs.current[idx] = el)}
                          type="password"
                          inputMode="numeric"
                          maxLength={1}
                          className="auth-digit-box"
                          value={digit}
                          autoComplete="off"
                          onChange={(e) => handlePinChange(idx, e.target.value)}
                          onPaste={(e) => {
                            e.preventDefault();
                            applyPinDigits(idx, e.clipboardData.getData('text'));
                          }}
                          onKeyDown={(e) => handlePinKeyDown(idx, e)}
                          autoFocus={idx === 0}
                        />
                      ))}
                    </div>

                    {error && <div className="auth-error-banner">{error}</div>}

                    <button
                      type="submit"
                      className="auth-submit-btn"
                      disabled={pin.some((d) => !d) || busy}
                    >
                      {busy ? 'Signing in…' : 'Access Trading Desk'} <Lock size={16} />
                    </button>
                  </form>

                  <div className="auth-card-footer">
                    Forgot Trading PIN? <Link to="/register">Reset with Demat KYC</Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default Login;
