/** Actual Windows launch/activation smoke, using isolated data and an ephemeral test bridge. */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

if (process.platform !== 'win32') throw new Error('This smoke currently requires Windows.');
const executable = path.resolve(process.argv[2] || 'release/local-optimized/win-unpacked/Chat On Steroids Local.exe');
const profile = await mkdtemp(path.join(tmpdir(), 'cos-desktop-smoke-'));
const env = { ...process.env, CLF_BRIDGE_PORTS: '0' };
if (process.argv.includes('--fixed-ports')) delete env.CLF_BRIDGE_PORTS;
delete env.ELECTRON_RUN_AS_NODE;
const args = [`--user-data-dir=${profile}`];
const primary = spawn(executable, [...args, '--background'], { env, windowsHide: true, stdio: 'ignore' });
let processError;
primary.on('error', error => { processError = error; });
const wait = async condition => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (processError) throw processError;
    if (primary.exitCode !== null) throw new Error('Primary exited during startup.');
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Desktop startup/activation timed out.');
};
const log = () => readFile(path.join(profile, 'app.log'), 'utf8').catch(() => '');
try {
  await wait(async () => (await log()).includes('app started'));
  await wait(async () => (await log()).includes('bridge listening on 127.0.0.1:'));
  if ((await log()).includes('window loaded')) throw new Error('Background launch unexpectedly opened a window.');
  const secondary = spawn(executable, args, { env, windowsHide: false, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { secondary.kill(); reject(new Error('Secondary activation timed out')); }, 20000);
    secondary.once('error', error => { clearTimeout(timeout); reject(error); });
    secondary.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Secondary exited ${code}`)); });
  });
  await wait(async () => (await log()).includes('window loaded'));
  const snapshot = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-Process -Id ${primary.pid} | Select-Object Id,MainWindowHandle,Responding | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true });
  const window = JSON.parse(snapshot.stdout);
  if (!window.MainWindowHandle || !window.Responding) throw new Error('Primary has no responsive native window.');
  const events = await log();
  if ((events.match(/app started/g) || []).length !== 1) throw new Error('Second launch created another runtime.');
  if (/window failed to load|renderer: |update: .*download/i.test(events)) throw new Error('Renderer failure or upstream update in local edition.');
  console.log(JSON.stringify({ background: true, activatedSameProcess: true, windowLoaded: true, responding: true, bridge: events.match(/bridge listening on (\S+)/)?.[1], profile, pid: primary.pid }));
} finally {
  // Only terminate the disposable runtime this script created; retain its logs for evidence.
  if (primary.pid && primary.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(primary.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}
