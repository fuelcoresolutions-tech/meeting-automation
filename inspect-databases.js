import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_KEY });

const databases = {
  'Projects': process.env.NOTION_PROJECTS_DATABASE_ID,
  'Tasks': process.env.NOTION_TASKS_DATABASE_ID,
  'Notes': process.env.NOTION_NOTES_DATABASE_ID,
  'Quarterly Rocks': process.env.NOTION_QUARTERLY_ROCKS_DATABASE,
  'Planning Cycles': process.env.NOTION_PLANNING_CYCLES_DATABASE,
  'Score Card Metrics': process.env.NOTION_SCORE_CARD_METRICS_DATABASE,
  'EOS Issues List': process.env.NOTION_EOS_ISSUES_LIST,
  'Speaker Aliases': process.env.NOTION_SPEAKER_ALIAS_LIST,
  'Meeting Register': process.env.NOTION_MEETING_REGISTER_DATABASE,
  'Agent Config': process.env.NOTION_AGENT_CONFIG_DATABASE,
  'Departments': process.env.NOTION_DEPARTMENT_DATABASE,
};

const allSchemas = {};

for (const [name, id] of Object.entries(databases)) {
  try {
    const db = await notion.databases.retrieve({ database_id: id });
    const props = {};
    for (const [key, val] of Object.entries(db.properties)) {
      const info = { type: val.type };
      if (val.type === 'select') info.options = val.select?.options?.map(o => o.name) || [];
      if (val.type === 'multi_select') info.options = val.multi_select?.options?.map(o => o.name) || [];
      if (val.type === 'relation') info.related_db = val.relation?.database_id || null;
      if (val.type === 'status') info.options = val.status?.options?.map(o => o.name) || [];
      props[key] = info;
    }
    allSchemas[name] = { id, properties: props };
    console.log(`\n=== ${name} ===`);
    for (const [key, info] of Object.entries(props)) {
      let line = `  ${key} (${info.type})`;
      if (info.options) line += ` [${info.options.join(', ')}]`;
      if (info.related_db) {
        const relName = Object.entries(databases).find(([, v]) => v === info.related_db)?.[0] || info.related_db;
        line += ` -> ${relName}`;
      }
      console.log(line);
    }
  } catch (e) {
    console.log(`\n=== ${name} === ERROR: ${e.message}`);
    allSchemas[name] = { id, error: e.message };
  }
}

// Also query People database — find it
console.log('\n\n--- Searching for People database ---');
try {
  const search = await notion.search({ query: 'People', filter: { property: 'object', value: 'database' } });
  for (const result of search.results) {
    const title = result.title?.map(t => t.plain_text).join('') || 'Untitled';
    if (title.toLowerCase().includes('people')) {
      console.log(`\nFound: ${title} [${result.id}]`);
      const props = {};
      for (const [key, val] of Object.entries(result.properties)) {
        const info = { type: val.type };
        if (val.type === 'select') info.options = val.select?.options?.map(o => o.name) || [];
        if (val.type === 'multi_select') info.options = val.multi_select?.options?.map(o => o.name) || [];
        if (val.type === 'relation') info.related_db = val.relation?.database_id || null;
        if (val.type === 'status') info.options = val.status?.options?.map(o => o.name) || [];
        props[key] = info;
      }
      console.log(`=== People ===`);
      for (const [key, info] of Object.entries(props)) {
        let line = `  ${key} (${info.type})`;
        if (info.options) line += ` [${info.options.join(', ')}]`;
        if (info.related_db) line += ` -> ${info.related_db}`;
        console.log(line);
      }
      allSchemas['People'] = { id: result.id, properties: props };
    }
  }
} catch (e) {
  console.log('People search error:', e.message);
}

// Save full schema dump
import fs from 'fs';
fs.writeFileSync('data/notion-schemas.json', JSON.stringify(allSchemas, null, 2));
console.log('\n\nFull schema saved to data/notion-schemas.json');
