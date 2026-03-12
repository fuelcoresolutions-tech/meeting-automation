import fs from 'fs';
import path from 'path';

const dir = 'data/processed';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.includes('.error'));
const manifest = JSON.parse(fs.readFileSync('data/manifest.json', 'utf-8'));

let totalTasks = 0, totalIssues = 0, totalTodos = 0, totalRocks = 0, totalMetrics = 0;
const allNewPeople = new Map();
const allNewAliases = new Map();
const allRocks = new Map();
const allMetrics = new Map();
const meetings = [];

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
  const id = data.transcript_id || data._meta?.transcript_id;
  const mEntry = manifest.transcripts.find(t => t.id === id);

  const reg = data.meeting_register || {};
  const notes = data.meeting_notes || {};
  const tasks = data.tasks || [];
  const issues = data.eos_issues || [];
  const rocks = data.quarterly_rocks || [];
  const metrics = data.scorecard_metrics || [];
  const newPeople = data.new_people || [];
  const newAliases = data.new_speaker_aliases || [];
  const todos = notes.conclude_todos || [];
  const idsIssues = notes.ids_issues || [];

  totalTasks += tasks.length;
  totalIssues += issues.length;
  totalTodos += todos.length;
  totalRocks += rocks.length;
  totalMetrics += metrics.length;

  for (const p of newPeople) {
    const key = (p.name || '').toLowerCase().trim();
    if (key && !allNewPeople.has(key)) allNewPeople.set(key, p);
  }
  for (const a of newAliases) {
    const key = (a.alias || '').toLowerCase().trim();
    if (key && !allNewAliases.has(key)) allNewAliases.set(key, a);
  }
  for (const r of rocks) {
    const key = (r.rock_title || '').toLowerCase().trim();
    if (key && !allRocks.has(key)) allRocks.set(key, r);
  }
  for (const m of metrics) {
    const key = (m.metric_name || '').toLowerCase().trim();
    if (key && !allMetrics.has(key)) allMetrics.set(key, m);
  }

  meetings.push({
    title: reg.title || mEntry?.title || file,
    date: reg.date || mEntry?.date || '?',
    type: reg.meeting_type || '?',
    scope: reg.meeting_scope || '?',
    format: reg.meeting_format || '?',
    facilitator: reg.facilitator || '?',
    attendees: reg.attendees || [],
    tasks: tasks.length,
    idsIssues: idsIssues.length,
    eosIssues: issues.length,
    todos: todos.length,
    rocks: rocks.length,
    metrics: metrics.length,
    newPeople: newPeople.length,
    newAliases: newAliases.length,
    summary: data.summary?.one_liner || '',
    keyDecisions: data.summary?.key_decisions || [],
  });
}

meetings.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

// Print report
console.log('═══════════════════════════════════════════════════════════════');
console.log('  BATCH RESULTS REVIEW — WHAT CAN GO TO NOTION');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log(`  📊 Total Meetings Processed: ${files.length}`);
console.log(`  📝 Total Tasks Extracted:    ${totalTasks}`);
console.log(`  🔴 Total EOS Issues:         ${totalIssues}`);
console.log(`  ✅ Total To-Dos:             ${totalTodos}`);
console.log(`  🎯 Unique Rocks Referenced:   ${allRocks.size}`);
console.log(`  📈 Unique Metrics Found:      ${allMetrics.size}`);
console.log(`  👤 New People Discovered:     ${allNewPeople.size}`);
console.log(`  🏷️  New Speaker Aliases:       ${allNewAliases.size}\n`);

console.log('───────────────────────────────────────────────────────────────');
console.log('  MEETING-BY-MEETING SUMMARY');
console.log('───────────────────────────────────────────────────────────────\n');

for (const m of meetings) {
  console.log(`  📅 ${m.date} | ${m.type} | ${m.title}`);
  console.log(`     ${m.summary}`);
  console.log(`     Attendees: ${m.attendees.join(', ') || '?'}`);
  console.log(`     Tasks: ${m.tasks} | IDS Issues: ${m.idsIssues} | Todos: ${m.todos} | EOS Issues: ${m.eosIssues}`);
  if (m.keyDecisions?.length) {
    console.log(`     Key Decisions:`);
    m.keyDecisions.forEach(d => console.log(`       • ${d}`));
  }
  console.log('');
}

console.log('───────────────────────────────────────────────────────────────');
console.log('  NEW PEOPLE TO ADD TO NOTION');
console.log('───────────────────────────────────────────────────────────────\n');
if (allNewPeople.size === 0) {
  console.log('  None discovered.\n');
} else {
  for (const [, p] of allNewPeople) {
    console.log(`  👤 ${p.name} | ${p.role_guess || '?'} | ${p.company || '?'} | ${p.email || 'no email'}`);
    if (p.context) console.log(`     Context: ${p.context}`);
  }
  console.log('');
}

console.log('───────────────────────────────────────────────────────────────');
console.log('  NEW SPEAKER ALIASES TO ADD');
console.log('───────────────────────────────────────────────────────────────\n');
if (allNewAliases.size === 0) {
  console.log('  None discovered.\n');
} else {
  for (const [, a] of allNewAliases) {
    console.log(`  🏷️  "${a.alias}" → ${a.likely_person || '?'} (confidence: ${a.confidence || '?'})`);
    if (a.reasoning) console.log(`     Reason: ${a.reasoning}`);
  }
  console.log('');
}

console.log('───────────────────────────────────────────────────────────────');
console.log('  UNIQUE ROCKS FOUND ACROSS ALL MEETINGS');
console.log('───────────────────────────────────────────────────────────────\n');
for (const [, r] of allRocks) {
  const isNew = r.is_new ? ' [NEW]' : '';
  console.log(`  🎯 ${r.rock_title}${isNew} | ${r.status || '?'} | Owner: ${r.owner || '?'} | Dept: ${r.department || '?'}`);
}
console.log('');

console.log('───────────────────────────────────────────────────────────────');
console.log('  UNIQUE SCORECARD METRICS FOUND');
console.log('───────────────────────────────────────────────────────────────\n');
if (allMetrics.size === 0) {
  console.log('  None found.\n');
} else {
  for (const [, m] of allMetrics) {
    console.log(`  📈 ${m.metric_name} | Target: ${m.target || '?'} ${m.unit || ''} | Current: ${m.current_value || '?'} | ${m.on_track ? '✅' : '❌'}`);
  }
  console.log('');
}

// Save structured summary
const summary = {
  generated_at: new Date().toISOString(),
  totals: { meetings: files.length, tasks: totalTasks, eosIssues: totalIssues, todos: totalTodos, rocks: allRocks.size, metrics: allMetrics.size, newPeople: allNewPeople.size, newAliases: allNewAliases.size },
  meetings,
  newPeople: [...allNewPeople.values()],
  newAliases: [...allNewAliases.values()],
  rocks: [...allRocks.values()],
  metrics: [...allMetrics.values()],
};
fs.writeFileSync('data/batch-review-summary.json', JSON.stringify(summary, null, 2));
console.log('📁 Full summary saved to data/batch-review-summary.json\n');
