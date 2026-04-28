import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BATCH_STATUS_PATH = path.join(process.cwd(), 'data', 'batch-status.json');
const MANIFEST_PATH = path.join(process.cwd(), 'data', 'manifest.json');
const PROCESSED_DIR = path.join(process.cwd(), 'data', 'processed');

const API_BASE = 'https://api.anthropic.com/v1/messages/batches';

// Ensure output directory exists
fs.mkdirSync(PROCESSED_DIR, { recursive: true });

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  FETCH BATCH RESULTS');
  console.log('═══════════════════════════════════════════════════════\n');

  // Load batch status
  if (!fs.existsSync(BATCH_STATUS_PATH)) {
    console.error('❌ No batch status found. Run "npm run submit-batch" first.');
    process.exit(1);
  }

  const status = JSON.parse(fs.readFileSync(BATCH_STATUS_PATH, 'utf-8'));

  if (status.processing_status !== 'ended') {
    // Check current status
    console.log('📡 Checking batch status...\n');
    try {
      const response = await axios.get(`${API_BASE}/${status.batch_id}`, {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
      });

      const batch = response.data;
      if (batch.processing_status !== 'ended') {
        console.log(`⏳ Batch is still ${batch.processing_status}.`);
        console.log(`   Succeeded: ${batch.request_counts?.succeeded || 0}`);
        console.log(`   Processing: ${batch.request_counts?.processing || 0}`);
        console.log(`\n   Run "npm run submit-batch -- --poll" to monitor progress.\n`);
        return;
      }

      // Update status file
      status.processing_status = 'ended';
      status.results_url = batch.results_url;
      status.request_counts = batch.request_counts;
      fs.writeFileSync(BATCH_STATUS_PATH, JSON.stringify(status, null, 2));
    } catch (error) {
      console.error(`❌ Error checking status: ${error.message}`);
      process.exit(1);
    }
  }

  console.log(`📥 Downloading results for batch: ${status.batch_id}\n`);

  // Fetch results — stream the JSONL
  let resultsData;
  try {
    const response = await axios.get(`${API_BASE}/${status.batch_id}/results`, {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      responseType: 'text',
    });
    resultsData = response.data;
  } catch (error) {
    if (error.response) {
      console.error(`❌ API Error: ${error.response.status}`);
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    process.exit(1);
  }

  // Parse JSONL results — each line is a separate result
  const resultLines = resultsData.trim().split('\n').filter(Boolean);

  let succeeded = 0;
  let errored = 0;
  let expired = 0;
  let canceled = 0;
  let parseErrors = 0;
  const costSummary = { input_tokens: 0, output_tokens: 0 };

  // Load manifest for updating
  const manifest = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'))
    : { transcripts: [] };

  console.log(`📋 Processing ${resultLines.length} results...\n`);

  for (const line of resultLines) {
    let result;
    try {
      result = JSON.parse(line);
    } catch (e) {
      console.log(`  ⚠️  Failed to parse result line: ${e.message}`);
      parseErrors++;
      continue;
    }

    const customId = result.custom_id;
    const resultType = result.result?.type;

    if (resultType === 'succeeded') {
      const message = result.result.message;
      const usage = message.usage || {};
      costSummary.input_tokens += usage.input_tokens || 0;
      costSummary.output_tokens += usage.output_tokens || 0;

      // Extract the text content from Claude's response
      const textBlocks = (message.content || []).filter(b => b.type === 'text');
      const responseText = textBlocks.map(b => b.text).join('');

      // Try to parse the JSON output from Claude
      let parsedOutput;
      try {
        // Claude might wrap JSON in markdown fences — strip them
        let cleanText = responseText.trim();
        if (cleanText.startsWith('```json')) {
          cleanText = cleanText.slice(7);
        } else if (cleanText.startsWith('```')) {
          cleanText = cleanText.slice(3);
        }
        if (cleanText.endsWith('```')) {
          cleanText = cleanText.slice(0, -3);
        }
        cleanText = cleanText.trim();

        parsedOutput = JSON.parse(cleanText);
      } catch (jsonError) {
        // Save raw text if JSON parsing fails
        parsedOutput = {
          _parse_error: true,
          _error_message: jsonError.message,
          _raw_response: responseText,
        };
        parseErrors++;
        console.log(`  ⚠️  ${customId}: JSON parse error — saved raw response`);
      }

      // Add metadata to the output
      const outputData = {
        _meta: {
          transcript_id: customId,
          batch_id: status.batch_id,
          model: message.model,
          processed_at: new Date().toISOString(),
          usage: usage,
          stop_reason: message.stop_reason,
        },
        ...parsedOutput,
      };

      // Save to data/processed/{id}.json
      const outputPath = path.join(PROCESSED_DIR, `${customId}.json`);
      fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));

      succeeded++;

      // Quick summary from the parsed data
      const issueCount = parsedOutput?.meeting_notes?.ids_issues?.length || 0;
      const todoCount = parsedOutput?.meeting_notes?.conclude_todos?.length || 0;
      const taskCount = parsedOutput?.tasks?.length || 0;
      const meetingType = parsedOutput?.meeting_register?.meeting_type || '?';

      const manifestEntry = manifest.transcripts.find(t => t.id === customId);
      const title = manifestEntry?.title || customId;

      console.log(`  ✅ ${title}`);
      console.log(`     Type: ${meetingType} | Issues: ${issueCount} | Todos: ${todoCount} | Tasks: ${taskCount}`);

      // Update manifest
      if (manifestEntry) {
        manifestEntry.processing_status = parsedOutput._parse_error ? 'parse_error' : 'processed';
        manifestEntry.processed_at = new Date().toISOString();
        manifestEntry.detected_meeting_type = meetingType;
        manifestEntry.issue_count = issueCount;
        manifestEntry.todo_count = todoCount;
        manifestEntry.task_count = taskCount;
      }

    } else if (resultType === 'errored') {
      errored++;
      const errorInfo = result.result.error || {};
      console.log(`  ❌ ${customId}: ${errorInfo.type || 'Unknown error'} — ${errorInfo.message || ''}`);

      // Save error info
      const errorPath = path.join(PROCESSED_DIR, `${customId}.error.json`);
      fs.writeFileSync(errorPath, JSON.stringify({ custom_id: customId, error: errorInfo }, null, 2));

      const manifestEntry = manifest.transcripts.find(t => t.id === customId);
      if (manifestEntry) {
        manifestEntry.processing_status = 'errored';
        manifestEntry.error = errorInfo.message || errorInfo.type;
      }

    } else if (resultType === 'expired') {
      expired++;
      console.log(`  ⏰ ${customId}: Expired`);
    } else if (resultType === 'canceled') {
      canceled++;
      console.log(`  🚫 ${customId}: Canceled`);
    }
  }

  // Save updated manifest
  manifest.last_fetch_at = new Date().toISOString();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  // Cost calculation
  const inputCost = costSummary.input_tokens * 1.5 / 1_000_000; // Batch Sonnet rate
  const outputCost = costSummary.output_tokens * 7.5 / 1_000_000;
  const totalCost = inputCost + outputCost;

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  ✅ Succeeded:    ${succeeded}`);
  console.log(`  ❌ Errored:      ${errored}`);
  console.log(`  ⏰ Expired:      ${expired}`);
  console.log(`  🚫 Canceled:     ${canceled}`);
  console.log(`  ⚠️  Parse errors: ${parseErrors}`);
  console.log('───────────────────────────────────────────────────────');
  console.log(`  📊 Input tokens:  ${costSummary.input_tokens.toLocaleString()}`);
  console.log(`  📊 Output tokens: ${costSummary.output_tokens.toLocaleString()}`);
  console.log(`  💰 Total cost:    $${totalCost.toFixed(4)} (batch pricing)`);
  console.log('───────────────────────────────────────────────────────');
  console.log(`  📁 Results saved: data/processed/`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (succeeded > 0) {
    console.log('📂 Review your processed transcripts:\n');
    console.log('   ls data/processed/');
    console.log('   cat data/processed/<id>.json | jq .\n');

    console.log('Each file contains structured JSON with:');
    console.log('  - meeting_register (Meeting Register database)');
    console.log('  - speaker_aliases (Speaker Aliases database)');
    console.log('  - meeting_notes (full EOS meeting notes)');
    console.log('  - quarterly_rocks (Quarterly Rocks database)');
    console.log('  - scorecard_metrics (Score Card Metrics database)');
    console.log('  - eos_issues (EOS Issues List database)');
    console.log('  - tasks (Tasks database)\n');
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
