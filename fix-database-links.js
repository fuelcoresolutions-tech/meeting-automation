import {
  getPeople, getDepartments, getQuarterlyRocks, getPlanningCycles,
  getEosIssues, getSpeakerAliases, getMeetingRegister,
  notion, DATABASES,
} from './notion.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  FIX DATABASE LINKS');
  console.log('═══════════════════════════════════════════════════════\n');

  const [people, depts, rocks, cycles, issues, aliases, meetings] = await Promise.all([
    getPeople(false), getDepartments(false), getQuarterlyRocks(), getPlanningCycles(),
    getEosIssues(false), getSpeakerAliases(), getMeetingRegister(),
  ]);

  // Build lookup helpers
  const pplByName = new Map();
  for (const p of people) {
    pplByName.set(p.name.toLowerCase().trim(), p);
    if (p.role) pplByName.set(p.role.toLowerCase().trim(), p);
  }
  const deptByCode = new Map(depts.map(d => [d.code?.toLowerCase(), d]));
  const deptByName = new Map(depts.map(d => [d.name.toLowerCase().trim(), d]));
  const cycleByTitle = new Map(cycles.map(c => [c.title.toLowerCase(), c]));

  let fixes = 0;

  // ══════════════════════════════════════════════════════════════════
  // FIX 1: Planning Cycles — only Q1 2026 should be "Is Current"
  // ══════════════════════════════════════════════════════════════════
  console.log('── Fix 1: Planning Cycles — set only Q1 2026 as current ──');
  const now = new Date('2026-03-12');
  for (const c of cycles) {
    const start = c.startDate ? new Date(c.startDate) : null;
    const end = c.endDate ? new Date(c.endDate) : null;
    const shouldBeCurrent = start && end && start <= now && now <= end;
    if (c.isCurrent !== shouldBeCurrent) {
      await notion.pages.update({ page_id: c.id, properties: { 'Is Current': { checkbox: shouldBeCurrent } } });
      console.log(`  ${shouldBeCurrent ? '🟢' : '⬜'} ${c.title} → Is Current: ${shouldBeCurrent}`);
      fixes++;
      await sleep(300);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // FIX 2: Departments — link Parent Departments for sub-depts
  // ══════════════════════════════════════════════════════════════════
  console.log('\n── Fix 2: Department hierarchy — link Parent Departments ──');
  const parentMap = {
    'OPS-SM': 'OPS',   // Service & Maintenance → Operations
    'OPS-PD': 'OPS',   // Parts & Distribution → Operations
    'SAL-IT': 'SAL',   // IT / Systems → Sales
    'HRA': 'OPS',      // HR & Admin → Operations
  };
  for (const d of depts) {
    if (d.parentIds.length > 0) continue; // Already has parent
    const parentCode = parentMap[d.code];
    if (!parentCode) continue;
    const parent = deptByCode.get(parentCode.toLowerCase());
    if (!parent) { console.log(`  ⚠️  No parent found for ${d.name} (${d.code}) → ${parentCode}`); continue; }
    await notion.pages.update({
      page_id: d.id,
      properties: { 'Parent Department': { relation: [{ id: parent.id }] } }
    });
    console.log(`  ✅ ${d.name} (${d.code}) → Parent: ${parent.name} (${parent.code})`);
    fixes++;
    await sleep(300);
  }

  // ══════════════════════════════════════════════════════════════════
  // FIX 3: Departments — assign Department Heads from People
  // ══════════════════════════════════════════════════════════════════
  console.log('\n── Fix 3: Department Heads ──');
  const headAssignments = {
    'STR': 'ruth',                    // Strategy → Ruth (CEO)
    'FIN': 'brian',                   // Finance → Brian (CFO)
    'OPS': 'lawrence',                // Operations → Lawrence (COO)
    'SAL': 'john mark kimuli',        // Sales → John Mark Kimuli
    'MKT': 'john mark kimuli',        // Marketing → John Mark (interim)
  };
  for (const d of depts) {
    if (d.headIds.length > 0) continue;
    const personName = headAssignments[d.code];
    if (!personName) continue;
    const person = pplByName.get(personName);
    if (!person) { console.log(`  ⚠️  Person "${personName}" not found for ${d.name}`); continue; }
    await notion.pages.update({
      page_id: d.id,
      properties: { 'Department Head': { relation: [{ id: person.id }] } }
    });
    console.log(`  ✅ ${d.name} → Head: ${person.name}`);
    fixes++;
    await sleep(300);
  }

  // ══════════════════════════════════════════════════════════════════
  // FIX 4: Rocks — link to Q1 2026 Planning Cycle
  // ══════════════════════════════════════════════════════════════════
  console.log('\n── Fix 4: Rocks — link Planning Cycles ──');
  // Find Q1 2026 cycle
  const q1 = cycles.find(c => c.title.includes('Q1') && c.title.includes('2026'));
  const q2 = cycles.find(c => c.title.includes('Q2') && c.title.includes('2026'));
  const q3 = cycles.find(c => c.title.includes('Q3') && c.title.includes('2026'));
  const q4 = cycles.find(c => c.title.includes('Q4') && c.title.includes('2026'));

  // Q1 rock titles (from the batch data — current quarter rocks)
  const q1RockKeywords = [
    'stabex', 'organizational structure', 'website relaunch', '20 pumps',
    'core process documentation', 'marketing collateral', 'mobile pump',
    'maintenance contracts', 'technician', 'spare parts inventory',
  ];

  for (const r of rocks) {
    if (r.planningCycleIds.length > 0) continue; // Already linked
    const lower = r.title.toLowerCase();
    // Determine which cycle this rock belongs to based on due date or keywords
    let targetCycle = null;
    if (r.dueDate) {
      const due = new Date(r.dueDate);
      if (due <= new Date('2026-03-31')) targetCycle = q1;
      else if (due <= new Date('2026-06-30')) targetCycle = q2;
      else if (due <= new Date('2026-09-30')) targetCycle = q3;
      else targetCycle = q4;
    } else if (q1RockKeywords.some(kw => lower.includes(kw))) {
      targetCycle = q1;
    }
    if (!targetCycle) { targetCycle = q1; } // Default to Q1

    await notion.pages.update({
      page_id: r.id,
      properties: { 'Planning Cycle': { relation: [{ id: targetCycle.id }] } }
    });
    console.log(`  ✅ "${r.title.slice(0, 50)}" → ${targetCycle.title}`);
    fixes++;
    await sleep(300);
  }

  // ══════════════════════════════════════════════════════════════════
  // FIX 5: Meeting Register — link Planning Cycles
  // ══════════════════════════════════════════════════════════════════
  console.log('\n── Fix 5: Meeting Register — link Planning Cycles ──');
  for (const m of meetings) {
    if (m.planningCycleIds.length > 0) continue;
    // All meetings in Feb-Mar 2026 → Q1 2026
    if (q1) {
      await notion.pages.update({
        page_id: m.id,
        properties: { 'Planning Cycle': { relation: [{ id: q1.id }] } }
      });
      console.log(`  ✅ ${m.title.slice(0, 45)} → ${q1.title}`);
      fixes++;
      await sleep(300);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // FIX 6: EOS Issues — fix the 1 blank issue (the original empty one)
  // ══════════════════════════════════════════════════════════════════
  console.log('\n── Fix 6: EOS Issues — clean up blank entry ──');
  for (const i of issues) {
    if (!i.title && !i.issueDescription) {
      await notion.pages.update({ page_id: i.id, archived: true });
      console.log(`  🗑️  Archived blank EOS issue`);
      fixes++;
      await sleep(300);
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  FIXES APPLIED: ${fixes}`);
  console.log(`═══════════════════════════════════════════════════════\n`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
