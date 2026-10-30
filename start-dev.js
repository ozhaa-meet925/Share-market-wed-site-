import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const portIsAvailable = (port) => new Promise((resolve) => {
  const probe = createServer();
  probe.once('error', () => resolve(false));
  probe.listen(port, () => probe.close(() => resolve(true)));
});

const findAvailablePort = async (startPort) => {
  for (let port = startPort; port < startPort + 20; port += 1) {
    if (await portIsAvailable(port)) return port;
  }
  throw new Error(`No free API port found between ${startPort} and ${startPort + 19}.`);
};

const requestedPort = Number.parseInt(process.env.PORT_PROXY || '3001', 10);
if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
  throw new Error('PORT_PROXY must be a valid TCP port.');
}

const apiPort = await findAvailablePort(requestedPort);
if (apiPort !== requestedPort) {
  console.log(`Port ${requestedPort} is already in use; starting the market API on ${apiPort}.`);
}

const childEnv = {
  ...process.env,
  PORT_PROXY: String(apiPort),
  VITE_API_PROXY_TARGET: `http://localhost:${apiPort}`,
};

const children = [
  spawn(process.execPath, ['server.js'], { env: childEnv, stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], { env: childEnv, stdio: 'inherit' }),
];

let shuttingDown = false;
const shutdown = (exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill();
  process.exitCode = exitCode;
};

for (const child of children) {
  child.on('error', (error) => {
    console.error('Could not start the development server:', error.message);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (!shuttingDown) shutdown(code || (signal ? 1 : 0));
  });
}

process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
