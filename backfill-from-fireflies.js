// Backfill missing meetings: list Fireflies transcripts, find any whose
// externalMeetingId is not already in the Notion meeting register, and queue
// them. The durable retry worker then processes each one normally
// (fetch full transcript + cache + Claude → notes in Notion).
//
// Usage:
//   BACKFILL_API_URL=https://meeting-automation-production.up.railway.app \
//   node backfill-from-fireflies.js [lookbackDays]
//
// Defaults: BACKFILL_API_URL=http://localhost:8080, lookbackDays=30
// Requires: FIREFLY_API_KEY in env. Skip running while Fireflies is rate-limited.

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const FIREFLY_API_KEY = process.env.FIREFLY_API_KEY;
const API_URL = (process.env.BACKFILL_API_URL || 'http://localhost:8080').replace(/\/$/, '');
const LOOKBACK_DAYS = parseInt(process.argv[2] || '30', 10);
const PAGE = 50;

if (!FIREFLY_API_KEY) {
  console.error('FIREFLY_API_KEY missing from env');
  process.exit(1);
}

async function fireflies(query, variables) {
  const resp = await axios.post(
    'https://api.fireflies.ai/graphql',
    { query, variables },
    { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${FIREFLY_API_KEY}` }, timeout: 60000 }
  );
  if (resp.data.errors) {
    const e = resp.data.errors[0];
    const code = e.extensions?.code;
    if (code === 'too_many_requests') {
      throw new Error(`Fireflies rate limit hit: ${e.message}. Try again after the lockout expires.`);
    }
    throw new Error(`Fireflies error (${code || 'unknown'}): ${e.message}`);
  }
  return resp.data.data;
}

async function listFirefliesTranscripts() {
  const all = [];
  let skip = 0;
  while (true) {
    const data = await fireflies(
      `query Transcripts($limit: Int, $skip: Int) {
         transcripts(limit: $limit, skip: $skip) { id title date duration }
       }`,
      { limit: PAGE, skip }
    );
    const batch = data.transcripts || [];
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < PAGE) break;
    skip += PAGE;
  }
  return all;
}

async function getExistingExternalIds() {
  const resp = await axios.get(`${API_URL}/api/meeting-register`, { timeout: 60000 });
  const rows = resp.data || [];
  return new Set(rows.map(r => r.externalMeetingId).filter(Boolean));
}

async function queueMissing(transcript) {
  const meetingDate = transcript.date
    ? new Date(transcript.date).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];
  await axios.post(
    `${API_URL}/api/meeting-register/upsert-by-external`,
    {
      externalMeetingId: transcript.id,
      meetingFormat: 'Virtual',
      processingStatus: 'Pending',
      retryCount: 0,
      retrySource: 'backfill_script',
      nextRetryAt: new Date().toISOString(),
      forceRerun: false,
      createOnlyFields: {
        title: transcript.title || 'Untitled Meeting',
        meetingDate,
      },
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
  );
}

async function main() {
  console.log(`Backfill target: ${API_URL}`);
  console.log(`Lookback window: ${LOOKBACK_DAYS} days`);

  console.log('Listing Fireflies transcripts...');
  const transcripts = await listFirefliesTranscripts();
  console.log(`  Fireflies returned ${transcripts.length} transcripts`);

  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const recent = transcripts.filter(t => {
    const ts = typeof t.date === 'number' ? t.date : Date.parse(t.date);
    return Number.isFinite(ts) && ts >= cutoff;
  });
  console.log(`  ${recent.length} within lookback window`);

  console.log('Loading Notion meeting register...');
  const existing = await getExistingExternalIds();
  console.log(`  ${existing.size} rows already in register`);

  const missing = recent.filter(t => !existing.has(t.id));
  console.log(`\n${missing.length} meeting(s) missing in Notion — queueing now\n`);

  let ok = 0;
  let failed = 0;
  for (const t of missing) {
    try {
      await queueMissing(t);
      const dt = t.date ? new Date(t.date).toISOString().slice(0, 16) : '';
      console.log(`  ✓ queued ${t.id} | ${dt} | ${t.title || '(untitled)'}`);
      ok += 1;
    } catch (e) {
      console.log(`  ✗ failed ${t.id} | ${e.message}`);
      failed += 1;
    }
  }

  console.log(`\nDone. Queued: ${ok}. Failed: ${failed}.`);
  console.log('The durable retry worker will fetch each transcript and create the Notion note.');
}

main().catch(err => {
  console.error('\nBackfill aborted:', err.message);
  process.exit(1);
});
