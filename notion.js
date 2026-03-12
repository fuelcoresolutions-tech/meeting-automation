import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_KEY });

const DATABASES = {
  projects: process.env.NOTION_PROJECTS_DATABASE_ID,
  tasks: process.env.NOTION_TASKS_DATABASE_ID,
  notes: process.env.NOTION_NOTES_DATABASE_ID,
  people: process.env.NOTION_PEOPLE_DATABASE,
  departments: process.env.NOTION_DEPARTMENT_DATABASE,
  quarterlyRocks: process.env.NOTION_QUARTERLY_ROCKS_DATABASE,
  planningCycles: process.env.NOTION_PLANNING_CYCLES_DATABASE,
  scorecardMetrics: process.env.NOTION_SCORE_CARD_METRICS_DATABASE,
  eosIssues: process.env.NOTION_EOS_ISSUES_LIST,
  speakerAliases: process.env.NOTION_SPEAKER_ALIAS_LIST,
  meetingRegister: process.env.NOTION_MEETING_REGISTER_DATABASE,
  agentConfig: process.env.NOTION_AGENT_CONFIG_DATABASE,
};

/**
 * Create a new project in the Projects database
 * @param {Object} projectData - Project details
 * @param {string} projectData.name - Project name (required)
 * @param {string} projectData.status - Project status (e.g., "Not Started", "In Progress", "Done")
 * @param {string} projectData.description - Project description
 * @param {Date} projectData.dueDate - Project due date
 */
export async function createProject(projectData) {
  const { name, status, description, dueDate } = projectData;

  const properties = {
    Name: {
      title: [
        {
          text: {
            content: name
          }
        }
      ]
    }
  };

  if (status) {
    properties.Status = {
      status: {
        name: status
      }
    };
  }

  if (dueDate) {
    properties['Target Deadline'] = {
      date: {
        start: dueDate instanceof Date ? dueDate.toISOString().split('T')[0] : dueDate
      }
    };
  }

  const pageData = {
    parent: {
      database_id: DATABASES.projects
    },
    properties
  };

  if (description) {
    pageData.children = [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: description
              }
            }
          ]
        }
      }
    ];
  }

  try {
    const response = await notion.pages.create(pageData);
    console.log(`Project "${name}" created successfully!`);
    console.log(`Page ID: ${response.id}`);
    return response;
  } catch (error) {
    console.error('Error creating project:', error.message);
    throw error;
  }
}

/**
 * Create a new task in the Tasks database
 * @param {Object} taskData - Task details
 * @param {string} taskData.name - Task name (required)
 * @param {string} taskData.status - Task status (e.g., "Not Started", "In Progress", "Done")
 * @param {string} taskData.priority - Task priority (e.g., "High", "Medium", "Low")
 * @param {Date} taskData.dueDate - Task due date
 * @param {string} taskData.projectId - Related project ID (for linking to a project)
 * @param {string} taskData.description - Task description
 */
export async function createTask(taskData) {
  const { name, status, priority, dueDate, projectId, parentTaskId, description, definitionOfDone, departmentIds, peopleIds } = taskData;

  const properties = {
    Name: {
      title: [
        {
          text: {
            content: name
          }
        }
      ]
    }
  };

  // Status is a "status" type — valid: To Do, Doing, Done
  if (status) {
    const statusMap = { 'To Do': 'To Do', 'In Progress': 'Doing', 'Doing': 'Doing', 'Done': 'Done' };
    properties.Status = {
      status: {
        name: statusMap[status] || status
      }
    };
  }

  // Priority is a "status" type — valid: Low, Medium, High
  if (priority) {
    properties.Priority = {
      status: {
        name: priority
      }
    };
  }

  if (dueDate) {
    properties.Due = {
      date: {
        start: dueDate instanceof Date ? dueDate.toISOString().split('T')[0] : dueDate
      }
    };
  }

  if (description) {
    properties.Description = {
      rich_text: [
        {
          text: {
            content: description.slice(0, 2000)
          }
        }
      ]
    };
  }

  if (projectId) {
    properties.Project = {
      relation: [
        {
          id: projectId
        }
      ]
    };
  }

  if (parentTaskId) {
    properties['Parent Task'] = {
      relation: [
        {
          id: parentTaskId
        }
      ]
    };
  }

  // Department relation → Departments DB
  if (departmentIds?.length) {
    properties.Department = {
      relation: departmentIds.map(id => ({ id }))
    };
  }

  // People relation → People DB
  if (peopleIds?.length) {
    properties.People = {
      relation: peopleIds.map(id => ({ id }))
    };
  }

  const pageData = {
    parent: {
      database_id: DATABASES.tasks
    },
    properties
  };

  // Add Definition of Done as page content (body) if provided
  if (definitionOfDone) {
    pageData.children = [
      {
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: 'Definition of Done' } }]
        }
      },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: definitionOfDone } }]
        }
      }
    ];
  }

  try {
    const response = await notion.pages.create(pageData);
    console.log(`Task "${name}" created successfully!`);
    console.log(`Page ID: ${response.id}`);
    return response;
  } catch (error) {
    console.error('Error creating task:', error.message);
    throw error;
  }
}

/**
 * Query all projects from the Projects database
 */
export async function getProjects() {
  try {
    const response = await notion.databases.query({
      database_id: DATABASES.projects
    });
    return response.results;
  } catch (error) {
    console.error('Error fetching projects:', error.message);
    throw error;
  }
}

/**
 * Query all tasks from the Tasks database
 */
export async function getTasks() {
  try {
    const response = await notion.databases.query({
      database_id: DATABASES.tasks
    });
    return response.results;
  } catch (error) {
    console.error('Error fetching tasks:', error.message);
    throw error;
  }
}

// ─── Helper: paginate all results ────────────────────────────────────────────
async function queryAll(dbId, filter = undefined) {
  const results = [];
  let cursor = undefined;
  while (true) {
    const opts = { database_id: dbId, page_size: 100 };
    if (cursor) opts.start_cursor = cursor;
    if (filter) opts.filter = filter;
    const resp = await notion.databases.query(opts);
    results.push(...resp.results);
    if (!resp.has_more) break;
    cursor = resp.next_cursor;
  }
  return results;
}

// ─── Helper: extract property values ─────────────────────────────────────────
function getTitle(page) {
  for (const val of Object.values(page.properties)) {
    if (val.type === 'title') return val.title?.map(t => t.plain_text).join('') || '';
  }
  return '';
}
function getRichText(page, prop) {
  const p = page.properties[prop];
  if (!p || p.type !== 'rich_text') return '';
  return p.rich_text?.map(t => t.plain_text).join('') || '';
}
function getSelect(page, prop) {
  const p = page.properties[prop];
  if (!p) return '';
  if (p.type === 'select') return p.select?.name || '';
  if (p.type === 'status') return p.status?.name || '';
  return '';
}
function getCheckbox(page, prop) { return page.properties[prop]?.checkbox || false; }
function getRelationIds(page, prop) { return (page.properties[prop]?.relation || []).map(r => r.id); }
function getDate(page, prop) { return page.properties[prop]?.date?.start || null; }
function getNumber(page, prop) { return page.properties[prop]?.number ?? null; }
function getEmail(page, prop) { return page.properties[prop]?.email || ''; }
function getMultiSelect(page, prop) { return (page.properties[prop]?.multi_select || []).map(o => o.name); }

// ─── People ──────────────────────────────────────────────────────────────────
export async function getPeople(activeOnly = true) {
  const all = await queryAll(DATABASES.people);
  const results = activeOnly ? all.filter(p => getCheckbox(p, 'Is Active Member')) : all;
  return results.map(p => ({
    id: p.id,
    name: getTitle(p),
    surname: getRichText(p, 'Surname'),
    email: getEmail(p, 'Email'),
    role: getRichText(p, 'Role Title'),
    title: getRichText(p, 'Title'),
    isActive: getCheckbox(p, 'Is Active Member'),
    departmentIds: getRelationIds(p, 'Department'),
    reportsToIds: getRelationIds(p, 'Reports To'),
    relationship: getMultiSelect(p, 'Relationship'),
  }));
}

// ─── Departments ─────────────────────────────────────────────────────────────
export async function getDepartments(activeOnly = true) {
  const all = await queryAll(DATABASES.departments);
  const results = activeOnly ? all.filter(d => getCheckbox(d, 'Is Active')) : all;
  return results.map(d => ({
    id: d.id,
    name: getTitle(d),
    code: getRichText(d, 'Department Code'),
    level: getSelect(d, 'Department Level'),
    isActive: getCheckbox(d, 'Is Active'),
    parentIds: getRelationIds(d, 'Parent Department'),
    subDeptIds: getRelationIds(d, 'Sub Departments'),
    headIds: getRelationIds(d, 'Department Head'),
    teamMemberIds: getRelationIds(d, 'Team Members'),
    description: getRichText(d, 'Description '),
    headCount: getRichText(d, 'Head Count'),
  }));
}

// ─── Quarterly Rocks ─────────────────────────────────────────────────────────
export async function getQuarterlyRocks() {
  const all = await queryAll(DATABASES.quarterlyRocks);
  return all.map(r => ({
    id: r.id,
    title: getTitle(r),
    status: getSelect(r, 'Status'),
    ownerIds: getRelationIds(r, 'Owner'),
    departmentIds: getRelationIds(r, 'Department'),
    projectIds: getRelationIds(r, 'Project'),
    planningCycleIds: getRelationIds(r, 'Planning Cycle'),
    dueDate: getDate(r, 'Due Date'),
    completedDate: getDate(r, 'Completed Date'),
    description: getRichText(r, 'Description'),
    keywords: getRichText(r, 'Key Words'),
  }));
}

export async function createRock(data) {
  const properties = {
    'Rock Title': { title: [{ text: { content: data.title } }] },
  };
  if (data.status) properties.Status = { status: { name: data.status } };
  if (data.description) properties.Description = { rich_text: [{ text: { content: data.description } }] };
  if (data.keywords) properties['Key Words'] = { rich_text: [{ text: { content: data.keywords } }] };
  if (data.dueDate) properties['Due Date'] = { date: { start: data.dueDate } };
  if (data.ownerIds?.length) properties.Owner = { relation: data.ownerIds.map(id => ({ id })) };
  if (data.departmentIds?.length) properties.Department = { relation: data.departmentIds.map(id => ({ id })) };
  if (data.projectIds?.length) properties.Project = { relation: data.projectIds.map(id => ({ id })) };
  if (data.planningCycleIds?.length) properties['Planning Cycle'] = { relation: data.planningCycleIds.map(id => ({ id })) };
  return notion.pages.create({ parent: { database_id: DATABASES.quarterlyRocks }, properties });
}

// ─── Planning Cycles ─────────────────────────────────────────────────────────
export async function getPlanningCycles() {
  const all = await queryAll(DATABASES.planningCycles);
  return all.map(c => ({
    id: c.id,
    title: getTitle(c),
    cycleType: getSelect(c, 'Cycle Type'),
    isCurrent: getCheckbox(c, 'Is Current'),
    startDate: getDate(c, 'Start Date'),
    endDate: getDate(c, 'End Date'),
    rockIds: getRelationIds(c, 'Rocks'),
    annualGoals: getRichText(c, 'Annual Goals'),
  }));
}

// ─── Scorecard Metrics ───────────────────────────────────────────────────────
export async function getScorecardMetrics() {
  const all = await queryAll(DATABASES.scorecardMetrics);
  return all.map(m => ({
    id: m.id,
    name: getTitle(m),
    ownerIds: getRelationIds(m, 'Owner'),
    departmentIds: getRelationIds(m, 'Department'),
    target: getNumber(m, 'Target'),
    currentValue: getNumber(m, 'Current Value'),
    onTrack: getCheckbox(m, 'On track'),
    frequency: getSelect(m, 'Frequency'),
    unit: getRichText(m, 'Unit'),
    notes: getRichText(m, 'Notes'),
  }));
}

export async function createScorecardMetric(data) {
  const properties = {
    'Metric Name': { title: [{ text: { content: data.name } }] },
  };
  if (data.target != null) properties.Target = { number: data.target };
  if (data.currentValue != null) properties['Current Value'] = { number: data.currentValue };
  if (data.onTrack != null) properties['On track'] = { checkbox: data.onTrack };
  if (data.frequency) properties.Frequency = { select: { name: data.frequency } };
  if (data.unit) properties.Unit = { rich_text: [{ text: { content: data.unit } }] };
  if (data.notes) properties.Notes = { rich_text: [{ text: { content: data.notes } }] };
  if (data.ownerIds?.length) properties.Owner = { relation: data.ownerIds.map(id => ({ id })) };
  if (data.departmentIds?.length) properties.Department = { relation: data.departmentIds.map(id => ({ id })) };
  return notion.pages.create({ parent: { database_id: DATABASES.scorecardMetrics }, properties });
}

// ─── EOS Issues ──────────────────────────────────────────────────────────────
export async function getEosIssues(unresolvedOnly = true) {
  const filter = unresolvedOnly ? { property: 'Is Resolved', checkbox: { equals: false } } : undefined;
  const all = await queryAll(DATABASES.eosIssues, filter);
  return all.map(i => ({
    id: i.id,
    title: getTitle(i),
    issueDescription: getRichText(i, 'Issue Description'),
    isResolved: getCheckbox(i, 'Is Resolved'),
    resolutionNotes: getRichText(i, 'Resolution Notes'),
    priority: getSelect(i, 'Priority level'),
    raisedByIds: getRelationIds(i, 'Raised by'),
    departmentIds: getRelationIds(i, 'Department'),
    projectIds: getRelationIds(i, 'Project'),
    rockIds: getRelationIds(i, 'Quarterly Rock'),
    sourceMeetingIds: getRelationIds(i, 'Source Meeting'),
  }));
}

export async function createEosIssue(data) {
  const properties = {
    Title: { title: [{ text: { content: data.title } }] },
  };
  if (data.issueDescription) properties['Issue Description'] = { rich_text: [{ text: { content: data.issueDescription } }] };
  if (data.isResolved != null) properties['Is Resolved'] = { checkbox: data.isResolved };
  if (data.resolutionNotes) properties['Resolution Notes'] = { rich_text: [{ text: { content: data.resolutionNotes } }] };
  if (data.priority) properties['Priority level'] = { select: { name: data.priority } };
  if (data.raisedByIds?.length) properties['Raised by'] = { relation: data.raisedByIds.map(id => ({ id })) };
  if (data.departmentIds?.length) properties.Department = { relation: data.departmentIds.map(id => ({ id })) };
  if (data.projectIds?.length) properties.Project = { relation: data.projectIds.map(id => ({ id })) };
  if (data.rockIds?.length) properties['Quarterly Rock'] = { relation: data.rockIds.map(id => ({ id })) };
  if (data.sourceMeetingIds?.length) properties['Source Meeting'] = { relation: data.sourceMeetingIds.map(id => ({ id })) };
  return notion.pages.create({ parent: { database_id: DATABASES.eosIssues }, properties });
}

// ─── Speaker Aliases ─────────────────────────────────────────────────────────
export async function getSpeakerAliases() {
  const all = await queryAll(DATABASES.speakerAliases);
  return all.map(a => ({
    id: a.id,
    alias: getTitle(a),
    personIds: getRelationIds(a, 'Person'),
    source: getRichText(a, 'Source'),
    confidence: getNumber(a, 'Confidence'),
    notes: getRichText(a, 'Notes'),
  }));
}

export async function createSpeakerAlias(data) {
  const properties = {
    Alias: { title: [{ text: { content: data.alias } }] },
  };
  if (data.source) properties.Source = { rich_text: [{ text: { content: data.source } }] };
  if (data.confidence != null) properties.Confidence = { number: data.confidence };
  if (data.notes) properties.Notes = { rich_text: [{ text: { content: data.notes } }] };
  if (data.personIds?.length) properties.Person = { relation: data.personIds.map(id => ({ id })) };
  return notion.pages.create({ parent: { database_id: DATABASES.speakerAliases }, properties });
}

// ─── Meeting Register ────────────────────────────────────────────────────────
export async function getMeetingRegister() {
  const all = await queryAll(DATABASES.meetingRegister);
  return all.map(m => ({
    id: m.id,
    title: getTitle(m),
    meetingDate: getDate(m, 'Meeting Date'),
    meetingFormat: getSelect(m, 'Meeting Format'),
    meetingTypes: getMultiSelect(m, 'Multi-select'),
    processingStatus: getSelect(m, 'Processing Status'),
    speakerMappingDone: getCheckbox(m, 'Speaker Mapping Done'),
    facilitatorIds: getRelationIds(m, 'Facilitator'),
    attendeeIds: getRelationIds(m, 'Attendees'),
    departmentIds: getRelationIds(m, 'Department'),
    planningCycleIds: getRelationIds(m, 'Planning Cycle'),
    meetingNoteIds: getRelationIds(m, 'Meeting Notes'),
    transcriptSource: getRichText(m, 'Transcript Source'),
    rawTranscript: getRichText(m, 'Raw Transcript'),
    confidenceNotes: getRichText(m, 'Agent Confidence Notes'),
  }));
}

export async function createMeetingRegister(data) {
  const properties = {
    Title: { title: [{ text: { content: data.title } }] },
  };
  if (data.meetingDate) properties['Meeting Date'] = { date: { start: data.meetingDate } };
  if (data.meetingFormat) properties['Meeting Format'] = { select: { name: data.meetingFormat } };
  if (data.meetingTypes?.length) properties['Multi-select'] = { multi_select: data.meetingTypes.map(n => ({ name: n })) };
  if (data.processingStatus) properties['Processing Status'] = { status: { name: data.processingStatus } };
  if (data.speakerMappingDone != null) properties['Speaker Mapping Done'] = { checkbox: data.speakerMappingDone };
  if (data.transcriptSource) properties['Transcript Source'] = { rich_text: [{ text: { content: data.transcriptSource } }] };
  if (data.confidenceNotes) properties['Agent Confidence Notes'] = { rich_text: [{ text: { content: data.confidenceNotes } }] };
  if (data.facilitatorIds?.length) properties.Facilitator = { relation: data.facilitatorIds.map(id => ({ id })) };
  if (data.attendeeIds?.length) properties.Attendees = { relation: data.attendeeIds.map(id => ({ id })) };
  if (data.departmentIds?.length) properties.Department = { relation: data.departmentIds.map(id => ({ id })) };
  if (data.planningCycleIds?.length) properties['Planning Cycle'] = { relation: data.planningCycleIds.map(id => ({ id })) };
  if (data.meetingNoteIds?.length) properties['Meeting Notes'] = { relation: data.meetingNoteIds.map(id => ({ id })) };
  return notion.pages.create({ parent: { database_id: DATABASES.meetingRegister }, properties });
}

// ─── Agent Config ────────────────────────────────────────────────────────────
export async function getAgentConfig() {
  const all = await queryAll(DATABASES.agentConfig);
  if (all.length === 0) return null;
  const c = all[0];
  return {
    id: c.id,
    workspaceName: getTitle(c),
    defaultTodoDueDays: getNumber(c, 'Default Todo Due Days'),
    minConfidenceThreshold: getNumber(c, 'Min Confidence Threshold'),
    requireSpeakerReview: getCheckbox(c, 'Require Speaker Review (In Person)'),
    customInstructions: getRichText(c, 'Custom Agent Instructions'),
    l10TemplatePage: c.properties['L10 Note Template Page']?.url || null,
  };
}

// ─── Aggregated Context ──────────────────────────────────────────────────────
export async function getFullContext() {
  const [people, projects, departments, rocks, cycles, metrics, issues, aliases, config] = await Promise.all([
    getPeople(),
    getProjects().then(results => results.map(p => ({
      id: p.id,
      name: p.properties?.Name?.title?.[0]?.plain_text || 'Untitled',
      status: p.properties?.Status?.status?.name || 'Unknown',
      departmentIds: (p.properties?.Departments?.relation || []).map(r => r.id),
    }))),
    getDepartments(),
    getQuarterlyRocks(),
    getPlanningCycles(),
    getScorecardMetrics(),
    getEosIssues(false),
    getSpeakerAliases(),
    getAgentConfig(),
  ]);
  return { people, projects, departments, rocks, planningCycles: cycles, scorecardMetrics: metrics, eosIssues: issues, speakerAliases: aliases, agentConfig: config };
}

export { notion, DATABASES, queryAll, getTitle, getRichText, getSelect, getCheckbox, getRelationIds, getDate, getNumber, getEmail, getMultiSelect };
