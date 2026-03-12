import { Client } from '@notionhq/client';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_KEY });

const DBS = {
  Projects: process.env.NOTION_PROJECTS_DATABASE_ID,
  Tasks: process.env.NOTION_TASKS_DATABASE_ID,
  Notes: process.env.NOTION_NOTES_DATABASE_ID,
  People: process.env.NOTION_PEOPLE_DATABASE,
  Departments: process.env.NOTION_DEPARTMENT_DATABASE,
  QuarterlyRocks: process.env.NOTION_QUARTERLY_ROCKS_DATABASE,
  PlanningCycles: process.env.NOTION_PLANNING_CYCLES_DATABASE,
  ScorecardMetrics: process.env.NOTION_SCORE_CARD_METRICS_DATABASE,
  EOSIssues: process.env.NOTION_EOS_ISSUES_LIST,
  SpeakerAliases: process.env.NOTION_SPEAKER_ALIAS_LIST,
  MeetingRegister: process.env.NOTION_MEETING_REGISTER_DATABASE,
  AgentConfig: process.env.NOTION_AGENT_CONFIG_DATABASE,
};

const schemas = {};

for (const [name, id] of Object.entries(DBS)) {
  const db = await notion.databases.retrieve({ database_id: id });
  const props = {};
  for (const [key, val] of Object.entries(db.properties)) {
    const info = { type: val.type, name: key };
    if (val.type === 'select' && val.select?.options) {
      info.options = val.select.options.map(o => o.name);
    }
    if (val.type === 'status' && val.status) {
      info.options = val.status.options.map(o => o.name);
      info.groups = val.status.groups.map(g => ({ name: g.name, options: g.option_ids }));
    }
    if (val.type === 'multi_select' && val.multi_select?.options) {
      info.options = val.multi_select.options.map(o => o.name);
    }
    if (val.type === 'relation') {
      info.related_db_id = val.relation?.database_id;
      // Resolve DB name
      const relName = Object.entries(DBS).find(([, v]) => {
        const normalized = v?.replace(/-/g, '');
        const relNorm = val.relation?.database_id?.replace(/-/g, '');
        return normalized === relNorm;
      });
      info.related_db_name = relName ? relName[0] : 'Unknown';
    }
    props[key] = info;
  }
  schemas[name] = { id, properties: props };
}

// Print in a format that's easy to compare
for (const [dbName, schema] of Object.entries(schemas)) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${dbName} [${schema.id}]`);
  console.log('═'.repeat(60));
  for (const [propName, info] of Object.entries(schema.properties)) {
    let line = `  ${propName} (${info.type})`;
    if (info.options) line += `\n    OPTIONS: [${info.options.join(' | ')}]`;
    if (info.related_db_name) line += `\n    RELATION → ${info.related_db_name}`;
    console.log(line);
  }
}

fs.writeFileSync('data/deep-schemas.json', JSON.stringify(schemas, null, 2));
console.log('\n\nSaved to data/deep-schemas.json');
