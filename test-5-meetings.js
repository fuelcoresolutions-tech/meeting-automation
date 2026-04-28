import fs from 'fs';
import axios from 'axios';

const AGENT_URL = 'http://localhost:8000/process-transcript-sync';

// 5 diverse meetings: L10, general, long, short, recent
const TEST_MEETINGS = [
  { id: '01KJMDEA98BJEDEAEYJWK61NXD', desc: 'Fuelcore Weekly Meeting (Mar 03, 861 sent, L10-style)' },
  { id: '01KJ7MAA4G3H2NWJJEJX4QR5A2', desc: 'Feb 24 01:50 PM (630 sent, interview/general)' },
  { id: '01KHNH8KFPAD8QBFXRH9J67GC9', desc: 'Feb 17 01:10 PM (1388 sent, long meeting)' },
  { id: '01KH5SNVQFW4K68Z8A37ZFFA2J', desc: 'Fuelcore meeting (Feb 11, 280 sent, short)' },
  { id: '01KH3ATX7BR9SAB97E2WE4WEW0', desc: 'Feb 10 11:31 AM (431 sent, strategy)' },
];

const results = [];

console.log('═══════════════════════════════════════════════════════════');
console.log('  TESTING 5 MEETINGS THROUGH FULL PIPELINE');
console.log('  (Sonnet extraction + Sonnet processing + Validator)');
console.log('═══════════════════════════════════════════════════════════\n');

for (let i = 0; i < TEST_MEETINGS.length; i++) {
  const { id, desc } = TEST_MEETINGS[i];
  const rawPath = `data/raw/${id}.json`;

  if (!fs.existsSync(rawPath)) {
    console.log(`[${i+1}/5] ❌ ${desc} — file not found\n`);
    continue;
  }

  const transcript = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
  console.log(`[${i+1}/5] 🔄 ${desc}`);
  console.log(`         Sentences: ${transcript.sentences?.length || 0} | Duration: ${Math.round(transcript.duration || 0)} min`);

  const startTime = Date.now();
  try {
    const resp = await axios.post(AGENT_URL, transcript, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 600000,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const data = resp.data;
    results.push({ id, desc, success: data.success, elapsed, error: data.error });
    console.log(`         ✅ ${data.success ? 'Success' : 'Failed'} in ${elapsed}s`);
    if (data.error) console.log(`         Error: ${data.error}`);
  } catch (e) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const errMsg = e.response?.data?.detail || e.message;
    results.push({ id, desc, success: false, elapsed, error: errMsg });
    console.log(`         ❌ Error in ${elapsed}s: ${errMsg}`);
  }
  console.log('');

  // Pause between meetings to avoid API rate limits
  if (i < TEST_MEETINGS.length - 1) {
    console.log('         ⏳ Waiting 10s before next meeting...\n');
    await new Promise(r => setTimeout(r, 10000));
  }
}

console.log('═══════════════════════════════════════════════════════════');
console.log('  TEST RESULTS');
console.log('═══════════════════════════════════════════════════════════');
const passed = results.filter(r => r.success).length;
const failed = results.filter(r => !r.success).length;
console.log(`  Passed: ${passed}/5 | Failed: ${failed}/5\n`);
results.forEach((r, i) => {
  const icon = r.success ? '✅' : '❌';
  console.log(`  ${icon} [${i+1}] ${r.desc}`);
  console.log(`      Time: ${r.elapsed}s${r.error ? ' | Error: ' + r.error : ''}`);
});
console.log('\n═══════════════════════════════════════════════════════════\n');
console.log('Run "node evaluate-run.js" to see what was created in Notion.\n');
