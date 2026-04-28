import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BATCH_REQUEST_PATH = path.join(process.cwd(), 'data', 'batch-request.jsonl');
const BATCH_STATUS_PATH = path.join(process.cwd(), 'data', 'batch-status.json');
const BATCH_META_PATH = path.join(process.cwd(), 'data', 'batch-meta.json');

const API_BASE = 'https://api.anthropic.com/v1/messages/batches';
const POLL_INTERVAL_MS = 15000; // Poll every 15 seconds

// ─── Terminal visualization helpers ──────────────────────────────────────────

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m',
};

function clearLines(n) {
  for (let i = 0; i < n; i++) {
    process.stdout.write('\x1b[1A\x1b[2K');
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000);
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function progressBar(current, total, width = 40) {
  if (total === 0) return '░'.repeat(width);
  const pct = Math.min(current / total, 1);
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return bar;
}

function spinnerFrame(tick) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  return frames[tick % frames.length];
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiRequest(method, url, data = null) {
  const config = {
    method,
    url,
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
  };
  if (data) config.data = data;
  return axios(config);
}

async function createBatch(requests) {
  const response = await apiRequest('POST', API_BASE, { requests });
  return response.data;
}

async function getBatchStatus(batchId) {
  const response = await apiRequest('GET', `${API_BASE}/${batchId}`);
  return response.data;
}

// ─── Live monitoring display ─────────────────────────────────────────────────

function renderStatus(batch, startTime, tick, meta) {
  const elapsed = Date.now() - startTime;
  const counts = batch.request_counts || {};
  const total = (counts.processing || 0) + (counts.succeeded || 0) +
                (counts.errored || 0) + (counts.canceled || 0) + (counts.expired || 0);
  const completed = (counts.succeeded || 0) + (counts.errored || 0) +
                    (counts.canceled || 0) + (counts.expired || 0);
  const inProgress = counts.processing || 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Estimate time remaining based on progress
  let etaStr = 'calculating...';
  if (completed > 0 && completed < total) {
    const msPerItem = elapsed / completed;
    const remaining = (total - completed) * msPerItem;
    etaStr = formatDuration(remaining);
  } else if (completed >= total && total > 0) {
    etaStr = 'done!';
  }

  const spinner = spinnerFrame(tick);
  const statusColor = batch.processing_status === 'ended'
    ? COLORS.green
    : batch.processing_status === 'canceling'
      ? COLORS.red
      : COLORS.cyan;

  const lines = [
    '',
    `${COLORS.bright}╔══════════════════════════════════════════════════════════╗${COLORS.reset}`,
    `${COLORS.bright}║  ${COLORS.cyan}ANTHROPIC BATCH PROCESSING${COLORS.reset}${COLORS.bright}                             ║${COLORS.reset}`,
    `${COLORS.bright}╠══════════════════════════════════════════════════════════╣${COLORS.reset}`,
    `${COLORS.bright}║${COLORS.reset}  ${spinner} Status:    ${statusColor}${batch.processing_status.toUpperCase()}${COLORS.reset}${' '.repeat(Math.max(0, 40 - batch.processing_status.length))}${COLORS.bright}║${COLORS.reset}`,
    `${COLORS.bright}║${COLORS.reset}  ⏱️  Elapsed:   ${COLORS.yellow}${formatDuration(elapsed)}${COLORS.reset}${' '.repeat(Math.max(0, 40 - formatDuration(elapsed).length))}${COLORS.bright}║${COLORS.reset}`,
    `${COLORS.bright}║${COLORS.reset}  ⏳ ETA:       ${COLORS.yellow}${etaStr}${COLORS.reset}${' '.repeat(Math.max(0, 40 - etaStr.length))}${COLORS.bright}║${COLORS.reset}`,
    `${COLORS.bright}║${COLORS.reset}  📊 Batch ID:  ${COLORS.dim}${batch.id}${COLORS.reset}${' '.repeat(Math.max(0, 14))}${COLORS.bright}║${COLORS.reset}`,
    `${COLORS.bright}╠══════════════════════════════════════════════════════════╣${COLORS.reset}`,
    `${COLORS.bright}║${COLORS.reset}                                                          ${COLORS.bright}║${COLORS.reset}`,
    `${COLORS.bright}║${COLORS.reset}  ${COLORS.blue}[${progressBar(completed, total)}]${COLORS.reset} ${pct}%    ${COLORS.bright}║${COLORS.reset}`,
    `${COLORS.bright}║${COLORS.reset}                                                          ${COLORS.bright}║${COLORS.reset}`,
    `${COLORS.bright}╠══════════════════════════════════════════════════════════╣${COLORS.reset}`,
    `${COLORS.bright}║${COLORS.reset}  ${COLORS.green}✅ Succeeded:${COLORS.reset}  ${counts.succeeded || 0}${' '.repeat(Math.max(0, 42 - String(counts.succeeded || 0).length))}${COLORS.bright}║${COLORS.reset}`,
    `${COLORS.bright}║${COLORS.reset}  ${COLORS.cyan}🔄 Processing:${COLORS.reset} ${inProgress}${' '.repeat(Math.max(0, 42 - String(inProgress).length))}${COLORS.bright}║${COLORS.reset}`,
    `${COLORS.bright}║${COLORS.reset}  ${COLORS.red}❌ Errored:${COLORS.reset}    ${counts.errored || 0}${' '.repeat(Math.max(0, 42 - String(counts.errored || 0).length))}${COLORS.bright}║${COLORS.reset}`,
    `${COLORS.bright}║${COLORS.reset}  ⏰ Expired:    ${counts.expired || 0}${' '.repeat(Math.max(0, 42 - String(counts.expired || 0).length))}${COLORS.bright}║${COLORS.reset}`,
    `${COLORS.bright}║${COLORS.reset}  🚫 Canceled:   ${counts.canceled || 0}${' '.repeat(Math.max(0, 42 - String(counts.canceled || 0).length))}${COLORS.bright}║${COLORS.reset}`,
    `${COLORS.bright}╠══════════════════════════════════════════════════════════╣${COLORS.reset}`,
    `${COLORS.bright}║${COLORS.reset}  💰 Est. cost:  ${COLORS.green}$${meta?.estimated_cost_batch?.toFixed(2) || '?'}${COLORS.reset} (50% batch discount)${' '.repeat(Math.max(0, 22 - String(meta?.estimated_cost_batch?.toFixed(2) || '?').length))}${COLORS.bright}║${COLORS.reset}`,
    `${COLORS.bright}║${COLORS.reset}  📝 Requests:   ${total} transcripts${' '.repeat(Math.max(0, 33 - String(total).length))}${COLORS.bright}║${COLORS.reset}`,
    `${COLORS.bright}╚══════════════════════════════════════════════════════════╝${COLORS.reset}`,
    '',
  ];

  return lines;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const shouldPoll = process.argv.includes('--poll');
  const statusOnly = process.argv.includes('--status');

  console.log(`\n${COLORS.bright}${COLORS.cyan}  ANTHROPIC MESSAGE BATCHES API${COLORS.reset}\n`);

  // Check for existing batch to poll
  if (statusOnly || shouldPoll) {
    if (!fs.existsSync(BATCH_STATUS_PATH)) {
      console.error('❌ No batch status found. Submit a batch first.');
      process.exit(1);
    }
    const status = JSON.parse(fs.readFileSync(BATCH_STATUS_PATH, 'utf-8'));
    const meta = fs.existsSync(BATCH_META_PATH)
      ? JSON.parse(fs.readFileSync(BATCH_META_PATH, 'utf-8'))
      : null;

    if (statusOnly) {
      const batch = await getBatchStatus(status.batch_id);
      console.log(JSON.stringify(batch, null, 2));
      return;
    }

    await pollBatch(status.batch_id, status.submitted_at, meta);
    return;
  }

  // Submit new batch
  if (!fs.existsSync(BATCH_REQUEST_PATH)) {
    console.error('❌ No batch request file found. Run "npm run build-batch" first.');
    process.exit(1);
  }

  const meta = fs.existsSync(BATCH_META_PATH)
    ? JSON.parse(fs.readFileSync(BATCH_META_PATH, 'utf-8'))
    : null;

  // Read JSONL and parse requests
  const lines = fs.readFileSync(BATCH_REQUEST_PATH, 'utf-8').trim().split('\n');
  const requests = lines.map(line => JSON.parse(line));

  console.log(`📦 Submitting batch with ${requests.length} requests...\n`);

  try {
    const batch = await createBatch(requests);

    console.log(`${COLORS.green}✅ Batch created!${COLORS.reset}`);
    console.log(`   Batch ID: ${batch.id}`);
    console.log(`   Status:   ${batch.processing_status}`);
    console.log(`   Expires:  ${batch.expires_at}\n`);

    // Save batch status
    const statusData = {
      batch_id: batch.id,
      submitted_at: new Date().toISOString(),
      processing_status: batch.processing_status,
      request_count: requests.length,
      expires_at: batch.expires_at,
    };
    fs.writeFileSync(BATCH_STATUS_PATH, JSON.stringify(statusData, null, 2));

    // Update manifest
    const manifestPath = path.join(process.cwd(), 'data', 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      manifest.last_batch_id = batch.id;
      manifest.last_batch_submitted = statusData.submitted_at;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }

    // Auto-poll
    console.log(`${COLORS.cyan}🔄 Starting live monitoring...${COLORS.reset}`);
    console.log(`   (Press Ctrl+C to stop — batch continues server-side)\n`);

    await pollBatch(batch.id, Date.now(), meta);

  } catch (error) {
    if (error.response) {
      console.error(`❌ API Error: ${error.response.status}`);
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    process.exit(1);
  }
}

async function pollBatch(batchId, startTime, meta) {
  if (typeof startTime === 'string') {
    startTime = new Date(startTime).getTime();
  }

  let tick = 0;
  let lastLinesCount = 0;
  let isFirstRender = true;

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n\n${COLORS.yellow}⚠️  Monitoring stopped. Batch continues server-side.${COLORS.reset}`);
    console.log(`   Resume with: ${COLORS.cyan}npm run submit-batch -- --poll${COLORS.reset}\n`);
    process.exit(0);
  });

  while (true) {
    try {
      const batch = await getBatchStatus(batchId);

      // Clear previous render
      if (!isFirstRender) {
        clearLines(lastLinesCount);
      }
      isFirstRender = false;

      const lines = renderStatus(batch, startTime, tick, meta);
      const output = lines.join('\n');
      process.stdout.write(output + '\n');
      lastLinesCount = lines.length + 1;

      // Check if done
      if (batch.processing_status === 'ended') {
        console.log(`${COLORS.green}${COLORS.bright}🎉 Batch processing complete!${COLORS.reset}\n`);

        // Update batch status file
        const statusData = {
          batch_id: batchId,
          submitted_at: new Date(startTime).toISOString(),
          completed_at: new Date().toISOString(),
          processing_status: 'ended',
          request_counts: batch.request_counts,
          results_url: batch.results_url,
          elapsed_ms: Date.now() - startTime,
        };
        fs.writeFileSync(BATCH_STATUS_PATH, JSON.stringify(statusData, null, 2));

        console.log(`Next step: ${COLORS.cyan}npm run fetch-results${COLORS.reset}\n`);
        return;
      }

      if (batch.processing_status === 'canceling') {
        console.log(`${COLORS.red}Batch is being canceled...${COLORS.reset}\n`);
      }

    } catch (error) {
      if (!isFirstRender) {
        clearLines(lastLinesCount);
      }
      console.log(`  ⚠️  Poll error: ${error.message} — retrying...`);
      lastLinesCount = 1;
      isFirstRender = true;
    }

    tick++;
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
