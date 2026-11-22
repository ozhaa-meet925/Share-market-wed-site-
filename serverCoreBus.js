import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

const emitter = new EventEmitter();
emitter.setMaxListeners(80);

const RING_LIMIT = 300;
const ring = [];
const sseClients = new Map();
const wsClients = new Set();
let wss = null;
let heartbeat = null;

const envelope = (topic, payload = {}) => ({
  id: `EVT-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
  topic,
  at: new Date().toISOString(),
  payload,
});

const broadcast = (event) => {
  const data = JSON.stringify(event);
  for (const [id, res] of sseClients) {
    try {
      res.write(`id: ${event.id}\nevent: core\ndata: ${data}\n\n`);
    } catch {
      sseClients.delete(id);
    }
  }
  for (const client of wsClients) {
    if (client.readyState === 1) {
      try { client.send(data); } catch { wsClients.delete(client); }
    }
  }
};

export const publish = (topic, payload) => {
  const event = envelope(topic, payload);
  ring.push(event);
  if (ring.length > RING_LIMIT) ring.splice(0, ring.length - RING_LIMIT);
  emitter.emit('event', event);
  emitter.emit(topic, event);
  broadcast(event);
  return event;
};

export const subscribe = (topic, handler) => {
  emitter.on(topic, handler);
  return () => emitter.off(topic, handler);
};

export const recentEvents = (limit = 40, topics = null) => {
  const wanted = topics ? new Set(topics) : null;
  return ring.filter((event) => !wanted || wanted.has(event.topic)).slice(-limit).reverse();
};

export const addSseClient = (res) => {
  const id = `SSE-${crypto.randomBytes(4).toString('hex')}`;
  sseClients.set(id, res);
  return id;
};

export const removeSseClient = (id) => {
  sseClients.delete(id);
};

export const attachCoreWebSocket = (server, { path: wsPath = '/ws/core', authenticate } = {}) => {
  if (!server || wss) return null;
  wss = new WebSocketServer({ server, path: wsPath });
  wss.on('connection', (socket, request) => {
    const user = typeof authenticate === 'function' ? authenticate(request) : null;
    if (!user) {
      socket.close(4401, 'Authentication required');
      return;
    }
    wsClients.add(socket);
    socket.isAlive = true;
    socket.send(JSON.stringify({
      id: `WS-${crypto.randomBytes(4).toString('hex')}`,
      topic: 'socket.ready',
      at: new Date().toISOString(),
      payload: { user: { id: user.id, role: user.role || 'trader' }, recent: recentEvents(20) },
    }));
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('message', (raw) => {
      if (String(raw).slice(0, 40).includes('ping')) {
        socket.send(JSON.stringify({ topic: 'socket.pong', at: new Date().toISOString(), payload: {} }));
      }
    });
    socket.on('close', () => wsClients.delete(socket));
    socket.on('error', () => wsClients.delete(socket));
  });
  heartbeat = setInterval(() => {
    for (const socket of wsClients) {
      if (!socket.isAlive) {
        wsClients.delete(socket);
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      try { socket.ping(); } catch { wsClients.delete(socket); }
    }
  }, 30_000);
  heartbeat.unref?.();
  return wss;
};

export const realtimeStatus = () => ({
  websocket: {
    enabled: Boolean(wss),
    path: wss ? '/ws/core' : null,
    clients: wsClients.size,
    transport: 'ws',
  },
  sse: { enabled: true, path: '/api/core/stream', clients: sseClients.size },
});

export const closeCoreRealtime = () => {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  for (const socket of wsClients) {
    try { socket.close(1001, 'Server shutting down'); } catch { /* ignore */ }
  }
  wsClients.clear();
  if (wss) wss.close();
  wss = null;
  for (const [, res] of sseClients) {
    try { res.end(); } catch { /* ignore */ }
  }
  sseClients.clear();
};
