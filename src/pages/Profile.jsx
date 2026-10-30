import { useState } from 'react';
import { CheckCircle2, UserCircle, Shield, CreditCard, ExternalLink, Wallet, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getCurrentUser, logoutUser } from '../services/auth';

const Profile = () => {
  const [user, setUser] = useState(() => getCurrentUser());

  return (
    <div className="page">
      <div className="page-title">
        <span>Account & Demat Services</span>
        <h1>Investor Profile</h1>
      </div>

      <section className="panel profile-panel">
        <UserCircle size={64} style={{ color: 'var(--accent, #10b981)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ margin: 0 }}>{user?.name || 'Guest Investor'}</h2>
              <p style={{ margin: '4px 0', color: 'var(--text-muted, #94a3b8)' }}>{user?.email || 'No email registered'}</p>
            </div>
            <div className="kyc-status" style={{ margin: 0 }}>
              <CheckCircle2 size={16} />
              <span>KYC: <strong>{user?.kycStatus === 'verified' || user?.linkedDemat ? 'Active & Verified' : 'Pending review'}</strong></span>
            </div>
          </div>

          {/* Demat Account Details Card */}
          <div style={{
            background: 'var(--bg-card-secondary, rgba(255,255,255,0.03))',
            borderRadius: 10,
            padding: 16,
            margin: '16px 0',
            border: '1px solid var(--border-color, #334155)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 14,
          }}>
            <div>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>Demat Platform</span>
              <strong style={{ fontSize: '1rem', color: '#10b981' }}>{user?.dematBroker || 'ShareMarket PRO'}</strong>
            </div>
            <div>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>Client ID / UCC</span>
              <strong>{user?.dematId || 'SM-89213401'}</strong>
            </div>
            <div>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>Primary Bank</span>
              <strong>{user?.bank || 'HDFC Bank'}</strong>
            </div>
            <div>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>Trading Segment</span>
              <strong>NSE / BSE Equity + F&O</strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 18, fontSize: '0.88rem' }}>
            <span>Risk Profile: <strong>Balanced Growth</strong></span>
            <span>Account Type: <strong>Individual Demat</strong></span>
            <span>DP Depository: <strong>CDSL</strong></span>
          </div>

          <div className="hero-actions profile-actions">
            <Link className="primary-button" to="/live">Open Live Terminal <ArrowUpRight size={15} /></Link>
            <Link className="secondary-button" to="/portfolio">Portfolio Holdings</Link>
            <Link className="secondary-button" to="/wallet">Wallet & Funds</Link>
            <Link className="secondary-button" to="/orders">Order History</Link>
            {user ? (
              <button className="secondary-button" type="button" onClick={() => { logoutUser(); setUser(null); }}>
                Log out
              </button>
            ) : (
              <Link className="primary-button" to="/login">Log in</Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Profile;
