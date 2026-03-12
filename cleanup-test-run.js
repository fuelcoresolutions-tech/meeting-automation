import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_KEY });
const since = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // Last 1 hour

async function archiveRecent(dbId, label, filterProp = 'Created') {
  let archived = 0;
  try {
    let resp;
    try {
      resp = await notion.databases.query({
        database_id: dbId, page_size: 100,
        filter: { property: filterProp, created_time: { on_or_after: since } },
      });
    } catch {
      resp = await notion.databases.query({ database_id: dbId, page_size: 100 });
      resp.results = resp.results.filter(p => new Date(p.created_time) >= new Date(since));
    }
    for (const page of resp.results) {
      await notion.pages.update({ page_id: page.id, archived: true });
      archived++;
    }
  } catch (e) {
    console.log(`  ⚠️  ${label}: ${e.message}`);
  }
  console.log(`  ${label}: archived ${archived}`);
  return archived;
}

console.log('Cleaning up test run outputs from last hour...\n');
let total = 0;
total += await archiveRecent(process.env.NOTION_TASKS_DATABASE_ID, 'Tasks');
total += await archiveRecent(process.env.NOTION_NOTES_DATABASE_ID, 'Notes');
total += await archiveRecent(process.env.NOTION_MEETING_REGISTER_DATABASE, 'Meeting Register');
console.log(`\nTotal archived: ${total}`);
