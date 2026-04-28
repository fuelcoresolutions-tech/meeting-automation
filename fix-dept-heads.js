import { getPeople, getDepartments, notion } from './notion.js';

const people = await getPeople(false);
const depts = await getDepartments(false);

const ruth = people.find(p => p.name.toLowerCase().includes('ruth'));
const brian = people.find(p => p.name.toLowerCase().includes('brian'));
const stratDept = depts.find(d => d.code === 'STR');
const finDept = depts.find(d => d.code === 'FIN');

console.log('Ruth:', ruth?.name, ruth?.id);
console.log('Brian:', brian?.name, brian?.id);

if (ruth && stratDept && !stratDept.headIds.length) {
  await notion.pages.update({ page_id: stratDept.id, properties: { 'Department Head': { relation: [{ id: ruth.id }] } } });
  console.log('✅ Strategy → Head: ' + ruth.name);
}
if (brian && finDept && !finDept.headIds.length) {
  await notion.pages.update({ page_id: finDept.id, properties: { 'Department Head': { relation: [{ id: brian.id }] } } });
  console.log('✅ Finance → Head: ' + brian.name);
}
console.log('Done.');
