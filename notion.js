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
  const { name, status, description, dueDate, keywords } = projectData;

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

  if (description) {
    properties['Project Description'] = {
      rich_text: [{ type: 'text', text: { content: description.slice(0, 2000) } }]
    };
  }

  if (keywords) {
    const keywordsStr = Array.isArray(keywords) ? keywords.join(', ') : keywords;
    properties['Key Words'] = {
      rich_text: [{ type: 'text', text: { content: keywordsStr.slice(0, 2000) } }]
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
 * Update an existing project's description, keywords, or client
 */
export async function updateProject(projectId, updates) {
  const properties = {};

  if (updates.description !== undefined) {
    properties['Project Description'] = {
      rich_text: [{ type: 'text', text: { content: (updates.description || '').slice(0, 2000) } }]
    };
  }
  if (updates.keywords !== undefined) {
    const keywordsStr = Array.isArray(updates.keywords) ? updates.keywords.join(', ') : (updates.keywords || '');
    properties['Key Words'] = {
      rich_text: [{ type: 'text', text: { content: keywordsStr.slice(0, 2000) } }]
    };
  }

  return notion.pages.update({ page_id: projectId, properties });
}

/**
 * Update a speaker alias's notes field
 */
export async function updateSpeakerAlias(aliasId, updates) {
  const properties = {};
  if (updates.notes !== undefined) {
    properties['Notes'] = {
      rich_text: [{ type: 'text', text: { content: (updates.notes || '').slice(0, 2000) } }]
    };
  }
  if (updates.confidence !== undefined) {
    properties['Confidence'] = { number: updates.confidence };
  }
  return notion.pages.update({ page_id: aliasId, properties });
}

/**
 * Update the agent config custom instructions
 */
export async function updateAgentConfig(configId, updates) {
  const properties = {};
  if (updates.customInstructions !== undefined) {
    properties['Custom Agent Instructions'] = {
      rich_text: [{ type: 'text', text: { content: (updates.customInstructions || '').slice(0, 2000) } }]
    };
  }
  if (updates.defaultTodoDueDays !== undefined) {
    properties['Default Todo Due Days'] = { number: updates.defaultTodoDueDays };
  }
  if (updates.minConfidenceThreshold !== undefined) {
    properties['Min Confidence Threshold'] = { number: updates.minConfidenceThreshold };
  }
  return notion.pages.update({ page_id: configId, properties });
}

/**
 * Create a new person in the People database (for external contacts)
 */
export async function createPerson(personData) {
  const { name, role, email, jobDescription, relationship, company } = personData;
  const properties = {
    'Full Name': { title: [{ text: { content: name } }] },
    'Is Active Member': { checkbox: true }
  };
  if (role) properties['Role Title'] = { rich_text: [{ type: 'text', text: { content: role } }] };
  if (email) properties['Email'] = { email };
  if (company) properties['Company'] = { rich_text: [{ type: 'text', text: { content: company } }] };
  if (jobDescription) {
    properties['Job Description'] = {
      rich_text: [{ type: 'text', text: { content: jobDescription.slice(0, 2000) } }]
    };
  }
  if (relationship?.length) {
    properties['Relationship'] = { multi_select: relationship.map(r => ({ name: r })) };
  }
  return notion.pages.create({ parent: { database_id: DATABASES.people }, properties });
}

/**
 * Update a person's job description or position level
 */
export async function updatePerson(personId, updates) {
  const properties = {};

  if (updates.jobDescription !== undefined) {
    properties['Job Description'] = {
      rich_text: [{ type: 'text', text: { content: (updates.jobDescription || '').slice(0, 2000) } }]
    };
  }
  if (updates.positionLevel !== undefined) {
    properties['Position Level'] = {
      multi_select: updates.positionLevel ? [{ name: updates.positionLevel }] : []
    };
  }

  return notion.pages.update({ page_id: personId, properties });
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
  const { name, status, priority, dueDate, projectId, parentTaskId, description, definitionOfDone, departmentIds, peopleIds, meetingRegisterId } = taskData;

  // Idempotency: when called for a specific meeting register row, attach a
  // provenance marker to the description and dedupe by (name, marker). On
  // retry after a partial Claude failure (e.g. credits ran out mid-loop),
  // the same task is returned instead of duplicated.
  const meetingMarker = meetingRegisterId ? `[mreg:${meetingRegisterId}]` : null;
  if (meetingMarker) {
    try {
      const existing = await notion.databases.query({
        database_id: DATABASES.tasks,
        filter: {
          and: [
            { property: 'Name', title: { equals: name } },
            { property: 'Description', rich_text: { contains: meetingMarker } },
          ],
        },
        page_size: 1,
      });
      if (existing.results.length > 0) {
        const hit = existing.results[0];
        console.log(`Task "${name}" already exists for meeting ${meetingRegisterId} (page ${hit.id}) — reusing`);
        return { id: hit.id, reused: true };
      }
    } catch (lookupError) {
      // Lookup failure should not block creation — fall through.
      console.warn(`Task dedupe lookup failed (continuing with create): ${lookupError.message}`);
    }
  }

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

  if (description || meetingMarker) {
    const segments = [];
    if (description) {
      segments.push({ text: { content: description.slice(0, 2000) } });
    }
    if (meetingMarker) {
      // Separate rich_text segment so the marker stays under Notion's per-segment
      // character limit and is easy to filter on for dedupe lookups.
      segments.push({ text: { content: `\n\n${meetingMarker}` } });
    }
    properties.Description = { rich_text: segments };
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
function getCreatedTime(page, prop) { return page.properties[prop]?.created_time || null; }

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
    jobDescription: getRichText(p, 'Job Description'),
    positionLevel: getSelect(p, 'Position Level'),
    projectIds: getRelationIds(p, 'Projects'),
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
    projectIds: getRelationIds(d, 'Project'),
  }));
}

export async function updateDepartment(deptId, updates) {
  const properties = {};
  if (updates.projectId !== undefined) {
    properties['Project'] = {
      relation: updates.projectId ? [{ id: updates.projectId }] : []
    };
  }
  return notion.pages.update({ page_id: deptId, properties });
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
    // Durable retry + idempotency fields (optional in schema).
    externalMeetingId: getRichText(m, 'External Meeting ID'),
    retryCount: getNumber(m, 'Retry Count'),
    nextRetryAt: getDate(m, 'Next Retry At'),
    lastErrorCode: getRichText(m, 'Last Error Code'),
    lastErrorMessage: getRichText(m, 'Last Error Message'),
    processedAt: getDate(m, 'Processed At'),
    createdNoteId: getRichText(m, 'Created Note ID'),
    createdAgendaId: getRichText(m, 'Created Agenda ID'),
    runVersion: getNumber(m, 'Run Version'),
    forceRerun: getCheckbox(m, 'Force Rerun'),
    lastAttemptAt: getDate(m, 'Last Attempt At'),
    retrySource: getRichText(m, 'Retry Source'),
    createdTime: getCreatedTime(m, 'Created time'),
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
  // Durable retry + idempotency fields.
  if (data.externalMeetingId) properties['External Meeting ID'] = { rich_text: [{ text: { content: data.externalMeetingId } }] };
  if (data.retryCount != null) properties['Retry Count'] = { number: data.retryCount };
  if (data.nextRetryAt) properties['Next Retry At'] = { date: { start: data.nextRetryAt } };
  if (data.lastErrorCode) properties['Last Error Code'] = { rich_text: [{ text: { content: data.lastErrorCode } }] };
  if (data.lastErrorMessage) properties['Last Error Message'] = { rich_text: [{ text: { content: String(data.lastErrorMessage).slice(0, 2000) } }] };
  if (data.processedAt) properties['Processed At'] = { date: { start: data.processedAt } };
  if (data.createdNoteId) properties['Created Note ID'] = { rich_text: [{ text: { content: data.createdNoteId } }] };
  if (data.createdAgendaId) properties['Created Agenda ID'] = { rich_text: [{ text: { content: data.createdAgendaId } }] };
  if (data.runVersion != null) properties['Run Version'] = { number: data.runVersion };
  if (data.forceRerun != null) properties['Force Rerun'] = { checkbox: !!data.forceRerun };
  if (data.lastAttemptAt) properties['Last Attempt At'] = { date: { start: data.lastAttemptAt } };
  if (data.retrySource) properties['Retry Source'] = { rich_text: [{ text: { content: data.retrySource } }] };
  if (data.facilitatorIds?.length) properties.Facilitator = { relation: data.facilitatorIds.map(id => ({ id })) };
  if (data.attendeeIds?.length) properties.Attendees = { relation: data.attendeeIds.map(id => ({ id })) };
  if (data.departmentIds?.length) properties.Department = { relation: data.departmentIds.map(id => ({ id })) };
  if (data.planningCycleIds?.length) properties['Planning Cycle'] = { relation: data.planningCycleIds.map(id => ({ id })) };
  if (data.meetingNoteIds?.length) properties['Meeting Notes'] = { relation: data.meetingNoteIds.map(id => ({ id })) };
  return notion.pages.create({ parent: { database_id: DATABASES.meetingRegister }, properties });
}

// Find one meeting register row using external meeting ID from Fireflies.
export async function findMeetingRegisterByExternalId(externalMeetingId) {
  if (!externalMeetingId) return null;
  const results = await queryAll(DATABASES.meetingRegister, {
    property: 'External Meeting ID',
    rich_text: { equals: externalMeetingId }
  });
  return results[0] || null;
}

// Update an existing meeting register row with queue/retry state.
export async function updateMeetingRegister(meetingRegisterId, data) {
  const properties = {};
  if (data.title !== undefined) properties.Title = { title: [{ text: { content: data.title || 'Untitled Meeting' } }] };
  if (data.meetingDate !== undefined) properties['Meeting Date'] = data.meetingDate ? { date: { start: data.meetingDate } } : { date: null };
  if (data.meetingFormat !== undefined) properties['Meeting Format'] = data.meetingFormat ? { select: { name: data.meetingFormat } } : { select: null };
  if (data.meetingTypes !== undefined) properties['Multi-select'] = { multi_select: (data.meetingTypes || []).map(n => ({ name: n })) };
  if (data.processingStatus !== undefined) properties['Processing Status'] = data.processingStatus ? { status: { name: data.processingStatus } } : { status: null };
  if (data.speakerMappingDone !== undefined) properties['Speaker Mapping Done'] = { checkbox: !!data.speakerMappingDone };
  if (data.transcriptSource !== undefined) properties['Transcript Source'] = { rich_text: data.transcriptSource ? [{ text: { content: data.transcriptSource } }] : [] };
  if (data.confidenceNotes !== undefined) properties['Agent Confidence Notes'] = { rich_text: data.confidenceNotes ? [{ text: { content: String(data.confidenceNotes).slice(0, 2000) } }] : [] };
  if (data.externalMeetingId !== undefined) properties['External Meeting ID'] = { rich_text: data.externalMeetingId ? [{ text: { content: data.externalMeetingId } }] : [] };
  if (data.retryCount !== undefined) properties['Retry Count'] = { number: data.retryCount ?? null };
  if (data.nextRetryAt !== undefined) properties['Next Retry At'] = data.nextRetryAt ? { date: { start: data.nextRetryAt } } : { date: null };
  if (data.lastErrorCode !== undefined) properties['Last Error Code'] = { rich_text: data.lastErrorCode ? [{ text: { content: data.lastErrorCode } }] : [] };
  if (data.lastErrorMessage !== undefined) properties['Last Error Message'] = { rich_text: data.lastErrorMessage ? [{ text: { content: String(data.lastErrorMessage).slice(0, 2000) } }] : [] };
  if (data.processedAt !== undefined) properties['Processed At'] = data.processedAt ? { date: { start: data.processedAt } } : { date: null };
  if (data.createdNoteId !== undefined) properties['Created Note ID'] = { rich_text: data.createdNoteId ? [{ text: { content: data.createdNoteId } }] : [] };
  if (data.createdAgendaId !== undefined) properties['Created Agenda ID'] = { rich_text: data.createdAgendaId ? [{ text: { content: data.createdAgendaId } }] : [] };
  if (data.runVersion !== undefined) properties['Run Version'] = { number: data.runVersion ?? null };
  if (data.forceRerun !== undefined) properties['Force Rerun'] = { checkbox: !!data.forceRerun };
  if (data.lastAttemptAt !== undefined) properties['Last Attempt At'] = data.lastAttemptAt ? { date: { start: data.lastAttemptAt } } : { date: null };
  if (data.retrySource !== undefined) properties['Retry Source'] = { rich_text: data.retrySource ? [{ text: { content: data.retrySource } }] : [] };
  if (data.facilitatorIds !== undefined) properties.Facilitator = { relation: (data.facilitatorIds || []).map(id => ({ id })) };
  if (data.attendeeIds !== undefined) properties.Attendees = { relation: (data.attendeeIds || []).map(id => ({ id })) };
  if (data.departmentIds !== undefined) properties.Department = { relation: (data.departmentIds || []).map(id => ({ id })) };
  if (data.planningCycleIds !== undefined) properties['Planning Cycle'] = { relation: (data.planningCycleIds || []).map(id => ({ id })) };
  if (data.meetingNoteIds !== undefined) properties['Meeting Notes'] = { relation: (data.meetingNoteIds || []).map(id => ({ id })) };
  return notion.pages.update({ page_id: meetingRegisterId, properties });
}

// Upsert meeting register row keyed by external meeting ID.
// `createOnlyFields` are applied only on create — useful for placeholder values
// (e.g. webhook-time title before transcript fetch) that must not clobber
// real data on a duplicate webhook for an already-processed meeting.
export async function upsertMeetingRegisterByExternalId(externalMeetingId, data, createOnlyFields = {}) {
  const existing = await findMeetingRegisterByExternalId(externalMeetingId);
  if (existing) {
    await updateMeetingRegister(existing.id, data);
    return { id: existing.id, created: false };
  }
  const created = await createMeetingRegister({
    ...createOnlyFields,
    ...data,
    externalMeetingId
  });
  return { id: created.id, created: true };
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
      description: (p.properties?.['Project Description']?.rich_text || []).map(t => t.plain_text).join('') || '',
      keywords: (p.properties?.['Key Words']?.rich_text || []).map(t => t.plain_text).join('').split(',').map(k => k.trim()).filter(k => k),
      client: (p.properties?.Client?.rich_text || []).map(t => t.plain_text).join('') || '',
      projectLeadIds: (p.properties?.['Project Lead']?.relation || []).map(r => r.id),
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

export { notion, DATABASES, queryAll, getTitle, getRichText, getSelect, getCheckbox, getRelationIds, getDate, getNumber, getEmail, getMultiSelect, getCreatedTime };
