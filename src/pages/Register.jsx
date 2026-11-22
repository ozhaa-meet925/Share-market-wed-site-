import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ShieldCheck,
  TrendingUp,
  BarChart2,
  ScanFace,
  Lock,
  Building2,
  CreditCard,
  Sparkles,
  ArrowRight,
  UserCheck,
} from 'lucide-react';
import { registerAccount, requestOtp, verifyOtp } from '../services/auth';
import BrandLogo from '../components/BrandLogo';
import FaceScanner from '../components/FaceScanner';
import './AuthModern.css';

const banks = [
  'HDFC Bank',
  'State Bank of India',
  'ICICI Bank',
  'Axis Bank',
  'Kotak Mahindra Bank',
  'Punjab National Bank',
  'Bank of Baroda',
];

const Register = () => {
  const navigate = useNavigate();

  // Steps:
  // 1: Phone & Name
  // 2: Mobile OTP
  // 3: 4-Digit PIN
  // 4: PAN Card
  // 5: SEBI Biometric Face IPV Scan
  // 6: Bank Account
  // 7: Account Created Success
  const [step, setStep] = useState(1);

  // Form State
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [pin, setPin] = useState(['', '', '', '']);
  const [pan, setPan] = useState('');
  const [faceVerified, setFaceVerified] = useState(false);
  const [bank, setBank] = useState('HDFC Bank');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('HDFC0001234');
  const [error, setError] = useState('');
  const [demoOtp, setDemoOtp] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [createdAccount, setCreatedAccount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

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

  // STEP 1: Phone submission
  const handlePhoneSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      setError('Please enter a valid 10-digit Indian mobile number');
      return;
    }
    if (name.trim().length < 2) {
      setError('Please enter your full legal name as per PAN card');
      return;
    }
    setPhone(cleanPhone);
    setBusy(true);
    try {
      const payload = await requestOtp(cleanPhone);
      setDemoOtp(payload?.demoOtp || '');
      setOtp(['', '', '', '', '', '']);
      setStep(2);
      startResendTimer();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resendOtp = async () => {
    setError('');
    setBusy(true);
    try {
      const payload = await requestOtp(phone);
      setDemoOtp(payload?.demoOtp || '');
      setOtp(['', '', '', '', '', '']);
      startResendTimer();
      otpRefs.current[0]?.focus();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // STEP 2: OTP submission
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
    const entered = otp.join('');
    if (entered.length !== 6) {
      setError('Please enter the full 6-digit OTP');
      return;
    }
    setBusy(true);
    try {
      const payload = await verifyOtp(phone, entered);
      setVerificationToken(payload.verificationToken);
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // STEP 3: Setup 4-digit PIN
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

  const handlePinSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (pin.join('').length !== 4) {
      setError('Set a 4-digit Trading PIN');
      return;
    }
    if (
      /^(\d)\1{3}$/.test(pin.join('')) ||
      '0123456789'.includes(pin.join('')) ||
      '9876543210'.includes(pin.join(''))
    ) {
      setError('Choose a secure PIN. Avoid repeated digits (e.g. 1111) and simple sequences.');
      return;
    }
    setStep(4);
  };

  // STEP 4: PAN Card Verification
  const handlePanSubmit = (e) => {
    e.preventDefault();
    setError('');
    const cleanPan = pan.trim().toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(cleanPan)) {
      setError('Enter a valid 10-digit PAN format (e.g. ABCDE1234F)');
      return;
    }
    // Proceed to Step 5: SEBI Biometric Face IPV Scan
    setStep(5);
  };

  // STEP 5: Biometric Face IPV Scan Success
  const handleFaceScanSuccess = (biometricPayload) => {
    setFaceVerified(true);
    setTimeout(() => {
      setStep(6);
    }, 1200);
  };

  // STEP 6: Bank details submission & Account Creation
  const handleBankSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const cleanAccount = accountNumber.replace(/\s/g, '');
    if (!/^\d{8,18}$/.test(cleanAccount)) {
      setError('Enter a valid bank account number (8 to 18 digits)');
      return;
    }
    const cleanIfsc = ifsc.trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc)) {
      setError('Enter a valid IFSC code (e.g. HDFC0001234)');
      return;
    }

    setBusy(true);
    try {
      const user = await registerAccount({
        name,
        email,
        phone,
        pin: pin.join(''),
        pan: pan.toUpperCase(),
        bank,
        accountNumber: cleanAccount,
        ifsc: cleanIfsc,
        verificationToken,
        faceEnrolled: true,
      });
      setCreatedAccount(user);
      setStep(7);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const stepLabels = [
    'Profile',
    'Verify OTP',
    'Security PIN',
    'PAN KYC',
    'Face IPV',
    'Bank Link',
    'Complete',
  ];

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
              Start Investing with <span>Zero Brokerage.</span>
            </h2>
            <p className="auth-sidebar-desc">
              Open a digital Demat account in 3 minutes. Complete paperless KYC, biometric verification and instant bank integration.
            </p>

            <div className="auth-perks-list">
              <div className="auth-perk-item">
                <div className="auth-perk-icon">
                  <TrendingUp size={16} />
                </div>
                <div>
                  <strong>₹5,00,000 Virtual Capital</strong>
                  <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.74rem' }}>Included free for learning &amp; testing</div>
                </div>
              </div>

              <div className="auth-perk-item">
                <div className="auth-perk-icon">
                  <ScanFace size={16} />
                </div>
                <div>
                  <strong>SEBI Digital Face IPV</strong>
                  <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.74rem' }}>Instant in-person camera verification</div>
                </div>
              </div>

              <div className="auth-perk-item">
                <div className="auth-perk-icon">
                  <CreditCard size={16} />
                </div>
                <div>
                  <strong>Direct Bank Settlements</strong>
                  <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.74rem' }}>UPI mandate &amp; T+1 stock payouts</div>
                </div>
              </div>
            </div>
          </div>

          <div className="auth-sidebar-footer">
            <ShieldCheck size={16} style={{ color: '#22c97e' }} />
            <span>CDSL Registered · Bank Grade 256-Bit TLS</span>
          </div>
        </aside>

        {/* Right Form Card */}
        <main className="auth-form-card">
          {/* Stepper Progress Indicator */}
          {step < 7 && (
            <div className="auth-stepper-wrap">
              <div className="auth-stepper-indicator">
                <span>Step {step} of 6: <b>{stepLabels[step - 1]}</b></span>
                <span>{Math.round((step / 6) * 100)}% Complete</span>
              </div>
              <div className="auth-stepper-track">
                <div className="auth-stepper-fill" style={{ width: `${(step / 6) * 100}%` }} />
              </div>
            </div>
          )}

          {/* ══════════ STEP 1: Full Name & Mobile ══════════ */}
          {step === 1 && (
            <div>
              <span className="home-section-kicker">INSTANT DEMAT ONBOARDING</span>
              <h1 className="auth-title">Open Demat Account</h1>
              <p className="auth-subtitle">Get started with Indian equities, F&amp;O and commodities</p>

              <form onSubmit={handlePhoneSubmit}>
                <div className="groww-field-group">
                  <label className="groww-label">Full Legal Name (as per PAN)</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    className="groww-input"
                    placeholder="e.g. Ramesh Chandra"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="groww-field-group">
                  <label className="groww-label">Email Address (Optional)</label>
                  <input
                    type="email"
                    className="groww-input"
                    placeholder="name@gmail.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div className="groww-field-group">
                  <label className="groww-label">Mobile Number</label>
                  <div className="auth-phone-wrap">
                    <span className="auth-phone-prefix">+91</span>
                    <input
                      type="tel"
                      required
                      className="auth-phone-field"
                      placeholder="10-digit number"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(-10))}
                    />
                  </div>
                </div>

                {error && <div className="auth-error-banner">{error}</div>}

                <button
                  type="submit"
                  className="auth-submit-btn"
                  disabled={!name || phone.length < 10 || busy}
                >
                  {busy ? 'Requesting OTP…' : 'Verify Mobile Number'} <ArrowRight size={16} />
                </button>
              </form>

              <div className="auth-card-footer">
                Already registered? <Link to="/login">Sign in here</Link>
              </div>
            </div>
          )}

          {/* ══════════ STEP 2: Mobile OTP ══════════ */}
          {step === 2 && (
            <div>
              <button
                type="button"
                className="groww-back-link"
                onClick={() => setStep(1)}
                style={{ marginBottom: 12 }}
              >
                <ArrowLeft size={15} /> Edit phone number
              </button>

              <h1 className="auth-title">Verify Mobile Number</h1>
              <p className="auth-subtitle">
                Enter the 6-digit OTP sent to <b>+91 {phone}</b>
              </p>

              {demoOtp && (
                <div className="auth-demo-banner">
                  <Sparkles size={16} />
                  <span>Demo Mode active: Your registration OTP is <b>{demoOtp}</b></span>
                </div>
              )}

              <form onSubmit={handleOtpSubmit}>
                <div className="auth-digit-grid">
                  {otp.map((d, i) => (
                    <input
                      key={i}
                      ref={(el) => (otpRefs.current[i] = el)}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      className="auth-digit-box"
                      value={d}
                      autoComplete={i === 0 ? 'one-time-code' : 'off'}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      onPaste={(e) => {
                        e.preventDefault();
                        applyOtpDigits(i, e.clipboardData.getData('text'));
                      }}
                      autoFocus={i === 0}
                    />
                  ))}
                </div>

                {error && <div className="auth-error-banner">{error}</div>}

                <button
                  type="submit"
                  className="auth-submit-btn"
                  disabled={otp.some((d) => !d) || busy}
                >
                  {busy ? 'Verifying…' : 'Confirm & Continue'} <ArrowRight size={16} />
                </button>
              </form>

              <div className="auth-card-footer">
                {resendTimer > 0 ? (
                  <span>Resend code in <b>{resendTimer}s</b></span>
                ) : (
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: 'var(--brand)', fontWeight: 700, cursor: 'pointer' }}
                    onClick={resendOtp}
                    disabled={busy}
                  >
                    Resend OTP
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ══════════ STEP 3: 4-Digit Trading PIN ══════════ */}
          {step === 3 && (
            <div>
              <h1 className="auth-title">Set 4-Digit Trading PIN</h1>
              <p className="auth-subtitle">Create a private PIN to authorize order execution &amp; withdrawals</p>

              <form onSubmit={handlePinSubmit}>
                <div className="auth-digit-grid">
                  {pin.map((d, i) => (
                    <input
                      key={i}
                      ref={(el) => (pinRefs.current[i] = el)}
                      type="password"
                      inputMode="numeric"
                      maxLength={1}
                      className="auth-digit-box"
                      value={d}
                      autoComplete="off"
                      onChange={(e) => handlePinChange(i, e.target.value)}
                      onKeyDown={(e) => handlePinKeyDown(i, e)}
                      onPaste={(e) => {
                        e.preventDefault();
                        applyPinDigits(i, e.clipboardData.getData('text'));
                      }}
                      autoFocus={i === 0}
                    />
                  ))}
                </div>

                {error && <div className="auth-error-banner">{error}</div>}

                <button
                  type="submit"
                  className="auth-submit-btn"
                  disabled={pin.some((d) => !d)}
                >
                  Save PIN &amp; Proceed <Lock size={16} />
                </button>
              </form>
            </div>
          )}

          {/* ══════════ STEP 4: PAN Card ══════════ */}
          {step === 4 && (
            <div>
              <h1 className="auth-title">Enter PAN Card Details</h1>
              <p className="auth-subtitle">SEBI regulation requires PAN for all Indian demat accounts</p>

              <form onSubmit={handlePanSubmit}>
                <div className="groww-field-group">
                  <label className="groww-label">Permanent Account Number (PAN)</label>
                  <input
                    type="text"
                    maxLength={10}
                    required
                    autoFocus
                    style={{ textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 700, fontSize: '1.1rem' }}
                    className="groww-input"
                    placeholder="ABCDE1234F"
                    value={pan}
                    onChange={(e) => setPan(e.target.value.toUpperCase())}
                  />
                </div>

                <div className="auth-demo-banner">
                  <ShieldCheck size={18} />
                  <span>Only the last 4 digits are stored on this server for privacy; full PAN is encrypted.</span>
                </div>

                {error && <div className="auth-error-banner">{error}</div>}

                <button
                  type="submit"
                  className="auth-submit-btn"
                  disabled={pan.length < 10}
                >
                  Verify PAN with KRA <ArrowRight size={16} />
                </button>
              </form>
            </div>
          )}

          {/* ══════════ STEP 5: SEBI Biometric Face IPV Scan ══════════ */}
          {step === 5 && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <span className="home-section-kicker">SEBI COMPLIANT IPV</span>
                <h1 className="auth-title">Biometric Face Verification</h1>
                <p className="auth-subtitle">In-Person Verification (IPV) to confirm your real identity</p>
              </div>

              {faceVerified ? (
                <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                  <CheckCircle2 size={56} color="#22c55e" style={{ margin: '0 auto 12px' }} />
                  <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#22c55e' }}>SEBI Face IPV Confirmed!</h3>
                  <p style={{ color: 'var(--text-3)', fontSize: '0.85rem', marginTop: 4 }}>Proceeding to Bank Account setup…</p>
                </div>
              ) : (
                <FaceScanner onSuccess={handleFaceScanSuccess} mode="register" />
              )}
            </div>
          )}

          {/* ══════════ STEP 6: Link Bank Account ══════════ */}
          {step === 6 && (
            <div>
              <h1 className="auth-title">Link Primary Bank Account</h1>
              <p className="auth-subtitle">For automated fund transfers &amp; IPO UPI mandates</p>

              <form onSubmit={handleBankSubmit}>
                <div className="groww-field-group">
                  <label className="groww-label">Select Bank Name</label>
                  <select
                    className="groww-input"
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                  >
                    {banks.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>

                <div className="groww-field-group">
                  <label className="groww-label">Bank Account Number</label>
                  <input
                    type="password"
                    required
                    className="groww-input"
                    placeholder="Enter account number"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                  />
                </div>

                <div className="groww-field-group">
                  <label className="groww-label">Bank IFSC Code</label>
                  <input
                    type="text"
                    required
                    style={{ textTransform: 'uppercase', letterSpacing: '1px' }}
                    className="groww-input"
                    placeholder="e.g. HDFC0001234"
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                  />
                </div>

                {error && <div className="auth-error-banner">{error}</div>}

                <button
                  type="submit"
                  className="auth-submit-btn"
                  disabled={busy}
                >
                  {busy ? 'Setting up Demat Account…' : 'Complete Registration'} <CheckCircle2 size={16} />
                </button>
              </form>
            </div>
          )}

          {/* ══════════ STEP 7: Demat Ready Success ══════════ */}
          {step === 7 && (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div
                style={{
                  margin: '10px auto 16px',
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  background: 'rgba(34, 197, 94, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CheckCircle2 size={48} color="#22c55e" />
              </div>

              <span className="home-section-kicker">DEMAT ACTIVATED</span>
              <h1 className="auth-title" style={{ fontSize: '1.8rem', marginTop: 6 }}>
                Welcome, {name}!
              </h1>
              <p className="auth-subtitle" style={{ maxWidth: 380, margin: '0 auto 20px' }}>
                Your ShareMarket PRO Demat Account has been created and verified.
              </p>

              <div
                style={{
                  background: 'var(--surface-2)',
                  borderRadius: 14,
                  padding: 16,
                  textAlign: 'left',
                  margin: '0 0 24px',
                  border: '1px solid var(--line-soft)',
                  display: 'grid',
                  gap: 10,
                  fontSize: '0.88rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-3)' }}>Client UCC ID:</span>
                  <b style={{ fontFamily: 'monospace' }}>{createdAccount?.dematId || 'SM-9823411'}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-3)' }}>Biometric Face IPV:</span>
                  <b style={{ color: '#22c55e' }}>Enrolled &amp; Verified ✓</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-3)' }}>Virtual Trading Cash:</span>
                  <b style={{ color: 'var(--brand)' }}>₹5,00,000 Credited</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-3)' }}>Depository:</span>
                  <b>CDSL India</b>
                </div>
              </div>

              <button
                type="button"
                className="auth-submit-btn"
                onClick={() => navigate('/profile')}
              >
                Launch Investor Profile <ArrowRight size={16} />
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default Register;
