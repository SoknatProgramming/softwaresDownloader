const { checkAndDownloadAll } = require('./autoUpdateService');

const DEFAULT_INTERVAL_MS = 1 * 60 * 1000; // 1 minute

let timer = null;
let state = {
  running: false,
  intervalMs: DEFAULT_INTERVAL_MS,
  startedAt: null,
  lastRun: null,
  nextRun: null,
  runCount: 0,
  lastResult: null,
  lastError: null
};

async function runCycle() {
  const now = new Date().toISOString();
  console.log(`[Scheduler] Auto-update cycle started at ${now}`);
  try {
    const result = await checkAndDownloadAll();
    state.lastRun = result.timestamp;
    state.lastResult = {
      initial: result.initial,
      updated: result.updated,
      errors: result.errors,
      noChange: result.noChange
    };
    state.lastError = null;
    state.runCount++;
    if (state.running) {
      state.nextRun = new Date(Date.now() + state.intervalMs).toISOString();
    }
    console.log(
      `[Scheduler] Cycle done — initial: ${result.initial}, updated: ${result.updated}, errors: ${result.errors}, unchanged: ${result.noChange}`
    );
  } catch (err) {
    state.lastError = err.message;
    console.error(`[Scheduler] Cycle error: ${err.message}`);
  }
}

function start(intervalMs) {
  if (timer) {
    return { message: 'Scheduler is already running', status: getStatus() };
  }

  if (intervalMs && intervalMs > 0) {
    state.intervalMs = intervalMs;
  }

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.nextRun = new Date(Date.now() + state.intervalMs).toISOString();

  timer = setInterval(runCycle, state.intervalMs);

  console.log(
    `[Scheduler] Started — interval: ${state.intervalMs / 60000} minute(s). Running first check immediately...`
  );

  // Run immediately so the first result is visible right away
  runCycle();

  return { message: 'Scheduler started', status: getStatus() };
}

function stop() {
  if (!timer) {
    return { message: 'Scheduler is not running', status: getStatus() };
  }

  clearInterval(timer);
  timer = null;
  state.running = false;
  state.nextRun = null;

  console.log('[Scheduler] Stopped.');
  return { message: 'Scheduler stopped', status: getStatus() };
}

async function runNow() {
  console.log('[Scheduler] Manual run triggered.');
  await runCycle();
  return { message: 'Manual run completed', status: getStatus() };
}

function getStatus() {
  return {
    running: state.running,
    intervalMs: state.intervalMs,
    intervalMinutes: state.intervalMs / 60000,
    startedAt: state.startedAt,
    lastRun: state.lastRun,
    nextRun: state.nextRun,
    runCount: state.runCount,
    lastResult: state.lastResult,
    lastError: state.lastError
  };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  start,
  stop,
  runNow,
  getStatus
};
