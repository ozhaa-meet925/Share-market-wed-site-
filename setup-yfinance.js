import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const venvPath = path.join(root, '.venv-yfinance');
const python = process.env.YFINANCE_SETUP_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
const pythonArgs = process.env.YFINANCE_SETUP_PYTHON ? [] : (process.platform === 'win32' ? ['-3'] : []);
const venvPython = process.platform === 'win32'
  ? path.join(venvPath, 'Scripts', 'python.exe')
  : path.join(venvPath, 'bin', 'python');

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`${command} exited with code ${code ?? 'unknown'}.`));
  });
});

try {
  await run(python, [...pythonArgs, '-m', 'venv', venvPath]);
  await run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  await run(venvPython, ['-m', 'pip', 'install', '-r', path.join(root, 'requirements-yfinance.txt')]);
  console.log(`yfinance research quotes are ready. Python: ${venvPython}`);
} catch (error) {
  console.error(`Could not set up yfinance: ${error.message}`);
  process.exitCode = 1;
}
