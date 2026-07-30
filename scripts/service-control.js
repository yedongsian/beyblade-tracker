#!/usr/bin/env node
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPaths } from '../src/paths.js';
import {
  runStartSequence, runStopSequence, START_TIMEOUT_MS, STOP_TIMEOUT_MS,
} from '../src/release/service-lifecycle.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATHS = projectPaths(ROOT);
const PID_FILE = PATHS.pidFile;
const STATUS_FILE = PATHS.statusFile;
const STOP_FILE = PATHS.stopFile;
const LOG_FILE = join(PATHS.logDir, 'tracker.log');
const SERVICE_FILE = join(ROOT, 'bin', 'service.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readPid() {
  try {
    const pid = Number(readFileSync(PID_FILE, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

function readStatus() {
  try { return JSON.parse(readFileSync(STATUS_FILE, 'utf8')); } catch { return null; }
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function systemPowerShell() {
  const root = process.env.SystemRoot || process.env.windir;
  if (!root) return 'powershell.exe';
  const absolute = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return existsSync(absolute) ? absolute : 'powershell.exe';
}

function processIdentity(pid) {
  if (process.platform !== 'win32') return null;
  try {
    const json = execFileSync(systemPowerShell(), [
      '-NoProfile', '-Command',
      `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" | Select-Object @{N='processId';E={$_.ProcessId}},@{N='executablePath';E={$_.ExecutablePath}},@{N='commandLine';E={$_.CommandLine}},@{N='createdAt';E={if ($_.CreationDate) {$_.CreationDate.ToUniversalTime().ToString('o')}}} | ConvertTo-Json -Compress)`,
    ], { encoding: 'utf8', windowsHide: true }).trim();
    return json ? JSON.parse(json) : null;
  } catch { return null; }
}

function clearPid() {
  try { unlinkSync(PID_FILE); } catch { /* absent */ }
}

function clearStopRequest() {
  try { unlinkSync(STOP_FILE); } catch { /* absent */ }
}

function writeStopRequest(pid) {
  console.log(`正在優雅停止 Tracker (PID=${pid})...`);
  writeFileSync(STOP_FILE, JSON.stringify({ requestedAt: new Date().toISOString(), by: 'service-control' }));
}

function forceTerminate(pid) {
  console.warn('優雅停止逾時，正在強制終止 Tracker 專屬程序樹...');
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    process.kill(pid, 'SIGKILL');
  }
}

function spawnService() {
  const fd = openSync(LOG_FILE, 'a');
  try {
    const child = spawn(process.execPath, ['--no-warnings', SERVICE_FILE], {
      cwd: ROOT,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
    });
    child.unref();
    return child;
  } finally { closeSync(fd); }
}

function lifecycleDependencies() {
  return {
    readPid,
    readStatus,
    isAlive,
    inspectProcess: processIdentity,
    clearPid,
    clearStopRequest,
    sleep,
    executablePath: process.execPath,
    serviceFile: SERVICE_FILE,
  };
}

async function start() {
  mkdirSync(PATHS.runtimeDir, { recursive: true });
  mkdirSync(PATHS.logDir, { recursive: true });
  const result = await runStartSequence({ ...lifecycleDependencies(), spawnService, timeoutMs: START_TIMEOUT_MS });
  if (result.outcome === 'already-running') {
    console.log(`Tracker 已在執行中 (PID=${result.pid})`);
    console.log('如需重啟請執行 restart_tracker.cmd');
    return true;
  }
  if (result.outcome === 'refused') {
    console.error(`PID=${result.pid} 無法確認是否為 Beyblade service；為避免同時執行兩個服務，已停止啟動。`);
    console.error(`請確認該程序後重試；若確定它已不是 Tracker，請刪除：${PID_FILE}`);
    return false;
  }
  if (result.outcome === 'started') {
    console.log(`Tracker 已在背景啟動 (PID=${result.pid})`);
    console.log(`管理頁：${result.status?.webUrl || 'http://127.0.0.1:8787'}`);
    console.log(`Log：${LOG_FILE}`);
    return true;
  }
  if (result.outcome === 'timeout') console.error('等待 Tracker 啟動逾時。');
  else console.error(`Tracker 啟動失敗：${result.status?.error || '程序已退出'}`);
  console.error(`請查看 Log：${LOG_FILE}`);
  return false;
}

function migrateLegacyStatus() {
  const legacy = join(ROOT, 'data', 'tracker-status.json');
  if (!existsSync(STATUS_FILE) && existsSync(legacy)) {
    mkdirSync(PATHS.runtimeDir, { recursive: true });
    copyFileSync(legacy, STATUS_FILE);
  }
}

async function stop() {
  const result = await runStopSequence({
    ...lifecycleDependencies(), writeStopRequest, forceTerminate, timeoutMs: STOP_TIMEOUT_MS,
  });
  if (result.outcome === 'not-running') {
    console.log('Tracker 目前沒有執行。');
    return true;
  }
  if (result.outcome === 'graceful') {
    console.log('Tracker 已正常停止。');
    return true;
  }
  if (result.outcome === 'forced') {
    console.log('Tracker 已強制停止。');
    return true;
  }
  if (result.outcome === 'refused') {
    console.error(`PID=${result.pid} 不是可確認的 Beyblade service；為安全起見不送出停止請求也不終止該程序。`);
    console.error(`請刪除過期 PID 檔後重試：${PID_FILE}`);
    return false;
  }
  if (result.outcome === 'force-refused') {
    console.error('等待期間無法重新確認 PID 身分，拒絕強制終止。');
    console.error(`請手動確認 PID=${result.pid} 後再重試。`);
    return false;
  }
  console.error(`強制終止 PID=${result.pid} 失敗，請手動確認該程序。`);
  return false;
}

function status() {
  const pid = readPid();
  const info = readStatus();
  if (pid && !isAlive(pid)) clearPid();
  if (!pid || !isAlive(pid)) {
    console.log('狀態：已停止');
    if (info?.error) console.log(`最後錯誤：${info.error}`);
    return;
  }
  console.log(`狀態：${info?.status || 'running'}`);
  console.log(`PID：${pid}`);
  if (info?.webUrl) console.log(`管理頁：${info.webUrl}`);
  if (info?.lastCrawlFinishedAt) console.log(`最後掃描：${info.lastCrawlFinishedAt}`);
  if (info?.nextCrawlAt) console.log(`下次掃描：${info.nextCrawlAt}`);
  console.log(`Log：${LOG_FILE}`);
}

async function main() {
  migrateLegacyStatus();
  const command = (process.argv[2] || 'status').toLowerCase();
  let ok = true;
  if (command === 'start') ok = await start();
  else if (command === 'stop') ok = await stop();
  else if (command === 'restart') {
    ok = await stop();
    if (ok) { await sleep(1000); ok = await start(); }
  } else if (command === 'status') status();
  else {
    console.error('用法：node scripts/service-control.js start|restart|stop|status');
    ok = false;
  }
  process.exitCode = ok ? 0 : 1;
}

main();
