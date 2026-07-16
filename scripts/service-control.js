#!/usr/bin/env node
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPaths } from '../src/paths.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATHS = projectPaths(ROOT);
const PID_FILE = PATHS.pidFile;
const STATUS_FILE = PATHS.statusFile;
const STOP_FILE = PATHS.stopFile;
const LOG_FILE = join(PATHS.logDir, 'tracker.log');
const SERVICE_FILE = join(ROOT, 'bin', 'service.js');
const WAIT_START_MS = 15000;
const WAIT_STOP_MS = 35000;

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

function commandLine(pid) {
  if (process.platform !== 'win32') return '';
  try {
    return execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\").CommandLine`,
    ], { encoding: 'utf8', windowsHide: true }).trim();
  } catch { return ''; }
}

function isTrackerService(pid) {
  const cmd = commandLine(pid).toLowerCase();
  return cmd.includes('bin\\service.js') || cmd.includes('bin/service.js');
}

function cleanupStalePid() {
  const pid = readPid();
  if (pid && !isAlive(pid)) {
    try { unlinkSync(PID_FILE); } catch { /* absent */ }
    return null;
  }
  return pid;
}

async function start() {
  mkdirSync(PATHS.runtimeDir, { recursive: true });
  mkdirSync(PATHS.logDir, { recursive: true });
  const existing = cleanupStalePid();
  if (existing && isAlive(existing)) {
    console.log(`Tracker 已在執行中 (PID=${existing})`);
    console.log('如需重啟請執行 restart_tracker.cmd');
    return true;
  }
  try { unlinkSync(STOP_FILE); } catch { /* absent */ }

  const fd = openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, ['--no-warnings', SERVICE_FILE], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
  closeSync(fd);

  const deadline = Date.now() + WAIT_START_MS;
  while (Date.now() < deadline) {
    await sleep(300);
    const status = readStatus();
    if (status?.pid === child.pid && status.status === 'running') {
      console.log(`Tracker 已在背景啟動 (PID=${child.pid})`);
      console.log(`管理頁：${status.webUrl || 'http://127.0.0.1:8787'}`);
      console.log(`Log：${LOG_FILE}`);
      return true;
    }
    if (!isAlive(child.pid)) {
      console.error(`Tracker 啟動失敗：${status?.error || '程序已退出'}`);
      console.error(`請查看 Log：${LOG_FILE}`);
      return false;
    }
  }
  console.error(`等待 Tracker 啟動逾時，請查看 Log：${LOG_FILE}`);
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
  const pid = cleanupStalePid();
  if (!pid || !isAlive(pid)) {
    console.log('Tracker 目前沒有執行。');
    return true;
  }
  if (!isTrackerService(pid)) {
    console.error(`PID=${pid} 不是可確認的 Beyblade service；為安全起見不終止該程序。`);
    console.error(`請刪除過期 PID 檔後重試：${PID_FILE}`);
    return false;
  }

  console.log(`正在優雅停止 Tracker (PID=${pid})...`);
  writeFileSync(STOP_FILE, JSON.stringify({ requestedAt: new Date().toISOString(), by: 'service-control' }));
  const deadline = Date.now() + WAIT_STOP_MS;
  while (Date.now() < deadline) {
    await sleep(500);
    if (!isAlive(pid)) {
      console.log('Tracker 已正常停止。');
      return true;
    }
  }

  if (!isTrackerService(pid)) {
    console.error('等待期間 PID 身分已改變，拒絕強制終止。');
    return false;
  }
  console.warn('優雅停止逾時，正在強制終止 Tracker 專屬程序樹...');
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    process.kill(pid, 'SIGKILL');
  }
  try { unlinkSync(PID_FILE); } catch { /* absent */ }
  try { unlinkSync(STOP_FILE); } catch { /* absent */ }
  console.log('Tracker 已強制停止。');
  return true;
}

function status() {
  const pid = cleanupStalePid();
  const info = readStatus();
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
