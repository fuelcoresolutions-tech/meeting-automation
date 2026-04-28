import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_KEY });
const TASKS_DB = process.env.NOTION_TASKS_DATABASE_ID;

async function main() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`Deleting tasks created on ${today}...\n`);

  let deleted = 0;
  let hasMore = true;

  while (hasMore) {
    const resp = await notion.databases.query({
      database_id: TASKS_DB,
      page_size: 100,
      filter: {
        property: 'Created',
        created_time: { on_or_after: today }
      }
    });

    if (resp.results.length === 0) break;

    for (const page of resp.results) {
      await notion.pages.update({ page_id: page.id, archived: true });
      deleted++;
    }
    console.log(`  Archived ${deleted} so far...`);
    hasMore = resp.results.length === 100;
  }

  console.log(`\nDone. Archived ${deleted} tasks.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
