import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, CheckCircle2, Clock3, Database, FileCheck2,
  HeartPulse, Loader2, Lock, RefreshCw, Server, ShieldCheck, Users, XCircle,
} from 'lucide-react';
import { adminApi } from '../services/admin';
import { getCurrentUser } from '../services/auth';
import './Admin.css';

const ROLES = [
  { value: 'viewer', label: 'Viewer', hint: 'Read-only dashboards and research' },
  { value: 'trader', label: 'Trader', hint: 'Paper trades and AI desk previews' },
  { value: 'admin', label: 'Admin', hint: 'Role management and platform audit' },
];

const roleLabel = (role) => ROLES.find((item) => item.value === role)?.label || role;
const formatWhen = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

const statusTone = (status) => {
  const value = String(status || '').toLowerCase();
  if (['healthy', 'ok', 'good'].includes(value)) return 'good';
  if (['degraded', 'warn', 'idle'].includes(value)) return 'warn';
  if (['down', 'fail', 'failed', 'critical'].includes(value)) return 'bad';
  return 'muted';
};

const Admin = () => {
  const [user, setUser] = useState(() => getCurrentUser());
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const onChange = (event) => setUser(event.detail || null);
    window.addEventListener('sharemarket:session-changed', onChange);
    return () => window.removeEventListener('sharemarket:session-changed', onChange);
  }, []);

  const load = useCallback(async () => {
    if (user?.role !== 'admin') return;
    setLoading(true);
    setError('');
    try {
      setOverview(await adminApi.overview());
    } catch (fetchError) {
      setError(fetchError.message);
    } finally {
      setLoading(false);
    }
  }, [user?.role]);

  useEffect(() => { load(); }, [load]);

  if (!user) {
    return (
      <div className="page admin-page">
        <section className="admin-gate panel">
          <span className="admin-gate-icon"><Lock size={22} /></span>
          <h1>Admin console requires a session</h1>
          <p>Sign in with an admin account to manage roles and read the platform audit trail.</p>
          <Link className="primary-button" to="/login">Sign in</Link>
        </section>
      </div>
    );
  }

  if (user.role !== 'admin') {
    return (
      <div className="page admin-page">
        <section className="admin-gate panel">
          <span className="admin-gate-icon is-warn"><ShieldCheck size={22} /></span>
          <h1>Admin role required</h1>
          <p>This account is signed in as <strong>{roleLabel(user.role)}</strong>. The server rejects admin endpoints for non-admin roles, so there is nothing to show here.</p>
          <Link className="secondary-button" to="/profile">Back to profile</Link>
        </section>
      </div>
    );
  }

  const changeRole = async (target, role) => {
    if (target.role === role) return;
    setBusyId(target.id);
    setNotice('');
    setError('');
    try {
      const payload = await adminApi.updateRole(target.id, role);
      setOverview((current) => (current ? { ...current, users: payload.users } : current));
      setNotice(`${target.name || target.id} is now ${roleLabel(role)}.`);
      await load();
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setBusyId('');
    }
  };

  const health = overview?.health || {};
  const audit = overview?.audit || {};
  const components = Object.entries(health.components || {});

  return (
    <div className="page admin-page">
      <header className="admin-hero">
        <div>
          <span className="admin-eyebrow"><ShieldCheck size={15} /> SERVER-SIDE ACCESS CONTROL</span>
          <h1>Admin console</h1>
          <p>Roles are enforced on the server on every admin request. Only accounts with the admin role can view this page's data or change roles.</p>
        </div>
        <button className="secondary-button" type="button" onClick={load} disabled={loading}>
          {loading ? <Loader2 size={16} className="admin-spin" /> : <RefreshCw size={16} />} Refresh
        </button>
      </header>

      {error ? <div className="admin-banner is-bad" role="alert"><AlertTriangle size={16} /> {error}</div> : null}
      {notice ? <div className="admin-banner is-good" role="status"><CheckCircle2 size={16} /> {notice}</div> : null}

      {!overview && loading ? (
        <section className="panel admin-loading"><Loader2 size={18} className="admin-spin" /> Loading admin data…</section>
      ) : null}

      {overview ? (
        <>
          <section className="admin-stat-grid" aria-label="Role summary">
            <article className="admin-stat">
              <span className="admin-stat-icon"><Users size={17} /></span>
              <strong>{overview.users.length}</strong>
              <em>accounts</em>
            </article>
            {ROLES.map((role) => (
              <article className="admin-stat" key={role.value}>
                <span className={`admin-role-chip is-${role.value}`}>{roleLabel(role.value)}</span>
                <strong>{overview.roleCounts?.[role.value] ?? 0}</strong>
                <em>{role.hint}</em>
              </article>
            ))}
          </section>

          <section className="panel admin-section">
            <div className="admin-section-head">
              <h2><Users size={17} /> Accounts and roles</h2>
              <span>You cannot change your own role here.</span>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>Account</th><th>Phone</th><th>Role</th><th>Last login</th><th>Sessions</th></tr>
                </thead>
                <tbody>
                  {overview.users.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.name || 'Unnamed'}</strong><small>{row.email || row.id}</small></td>
                      <td>{row.phone || '—'}</td>
                      <td>
                        <select
                          value={row.role}
                          disabled={busyId === row.id || row.id === user.id}
                          onChange={(event) => changeRole(row, event.target.value)}
                          aria-label={`Role for ${row.name || row.id}`}
                        >
                          {ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                        </select>
                      </td>
                      <td>{formatWhen(row.lastLoginAt)}</td>
                      <td>{row.activeSessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="admin-note">Demoting an admin also signs that account out of its existing sessions so an open tab cannot keep admin access.</p>
          </section>

          <div className="admin-two-col">
            <section className="panel admin-section">
              <div className="admin-section-head">
                <h2><HeartPulse size={17} /> Platform health</h2>
                <span className={`admin-tone is-${statusTone(health.status)}`}>{health.status || 'unknown'}</span>
              </div>
              <ul className="admin-health-list">
                {components.map(([name, value]) => (
                  <li key={name}>
                    <span className="admin-health-name">{name}</span>
                    <span className={`admin-tone is-${statusTone(value?.status)}`}>{value?.status || 'unknown'}</span>
                    <small>{value?.detail || ''}</small>
                  </li>
                ))}
                {!components.length ? <li><small>No health snapshot is available yet.</small></li> : null}
              </ul>
              <p className="admin-note"><Clock3 size={13} /> Last check {formatWhen(health.checkedAt)}</p>
            </section>

            <section className="panel admin-section">
              <div className="admin-section-head">
                <h2><Server size={17} /> Brokers and trading mode</h2>
                <span className={`admin-tone is-${overview.liveTradingMasterEnabled ? 'warn' : 'good'}`}>
                  {overview.liveTradingMasterEnabled ? 'Live master switch ON' : 'Live trading disabled'}
                </span>
              </div>
              <ul className="admin-broker-list">
                {(overview.brokers || []).map((broker) => (
                  <li key={broker.id}>
                    <div>
                      <strong>{broker.name}</strong>
                      <small>{broker.mode ? `mode: ${broker.mode}` : 'no mode set'}</small>
                    </div>
                    <span className={`admin-tone is-${broker.configured ? 'good' : 'muted'}`}>
                      {broker.configured ? 'configured' : 'not configured'}
                    </span>
                    {broker.missing?.length ? <small>Missing: {broker.missing.join(', ')}</small> : null}
                  </li>
                ))}
              </ul>
              <p className="admin-note">Credentials are never returned by this endpoint; only configuration presence is shown.</p>
            </section>
          </div>

          <section className="panel admin-section">
            <div className="admin-section-head">
              <h2><FileCheck2 size={17} /> Audit chain</h2>
              <span className={`admin-tone is-${audit.chain?.ok ? 'good' : 'bad'}`}>
                {audit.chain?.ok ? 'verified' : 'unverified'}{typeof audit.chain?.entries === 'number' ? ` · ${audit.chain.entries} entries` : ''}
              </span>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Outcome</th></tr></thead>
                <tbody>
                  {(audit.recent || []).map((entry) => (
                    <tr key={`${entry.seq}-${entry.hash || ''}`}>
                      <td>{entry.seq}</td>
                      <td>{formatWhen(entry.ts || entry.time || entry.createdAt)}</td>
                      <td>{entry.actor?.name || entry.actor?.id || 'system'}<small>{entry.actor?.role || ''}</small></td>
                      <td>{entry.action}<small>{entry.resource || ''}</small></td>
                      <td>
                        <span className={`admin-tone is-${entry.outcome === 'success' ? 'good' : 'warn'}`}>
                          {entry.outcome || 'logged'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!audit.recent?.length ? <tr><td colSpan={5}>No audit events are recorded yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel admin-section">
            <div className="admin-section-head"><h2><Database size={17} /> Role permissions</h2></div>
            <ul className="admin-permission-list">
              {Object.entries(overview.permissions || {}).map(([role, items]) => (
                <li key={role}>
                  <span className={`admin-role-chip is-${role}`}>{roleLabel(role)}</span>
                  <span>{items.join(' · ')}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel admin-section">
            <div className="admin-section-head"><h2><Activity size={17} /> AI Core status</h2></div>
            <div className="admin-core-status">
              <span className={`admin-tone is-${statusTone(overview.brain?.status)}`}>{overview.brain?.status || 'unknown'}</span>
              {overview.brain?.mode ? <span>Mode: {overview.brain.mode}</span> : null}
              {overview.brain?.modules ? <span>{Array.isArray(overview.brain.modules) ? `${overview.brain.modules.length} modules` : ''}</span> : null}
              <span className="admin-note"><Lock size={13} /> The kill switch is released only by the account owner inside AI Core.</span>
            </div>
          </section>
        </>
      ) : null}

      {overview && health.openIncidents?.length ? (
        <section className="panel admin-section is-alert">
          <div className="admin-section-head">
            <h2><XCircle size={17} /> Open incidents</h2>
            <span className="admin-tone is-warn">{health.openIncidents.length}</span>
          </div>
          <ul className="admin-health-list">
            {health.openIncidents.map((incident) => (
              <li key={incident.id || incident.startedAt}>
                <span className="admin-health-name">{incident.component || incident.scope || 'incident'}</span>
                <small>{incident.message || incident.detail || 'Open incident reported by the health monitor.'}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};

export default Admin;
