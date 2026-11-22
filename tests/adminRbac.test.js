import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAdminRoutes } from '../serverAdmin.js';

const makeApp = () => {
  const routes = [];
  return {
    routes,
    get: (path, handler) => routes.push({ method: 'GET', path, handler }),
    patch: (path, handler) => routes.push({ method: 'PATCH', path, handler }),
  };
};

const resDouble = () => {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.set = (key, value) => { res.headers[key] = value; return res; };
  return res;
};

const routeFor = (app, method, path) => {
  const route = app.routes.find((item) => item.method === method && item.path === path);
  assert.ok(route, `missing ${method} ${path}`);
  return route.handler;
};

test('admin routes are registered for overview, audit and role changes', () => {
  const app = makeApp();
  registerAdminRoutes(app);
  const keys = app.routes.map((route) => `${route.method} ${route.path}`).sort();
  assert.deepEqual(keys, [
    'GET /api/admin/audit',
    'GET /api/admin/overview',
    'PATCH /api/admin/users/:id/role',
  ]);
});

test('admin routes reject anonymous sessions with 401', () => {
  const app = makeApp();
  registerAdminRoutes(app, { readUser: () => null });
  for (const route of app.routes) {
    const res = resDouble();
    route.handler({ params: { id: 'u1' }, body: { role: 'admin' }, query: {} }, res);
    assert.equal(res.statusCode, 401, `${route.path} must reject anonymous callers`);
    assert.equal(res.body.code, 'not_authenticated');
  }
});

test('admin routes reject non-admin roles with 403', () => {
  const app = makeApp();
  registerAdminRoutes(app, { readUser: () => ({ id: 'u1', role: 'trader', name: 'Trader' }) });
  for (const route of app.routes) {
    const res = resDouble();
    route.handler({ params: { id: 'u2' }, body: { role: 'admin' }, query: {} }, res);
    assert.equal(res.statusCode, 403, `${route.path} must require the admin role`);
    assert.equal(res.body.code, 'insufficient_role');
  }
});

test('an admin role change is applied, audited and returned with the user list', () => {
  const app = makeApp();
  const audited = [];
  const calls = [];
  registerAdminRoutes(app, {
    readUser: () => ({ id: 'admin-1', role: 'admin', name: 'Owner' }),
    changeRole: (id, role, actorId) => {
      calls.push({ id, role, actorId });
      return { id, role, previousRole: 'viewer', changed: true };
    },
    listUsers: () => [{ id: 'u2', role: 'admin' }],
    recordAudit: (entry) => audited.push(entry),
  });
  const handler = routeFor(app, 'PATCH', '/api/admin/users/:id/role');
  const res = resDouble();
  handler({ params: { id: 'u2' }, body: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [{ id: 'u2', role: 'admin', actorId: 'admin-1' }]);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.users[0].role, 'admin');
  assert.equal(audited.length, 1);
  assert.equal(audited[0].action, 'admin.role_change');
  assert.deepEqual(audited[0].detail, { previousRole: 'viewer', role: 'admin' });
});

test('invalid roles are rejected before touching the user store', () => {
  const app = makeApp();
  let changed = false;
  registerAdminRoutes(app, {
    readUser: () => ({ id: 'admin-1', role: 'admin' }),
    changeRole: () => { changed = true; return { changed: true }; },
  });
  const handler = routeFor(app, 'PATCH', '/api/admin/users/:id/role');
  const res = resDouble();
  handler({ params: { id: 'u2' }, body: { role: 'superuser' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'invalid_role');
  assert.equal(changed, false);
});

test('last-admin protection surfaces a 409 conflict', () => {
  const app = makeApp();
  registerAdminRoutes(app, {
    readUser: () => ({ id: 'admin-1', role: 'admin' }),
    changeRole: () => {
      throw Object.assign(new Error('The last remaining admin cannot lose the admin role.'), { code: 'last_admin' });
    },
  });
  const handler = routeFor(app, 'PATCH', '/api/admin/users/:id/role');
  const res = resDouble();
  handler({ params: { id: 'admin-1' }, body: { role: 'viewer' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'last_admin');
  assert.match(res.body.error, /last remaining admin/i);
});
