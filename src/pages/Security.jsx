import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BadgeCheck,
  Check,
  CheckCircle2,
  Clock,
  Cookie,
  Fingerprint,
  Gauge,
  IdCard,
  KeyRound,
  LockKeyhole,
  LogIn,
  LogOut,
  MessageSquare,
  Server,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Timer,
  UserCircle,
  QrCode,
  Laptop,
  Monitor,
  Copy,
  Trash2,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  Key,
} from 'lucide-react';
import {
  changeTradingPin,
  fetchSecuritySettings,
  getCurrentUser,
  logoutAllDevices,
  refreshSession,
  fetchActiveDevices,
  revokeDevice,
  revokeOtherDevices,
  setupTotp,
  enableTotp,
  disableTotp,
} from '../services/auth';
import './Security.css';

const formatWhen = (value) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return `${date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} IST`;
};

const isSequence = (pin) => {
  const digits = pin.split('').map(Number);
  const ascending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] + 1);
  const descending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] - 1);
  return ascending || descending;
};

const isWeakPin = (pin) => {
  if (!/^\d{4}$/.test(pin)) return true;
  if (/^(\d)\1{3}$/.test(pin)) return true;
  return isSequence(pin);
};

const SAFEGUARDS = [
  {
    icon: QrCode,
    title: 'Google Authenticator (RFC 6238 TOTP)',
    body: 'Time-based one-time codes generated on your phone app; immune to SMS interception.',
  },
  {
    icon: Laptop,
    title: 'Multi-Device Session Guard',
    body: 'Real-time device monitoring with one-click remote session revocation.',
  },
  {
    icon: Server,
    title: 'Salted scrypt PIN Vault',
    body: 'Only a cryptographic salt and scrypt hash of your PIN is stored on the server.',
  },
  {
    icon: MessageSquare,
    title: '5-minute mobile OTP',
    body: 'Sign-in needs a one-time code that expires in 5 minutes with automatic lockout.',
  },
  {
    icon: Gauge,
    title: 'Attempt rate limits',
    body: 'Sign-in is limited to 10 attempts per 15 minutes for each device and mobile number.',
  },
  {
    icon: Cookie,
    title: 'Signed, HttpOnly session',
    body: 'Session cookie is HttpOnly, SameSite=Lax and signed with HMAC-SHA256.',
  },
  {
    icon: KeyRound,
    title: 'Guarded PIN changes',
    body: 'PIN updates are rate-limited and immediately sign out every other session.',
  },
  {
    icon: ShieldCheck,
    title: 'Hardened responses',
    body: 'nosniff, referrer-policy, permissions-policy and frame protections active.',
  },
];

const emptyForm = { currentPin: '', newPin: '', confirmPin: '' };

const Security = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => getCurrentUser());
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Trading PIN State
  const [form, setForm] = useState(emptyForm);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState('');
  const [pinNotice, setPinNotice] = useState('');

  // Global Sign-Out State
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  // Active Devices State
  const [devices, setDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesActionNotice, setDevicesActionNotice] = useState('');

  // Google Authenticator (TOTP) State
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpWizardOpen, setTotpWizardOpen] = useState(false);
  const [totpSetupData, setTotpSetupData] = useState(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpError, setTotpError] = useState('');
  const [totpNotice, setTotpNotice] = useState('');
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [disablePin, setDisablePin] = useState('');
  const [disableModalOpen, setDisableModalOpen] = useState(false);

  const loadData = async () => {
    const sessionUser = await refreshSession();
    if (!sessionUser) {
      setUser(null);
      setPayload(null);
      setLoading(false);
      return;
    }
    try {
      const [settings, devicesData] = await Promise.all([
        fetchSecuritySettings().catch(() => null),
        fetchActiveDevices().catch(() => ({ devices: [] })),
      ]);
      setPayload(settings);
      setUser(settings?.user || sessionUser);
      setTotpEnabled(Boolean(settings?.user?.totpEnabled));
      setDevices(devicesData?.devices || []);
      setLoadError('');
    } catch (error) {
      if (error.status === 401) {
        setUser(null);
        setPayload(null);
      } else {
        setLoadError(error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const pinChecks = useMemo(() => {
    const pin = form.newPin;
    const complete = /^\d{4}$/.test(pin);
    return [
      { label: '4 digits', ok: complete },
      { label: 'Not repeated', ok: complete && !/^(\d)\1{3}$/.test(pin) },
      { label: 'No simple sequence', ok: complete && !isSequence(pin) },
      { label: 'Matches confirmation', ok: complete && pin === form.confirmPin },
    ];
  }, [form.newPin, form.confirmPin]);

  const updateField = (field) => (event) => {
    const value = event.target.value.replace(/\D/g, '').slice(0, 4);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submitPin = async (event) => {
    event.preventDefault();
    setPinError('');
    setPinNotice('');
    if (!/^\d{4}$/.test(form.currentPin) || !/^\d{4}$/.test(form.newPin)) {
      setPinError('Enter 4 digits for both the current and new PIN.');
      return;
    }
    if (form.newPin !== form.confirmPin) {
      setPinError('The new PIN and confirmation do not match.');
      return;
    }
    if (form.newPin === form.currentPin) {
      setPinError('Choose a PIN that is different from your current PIN.');
      return;
    }
    if (isWeakPin(form.newPin)) {
      setPinError('Choose a less predictable PIN. Avoid repeated digits and simple sequences.');
      return;
    }

    setPinBusy(true);
    try {
      const result = await changeTradingPin({ currentPin: form.currentPin, newPin: form.newPin });
      setForm(emptyForm);
      setPinNotice(`PIN updated on ${formatWhen(result.pinUpdatedAt)}. Every other device was signed out.`);
      setPayload((current) => current
        ? {
          ...current,
          security: { ...current.security, pinUpdatedAt: result.pinUpdatedAt },
          session: { ...current.session, startedAt: new Date().toISOString() },
        }
        : current);
      // Reload devices list as other sessions were cleared
      loadData();
    } catch (error) {
      setPinError(error.message);
    } finally {
      setPinBusy(false);
    }
  };

  const signOutEverywhere = async () => {
    setSignOutBusy(true);
    setSignOutError('');
    try {
      await logoutAllDevices();
      navigate('/login', { replace: true });
    } catch (error) {
      setSignOutError(error.message);
      setSignOutBusy(false);
    }
  };

  /* ── TOTP 2FA Handlers ─────────────────────────────────────────────────── */
  const startTotpSetup = async () => {
    setTotpError('');
    setTotpNotice('');
    setTotpBusy(true);
    try {
      const setup = await setupTotp();
      setTotpSetupData(setup);
      setTotpWizardOpen(true);
    } catch (err) {
      setTotpError(err.message || 'Could not initialize TOTP setup.');
    } finally {
      setTotpBusy(false);
    }
  };

  const confirmEnableTotp = async (e) => {
    e.preventDefault();
    setTotpError('');
    setTotpNotice('');
    if (totpVerifyCode.trim().length !== 6) {
      setTotpError('Enter the 6-digit code shown in Google Authenticator.');
      return;
    }
    setTotpBusy(true);
    try {
      await enableTotp({
        secret: totpSetupData?.secret,
        token: totpVerifyCode.trim(),
      });
      setTotpEnabled(true);
      setTotpWizardOpen(false);
      setTotpVerifyCode('');
      setTotpNotice('Google Authenticator 2FA is now active on your account!');
      loadData();
    } catch (err) {
      setTotpError(err.message || 'Invalid 6-digit code. Please verify in the app and re-try.');
    } finally {
      setTotpBusy(false);
    }
  };

  const confirmDisableTotp = async (e) => {
    e.preventDefault();
    setTotpError('');
    setTotpNotice('');
    if (!/^\d{4}$/.test(disablePin)) {
      setTotpError('Enter your 4-digit Trading PIN to disable 2FA.');
      return;
    }
    setTotpBusy(true);
    try {
      await disableTotp({ pin: disablePin });
      setTotpEnabled(false);
      setDisableModalOpen(false);
      setDisablePin('');
      setTotpNotice('Google Authenticator 2FA has been disabled.');
      loadData();
    } catch (err) {
      setTotpError(err.message || 'Failed to disable TOTP. Check your PIN.');
    } finally {
      setTotpBusy(false);
    }
  };

  const copySecret = () => {
    if (!totpSetupData?.secret) return;
    navigator.clipboard?.writeText(totpSetupData.secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  /* ── Device Management Handlers ────────────────────────────────────────── */
  const handleRevokeDevice = async (sessionId) => {
    setDevicesActionNotice('');
    try {
      const res = await revokeDevice(sessionId);
      if (res?.currentSessionRevoked) {
        navigate('/login', { replace: true });
        return;
      }
      setDevices((current) => current.filter((d) => d.id !== sessionId));
      setDevicesActionNotice('Device session revoked successfully.');
    } catch (err) {
      setDevicesActionNotice(err.message || 'Failed to revoke device session.');
    }
  };

  const handleRevokeOthers = async () => {
    setDevicesActionNotice('');
    try {
      await revokeOtherDevices();
      setDevices((current) => current.filter((d) => d.isCurrent));
      setDevicesActionNotice('Every other device session was signed out.');
    } catch (err) {
      setDevicesActionNotice(err.message || 'Failed to sign out other devices.');
    }
  };

  const otherDevicesCount = devices.filter((d) => !d.isCurrent).length;

  return (
    <div className="page security-page">
      {loadError ? <p className="error-message">{loadError}</p> : null}

      {!loading && !user ? (
        <>
          <div className="page-title">
            <span>Account protection</span>
            <h1>Security Centre</h1>
          </div>
          <section className="auth-panel security-signed-out">
            <span className="security-signed-out-icon"><ShieldCheck size={30} /></span>
            <h2>You are not signed in</h2>
            <p>Sign in to manage your trading PIN, 2FA authenticator and active sessions.</p>
            <div className="hero-actions">
              <Link className="primary-button" to="/login">Log in</Link>
              <Link className="secondary-button" to="/register">Open an account</Link>
            </div>
          </section>
        </>
      ) : null}

      {user ? (
        <>
          {/* Hero Header */}
          <section className="security-hero">
            <div className="security-hero-copy">
              <span className="security-hero-eyebrow"><ShieldCheck size={15} /> Bank-Grade Protection</span>
              <h1>Security Centre &amp; 2FA</h1>
              <p>Manage Google Authenticator, inspect active browser devices, and rotate your trading PIN.</p>
              <div className="security-hero-chips">
                <span className="security-chip"><UserCircle size={14} /> {user.name || 'Investor'}</span>
                <span className="security-chip"><Smartphone size={14} /> +91 {user.phone}</span>
                <span className="security-chip"><BadgeCheck size={14} /> {user.dematId || 'Client ID not assigned'}</span>
                <span className="security-chip" style={{ color: totpEnabled ? '#10b981' : '#f59e0b' }}>
                  <QrCode size={14} /> {totpEnabled ? 'TOTP 2FA Active' : 'TOTP 2FA Disabled'}
                </span>
              </div>
            </div>

            <aside className="security-hero-meter">
              <div
                className="security-meter"
                style={{ '--security-score': totpEnabled ? 100 : 85 }}
                role="img"
                aria-label="Security score"
              >
                <span className="security-meter-value">
                  <strong>{totpEnabled ? '100%' : '88%'}</strong>
                  <em>Score</em>
                </span>
              </div>
              <div className="security-meter-copy">
                <span>SEBI Hardened</span>
                <p>TOTP 2FA, salted scrypt PINs, biometric Face IPV and remote device revocation.</p>
                <span className="security-meter-status">
                  {totpEnabled ? '✓ Maximum Protection Active' : '⚠ Enable Authenticator for 100%'}
                </span>
              </div>
            </aside>
          </section>

          {/* ════════════════════════════════════════════════════════════════
             FEATURE 1: GOOGLE AUTHENTICATOR (TOTP 2FA)
             ════════════════════════════════════════════════════════════════ */}
          <section className="security-totp-card">
            <div className="totp-card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="security-card-icon" style={{ background: 'rgba(37,99,235,0.1)', color: '#2563eb' }}>
                  <QrCode size={22} />
                </span>
                <div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Two-Factor Authentication (RFC 6238)
                  </span>
                  <h2 style={{ margin: '2px 0 0', fontSize: '1.25rem', fontWeight: 800 }}>Google Authenticator (TOTP)</h2>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={`totp-status-pill ${totpEnabled ? 'active' : 'inactive'}`}>
                  {totpEnabled ? '✓ Active & Enforced' : 'Not Configured'}
                </span>
                {totpEnabled ? (
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ padding: '6px 14px', fontSize: '0.82rem', color: 'var(--loss)' }}
                    onClick={() => {
                      setDisableModalOpen(true);
                      setTotpError('');
                    }}
                  >
                    Disable 2FA
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary-button"
                    style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                    onClick={startTotpSetup}
                    disabled={totpBusy}
                  >
                    <QrCode size={15} /> {totpBusy ? 'Generating…' : 'Set Up Google Authenticator'}
                  </button>
                )}
              </div>
            </div>

            <p className="totp-desc">
              Protect your Demat orders and portfolio with dynamic 6-digit codes generated every 30 seconds inside Google Authenticator, Authy, or Microsoft Authenticator. Immune to SIM swapping and SMS delivery failures.
            </p>

            {totpNotice && (
              <div className="auth-demo-banner" style={{ marginBottom: 16 }}>
                <CheckCircle2 size={16} /> <span>{totpNotice}</span>
              </div>
            )}
            {totpError && (
              <div className="auth-error-banner" style={{ marginBottom: 16 }}>
                <AlertTriangle size={16} /> <span>{totpError}</span>
              </div>
            )}

            {/* TOTP Setup Wizard */}
            {totpWizardOpen && totpSetupData && (
              <div className="totp-wizard">
                <div className="totp-qr-wrapper">
                  <img
                    src={totpSetupData.qrCodeUrl}
                    alt="Google Authenticator QR Code"
                    className="totp-qr-img"
                  />
                  <div style={{ textAlign: 'center', fontSize: '0.72rem', color: '#64748b', marginTop: 4 }}>
                    Scan with Authenticator app
                  </div>
                </div>

                <div>
                  <h3 style={{ margin: '0 0 6px', fontSize: '1.1rem', fontWeight: 800 }}>Scan QR Code or Enter Key</h3>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-3)', lineHeight: 1.5 }}>
                    Open Google Authenticator on your phone, tap <b>+</b> and choose <b>Scan a QR code</b>. If camera cannot scan, type this key manually:
                  </p>

                  <div className="totp-secret-group">
                    <span className="totp-secret-label">Secret Key (Base32)</span>
                    <span className="totp-secret-code-pill">
                      <span>{totpSetupData.secret}</span>
                      <button
                        type="button"
                        onClick={copySecret}
                        style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'flex' }}
                        title="Copy Secret Key"
                      >
                        {copiedSecret ? <Check size={16} style={{ color: '#10b981' }} /> : <Copy size={16} />}
                      </button>
                    </span>
                  </div>

                  <form className="totp-code-form" onSubmit={confirmEnableTotp}>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      autoFocus
                      className="totp-digit-input"
                      placeholder="000 000"
                      value={totpVerifyCode}
                      onChange={(e) => setTotpVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    />
                    <button
                      type="submit"
                      className="primary-button"
                      disabled={totpVerifyCode.length !== 6 || totpBusy}
                    >
                      {totpBusy ? 'Verifying…' : 'Confirm & Activate 2FA'}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setTotpWizardOpen(false)}
                    >
                      Cancel
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* Modal to Disable 2FA */}
            {disableModalOpen && (
              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', padding: 18, borderRadius: 12, margin: '14px 0' }}>
                <h4 style={{ margin: '0 0 6px', color: 'var(--loss)' }}>Disable Google Authenticator?</h4>
                <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--text-3)' }}>
                  Enter your 4-digit Trading PIN to confirm disabling Two-Factor Authentication.
                </p>
                <form onSubmit={confirmDisableTotp} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="password"
                    maxLength={4}
                    inputMode="numeric"
                    placeholder="Trading PIN"
                    value={disablePin}
                    onChange={(e) => setDisablePin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="groww-input"
                    style={{ width: 140 }}
                  />
                  <button type="submit" className="primary-button" style={{ background: 'var(--loss)' }} disabled={disablePin.length !== 4 || totpBusy}>
                    {totpBusy ? 'Verifying…' : 'Confirm Disable'}
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setDisableModalOpen(false)}>
                    Cancel
                  </button>
                </form>
              </div>
            )}
          </section>

          {/* ════════════════════════════════════════════════════════════════
             FEATURE 2: ACTIVE DEVICES & REMOTE LOGOUT
             ════════════════════════════════════════════════════════════════ */}
          <section className="security-devices-card">
            <div className="devices-header-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="security-card-icon" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                  <Laptop size={22} />
                </span>
                <div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Session Security &amp; Access Logs
                  </span>
                  <h2 style={{ margin: '2px 0 0', fontSize: '1.25rem', fontWeight: 800 }}>Active Devices ({devices.length})</h2>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {otherDevicesCount > 0 && (
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ color: 'var(--loss)', borderColor: 'rgba(239, 68, 68, 0.3)', fontSize: '0.82rem', padding: '7px 14px' }}
                    onClick={handleRevokeOthers}
                  >
                    <LogOut size={14} /> Sign Out {otherDevicesCount} Other {otherDevicesCount === 1 ? 'Device' : 'Devices'}
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  style={{ padding: '7px 12px', fontSize: '0.82rem' }}
                  onClick={loadData}
                  title="Refresh device list"
                >
                  <RefreshCw size={14} /> Refresh
                </button>
              </div>
            </div>

            {devicesActionNotice && (
              <div className="auth-demo-banner" style={{ marginBottom: 14 }}>
                <CheckCircle2 size={16} /> <span>{devicesActionNotice}</span>
              </div>
            )}

            <div className="devices-list">
              {devices.map((device) => {
                const isMobile = device.deviceType === 'mobile' || /Android|iPhone/i.test(device.device);
                return (
                  <div key={device.id} className={`device-row ${device.isCurrent ? 'is-current' : ''}`}>
                    <div className="device-meta-wrap">
                      <div className="device-icon-box">
                        {isMobile ? <Smartphone size={22} /> : <Monitor size={22} />}
                      </div>
                      <div>
                        <div className="device-name-title">
                          <span>{device.device || 'Web Browser'}</span>
                          {device.isCurrent && (
                            <span className="device-current-badge">
                              <span className="live-dot" style={{ width: 6, height: 6, marginRight: 4 }} /> This Device (Active)
                            </span>
                          )}
                        </div>
                        <div className="device-details-sub">
                          <span>IP: <b>{device.ip || '127.0.0.1'}</b></span>
                          <span>Location: <b>{device.location || 'India'}</b></span>
                          <span>Last active: <b>{formatWhen(device.lastActiveAt)}</b></span>
                        </div>
                      </div>
                    </div>

                    <div>
                      {device.isCurrent ? (
                        <span style={{ fontSize: '0.78rem', color: '#10b981', fontWeight: 700 }}>
                          Current Session
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="device-revoke-btn"
                          onClick={() => handleRevokeDevice(device.id)}
                        >
                          <Trash2 size={13} /> Revoke Access
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {!devices.length && (
                <div className="devices-empty-state">
                  No other active devices registered. Your session is exclusive to this browser.
                </div>
              )}
            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════════
             PIN ROTATION & SAFEGUARDS CHECKLIST
             ════════════════════════════════════════════════════════════════ */}
          <div className="security-grid">
            {/* PIN Rotation Card */}
            <section className="panel security-card">
              <header className="security-card-head">
                <span className="security-card-icon"><KeyRound size={20} /></span>
                <div>
                  <span>Trading PIN</span>
                  <h2>Change your PIN</h2>
                </div>
              </header>

              <p className="security-pin-updated">
                <Fingerprint size={14} />
                Last changed {loading ? 'Loading…' : formatWhen(payload?.security?.pinUpdatedAt)}
              </p>

              <form className="feedback-form security-form" onSubmit={submitPin}>
                <label>
                  Current PIN
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="current-password"
                    maxLength={4}
                    value={form.currentPin}
                    onChange={updateField('currentPin')}
                    placeholder="••••"
                  />
                </label>
                <label>
                  New PIN
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={4}
                    value={form.newPin}
                    onChange={updateField('newPin')}
                    placeholder="••••"
                  />
                </label>
                <label>
                  Confirm new PIN
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={4}
                    value={form.confirmPin}
                    onChange={updateField('confirmPin')}
                    placeholder="••••"
                  />
                </label>

                <ul className="security-pin-rules" aria-label="New PIN requirements">
                  {pinChecks.map((check) => (
                    <li key={check.label} className={check.ok ? 'is-ok' : undefined}>
                      <Check size={12} aria-hidden="true" />
                      {check.label}
                    </li>
                  ))}
                </ul>

                <button className="primary-button" type="submit" disabled={pinBusy}>
                  {pinBusy ? 'Updating PIN…' : 'Update PIN'}
                </button>
              </form>

              {pinError ? <p className="error-message">{pinError}</p> : null}
              {pinNotice ? <p className="success-message"><CheckCircle2 size={16} /> {pinNotice}</p> : null}
            </section>

            {/* Current Session Specs */}
            <section className="panel security-card">
              <header className="security-card-head">
                <span className="security-card-icon"><LockKeyhole size={20} /></span>
                <div>
                  <span>Session Architecture</span>
                  <h2>Security Token Specs</h2>
                </div>
                <span className="security-live-pill"><i /> Active</span>
              </header>

              <dl className="security-facts">
                <div>
                  <dt><UserCircle size={15} /> Account</dt>
                  <dd>{user.name || 'Investor'} · +91 {user.phone}</dd>
                </div>
                <div>
                  <dt><IdCard size={15} /> Client ID</dt>
                  <dd>{user.dematId || 'Not assigned'}</dd>
                </div>
                <div>
                  <dt><LogIn size={15} /> Last login</dt>
                  <dd>{loading ? 'Loading…' : formatWhen(payload?.security?.lastLoginAt)}</dd>
                </div>
                <div>
                  <dt><Clock size={15} /> Session started</dt>
                  <dd>{loading ? 'Loading…' : formatWhen(payload?.session?.startedAt)}</dd>
                </div>
                <div>
                  <dt><Timer size={15} /> Session expires</dt>
                  <dd>{loading ? 'Loading…' : formatWhen(payload?.session?.expiresAt)}</dd>
                </div>
                <div>
                  <dt><LockKeyhole size={15} /> Cookie</dt>
                  <dd>HttpOnly · SameSite=Lax · Signed</dd>
                </div>
              </dl>

              <div className="security-session-foot">
                {confirmSignOut ? (
                  <div className="security-confirm" role="group" aria-label="Confirm sign out of all devices">
                    <div>
                      <strong>Sign out everywhere?</strong>
                      <p>This device and every other session will be signed out immediately.</p>
                    </div>
                    <div className="security-confirm-actions">
                      <button
                        className="security-danger-button is-solid"
                        type="button"
                        onClick={signOutEverywhere}
                        disabled={signOutBusy}
                      >
                        <LogOut size={15} /> {signOutBusy ? 'Signing out…' : 'Yes, sign out everywhere'}
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => setConfirmSignOut(false)}
                        disabled={signOutBusy}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="security-danger-button"
                    type="button"
                    onClick={() => {
                      setSignOutError('');
                      setConfirmSignOut(true);
                    }}
                  >
                    <LogOut size={15} /> Sign out of all devices
                  </button>
                )}
                {signOutError ? <p className="error-message">{signOutError}</p> : null}
              </div>
            </section>
          </div>

          {/* Safeguards Checklist */}
          <section className="panel security-card security-checklist">
            <header className="security-card-head">
              <span className="security-card-icon"><ShieldCheck size={20} /></span>
              <div>
                <span>SEBI Defence in Depth</span>
                <h2>Active Security Safeguards</h2>
              </div>
            </header>

            <ul className="security-safeguards">
              {SAFEGUARDS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="security-safeguard">
                  <span className="security-safeguard-icon"><Icon size={18} /></span>
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      {loading && !user ? (
        <section className="auth-panel security-signed-out">
          <span className="security-signed-out-icon"><ShieldCheck size={30} /></span>
          <h2>Loading your security settings…</h2>
        </section>
      ) : null}
    </div>
  );
};

export default Security;
