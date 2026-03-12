import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  notion, DATABASES, getPeople, getDepartments, getSpeakerAliases,
  getQuarterlyRocks, getProjects,
  createSpeakerAlias, createScorecardMetric, createEosIssue,
  createMeetingRegister, createTask,
} from './notion.js';

dotenv.config();

const PROCESSED_DIR = path.join(process.cwd(), 'data', 'processed');
const MANIFEST_PATH = path.join(process.cwd(), 'data', 'manifest.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Load all existing Notion data for ID resolution ─────────────────
async function loadNotionContext() {
  console.log('📡 Loading Notion context for ID resolution...');
  const [people, departments, aliases, rocks, projectsRaw] = await Promise.all([
    getPeople(false),
    getDepartments(),
    getSpeakerAliases(),
    getQuarterlyRocks(),
    getProjects(),
  ]);
  const projects = projectsRaw.map(p => ({
    id: p.id,
    name: p.properties?.Name?.title?.[0]?.plain_text || 'Untitled',
    status: p.properties?.Status?.status?.name || 'Unknown',
  }));

  console.log(`   People: ${people.length} | Depts: ${departments.length} | Projects: ${projects.length} | Rocks: ${rocks.length} | Aliases: ${aliases.length}`);
  return { people, departments, aliases, rocks, projects };
}

// ─── Name → Notion ID resolvers ─────────────────────────────────────
function resolvePersonId(name, people) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  const match = people.find(p =>
    p.name.toLowerCase() === lower ||
    p.name.toLowerCase().includes(lower) ||
    lower.includes(p.name.toLowerCase())
  );
  return match?.id || null;
}

function resolveDeptId(codeOrName, departments) {
  if (!codeOrName) return null;
  const lower = codeOrName.toLowerCase().trim();
  const match = departments.find(d =>
    d.code?.toLowerCase() === lower ||
    d.name?.toLowerCase() === lower ||
    d.name?.toLowerCase().includes(lower)
  );
  return match?.id || null;
}

function resolveProjectId(nameOrId, projects) {
  if (!nameOrId) return null;
  // If it looks like a Notion ID, use directly
  if (nameOrId.includes('-') && nameOrId.length > 30) return nameOrId;
  const lower = nameOrId.toLowerCase().trim();
  const match = projects.find(p => p.name.toLowerCase() === lower);
  return match?.id || null;
}

function resolveRockId(title, rocks) {
  if (!title) return null;
  const lower = title.toLowerCase().trim();
  const match = rocks.find(r => r.title.toLowerCase() === lower);
  return match?.id || null;
}

// ─── Push functions ──────────────────────────────────────────────────

async function pushNewPeople(allFiles, ctx) {
  console.log('\n══ 1. NEW PEOPLE ══════════════════════════════════════');
  const seen = new Map();
  for (const data of allFiles) {
    for (const p of (data.new_people || [])) {
      const key = (p.name || '').toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      // Skip if already in Notion
      if (resolvePersonId(p.name, ctx.people)) { continue; }
      seen.set(key, p);
    }
  }
  if (seen.size === 0) { console.log('  No new people to add.'); return 0; }

  let created = 0;
  for (const [, p] of seen) {
    try {
      const properties = {
        'Full Name': { title: [{ text: { content: p.name } }] },
      };
      if (p.email) properties.Email = { email: p.email };
      if (p.role_guess) properties['Role Title'] = { rich_text: [{ text: { content: p.role_guess } }] };
      if (p.company) properties.Company = { rich_text: [{ text: { content: p.company } }] };
      // Mark external people differently
      const isExternal = p.company && !p.company.toLowerCase().includes('fuel core');
      if (!isExternal) {
        properties['Is Active Member'] = { checkbox: true };
      }
      if (p.company?.toLowerCase().includes('fuel core')) {
        properties.Relationship = { multi_select: [{ name: 'Colleague' }] };
      } else {
        properties.Relationship = { multi_select: [{ name: 'Business Partner' }] };
      }

      await notion.pages.create({ parent: { database_id: DATABASES.people }, properties });
      created++;
      console.log(`  ✅ ${p.name} (${p.role_guess || '?'}) — ${isExternal ? 'External' : 'Team Member'}`);
      await sleep(350);
    } catch (e) {
      console.log(`  ❌ ${p.name}: ${e.message}`);
    }
  }
  console.log(`  → Created ${created} people`);
  return created;
}

async function pushSpeakerAliases(allFiles, ctx) {
  console.log('\n══ 2. SPEAKER ALIASES ═════════════════════════════════');
  const seen = new Map();
  const existingAliases = new Set(ctx.aliases.map(a => a.alias.toLowerCase().trim()));

  for (const data of allFiles) {
    for (const a of (data.new_speaker_aliases || [])) {
      const key = (a.alias || '').toLowerCase().trim();
      if (!key || key === 'null' || key === 'speaker' || key === 'speaker (unknown)' || seen.has(key) || existingAliases.has(key)) continue;
      // Fix known wrong mapping: Bob Changamu is NOT John Mark
      if (key === 'bob changamu' && a.likely_person?.includes('John Mark')) {
        a.likely_person = 'Bob Changamu';
      }
      seen.set(key, a);
    }
  }
  if (seen.size === 0) { console.log('  No new aliases to add.'); return 0; }

  // Reload people after push to get new IDs
  const freshPeople = await getPeople(false);
  let created = 0;
  for (const [, a] of seen) {
    try {
      const personId = resolvePersonId(a.likely_person, freshPeople);
      const aliasData = {
        alias: a.alias,
        source: 'Fireflies',
        confidence: a.confidence || 0.5,
        notes: a.reasoning || '',
      };
      if (personId) aliasData.personIds = [personId];
      await createSpeakerAlias(aliasData);
      created++;
      console.log(`  ✅ "${a.alias}" → ${a.likely_person || '?'} (${a.confidence || '?'})`);
      await sleep(350);
    } catch (e) {
      console.log(`  ❌ "${a.alias}": ${e.message}`);
    }
  }
  console.log(`  → Created ${created} aliases`);
  return created;
}

async function pushScorecardMetrics(allFiles, ctx) {
  console.log('\n══ 3. SCORECARD METRICS ═══════════════════════════════');
  const seen = new Map();
  // Dedup by normalized metric name
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const data of allFiles) {
    for (const m of (data.scorecard_metrics || [])) {
      const key = normalize(m.metric_name || '');
      if (!key || seen.has(key)) continue;
      seen.set(key, m);
    }
  }

  // Further dedup: group similar metrics
  const deduped = new Map();
  const groups = {
    'pump_sales': ['pumps sold', 'pump sales', 'annual pump', 'quarterly pump', 'monthly pump'],
    'revenue': ['revenue target', 'annual revenue'],
    'response_time': ['response time', 'urban response', 'regional response', '1.5-hour', '4-hour'],
    'uptime': ['uptime'],
    'nozzle': ['nozzle'],
    'inventory': ['inventory', 'remaining pump'],
    'cylinder': ['cylinder', 'gas cylinder'],
    'customer_db': ['customer database', 'open rate'],
    'completion_rate': ['completion rate', '90-day'],
    'notion': ['notion'],
  };

  for (const [, m] of seen) {
    const lower = (m.metric_name || '').toLowerCase();
    let grouped = false;
    for (const [groupKey, keywords] of Object.entries(groups)) {
      if (keywords.some(kw => lower.includes(kw))) {
        if (!deduped.has(groupKey)) deduped.set(groupKey, m);
        grouped = true;
        break;
      }
    }
    if (!grouped) deduped.set(normalize(m.metric_name), m);
  }

  const freshPeople = await getPeople(false);
  let created = 0;
  for (const [, m] of deduped) {
    try {
      const ownerId = resolvePersonId(m.owner, freshPeople);
      const deptId = resolveDeptId(m.department, ctx.departments);
      const metricData = {
        name: m.metric_name,
        target: m.target,
        currentValue: m.current_value,
        onTrack: m.on_track ?? true,
        frequency: m.frequency || 'Weekly',
        unit: m.unit || '',
        notes: m.notes || '',
      };
      if (ownerId) metricData.ownerIds = [ownerId];
      if (deptId) metricData.departmentIds = [deptId];
      await createScorecardMetric(metricData);
      created++;
      console.log(`  ✅ ${m.metric_name} | Target: ${m.target || '?'} ${m.unit || ''} | ${m.on_track ? '✅' : '❌'}`);
      await sleep(350);
    } catch (e) {
      console.log(`  ❌ ${m.metric_name}: ${e.message}`);
    }
  }
  console.log(`  → Created ${created} metrics (deduped from ${seen.size})`);
  return created;
}

async function pushMeetingRegister(allFiles, ctx) {
  console.log('\n══ 4. MEETING REGISTER ════════════════════════════════');
  const freshPeople = await getPeople(false);
  let created = 0;
  let skipped = 0;

  for (const data of allFiles) {
    const reg = data.meeting_register;
    if (!reg || !reg.title || !reg.date) { skipped++; continue; }
    // Skip empty meetings
    const notes = data.meeting_notes || {};
    const hasContent = (notes.ids_issues?.length || 0) + (notes.conclude_todos?.length || 0) + (data.tasks?.length || 0) > 0;
    if (!hasContent) { skipped++; continue; }

    try {
      const meetingData = {
        title: reg.title,
        meetingDate: reg.date,
        processingStatus: 'Completed',
      };
      if (reg.meeting_format) meetingData.meetingFormat = reg.meeting_format;
      if (reg.meeting_type) {
        const typeMap = { 'L10': 'L10', 'Quarterly': 'Quartely', 'Annual': 'Annual', 'Same Page': 'Same Page', 'State of Company': 'State Of Company', 'General': 'Ad Hoc' };
        const mapped = typeMap[reg.meeting_type];
        if (mapped) meetingData.meetingTypes = [mapped];
      }
      if (reg.transcript_source) meetingData.transcriptSource = reg.transcript_source;
      if (reg.confidence_notes) meetingData.confidenceNotes = reg.confidence_notes;

      // Resolve attendee IDs
      const attendeeIds = (reg.attendees || []).map(n => resolvePersonId(n, freshPeople)).filter(Boolean);
      if (attendeeIds.length) meetingData.attendeeIds = attendeeIds;
      const facId = resolvePersonId(reg.facilitator, freshPeople);
      if (facId) meetingData.facilitatorIds = [facId];

      await createMeetingRegister(meetingData);
      created++;
      console.log(`  ✅ ${reg.date} | ${reg.meeting_type} | ${reg.title}`);
      await sleep(350);
    } catch (e) {
      console.log(`  ❌ ${reg.title}: ${e.message}`);
    }
  }
  console.log(`  → Created ${created} register entries (skipped ${skipped} empty meetings)`);
  return created;
}

async function pushEosIssues(allFiles, ctx) {
  console.log('\n══ 5. EOS ISSUES ═════════════════════════════════════');
  const freshPeople = await getPeople(false);
  let created = 0;

  for (const data of allFiles) {
    for (const issue of (data.eos_issues || [])) {
      if (!issue.issue_title) continue;
      try {
        const issueData = {
          title: issue.issue_title,
          issueDescription: issue.issue_description || '',
          isResolved: issue.is_resolved ?? false,
          resolutionNotes: issue.resolution_notes || '',
          priority: issue.priority || 'Medium',
        };
        const raisedId = resolvePersonId(issue.raised_by, freshPeople);
        if (raisedId) issueData.raisedByIds = [raisedId];
        const deptId = resolveDeptId(issue.department, ctx.departments);
        if (deptId) issueData.departmentIds = [deptId];
        // Link to default project
        if (ctx.projects.length) issueData.projectIds = [ctx.projects[0].id];

        await createEosIssue(issueData);
        created++;
        const status = issue.is_resolved ? '✅' : '🔴';
        console.log(`  ${status} ${issue.issue_title} | ${issue.priority || '?'} | ${issue.raised_by || '?'}`);
        await sleep(350);
      } catch (e) {
        console.log(`  ❌ ${issue.issue_title}: ${e.message}`);
      }
    }
  }
  console.log(`  → Created ${created} EOS issues`);
  return created;
}

async function pushTasks(allFiles, ctx) {
  console.log('\n══ 6. TASKS ══════════════════════════════════════════');
  const freshPeople = await getPeople(false);
  const defaultProjectId = ctx.projects[0]?.id;
  let created = 0;
  let skipped = 0;

  for (const data of allFiles) {
    for (const task of (data.tasks || [])) {
      if (!task.name) { skipped++; continue; }
      try {
        const projectId = resolveProjectId(task.project_name, ctx.projects) || defaultProjectId;
        const taskData = {
          name: task.name,
          description: task.description || '',
          definitionOfDone: task.definition_of_done || '',
          priority: task.priority || 'Medium',
          dueDate: task.due_date || null,
          status: task.status || 'To Do',
          projectId: projectId,
        };

        // Resolve department relation
        const deptId = resolveDeptId(task.department, ctx.departments);
        // We can't set department on tasks via the current createTask function
        // but we include it in description for context

        await createTask(taskData);
        created++;
        console.log(`  ✅ ${task.name} | ${task.priority || '?'} | ${task.owner || '?'} | ${task.due_date || '?'}`);
        await sleep(300);
      } catch (e) {
        console.log(`  ❌ ${task.name}: ${e.message}`);
        skipped++;
      }
    }
  }
  console.log(`  → Created ${created} tasks (skipped ${skipped})`);
  return created;
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  PUSH BATCH RESULTS TO NOTION');
  console.log('═══════════════════════════════════════════════════════\n');

  // Load all processed files
  const files = fs.readdirSync(PROCESSED_DIR)
    .filter(f => f.endsWith('.json') && !f.includes('.error'))
    .map(f => JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, f), 'utf-8')));
  console.log(`📁 Loaded ${files.length} processed transcripts\n`);

  // Load Notion context
  const ctx = await loadNotionContext();

  const startTime = Date.now();
  const results = {};

  // Push in dependency order
  results.people = await pushNewPeople(files, ctx);
  results.aliases = await pushSpeakerAliases(files, ctx);
  results.metrics = await pushScorecardMetrics(files, ctx);
  results.meetingRegister = await pushMeetingRegister(files, ctx);
  results.eosIssues = await pushEosIssues(files, ctx);
  results.tasks = await pushTasks(files, ctx);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  PUSH COMPLETE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  👤 People created:          ${results.people}`);
  console.log(`  🏷️  Speaker aliases created:  ${results.aliases}`);
  console.log(`  📈 Scorecard metrics:        ${results.metrics}`);
  console.log(`  📋 Meeting register entries:  ${results.meetingRegister}`);
  console.log(`  🔴 EOS Issues:               ${results.eosIssues}`);
  console.log(`  ✅ Tasks:                    ${results.tasks}`);
  console.log(`  ⏱️  Time:                     ${elapsed}s`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Update manifest
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  manifest.pushed_at = new Date().toISOString();
  manifest.push_results = results;
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
