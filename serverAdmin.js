import {
  AUTH_ROLES,
  changeAuthUserRole,
  listAuthUsersForAdmin,
  readSessionUser,
} from './serverAuth.js';
import { readAudit, recordAudit, verifyAudit } from './serverCoreAudit.js';
import { healthMetadata, healthStatus, listIncidents } from './serverHealth.js';
import { brainStatus } from './serverAICore.js';
import { listAdapters, liveTradingMasterEnabled } from './serverBrokers/index.js';

const fail = (res, status, message, code) => res.status(status).json({ error: message, code });

const roleCounts = (users) => AUTH_ROLES.reduce((counts, role) => {
  counts[role] = users.filter((user) => user.role === role).length;
  return counts;
}, {});

const brokerSummary = () => listAdapters().map((adapter) => {
  const config = typeof adapter.config === 'function' ? adapter.config() : {};
  return {
    id: adapter.id,
    name: adapter.name,
    configured: config.configured === true,
    mode: config.mode || null,
    missing: Array.isArray(config.missing) ? config.missing : [],
    capabilities: adapter.capabilities?.() || null,
  };
});

export const registerAdminRoutes = (app, deps = {}) => {
  const sessionUser = deps.readUser || readSessionUser;
  const listUsers = deps.listUsers || listAuthUsersForAdmin;
  const changeRole = deps.changeRole || changeAuthUserRole;
  const writeAudit = deps.recordAudit || recordAudit;

  const requireAdmin = (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      fail(res, 401, 'Please sign in to open the admin console.', 'not_authenticated');
      return null;
    }
    if (user.role !== 'admin') {
      fail(res, 403, 'Admin access requires the admin role on this account.', 'insufficient_role');
      return null;
    }
    return user;
  };

  app.get('/api/admin/overview', (req, res) => {
    const user = requireAdmin(req, res);
    if (!user) return;
    res.set('Cache-Control', 'no-store');
    const users = listUsers();
    const health = healthStatus();
    res.json({
      users,
      roleCounts: roleCounts(users),
      health: {
        status: health?.status || 'unknown',
        checkedAt: health?.checkedAt || null,
        components: health?.components || {},
        metadata: healthMetadata(),
        openIncidents: listIncidents(20).filter((incident) => !incident.resolvedAt).slice(0, 10),
      },
      brain: brainStatus(),
      brokers: brokerSummary(),
      liveTradingMasterEnabled: liveTradingMasterEnabled(),
      audit: { chain: verifyAudit(), recent: readAudit(15) },
      permissions: {
        viewer: ['Read dashboards, quotes and research'],
        trader: ['Place paper trades and use AI desk previews'],
        admin: ['Manage account roles and read platform audit'],
      },
    });
  });

  app.get('/api/admin/audit', (req, res) => {
    const user = requireAdmin(req, res);
    if (!user) return;
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    res.set('Cache-Control', 'no-store');
    res.json({ chain: verifyAudit(), entries: readAudit(limit) });
  });

  app.patch('/api/admin/users/:id/role', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const role = String(req.body?.role || '').toLowerCase();
    if (!AUTH_ROLES.includes(role)) return fail(res, 400, 'Choose viewer, trader or admin.', 'invalid_role');
    try {
      const result = changeRole(req.params.id, role, admin.id);
      if (!result) return fail(res, 404, 'That account was not found.', 'user_not_found');
      if (!result.changed) return res.json({ ok: true, ...result, users: listUsers() });
      writeAudit({
        actor: { id: admin.id, role: 'admin', name: admin.name || admin.id },
        action: 'admin.role_change',
        resource: `user:${result.id}`,
        outcome: 'success',
        detail: { previousRole: result.previousRole, role: result.role },
      });
      res.json({ ok: true, ...result, users: listUsers() });
    } catch (error) {
      if (error.code === 'last_admin') return fail(res, 409, error.message, error.code);
      if (error.code === 'invalid_role') return fail(res, 400, error.message, error.code);
      fail(res, 500, 'The role change could not be saved.', 'role_change_failed');
    }
  });
};
