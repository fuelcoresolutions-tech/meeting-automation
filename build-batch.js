import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { BATCH_SYSTEM_PROMPT, buildUserPrompt } from './batch-prompt.js';

dotenv.config();

const RAW_DIR = path.join(process.cwd(), 'data', 'raw');
const MANIFEST_PATH = path.join(process.cwd(), 'data', 'manifest.json');
const BATCH_REQUEST_PATH = path.join(process.cwd(), 'data', 'batch-request.jsonl');

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const HAIKU_MODEL = process.env.CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5-20251001';

// Rough token estimation: ~4 chars per token
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  BUILD ANTHROPIC BATCH REQUEST');
  console.log('═══════════════════════════════════════════════════════\n');

  // Load manifest
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('❌ No manifest found. Run "npm run pull" first.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  const transcripts = manifest.transcripts || [];

  if (transcripts.length === 0) {
    console.error('❌ No transcripts in manifest. Run "npm run pull" first.');
    process.exit(1);
  }

  // Filter: only process transcripts that haven't been processed yet
  const onlyUnprocessed = !process.argv.includes('--all');
  const targetIds = process.argv.filter(a => !a.startsWith('--')).slice(2); // specific IDs
  
  let toProcess = transcripts;
  if (targetIds.length > 0) {
    toProcess = transcripts.filter(t => targetIds.includes(t.id));
    console.log(`📌 Processing specific transcripts: ${targetIds.length}\n`);
  } else if (onlyUnprocessed) {
    toProcess = transcripts.filter(t => t.processing_status === 'raw');
    console.log(`📋 Processing unprocessed transcripts: ${toProcess.length} of ${transcripts.length}\n`);
    console.log('   (use --all to reprocess everything)\n');
  } else {
    console.log(`📋 Processing ALL transcripts: ${toProcess.length}\n`);
  }

  if (toProcess.length === 0) {
    console.log('✅ All transcripts already processed. Use --all to rebuild batch.');
    return;
  }

  const requests = [];
  let totalInputTokens = 0;
  let totalOutputTokensEstimate = 0;
  let sonnetCount = 0;
  let haikuCount = 0;

  const systemPromptTokens = estimateTokens(BATCH_SYSTEM_PROMPT);

  for (const entry of toProcess) {
    const rawPath = path.join(RAW_DIR, `${entry.id}.json`);
    if (!fs.existsSync(rawPath)) {
      console.log(`  ⚠️  Skipping ${entry.title} — raw file not found`);
      continue;
    }

    const transcript = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
    const userPrompt = buildUserPrompt(transcript);
    const userTokens = estimateTokens(userPrompt);
    const inputTokens = systemPromptTokens + userTokens;

    // Model selection: Haiku for short/simple meetings, Sonnet for standard
    const isShort = (transcript.duration || 0) < 15; // less than 15 minutes
    const fewSentences = (transcript.sentences || []).length < 50;
    const selectedModel = (isShort && fewSentences) ? HAIKU_MODEL : MODEL;

    if (selectedModel === HAIKU_MODEL) {
      haikuCount++;
    } else {
      sonnetCount++;
    }

    // Build the batch request entry
    const request = {
      custom_id: entry.id,
      params: {
        model: selectedModel,
        max_tokens: 8192,
        system: [
          {
            type: 'text',
            text: BATCH_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: [
          { role: 'user', content: userPrompt }
        ]
      }
    };

    requests.push(request);
    totalInputTokens += inputTokens;
    totalOutputTokensEstimate += 4000; // ~4K output tokens per transcript

    const model = selectedModel === HAIKU_MODEL ? 'Haiku' : 'Sonnet';
    console.log(`  ✅ ${entry.title} (${model}, ~${Math.round(inputTokens / 1000)}K input tokens)`);
  }

  if (requests.length === 0) {
    console.log('\n❌ No valid transcripts to process.');
    return;
  }

  // Write JSONL file
  const jsonlContent = requests.map(r => JSON.stringify(r)).join('\n');
  fs.writeFileSync(BATCH_REQUEST_PATH, jsonlContent);

  // Cost estimation
  const sonnetInputRate = 3.0;  // per MTok
  const sonnetOutputRate = 15.0;
  const haikuInputRate = 1.0;
  const haikuOutputRate = 5.0;

  // Rough split of tokens between models
  const avgInputPerTranscript = totalInputTokens / requests.length;
  const sonnetInputTokens = sonnetCount * avgInputPerTranscript;
  const haikuInputTokens = haikuCount * avgInputPerTranscript;
  const sonnetOutputTokens = sonnetCount * 4000;
  const haikuOutputTokens = haikuCount * 4000;

  const standardCost =
    (sonnetInputTokens * sonnetInputRate / 1_000_000) +
    (sonnetOutputTokens * sonnetOutputRate / 1_000_000) +
    (haikuInputTokens * haikuInputRate / 1_000_000) +
    (haikuOutputTokens * haikuOutputRate / 1_000_000);
  const batchCost = standardCost * 0.5; // 50% discount

  // Save batch metadata
  const batchMeta = {
    created_at: new Date().toISOString(),
    request_count: requests.length,
    transcript_ids: requests.map(r => r.custom_id),
    model_breakdown: { sonnet: sonnetCount, haiku: haikuCount },
    estimated_input_tokens: totalInputTokens,
    estimated_output_tokens: totalOutputTokensEstimate,
    estimated_cost_standard: Number(standardCost.toFixed(4)),
    estimated_cost_batch: Number(batchCost.toFixed(4)),
    batch_request_file: 'data/batch-request.jsonl'
  };
  fs.writeFileSync(
    path.join(process.cwd(), 'data', 'batch-meta.json'),
    JSON.stringify(batchMeta, null, 2)
  );

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  BATCH REQUEST BUILT');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  📝 Requests:       ${requests.length}`);
  console.log(`  🤖 Sonnet:         ${sonnetCount}`);
  console.log(`  ⚡ Haiku:          ${haikuCount}`);
  console.log(`  📊 Input tokens:   ~${Math.round(totalInputTokens / 1000)}K`);
  console.log(`  📊 Output tokens:  ~${Math.round(totalOutputTokensEstimate / 1000)}K (estimated)`);
  console.log(`  💰 Standard cost:  $${standardCost.toFixed(2)}`);
  console.log(`  💰 Batch cost:     $${batchCost.toFixed(2)} (50% off)`);
  console.log(`  💾 Saved savings:  $${(standardCost - batchCost).toFixed(2)}`);
  console.log(`  📁 Output:         data/batch-request.jsonl`);
  console.log('═══════════════════════════════════════════════════════\n');
  console.log('Next step: npm run submit-batch\n');
}

main();
