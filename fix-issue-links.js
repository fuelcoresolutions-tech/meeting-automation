import fs from 'fs';
import path from 'path';
import {
  getPeople, getDepartments, getQuarterlyRocks, getMeetingRegister,
  getEosIssues, notion, DATABASES,
} from './notion.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  FIX EOS ISSUES — Link Rocks, Meetings, Assign People');
  console.log('═══════════════════════════════════════════════════════\n');

  // Load all Notion data
  const [people, depts, rocks, meetings, issues] = await Promise.all([
    getPeople(false), getDepartments(false), getQuarterlyRocks(),
    getMeetingRegister(), getEosIssues(false),
  ]);

  console.log(`Loaded: ${issues.length} issues, ${rocks.length} rocks, ${meetings.length} meetings, ${people.length} people\n`);

  // Build lookup helpers
  const pplByName = new Map();
  for (const p of people) {
    pplByName.set(p.name.toLowerCase().trim(), p);
    const firstName = p.name.split(' ')[0].toLowerCase().trim();
    if (firstName && !pplByName.has(firstName)) pplByName.set(firstName, p);
  }

  const meetingsByDate = new Map();
  for (const m of meetings) {
    if (m.meetingDate) {
      if (!meetingsByDate.has(m.meetingDate)) meetingsByDate.set(m.meetingDate, []);
      meetingsByDate.get(m.meetingDate).push(m);
    }
  }

  // Load batch processed data to get context about which issue came from which meeting
  const processedDir = 'data/processed';
  const batchFiles = fs.readdirSync(processedDir)
    .filter(f => f.endsWith('.json') && !f.includes('.error'))
    .map(f => JSON.parse(fs.readFileSync(path.join(processedDir, f), 'utf-8')));

  // Build a map: issue_title → { meeting_date, meeting_title, related_rock, department, raised_by }
  const issueContext = new Map();
  for (const data of batchFiles) {
    const meetDate = data.meeting_register?.date;
    const meetTitle = data.meeting_register?.title;

    // From eos_issues in batch output
    for (const bi of (data.eos_issues || [])) {
      const key = (bi.issue_title || '').toLowerCase().trim();
      if (key) {
        issueContext.set(key, {
          meetDate,
          meetTitle,
          department: bi.department,
          raised_by: bi.raised_by,
          related_rock: bi.related_rock || null,
          issue_description: bi.issue_description || '',
          resolution_notes: bi.resolution_notes || '',
        });
      }
    }

    // Also check ids_issues from meeting_notes for richer context
    for (const ids of (data.meeting_notes?.ids_issues || [])) {
      const key = (ids.title || '').toLowerCase().trim();
      if (key && !issueContext.has(key)) {
        issueContext.set(key, {
          meetDate,
          meetTitle,
          department: ids.department || null,
          raised_by: null,
          related_rock: null,
          issue_description: ids.issue || '',
          resolution_notes: ids.solution || '',
        });
      }
    }
  }

  console.log(`Batch context: ${issueContext.size} issue contexts found\n`);

  // Rock keyword matching — map issue titles to related rocks
  const rockKeywords = rocks.map(r => ({
    rock: r,
    keywords: [
      r.title.toLowerCase(),
      ...(r.keywords || '').toLowerCase().split(',').map(k => k.trim()).filter(Boolean),
    ]
  }));

  function findRelatedRock(issueTitle, issueDesc) {
    const text = (issueTitle + ' ' + issueDesc).toLowerCase();
    // Specific keyword matches
    const matchRules = [
      { keywords: ['inventory', 'stockout', 'spare parts', 'warehouse', 'parts'], rockMatch: ['spare parts inventory', 'inventory'] },
      { keywords: ['technician', 'training', 'hiring', 'hire'], rockMatch: ['hire and train', 'technician'] },
      { keywords: ['marketing', 'brochure', 'brand', 'content', 'collateral'], rockMatch: ['marketing collateral'] },
      { keywords: ['website', 'domain', 'web', 'storage'], rockMatch: ['website relaunch'] },
      { keywords: ['stabex', 'pump sales', 'contract', 'sales target', 'revenue'], rockMatch: ['stabex', '20 pumps', 'pump sales', 'revenue'] },
      { keywords: ['organizational', 'org structure', 'reporting lines'], rockMatch: ['organizational structure'] },
      { keywords: ['process', 'sop', 'documentation'], rockMatch: ['core process documentation'] },
      { keywords: ['mobile pump', 'mobile station'], rockMatch: ['mobile pump'] },
      { keywords: ['maintenance', 'service', 'response time'], rockMatch: ['maintenance contracts'] },
    ];

    for (const rule of matchRules) {
      if (rule.keywords.some(kw => text.includes(kw))) {
        for (const r of rocks) {
          if (rule.rockMatch.some(rm => r.title.toLowerCase().includes(rm))) {
            return r;
          }
        }
      }
    }
    return null;
  }

  function findSourceMeeting(issueTitle, ctx) {
    // First try batch context
    if (ctx?.meetDate) {
      const dateMeetings = meetingsByDate.get(ctx.meetDate) || [];
      if (dateMeetings.length === 1) return dateMeetings[0];
      // Try matching title
      const titleMatch = dateMeetings.find(m =>
        m.title.toLowerCase().includes(ctx.meetTitle?.toLowerCase()?.slice(0, 20) || '???')
      );
      if (titleMatch) return titleMatch;
      if (dateMeetings.length > 0) return dateMeetings[0]; // First meeting on that date
    }
    return null;
  }

  // Process each issue
  let fixes = 0;
  for (const issue of issues) {
    const titleLower = (issue.title || '').toLowerCase().trim();
    const ctx = issueContext.get(titleLower);
    const updates = {};
    const logParts = [];

    // 1. Link Quarterly Rock
    if (!issue.rockIds.length) {
      const rock = findRelatedRock(issue.title, issue.issueDescription || '');
      if (rock) {
        updates['Quarterly Rock'] = { relation: [{ id: rock.id }] };
        logParts.push(`Rock: "${rock.title.slice(0, 35)}"`);
      }
    }

    // 2. Link Source Meeting
    if (!issue.sourceMeetingIds.length) {
      const meeting = findSourceMeeting(issue.title, ctx);
      if (meeting) {
        // Source Meeting links to Notes DB, but our meetings are in Meeting Register
        // The Notion schema shows Source Meeting → Notes database
        // For now we can't link directly — would need a meeting note ID
        // But we DO have Meeting Register entries, so let's note this
        logParts.push(`Meeting: ${meeting.meetingDate}`);
      }
    }

    // 3. Fill Assigned To (people type) — use the "raised by" person
    if (issue.raisedByIds.length > 0) {
      // Raised By is set — the same person is usually assigned
      // Notion "Assigned To" is a people type, not relation — needs user IDs not page IDs
      // We can't easily set this without Notion user IDs, skip for now
    }

    // 4. Update Issue Description if empty
    if (!issue.issueDescription && ctx?.issue_description) {
      updates['Issue Description'] = { rich_text: [{ text: { content: ctx.issue_description } }] };
      logParts.push('Added description');
    }

    // 5. Update Resolution Notes if empty and resolved
    if (issue.isResolved && !issue.resolutionNotes && ctx?.resolution_notes) {
      updates['Resolution Notes'] = { rich_text: [{ text: { content: ctx.resolution_notes } }] };
      logParts.push('Added resolution');
    }

    if (Object.keys(updates).length > 0) {
      await notion.pages.update({ page_id: issue.id, properties: updates });
      fixes++;
      console.log(`  ✅ ${(issue.title || '?').slice(0, 45)} → ${logParts.join(' | ')}`);
      await sleep(350);
    } else {
      console.log(`  ⬜ ${(issue.title || '?').slice(0, 45)} — no changes needed`);
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  ISSUE FIXES APPLIED: ${fixes} of ${issues.length}`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  // Now fix the remaining dept heads
  console.log('── Also fixing remaining Department Heads ──');
  const deptUpdates = [
    { code: 'STR', personSearch: 'ruth' },
    { code: 'FIN', personSearch: 'brian' },
  ];
  for (const du of deptUpdates) {
    const dept = depts.find(d => d.code === du.code);
    if (!dept || dept.headIds.length > 0) continue;
    const person = people.find(p => p.name.toLowerCase().includes(du.personSearch));
    if (!person) { console.log(`  ⚠️  "${du.personSearch}" not found`); continue; }
    await notion.pages.update({
      page_id: dept.id,
      properties: { 'Department Head': { relation: [{ id: person.id }] } }
    });
    console.log(`  ✅ ${dept.name} → Head: ${person.name}`);
    await sleep(300);
  }

  // Fix rocks with no owner — assign John Mark Kimuli as default for Q1
  console.log('\n── Fixing Rocks with no Owner ──');
  const jmk = people.find(p => p.name.toLowerCase().includes('john mark'));
  const lawrence = people.find(p => p.name.toLowerCase().includes('lawrence'));
  if (jmk) {
    const rockOwnerMap = {
      'maintenance contracts': lawrence,
      'technician': lawrence,
      'spare parts inventory': lawrence,
      'process documentation': jmk,
      'annual revenue': jmk,
      '40 pumps': jmk,
      'strategic plan': jmk,
      'enterprise contract': jmk,
    };

    for (const r of rocks) {
      if (r.ownerIds.length > 0) continue;
      const lower = r.title.toLowerCase();
      let owner = null;
      for (const [kw, person] of Object.entries(rockOwnerMap)) {
        if (lower.includes(kw) && person) { owner = person; break; }
      }
      if (!owner) owner = jmk; // Default
      if (owner) {
        await notion.pages.update({
          page_id: r.id,
          properties: { 'Owner': { relation: [{ id: owner.id }] } }
        });
        console.log(`  ✅ "${r.title.slice(0, 45)}" → Owner: ${owner.name}`);
        fixes++;
        await sleep(300);
      }
    }
  }

  console.log(`\n  Total fixes this run: ${fixes}\n`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
