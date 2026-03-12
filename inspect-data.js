import { Client } from '@notionhq/client';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_KEY });

async function queryAll(dbId, label) {
  const results = [];
  let cursor = undefined;
  while (true) {
    const resp = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...resp.results);
    if (!resp.has_more) break;
    cursor = resp.next_cursor;
  }
  console.log(`\n=== ${label} (${results.length} entries) ===`);
  return results;
}

function getTitle(page) {
  for (const [, val] of Object.entries(page.properties)) {
    if (val.type === 'title') {
      return val.title?.map(t => t.plain_text).join('') || '';
    }
  }
  return '';
}

function getRichText(page, propName) {
  const prop = page.properties[propName];
  if (!prop || prop.type !== 'rich_text') return '';
  return prop.rich_text?.map(t => t.plain_text).join('') || '';
}

function getSelect(page, propName) {
  const prop = page.properties[propName];
  if (!prop) return '';
  if (prop.type === 'select') return prop.select?.name || '';
  if (prop.type === 'status') return prop.status?.name || '';
  return '';
}

function getCheckbox(page, propName) {
  return page.properties[propName]?.checkbox || false;
}

function getRelationIds(page, propName) {
  return (page.properties[propName]?.relation || []).map(r => r.id);
}

const context = {};

// People
const people = await queryAll(process.env.NOTION_PEOPLE_DATABASE, 'People');
context.people = people.map(p => {
  const name = getTitle(p);
  const email = p.properties.Email?.email || '';
  const role = getRichText(p, 'Role Title');
  const isActive = getCheckbox(p, 'Is Active Member');
  const deptIds = getRelationIds(p, 'Department');
  const reportsTo = getRelationIds(p, 'Reports To');
  console.log(`  ${isActive ? '✅' : '⬜'} ${name} | ${role || 'No role'} | ${email || 'No email'} | Dept: ${deptIds.length} | Reports: ${reportsTo.length}`);
  return { id: p.id, name, email, role, isActive, departmentIds: deptIds, reportsToIds: reportsTo };
});

// Projects
const projects = await queryAll(process.env.NOTION_PROJECTS_DATABASE_ID, 'Projects');
context.projects = projects.filter(p => !getCheckbox(p, 'Archived')).map(p => {
  const name = getTitle(p);
  const status = getSelect(p, 'Status');
  const deptIds = getRelationIds(p, 'Departments');
  console.log(`  ${name} | ${status} | Depts: ${deptIds.length}`);
  return { id: p.id, name, status, departmentIds: deptIds };
});

// Departments
const departments = await queryAll(process.env.NOTION_DEPARTMENT_DATABASE, 'Departments');
context.departments = departments.map(d => {
  const name = getTitle(d);
  const code = getRichText(d, 'Department Code');
  const level = getSelect(d, 'Department Level');
  const isActive = getCheckbox(d, 'Is Active');
  const parentIds = getRelationIds(d, 'Parent Department');
  const headIds = getRelationIds(d, 'Department Head');
  console.log(`  ${isActive ? '✅' : '⬜'} ${name} | ${code} | ${level} | Head: ${headIds.length} | Parent: ${parentIds.length}`);
  return { id: d.id, name, code, level, isActive, parentIds, headIds };
});

// Planning Cycles
const cycles = await queryAll(process.env.NOTION_PLANNING_CYCLES_DATABASE, 'Planning Cycles');
context.planningCycles = cycles.map(c => {
  const title = getTitle(c);
  const type = getSelect(c, 'Cycle Type');
  const isCurrent = getCheckbox(c, 'Is Current');
  const start = c.properties['Start Date']?.date?.start || '';
  const end = c.properties['End Date']?.date?.start || '';
  console.log(`  ${isCurrent ? '🟢' : '⬜'} ${title} | ${type} | ${start} - ${end}`);
  return { id: c.id, title, type, isCurrent, start, end };
});

// Quarterly Rocks
const rocks = await queryAll(process.env.NOTION_QUARTERLY_ROCKS_DATABASE, 'Quarterly Rocks');
context.rocks = rocks.map(r => {
  const title = getTitle(r);
  const status = getSelect(r, 'Status');
  const ownerIds = getRelationIds(r, 'Owner');
  const deptIds = getRelationIds(r, 'Department');
  console.log(`  ${title} | ${status} | Owner: ${ownerIds.length} | Dept: ${deptIds.length}`);
  return { id: r.id, title, status, ownerIds, departmentIds: deptIds };
});

// Score Card Metrics
const metrics = await queryAll(process.env.NOTION_SCORE_CARD_METRICS_DATABASE, 'Score Card Metrics');
context.metrics = metrics.map(m => {
  const name = getTitle(m);
  const target = m.properties.Target?.number;
  const current = m.properties['Current Value']?.number;
  const onTrack = getCheckbox(m, 'On track');
  console.log(`  ${name} | Target: ${target} | Current: ${current} | ${onTrack ? '✅' : '❌'}`);
  return { id: m.id, name, target, current, onTrack };
});

// EOS Issues
const issues = await queryAll(process.env.NOTION_EOS_ISSUES_LIST, 'EOS Issues List');
context.issues = issues.map(i => {
  const title = getTitle(i);
  const resolved = getCheckbox(i, 'Is Resolved');
  const priority = getSelect(i, 'Priority level');
  console.log(`  ${resolved ? '✅' : '🔴'} ${title} | ${priority}`);
  return { id: i.id, title, resolved, priority };
});

// Speaker Aliases
const aliases = await queryAll(process.env.NOTION_SPEAKER_ALIAS_LIST, 'Speaker Aliases');
context.aliases = aliases.map(a => {
  const alias = getTitle(a);
  const personIds = getRelationIds(a, 'Person');
  const confidence = a.properties.Confidence?.number;
  console.log(`  "${alias}" -> Person: ${personIds.length} | Confidence: ${confidence}`);
  return { id: a.id, alias, personIds, confidence };
});

// Meeting Register
const meetings = await queryAll(process.env.NOTION_MEETING_REGISTER_DATABASE, 'Meeting Register');
context.meetings = meetings.map(m => {
  const title = getTitle(m);
  const status = getSelect(m, 'Processing Status');
  const date = m.properties['Meeting Date']?.date?.start || '';
  console.log(`  ${title} | ${status} | ${date}`);
  return { id: m.id, title, status, date };
});

fs.writeFileSync('data/notion-context.json', JSON.stringify(context, null, 2));
console.log('\n\nFull context saved to data/notion-context.json');
