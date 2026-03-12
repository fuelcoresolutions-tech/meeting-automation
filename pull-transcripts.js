import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const FIREFLY_API_KEY = process.env.FIREFLY_API_KEY;
const RAW_DIR = path.join(process.cwd(), 'data', 'raw');
const MANIFEST_PATH = path.join(process.cwd(), 'data', 'manifest.json');

// Ensure directories exist
fs.mkdirSync(RAW_DIR, { recursive: true });

// Full Fireflies transcript list query — gets IDs + metadata for pagination
const LIST_QUERY = `
  query Transcripts($limit: Int, $skip: Int) {
    transcripts(limit: $limit, skip: $skip) {
      id
      title
      date
      duration
    }
  }
`;

// Full Fireflies single transcript query — gets ALL available fields
const FULL_TRANSCRIPT_QUERY = `
  query Transcript($transcriptId: String!) {
    transcript(id: $transcriptId) {
      id
      title
      date
      duration
      organizer_email
      participants
      transcript_url
      meeting_link
      calendar_type
      cal_id
      is_live
      fireflies_users
      host_email
      speakers {
        id
        name
      }
      analytics {
        sentiments {
          negative_pct
          neutral_pct
          positive_pct
        }
        categories {
          questions
          date_times
          metrics
          tasks
        }
        speakers {
          speaker_id
          name
          duration
          word_count
          longest_monologue
          monologues_count
          filler_words
          questions
          duration_pct
          words_per_minute
        }
      }
      sentences {
        index
        speaker_name
        speaker_id
        text
        raw_text
        start_time
        end_time
        ai_filters {
          task
          pricing
          metric
          question
          date_and_time
          text_cleanup
          sentiment
        }
      }
      summary {
        keywords
        action_items
        outline
        shorthand_bullet
        overview
        bullet_gist
        gist
        short_summary
        short_overview
        meeting_type
        topics_discussed
        transcript_chapters
      }
      meeting_attendees {
        displayName
        email
        phoneNumber
        name
        location
      }
      meeting_attendance {
        name
        join_time
        leave_time
      }
    }
  }
`;

async function firefliesRequest(query, variables = {}) {
  const response = await axios.post(
    'https://api.fireflies.ai/graphql',
    { query, variables },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIREFLY_API_KEY}`
      }
    }
  );

  if (response.data.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(response.data.errors)}`);
  }

  return response.data.data;
}

function loadManifest() {
  if (fs.existsSync(MANIFEST_PATH)) {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  }
  return { transcripts: [], pulled_at: null, last_batch_id: null };
}

function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const force = process.argv.includes('--force');

  console.log('═══════════════════════════════════════════════════════');
  console.log('  FIREFLIES TRANSCRIPT PULL');
  console.log('═══════════════════════════════════════════════════════\n');

  // Step 1: Get list of all transcripts
  console.log('📋 Fetching transcript list from Fireflies...\n');

  let allTranscripts = [];
  let skip = 0;
  const limit = 50;

  while (true) {
    const data = await firefliesRequest(LIST_QUERY, { limit, skip });
    const batch = data.transcripts || [];

    if (batch.length === 0) break;

    allTranscripts = allTranscripts.concat(batch);
    console.log(`   Fetched ${allTranscripts.length} transcript IDs so far...`);

    if (batch.length < limit) break;
    skip += limit;
    await sleep(500);
  }

  console.log(`\n✅ Found ${allTranscripts.length} total transcripts\n`);

  if (allTranscripts.length === 0) {
    console.log('No transcripts found. Make sure your FIREFLY_API_KEY is correct.');
    return;
  }

  // Step 2: Load manifest to check what's already pulled
  const manifest = loadManifest();
  const existingIds = new Set(manifest.transcripts.map(t => t.id));

  // Step 3: Pull full transcript data for each
  let pulled = 0;
  let skipped = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < allTranscripts.length; i++) {
    const t = allTranscripts[i];
    const filePath = path.join(RAW_DIR, `${t.id}.json`);

    // Skip if already pulled (unless --force)
    if (!force && existingIds.has(t.id) && fs.existsSync(filePath)) {
      skipped++;
      process.stdout.write(`  [${i + 1}/${allTranscripts.length}] ⏭️  "${t.title}" (already pulled)\n`);
      continue;
    }

    process.stdout.write(`  [${i + 1}/${allTranscripts.length}] 📥 "${t.title}"...`);

    try {
      const data = await firefliesRequest(FULL_TRANSCRIPT_QUERY, { transcriptId: t.id });
      const transcript = data.transcript;

      // Convert timestamp to ISO date string
      if (transcript.date && typeof transcript.date === 'number') {
        transcript.pulled_date_iso = new Date(transcript.date).toISOString();
      }

      // Save raw JSON
      fs.writeFileSync(filePath, JSON.stringify(transcript, null, 2));

      // Update manifest entry
      const existingIdx = manifest.transcripts.findIndex(mt => mt.id === t.id);
      const entry = {
        id: t.id,
        title: transcript.title,
        date: transcript.pulled_date_iso || transcript.date,
        duration_minutes: transcript.duration ? Math.round(transcript.duration) : 0,
        sentence_count: transcript.sentences?.length || 0,
        speaker_count: transcript.speakers?.length || 0,
        attendee_count: transcript.meeting_attendees?.length || 0,
        meeting_type: transcript.summary?.meeting_type || 'Unknown',
        pulled_at: new Date().toISOString(),
        processing_status: 'raw'
      };

      if (existingIdx >= 0) {
        manifest.transcripts[existingIdx] = entry;
      } else {
        manifest.transcripts.push(entry);
      }

      pulled++;
      const sentenceCount = transcript.sentences?.length || 0;
      process.stdout.write(` ✅ (${sentenceCount} sentences)\n`);
    } catch (error) {
      errors++;
      process.stdout.write(` ❌ ${error.message}\n`);
    }

    // Rate limit: 1 second between full transcript fetches
    if (i < allTranscripts.length - 1) {
      await sleep(1000);
    }
  }

  // Save manifest
  manifest.pulled_at = new Date().toISOString();
  saveManifest(manifest);

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  PULL COMPLETE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  📥 Pulled:  ${pulled}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log(`  ❌ Errors:  ${errors}`);
  console.log(`  ⏱️  Time:    ${elapsed}s`);
  console.log(`  📁 Files:   data/raw/`);
  console.log(`  📋 Manifest: data/manifest.json`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Show transcript list
  console.log('Transcripts in manifest:\n');
  manifest.transcripts
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .forEach((t, i) => {
      const date = t.date ? new Date(t.date).toLocaleDateString() : 'N/A';
      const status = t.processing_status === 'raw' ? '⬜' : t.processing_status === 'processed' ? '✅' : '🔄';
      console.log(`  ${status} ${i + 1}. ${t.title} (${date}, ${t.duration_minutes}min, ${t.sentence_count} sentences)`);
    });
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
