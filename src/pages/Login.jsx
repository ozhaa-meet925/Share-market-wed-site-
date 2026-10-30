import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ShieldCheck, Lock, Smartphone, ChevronRight } from 'lucide-react';
import { loginUserByPhone, loginWithDemat } from '../services/auth';

const GrowwLogin = () => {
  const navigate = useNavigate();
  // Steps: 'phone' -> 'otp' -> 'pin'
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [resendTimer, setResendTimer] = useState(30);

  const otpRefs = useRef([]);
  const pinRefs = useRef([]);

  // Handle phone submit
  const handlePhoneSubmit = (e) => {
    e.preventDefault();
    setError('');
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }
    setStep('otp');
    // Start countdown timer
    let count = 30;
    const interval = setInterval(() => {
      count -= 1;
      setResendTimer(count);
      if (count <= 0) clearInterval(interval);
    }, 1000);
  };

  // Handle OTP digit inputs
  const handleOtpChange = (index, value) => {
    if (isNaN(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);

    // Auto-focus next box
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpSubmit = (e) => {
    e.preventDefault();
    setError('');
    const enteredOtp = otp.join('');
    if (enteredOtp.length !== 6) {
      setError('Please enter the full 6-digit OTP');
      return;
    }
    // Check demo OTP or allow any 6 digit
    if (enteredOtp !== '123456' && enteredOtp !== '000000') {
      // For friendly demo, we also accept 123456
      // but let's allow it if user typed 123456
      setError('Enter valid OTP (Use demo OTP: 123456)');
      return;
    }
    setStep('pin');
  };

  // Handle PIN digit inputs
  const handlePinChange = (index, value) => {
    if (isNaN(value)) return;
    const newPin = [...pin];
    newPin[index] = value.slice(-1);
    setPin(newPin);

    // Auto-focus next box
    if (value && index < 3) {
      pinRefs.current[index + 1]?.focus();
    }
  };

  const handlePinKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      pinRefs.current[index - 1]?.focus();
    }
  };

  const handlePinSubmit = (e) => {
    e.preventDefault();
    setError('');
    const enteredPin = pin.join('');
    if (enteredPin.length !== 4) {
      setError('Please enter your 4-digit Trading PIN');
      return;
    }
    try {
      loginWithDemat({
        broker: 'ShareMarket PRO',
        dematId: `SM-${phone.slice(-6)}`,
        pin: enteredPin,
      });
      navigate('/profile');
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

        {/* STEP 1: ENTER MOBILE NUMBER */}
        {step === 'phone' && (
          <div className="groww-step-container">
            <h1 className="groww-title">Welcome to ShareMarket</h1>
            <p className="groww-subtitle">Enter your mobile number to login or register</p>

            <form onSubmit={handlePhoneSubmit}>
              <div className="groww-phone-input-group">
                <span className="groww-country-code">+91</span>
                <input
                  type="tel"
                  autoFocus
                  maxLength={10}
                  className="groww-phone-input"
                  placeholder="Your 10 digit mobile number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              {error && <div className="groww-error-alert">{error}</div>}

              <button
                type="submit"
                className="groww-continue-btn"
                disabled={phone.length < 10}
              >
                Continue
              </button>
            </form>

            <div className="groww-terms-notice">
              By proceeding, you agree to the <a href="#terms">Terms and Conditions</a> and <a href="#privacy">Privacy Policy</a>
            </div>

            <div className="groww-social-divider">
              <span>or</span>
            </div>

            <button
              type="button"
              className="groww-google-btn"
              onClick={() => {
                setPhone('9876543210');
                setStep('otp');
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              Continue with Google
            </button>
          </div>
        )}

        {/* STEP 2: ENTER OTP */}
        {step === 'otp' && (
          <div className="groww-step-container">
            <button type="button" className="groww-back-link" onClick={() => setStep('phone')}>
              <ArrowLeft size={16} /> Edit number
            </button>

            <h1 className="groww-title">Enter OTP</h1>
            <p className="groww-subtitle">
              We have sent a 6-digit OTP to <b>+91 {phone}</b>
            </p>

            <div className="groww-demo-hint">
              Demo OTP: <b>123456</b>
            </div>

            <form onSubmit={handleOtpSubmit}>
              <div className="groww-otp-boxes">
                {otp.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => (otpRefs.current[idx] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    className="groww-otp-box"
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    autoFocus={idx === 0}
                  />
                ))}
              </div>

              {error && <div className="groww-error-alert">{error}</div>}

              <button
                type="submit"
                className="groww-continue-btn"
                disabled={otp.some((d) => !d)}
              >
                Verify OTP
              </button>
            </form>

            <div className="groww-resend-line">
              {resendTimer > 0 ? (
                <span>Resend OTP in <b>{resendTimer}s</b></span>
              ) : (
                <button
                  type="button"
                  className="groww-link-btn"
                  onClick={() => {
                    setResendTimer(30);
                    setError('');
                  }}
                >
                  Resend OTP
                </button>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: ENTER 4-DIGIT TRADING SECURITY PIN */}
        {step === 'pin' && (
          <div className="groww-step-container">
            <button type="button" className="groww-back-link" onClick={() => setStep('otp')}>
              <ArrowLeft size={16} /> Back
            </button>

            <h1 className="groww-title">Enter Trading PIN</h1>
            <p className="groww-subtitle">Enter your 4-digit security PIN to access your Demat account</p>

            <form onSubmit={handlePinSubmit}>
              <div className="groww-pin-boxes">
                {pin.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => (pinRefs.current[idx] = el)}
                    type="password"
                    inputMode="numeric"
                    maxLength={1}
                    className="groww-pin-box"
                    value={digit}
                    onChange={(e) => handlePinChange(idx, e.target.value)}
                    onKeyDown={(e) => handlePinKeyDown(idx, e)}
                    autoFocus={idx === 0}
                  />
                ))}
              </div>

              {error && <div className="groww-error-alert">{error}</div>}

              <button
                type="submit"
                className="groww-continue-btn"
                disabled={pin.some((d) => !d)}
              >
                Complete Login
              </button>
            </form>

            <div className="groww-resend-line">
              <button
                type="button"
                className="groww-link-btn"
                onClick={() => {
                  setPin(['1', '2', '3', '4']);
                }}
              >
                Forgot PIN? (Auto-fill Demo 1234)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Security Footer */}
      <div className="groww-secure-footer">
        <ShieldCheck size={16} />
        <span>100% Safe & Secure · Registered with SEBI & CDSL</span>
      </div>
    </div>
  );
};

export default GrowwLogin;
