import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_KEY });

// Check what was created in the last 30 minutes
const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();

async function queryRecent(dbId, label) {
  try {
    // Try 'Created' first (Tasks, Notes, EOS Issues have it)
    const resp = await notion.databases.query({
      database_id: dbId,
      filter: { property: 'Created', created_time: { on_or_after: since } },
    });
    return { label, count: resp.results.length, results: resp.results };
  } catch (e) {
    // Fallback: query all and filter by created_time from page metadata
    const resp = await notion.databases.query({ database_id: dbId, page_size: 100 });
    const recent = resp.results.filter(p => new Date(p.created_time) >= new Date(since));
    return { label, count: recent.length, results: recent };
  }
}

function getTitle(page) {
  for (const val of Object.values(page.properties)) {
    if (val.type === 'title') return val.title?.map(t => t.plain_text).join('') || '';
  }
  return '';
}

function getRichText(page, prop) {
  const p = page.properties[prop];
  if (!p || p.type !== 'rich_text') return '';
  return p.rich_text?.map(t => t.plain_text).join('') || '';
}

function getSelect(page, prop) {
  const p = page.properties[prop];
  if (!p) return '';
  if (p.type === 'select') return p.select?.name || '';
  if (p.type === 'status') return p.status?.name || '';
  return '';
}

function getRelCount(page, prop) {
  return (page.properties[prop]?.relation || []).length;
}

const DBS = {
  notes: process.env.NOTION_NOTES_DATABASE_ID,
  tasks: process.env.NOTION_TASKS_DATABASE_ID,
  meetingRegister: process.env.NOTION_MEETING_REGISTER_DATABASE,
  eosIssues: process.env.NOTION_EOS_ISSUES_LIST,
  speakerAliases: process.env.NOTION_SPEAKER_ALIAS_LIST,
};

console.log('═══════════════════════════════════════════════════════════');
console.log('  AGENT PERFORMANCE EVALUATION');
console.log(`  Items created since ${new Date(since).toLocaleTimeString()}`);
console.log('═══════════════════════════════════════════════════════════\n');

// Notes
const notes = await queryRecent(DBS.notes, 'Meeting Notes');
console.log(`══ MEETING NOTES (${notes.count}) ══`);
for (const n of notes.results) {
  const title = getTitle(n);
  const type = getSelect(n, 'Type');
  const projCount = getRelCount(n, 'Project');
  const peopleCount = getRelCount(n, 'People');
  console.log(`  📝 ${title} | Type: ${type} | Project: ${projCount > 0 ? '✅' : '❌'} | People: ${peopleCount}`);
}

// Meeting Register
const register = await queryRecent(DBS.meetingRegister, 'Meeting Register');
console.log(`\n══ MEETING REGISTER (${register.count}) ══`);
for (const m of register.results) {
  const title = getTitle(m);
  const status = getSelect(m, 'Processing Status');
  const format = getSelect(m, 'Meeting Format');
  const attCount = getRelCount(m, 'Attendees');
  const facCount = getRelCount(m, 'Facilitator');
  const noteCount = getRelCount(m, 'Meeting Notes');
  const cycleCount = getRelCount(m, 'Planning Cycle');
  const types = (m.properties['Multi-select']?.multi_select || []).map(o => o.name).join(', ');
  console.log(`  📋 ${title}`);
  console.log(`     Status: ${status} | Format: ${format} | Types: ${types}`);
  console.log(`     Attendees: ${attCount} | Facilitator: ${facCount > 0 ? '✅' : '❌'} | Note linked: ${noteCount > 0 ? '✅' : '❌'} | Cycle: ${cycleCount > 0 ? '✅' : '❌'}`);
}

// Tasks
const tasks = await queryRecent(DBS.tasks, 'Tasks');
console.log(`\n══ TASKS (${tasks.count}) ══`);
let tasksWithProject = 0, tasksWithDept = 0, tasksWithPeople = 0, tasksWithDueDate = 0, tasksWithDesc = 0;
for (const t of tasks.results) {
  const name = getTitle(t);
  const priority = getSelect(t, 'Priority');
  const status = getSelect(t, 'Status');
  const projCount = getRelCount(t, 'Project');
  const deptCount = getRelCount(t, 'Department');
  const peopleCount = getRelCount(t, 'People');
  const hasDue = !!t.properties.Due?.date?.start;
  const hasDesc = !!getRichText(t, 'Description');
  
  if (projCount > 0) tasksWithProject++;
  if (deptCount > 0) tasksWithDept++;
  if (peopleCount > 0) tasksWithPeople++;
  if (hasDue) tasksWithDueDate++;
  if (hasDesc) tasksWithDesc++;
  
  console.log(`  ✅ ${name.slice(0, 60)} | ${priority} | ${status} | Proj: ${projCount > 0 ? '✅' : '❌'} | Dept: ${deptCount > 0 ? '✅' : '❌'} | People: ${peopleCount > 0 ? '✅' : '❌'} | Due: ${hasDue ? '✅' : '❌'}`);
}

// EOS Issues
const issues = await queryRecent(DBS.eosIssues, 'EOS Issues');
console.log(`\n══ EOS ISSUES (${issues.count}) ══`);
for (const i of issues.results) {
  const title = getTitle(i);
  const priority = getSelect(i, 'Priority level');
  const hasDesc = !!getRichText(i, 'Issue Description');
  const hasResolution = !!getRichText(i, 'Resolution Notes');
  const raisedCount = getRelCount(i, 'Raised by');
  const deptCount = getRelCount(i, 'Department');
  const projCount = getRelCount(i, 'Project');
  const rockCount = getRelCount(i, 'Quarterly Rock');
  const meetingCount = getRelCount(i, 'Source Meeting');
  const resolved = i.properties['Is Resolved']?.checkbox;
  console.log(`  ${resolved ? '✅' : '🔴'} ${title.slice(0, 50)} | ${priority}`);
  console.log(`     Desc: ${hasDesc ? '✅' : '❌'} | Resolution: ${hasResolution ? '✅' : '❌'} | Raised: ${raisedCount > 0 ? '✅' : '❌'} | Dept: ${deptCount > 0 ? '✅' : '❌'} | Proj: ${projCount > 0 ? '✅' : '❌'} | Rock: ${rockCount > 0 ? '✅' : '❌'} | Meeting: ${meetingCount > 0 ? '✅' : '❌'}`);
}

// Speaker Aliases
const aliases = await queryRecent(DBS.speakerAliases, 'Speaker Aliases');
console.log(`\n══ NEW SPEAKER ALIASES (${aliases.count}) ══`);
for (const a of aliases.results) {
  const alias = getTitle(a);
  const personCount = getRelCount(a, 'Person');
  const conf = a.properties.Confidence?.number;
  console.log(`  🏷️  "${alias}" | Person linked: ${personCount > 0 ? '✅' : '❌'} | Confidence: ${conf}`);
}

// Summary scorecard
console.log('\n═══════════════════════════════════════════════════════════');
console.log('  SCORECARD');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Meeting Notes:    ${notes.count}`);
console.log(`  Meeting Register: ${register.count}`);
console.log(`  Tasks Created:    ${tasks.count}`);
console.log(`  EOS Issues:       ${issues.count}`);
console.log(`  Speaker Aliases:  ${aliases.count}`);
console.log('');
if (tasks.count > 0) {
  console.log('  TASK QUALITY:');
  console.log(`    With Project:    ${tasksWithProject}/${tasks.count} (${Math.round(tasksWithProject/tasks.count*100)}%)`);
  console.log(`    With Department: ${tasksWithDept}/${tasks.count} (${Math.round(tasksWithDept/tasks.count*100)}%)`);
  console.log(`    With People:     ${tasksWithPeople}/${tasks.count} (${Math.round(tasksWithPeople/tasks.count*100)}%)`);
  console.log(`    With Due Date:   ${tasksWithDueDate}/${tasks.count} (${Math.round(tasksWithDueDate/tasks.count*100)}%)`);
  console.log(`    With Description:${tasksWithDesc}/${tasks.count} (${Math.round(tasksWithDesc/tasks.count*100)}%)`);
}
console.log('═══════════════════════════════════════════════════════════\n');
