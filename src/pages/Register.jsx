import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ShieldCheck, Upload, User, CreditCard } from 'lucide-react';
import { registerUser } from '../services/auth';

const banks = ['HDFC Bank', 'State Bank of India', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank', 'Punjab National Bank'];

const GrowwRegister = () => {
  const navigate = useNavigate();
  // Steps: 1: 'phone' -> 2: 'otp' -> 3: 'pin' -> 4: 'pan' -> 5: 'bank' -> 6: 'success'
  const [step, setStep] = useState(1);

  // Form State
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [pin, setPin] = useState(['', '', '', '']);
  const [pan, setPan] = useState('');
  const [bank, setBank] = useState('HDFC Bank');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [error, setError] = useState('');

  const otpRefs = useRef([]);
  const pinRefs = useRef([]);

  // STEP 1: Phone submission
  const handlePhoneSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (phone.replace(/\D/g, '').length !== 10) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }
    if (!name.trim()) {
      setError('Please enter your full name as per PAN');
      return;
    }
    setStep(2);
  };

  // STEP 2: OTP submission
  const handleOtpChange = (index, value) => {
    if (isNaN(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    if (value && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpSubmit = (e) => {
    e.preventDefault();
    setError('');
    const entered = otp.join('');
    if (entered.length !== 6) {
      setError('Please enter the full 6-digit OTP');
      return;
    }
    if (entered !== '123456' && entered !== '000000') {
      setError('Enter valid OTP (Use demo OTP: 123456)');
      return;
    }
    setStep(3);
  };

  // STEP 3: Setup 4-digit PIN
  const handlePinChange = (index, value) => {
    if (isNaN(value)) return;
    const newPin = [...pin];
    newPin[index] = value.slice(-1);
    setPin(newPin);
    if (value && index < 3) pinRefs.current[index + 1]?.focus();
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
    setStep(4);
  };

  // STEP 4: PAN Verification
  const handlePanSubmit = (e) => {
    e.preventDefault();
    setError('');
    const cleanPan = pan.trim().toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(cleanPan)) {
      setError('Enter a valid 10-digit PAN format (e.g. ABCDE1234F)');
      return;
    }
    setStep(5);
  };

  // STEP 5: Bank details submission
  const handleBankSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (accountNumber.length < 8) {
      setError('Enter a valid bank account number');
      return;
    }
    if (!ifsc.trim()) {
      setError('Enter bank IFSC code (e.g. HDFC0001234)');
      return;
    }

    try {
      const dematId = `SM-120816${Math.floor(10000000 + Math.random() * 90000000)}`;
      registerUser({
        name,
        email: email || `${phone}@sharemarket.in`,
        password: pin.join(''),
        phone,
        pan: pan.toUpperCase(),
        bank,
        accountHolder: name,
        dematBroker: 'ShareMarket PRO',
        dematId,
      });
      setStep(6);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="groww-auth-wrapper">
      <div className="groww-auth-card">
        {/* ShareMarket Website Brand Header */}
        <div className="groww-header" style={{ marginBottom: 20 }}>
          <div className="groww-logo-mark">
            <svg width="42" height="42" viewBox="0 0 48 48" fill="none">
              <rect width="48" height="48" rx="12" fill="#0d6f4e" />
              <line x1="14" y1="20" x2="14" y2="34" stroke="white" strokeWidth="2" strokeOpacity="0.6" />
              <rect x="12" y="24" width="4" height="8" rx="1.5" fill="#ffffff" />
              <line x1="22" y1="15" x2="22" y2="33" stroke="white" strokeWidth="2" strokeOpacity="0.6" />
              <rect x="20" y="18" width="4" height="12" rx="1.5" fill="#ffffff" />
              <line x1="30" y1="11" x2="30" y2="31" stroke="white" strokeWidth="2" strokeOpacity="0.6" />
              <rect x="28" y="13" width="4" height="15" rx="1.5" fill="#ffffff" />
              <path d="M12 28L21 20L27 23L36 12" stroke="#a7f3d0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M31 12H36V17" stroke="#a7f3d0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <span className="groww-brand-name" style={{ display: 'block', lineHeight: 1.1 }}>ShareMarket</span>
            <small style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 700, letterSpacing: '1px' }}>PRO TRADING</small>
          </div>
        </div>

        {/* Stepper Progress Bar */}
        <div className="groww-progress-bar">
          <div className="groww-progress-fill" style={{ width: `${(step / 6) * 100}%` }} />
        </div>

        {/* STEP 1: Full Name & Mobile Number */}
        {step === 1 && (
          <div className="groww-step-container">
            <h1 className="groww-title">Open Demat Account</h1>
            <p className="groww-subtitle">Enter your details to get started with zero brokerage</p>

            <form onSubmit={handlePhoneSubmit}>
              <div className="groww-field-group">
                <label className="groww-label">Full Name (as on PAN card)</label>
                <input
                  type="text"
                  required
                  className="groww-input"
                  placeholder="e.g. Ramesh Kumar"
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
                <div className="groww-phone-input-group">
                  <span className="groww-country-code">+91</span>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    className="groww-phone-input"
                    placeholder="10 digit number"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>

              {error && <div className="groww-error-alert">{error}</div>}

              <button
                type="submit"
                className="groww-continue-btn"
                disabled={!name || phone.length < 10}
              >
                Send OTP
              </button>
            </form>

            <div className="groww-login-footer">
              Already have a ShareMarket account? <Link to="/login">Login</Link>
            </div>
          </div>
        )}

        {/* STEP 2: Verify Mobile OTP */}
        {step === 2 && (
          <div className="groww-step-container">
            <button type="button" className="groww-back-link" onClick={() => setStep(1)}>
              <ArrowLeft size={16} /> Edit number
            </button>

            <h1 className="groww-title">Verify Mobile</h1>
            <p className="groww-subtitle">Enter 6-digit OTP sent to <b>+91 {phone}</b></p>

            <div className="groww-demo-hint">Demo OTP: <b>123456</b></div>

            <form onSubmit={handleOtpSubmit}>
              <div className="groww-otp-boxes">
                {otp.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => (otpRefs.current[i] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    className="groww-otp-box"
                    value={d}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    autoFocus={i === 0}
                  />
                ))}
              </div>

              {error && <div className="groww-error-alert">{error}</div>}

              <button
                type="submit"
                className="groww-continue-btn"
                disabled={otp.some((d) => !d)}
              >
                Verify & Next
              </button>
            </form>
          </div>
        )}

        {/* STEP 3: Create 4-Digit Security PIN */}
        {step === 3 && (
          <div className="groww-step-container">
            <h1 className="groww-title">Set Trading PIN</h1>
            <p className="groww-subtitle">Create a 4-digit security PIN for your orders and transactions</p>

            <form onSubmit={handlePinSubmit}>
              <div className="groww-pin-boxes">
                {pin.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => (pinRefs.current[i] = el)}
                    type="password"
                    inputMode="numeric"
                    maxLength={1}
                    className="groww-pin-box"
                    value={d}
                    onChange={(e) => handlePinChange(i, e.target.value)}
                    onKeyDown={(e) => handlePinKeyDown(i, e)}
                    autoFocus={i === 0}
                  />
                ))}
              </div>

              {error && <div className="groww-error-alert">{error}</div>}

              <button
                type="submit"
                className="groww-continue-btn"
                disabled={pin.some((d) => !d)}
              >
                Set PIN
              </button>
            </form>
          </div>
        )}

        {/* STEP 4: PAN Card Verification */}
        {step === 4 && (
          <div className="groww-step-container">
            <h1 className="groww-title">Enter PAN Details</h1>
            <p className="groww-subtitle">Required for opening your SEBI registered Demat account</p>

            <form onSubmit={handlePanSubmit}>
              <div className="groww-field-group">
                <label className="groww-label">PAN Card Number</label>
                <input
                  type="text"
                  maxLength={10}
                  required
                  autoFocus
                  style={{ textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 600 }}
                  className="groww-input"
                  placeholder="ABCDE1234F"
                  value={pan}
                  onChange={(e) => setPan(e.target.value.toUpperCase())}
                />
              </div>

              <div className="groww-tip-box">
                <ShieldCheck size={18} color="#00D09C" />
                <span>Your PAN details are securely checked with the Income Tax database.</span>
              </div>

              {error && <div className="groww-error-alert">{error}</div>}

              <button
                type="submit"
                className="groww-continue-btn"
                disabled={pan.length < 10}
              >
                Verify PAN
              </button>
            </form>
          </div>
        )}

        {/* STEP 5: Link Bank Account */}
        {step === 5 && (
          <div className="groww-step-container">
            <h1 className="groww-title">Link Bank Account</h1>
            <p className="groww-subtitle">For fund deposits and withdrawals on ShareMarket</p>

            <form onSubmit={handleBankSubmit}>
              <div className="groww-field-group">
                <label className="groww-label">Select Bank</label>
                <select
                  className="groww-input"
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                >
                  {banks.map((b) => <option key={b} value={b}>{b}</option>)}
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
                <label className="groww-label">IFSC Code</label>
                <input
                  type="text"
                  required
                  style={{ textTransform: 'uppercase' }}
                  className="groww-input"
                  placeholder="e.g. HDFC0001234"
                  value={ifsc}
                  onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                />
              </div>

              {error && <div className="groww-error-alert">{error}</div>}

              <button type="submit" className="groww-continue-btn">
                Complete Demat Setup
              </button>
            </form>
          </div>
        )}

        {/* STEP 6: Success! Demat Account Opened */}
        {step === 6 && (
          <div className="groww-step-container" style={{ textAlign: 'center' }}>
            <div style={{ margin: '20px auto 14px', width: 68, height: 68, borderRadius: '50%', background: 'rgba(0, 208, 156, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle2 size={44} color="#00D09C" />
            </div>

            <h1 className="groww-title">Demat Account Ready!</h1>
            <p className="groww-subtitle">
              Welcome aboard, <b>{name}</b>. Your ShareMarket Demat Account has been created and verified.
            </p>

            <div className="groww-success-details">
              <div><span>Trading Platform:</span> <b>ShareMarket PRO</b></div>
              <div><span>DP ID:</span> <b>CDSL (IN-DP-453-2026)</b></div>
              <div><span>Primary Bank:</span> <b>{bank}</b></div>
              <div><span>KYC Status:</span> <b style={{ color: '#00D09C' }}>Verified ✓</b></div>
            </div>

            <button
              type="button"
              className="groww-continue-btn"
              onClick={() => navigate('/profile')}
            >
              Go to Investor Profile
            </button>
          </div>
        )}
      </div>

      <div className="groww-secure-footer">
        <ShieldCheck size={16} />
        <span>SEBI Regulated · CDSL Depository Participant · ISO 27001 Certified</span>
      </div>
    </div>
  );
};

export default GrowwRegister;
