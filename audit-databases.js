import {
  getPeople, getDepartments, getQuarterlyRocks, getPlanningCycles,
  getScorecardMetrics, getEosIssues, getSpeakerAliases,
  getMeetingRegister, getAgentConfig, getProjects,
  notion, DATABASES,
} from './notion.js';

function resolveNames(ids, lookup) {
  return ids.map(id => lookup.get(id) || `[UNLINKED: ${id.slice(0, 8)}]`).join(', ') || '—';
}

async function main() {
  const [people, depts, rocks, cycles, metrics, issues, aliases, meetings, config, projectsRaw] = await Promise.all([
    getPeople(false), getDepartments(false), getQuarterlyRocks(), getPlanningCycles(),
    getScorecardMetrics(), getEosIssues(false), getSpeakerAliases(),
    getMeetingRegister(), getAgentConfig(),
    getProjects(),
  ]);

  const projects = projectsRaw.map(p => ({
    id: p.id,
    name: p.properties?.Name?.title?.[0]?.plain_text || 'Untitled',
    status: p.properties?.Status?.status?.name || '?',
    archived: p.properties?.Archived?.checkbox || false,
  }));

  // Build lookup maps
  const pplMap = new Map(people.map(p => [p.id, p.name]));
  const deptMap = new Map(depts.map(d => [d.id, `${d.name} (${d.code})`]));
  const rockMap = new Map(rocks.map(r => [r.id, r.title]));
  const cycleMap = new Map(cycles.map(c => [c.id, c.title]));
  const projMap = new Map(projects.map(p => [p.id, p.name]));
  const noteMap = new Map(); // We'd need notes DB but let's skip for now

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  FULL DATABASE AUDIT');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── People ──
  console.log(`\n══ PEOPLE (${people.length}) ══`);
  const pplIssues = [];
  for (const p of people) {
    const dept = resolveNames(p.departmentIds, deptMap);
    const reports = resolveNames(p.reportsToIds, pplMap);
    const problems = [];
    if (!p.email && p.isActive) problems.push('NO EMAIL');
    if (!p.departmentIds.length && p.isActive) problems.push('NO DEPARTMENT');
    if (!p.reportsToIds.length && p.isActive && p.role !== 'Board Chairman') problems.push('NO REPORTS-TO');
    if (!p.role && p.isActive) problems.push('NO ROLE');
    const flag = problems.length ? ` ⚠️ [${problems.join(', ')}]` : '';
    console.log(`  ${p.isActive ? '✅' : '⬜'} ${p.name} | ${p.role || '—'} | Dept: ${dept} | Reports: ${reports}${flag}`);
    if (problems.length) pplIssues.push({ name: p.name, id: p.id, problems });
  }

  // ── Departments ──
  console.log(`\n══ DEPARTMENTS (${depts.length}) ══`);
  for (const d of depts) {
    const head = resolveNames(d.headIds, pplMap);
    const parent = resolveNames(d.parentIds, deptMap);
    const members = d.teamMemberIds.length;
    const problems = [];
    if (!d.headIds.length) problems.push('NO HEAD');
    if (d.level !== 'Division' && !d.parentIds.length) problems.push('NO PARENT');
    if (!d.code) problems.push('NO CODE');
    const flag = problems.length ? ` ⚠️ [${problems.join(', ')}]` : '';
    console.log(`  ${d.isActive ? '✅' : '⬜'} ${d.name} (${d.code || '?'}) | ${d.level} | Head: ${head} | Parent: ${parent} | Members: ${members}${flag}`);
  }

  // ── Quarterly Rocks ──
  console.log(`\n══ QUARTERLY ROCKS (${rocks.length}) ══`);
  for (const r of rocks) {
    const owner = resolveNames(r.ownerIds, pplMap);
    const dept = resolveNames(r.departmentIds, deptMap);
    const cycle = resolveNames(r.planningCycleIds, cycleMap);
    const proj = resolveNames(r.projectIds, projMap);
    const problems = [];
    if (!r.ownerIds.length) problems.push('NO OWNER');
    if (!r.departmentIds.length) problems.push('NO DEPARTMENT');
    if (!r.planningCycleIds.length) problems.push('NO PLANNING CYCLE');
    if (!r.dueDate) problems.push('NO DUE DATE');
    const flag = problems.length ? ` ⚠️ [${problems.join(', ')}]` : '';
    console.log(`  ${r.status.padEnd(12)} ${r.title.slice(0, 50)} | Owner: ${owner} | Dept: ${dept} | Cycle: ${cycle}${flag}`);
  }

  // ── Planning Cycles ──
  console.log(`\n══ PLANNING CYCLES (${cycles.length}) ══`);
  const currentCycles = cycles.filter(c => c.isCurrent);
  for (const c of cycles) {
    const rockCount = c.rockIds.length;
    const problems = [];
    if (!c.startDate || !c.endDate) problems.push('MISSING DATES');
    const flag = problems.length ? ` ⚠️ [${problems.join(', ')}]` : '';
    console.log(`  ${c.isCurrent ? '🟢' : '⬜'} ${c.title} | ${c.cycleType} | ${c.startDate} - ${c.endDate} | Rocks linked: ${rockCount}${flag}`);
  }
  if (currentCycles.length > 1) {
    console.log(`  ⚠️ WARNING: ${currentCycles.length} cycles marked as current! Only Q1 2026 should be current (March 2026).`);
  }

  // ── Scorecard Metrics ──
  console.log(`\n══ SCORECARD METRICS (${metrics.length}) ══`);
  for (const m of metrics) {
    const owner = resolveNames(m.ownerIds, pplMap);
    const dept = resolveNames(m.departmentIds, deptMap);
    const problems = [];
    if (!m.ownerIds.length) problems.push('NO OWNER');
    if (!m.departmentIds.length) problems.push('NO DEPARTMENT');
    if (m.target == null) problems.push('NO TARGET');
    const flag = problems.length ? ` ⚠️ [${problems.join(', ')}]` : '';
    console.log(`  ${m.onTrack ? '✅' : '❌'} ${m.name} | Target: ${m.target ?? '?'} ${m.unit} | Current: ${m.currentValue ?? '?'} | Owner: ${owner} | Dept: ${dept}${flag}`);
  }

  // ── EOS Issues ──
  console.log(`\n══ EOS ISSUES (${issues.length}) ══`);
  for (const i of issues) {
    const raised = resolveNames(i.raisedByIds, pplMap);
    const dept = resolveNames(i.departmentIds, deptMap);
    const proj = resolveNames(i.projectIds, projMap);
    const rock = resolveNames(i.rockIds, rockMap);
    const srcMeeting = i.sourceMeetingIds.length ? `${i.sourceMeetingIds.length} linked` : 'NONE';
    const problems = [];
    if (!i.raisedByIds.length) problems.push('NO RAISED-BY');
    if (!i.departmentIds.length) problems.push('NO DEPARTMENT');
    if (!i.projectIds.length) problems.push('NO PROJECT');
    if (!i.issueDescription) problems.push('NO DESCRIPTION');
    if (!i.priority) problems.push('NO PRIORITY');
    if (!i.sourceMeetingIds.length) problems.push('NO SOURCE MEETING');
    const flag = problems.length ? ` ⚠️ [${problems.join(', ')}]` : '';
    console.log(`  ${i.isResolved ? '✅' : '🔴'} ${(i.title || '(untitled)').slice(0, 50)} | ${i.priority || '?'} | Raised: ${raised} | Dept: ${dept} | Proj: ${proj} | Meeting: ${srcMeeting}${flag}`);
  }

  // ── Speaker Aliases ──
  console.log(`\n══ SPEAKER ALIASES (${aliases.length}) ══`);
  for (const a of aliases) {
    const person = resolveNames(a.personIds, pplMap);
    const problems = [];
    if (!a.personIds.length) problems.push('NO PERSON LINKED');
    if (a.confidence != null && a.confidence < 0.5) problems.push('LOW CONFIDENCE');
    const flag = problems.length ? ` ⚠️ [${problems.join(', ')}]` : '';
    console.log(`  "${a.alias}" → ${person} | Conf: ${a.confidence ?? '?'} | Src: ${a.source || '?'}${flag}`);
  }

  // ── Meeting Register ──
  console.log(`\n══ MEETING REGISTER (${meetings.length}) ══`);
  for (const m of meetings) {
    const fac = resolveNames(m.facilitatorIds, pplMap);
    const attendees = m.attendeeIds.length;
    const dept = resolveNames(m.departmentIds, deptMap);
    const notes = m.meetingNoteIds.length;
    const problems = [];
    if (!m.attendeeIds.length) problems.push('NO ATTENDEES');
    if (!m.facilitatorIds.length) problems.push('NO FACILITATOR');
    if (!m.meetingNoteIds.length) problems.push('NO MEETING NOTE LINKED');
    if (!m.planningCycleIds.length) problems.push('NO PLANNING CYCLE');
    const flag = problems.length ? ` ⚠️ [${problems.join(', ')}]` : '';
    console.log(`  ${m.processingStatus.padEnd(10)} ${m.meetingDate || '?'} | ${m.title.slice(0, 40)} | Fac: ${fac} | Att: ${attendees} | Notes: ${notes}${flag}`);
  }

  // ── Projects ──
  console.log(`\n══ PROJECTS (${projects.length}) ══`);
  for (const p of projects) {
    console.log(`  ${p.name} | ${p.status} | Archived: ${p.archived}`);
  }

  // ── Summary of issues ──
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  DATA QUALITY ISSUES SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  const allProblems = [];

  // People missing data
  const pplMissing = people.filter(p => p.isActive && (!p.departmentIds.length || !p.email || !p.role));
  if (pplMissing.length) allProblems.push(`People: ${pplMissing.length} active members missing dept/email/role`);

  // Depts missing heads
  const deptNoHead = depts.filter(d => d.isActive && !d.headIds.length);
  if (deptNoHead.length) allProblems.push(`Departments: ${deptNoHead.length} have no Department Head assigned`);

  // Depts missing parents (non-Division)
  const deptNoParent = depts.filter(d => d.isActive && d.level !== 'Division' && !d.parentIds.length);
  if (deptNoParent.length) allProblems.push(`Departments: ${deptNoParent.length} sub-departments have no Parent Department`);

  // Rocks missing links
  const rockNoOwner = rocks.filter(r => !r.ownerIds.length);
  const rockNoCycle = rocks.filter(r => !r.planningCycleIds.length);
  const rockNoDept = rocks.filter(r => !r.departmentIds.length);
  if (rockNoOwner.length) allProblems.push(`Rocks: ${rockNoOwner.length} have no Owner`);
  if (rockNoCycle.length) allProblems.push(`Rocks: ${rockNoCycle.length} have no Planning Cycle linked`);
  if (rockNoDept.length) allProblems.push(`Rocks: ${rockNoDept.length} have no Department`);

  // Multiple current cycles
  if (currentCycles.length > 1) allProblems.push(`Planning Cycles: ${currentCycles.length} marked as current (should be 1)`);

  // Metrics missing links
  const metricNoOwner = metrics.filter(m => !m.ownerIds.length);
  const metricNoDept = metrics.filter(m => !m.departmentIds.length);
  if (metricNoOwner.length) allProblems.push(`Scorecard: ${metricNoOwner.length} metrics have no Owner`);
  if (metricNoDept.length) allProblems.push(`Scorecard: ${metricNoDept.length} metrics have no Department`);

  // Issues missing links
  const issueNoRaised = issues.filter(i => !i.raisedByIds.length);
  const issueNoDept = issues.filter(i => !i.departmentIds.length);
  const issueNoProj = issues.filter(i => !i.projectIds.length);
  const issueNoDesc = issues.filter(i => !i.issueDescription);
  const issueNoMeeting = issues.filter(i => !i.sourceMeetingIds.length);
  if (issueNoRaised.length) allProblems.push(`EOS Issues: ${issueNoRaised.length} have no Raised By person`);
  if (issueNoDept.length) allProblems.push(`EOS Issues: ${issueNoDept.length} have no Department`);
  if (issueNoProj.length) allProblems.push(`EOS Issues: ${issueNoProj.length} have no Project linked`);
  if (issueNoDesc.length) allProblems.push(`EOS Issues: ${issueNoDesc.length} have no Issue Description`);
  if (issueNoMeeting.length) allProblems.push(`EOS Issues: ${issueNoMeeting.length} have no Source Meeting linked`);

  // Aliases with no person
  const aliasNoPerson = aliases.filter(a => !a.personIds.length);
  if (aliasNoPerson.length) allProblems.push(`Speaker Aliases: ${aliasNoPerson.length} have no Person linked`);

  // Meetings missing data
  const meetNoAtt = meetings.filter(m => !m.attendeeIds.length);
  const meetNoNote = meetings.filter(m => !m.meetingNoteIds.length);
  const meetNoCycle = meetings.filter(m => !m.planningCycleIds.length);
  if (meetNoAtt.length) allProblems.push(`Meeting Register: ${meetNoAtt.length} have no Attendees`);
  if (meetNoNote.length) allProblems.push(`Meeting Register: ${meetNoNote.length} have no Meeting Note linked`);
  if (meetNoCycle.length) allProblems.push(`Meeting Register: ${meetNoCycle.length} have no Planning Cycle`);

  for (const p of allProblems) {
    console.log(`  ⚠️  ${p}`);
  }
  console.log(`\n  Total issues found: ${allProblems.length}\n`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
