import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_KEY });
const AGENT_CONFIG_DB = process.env.NOTION_AGENT_CONFIG_DATABASE;

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SEED AGENT CONFIG DATABASE');
  console.log('═══════════════════════════════════════════════════════\n');

  // Check if config already exists
  const existing = await notion.databases.query({ database_id: AGENT_CONFIG_DB });
  if (existing.results.length > 0) {
    console.log('⚠️  Agent Config entry already exists. Updating...\n');
    const pageId = existing.results[0].id;
    await notion.pages.update({
      page_id: pageId,
      properties: {
        'Workspace Name': { title: [{ text: { content: 'Fuel Core Solutions' } }] },
        'Default Todo Due Days': { number: 7 },
        'Min Confidence Threshold': { number: 0.6 },
        'Require Speaker Review (In Person)': { checkbox: true },
        'Custom Agent Instructions': {
          rich_text: [{ text: { content: CUSTOM_INSTRUCTIONS } }]
        },
      }
    });
    console.log(`✅ Updated Agent Config (ID: ${pageId})\n`);
    return;
  }

  // Create new config
  const result = await notion.pages.create({
    parent: { database_id: AGENT_CONFIG_DB },
    properties: {
      'Workspace Name': { title: [{ text: { content: 'Fuel Core Solutions' } }] },
      'Default Todo Due Days': { number: 7 },
      'Min Confidence Threshold': { number: 0.6 },
      'Require Speaker Review (In Person)': { checkbox: true },
      'Custom Agent Instructions': {
        rich_text: [{ text: { content: CUSTOM_INSTRUCTIONS } }]
      },
    }
  });

  console.log(`✅ Created Agent Config (ID: ${result.id})\n`);
  console.log('Settings:');
  console.log('  Workspace Name: Fuel Core Solutions');
  console.log('  Default Todo Due Days: 7');
  console.log('  Min Confidence Threshold: 0.6');
  console.log('  Require Speaker Review (In Person): true');
  console.log('  Custom Instructions: (see below)\n');
  console.log('─── Custom Agent Instructions ───');
  console.log(CUSTOM_INSTRUCTIONS);
  console.log('────────────────────────────────\n');
}

const CUSTOM_INSTRUCTIONS = `## Project Routing Rules
- ALL tasks related to pump equipment, sales, service, operations, marketing, finance, IT, or company strategy → link to "Fuel Core Development" project
- Do NOT create new projects. If a discussion topic doesn't fit any existing project, still use "Fuel Core Development" as default
- When multiple projects exist, match based on the meeting topic and department context

## Speaker Resolution
- "John Mark" or "JM" → John Mark Kimuli (Business Development Lead)
- "Bob" or "Counsel Bob" → External legal counsel, NOT a Fuel Core team member — add to new_people
- "Pauline" or "Namuli" → External, add to new_people if not in KNOWN PEOPLE
- When Fireflies labels someone as "Speaker 1/2/3" in virtual meetings, use participant list emails + voice context to resolve

## Meeting Classification
- Weekly Monday/Tuesday meetings with John Mark, Lawrence, Brian, Ruth → L10
- Meetings with external parties (lawyers, board, Stabex) → General
- Strategy discussions with Dan (Board Chairman) → General (board meeting)

## Department Assignment Priorities
- Pump sales, Stabex contract, customer meetings → Sales (SAL)
- Website, pitch deck, brochures, social media → Marketting (MKT)  
- Technician hiring, field work, maintenance → Service & Maintenance (OPS-SM)
- Warehouse, parts inventory, distribution → Parts & Distribution (OPS-PD)
- Accounting, budgets, revenue tracking → Finance (FIN)
- Software, Notion, IoT, systems → IT / Systems (SAL-IT)
- Company structure, vision, board matters → Strategy (STR)
- HR, office admin, hiring non-technical → Human Resource & Administration (HRA)

## Quality Preferences
- Prefer detailed IDS discussion summaries over brevity
- Always include "Definition of Done" on tasks in Dan Martell style
- When in doubt about a to-do's department, use the speaker's own department from KNOWN PEOPLE`;

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
