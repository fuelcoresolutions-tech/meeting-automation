import express from 'express';
import {
  createProject, updateProject,
  createPerson, updatePerson,
  createTask, getProjects, getTasks, notion, DATABASES,
  getPeople, getDepartments, updateDepartment, getQuarterlyRocks, createRock,
  getPlanningCycles, getScorecardMetrics, createScorecardMetric,
  getEosIssues, createEosIssue,
  getSpeakerAliases, createSpeakerAlias, updateSpeakerAlias,
  getMeetingRegister, createMeetingRegister,
  getAgentConfig, updateAgentConfig, getFullContext,
} from './notion.js';

const router = express.Router();

// Get all projects
router.get('/projects', async (req, res) => {
  try {
    const projects = await getProjects();
    const formatted = projects.map(p => ({
      id: p.id,
      name: p.properties.Name?.title?.[0]?.plain_text || 'Untitled',
      status: p.properties.Status?.status?.name || 'Unknown',
      description: (p.properties['Project Description']?.rich_text || []).map(t => t.plain_text).join('') || '',
      keywords: (p.properties['Key Words']?.rich_text || []).map(t => t.plain_text).join('').split(',').map(k => k.trim()).filter(k => k),
      client: (p.properties.Client?.rich_text || []).map(t => t.plain_text).join('') || '',
      projectLeadIds: (p.properties['Project Lead']?.relation || []).map(r => r.id),
    }));
    res.json(formatted);
  } catch (error) {
    console.error('Error fetching projects:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Create a project
router.post('/projects', async (req, res) => {
  try {
    const result = await createProject(req.body);
    res.json({ id: result.id, success: true });
  } catch (error) {
    console.error('Error creating project:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Update project description, keywords, client
router.patch('/projects/:id', async (req, res) => {
  try {
    await updateProject(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating project:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get all tasks
router.get('/tasks', async (req, res) => {
  try {
    const tasks = await getTasks();
    const formatted = tasks.map(t => ({
      id: t.id,
      name: t.properties.Name?.title?.[0]?.plain_text || 'Untitled',
      status: t.properties.Status?.status?.name || 'Unknown',
      priority: t.properties.Priority?.status?.name || 'Unknown'
    }));
    res.json(formatted);
  } catch (error) {
    console.error('Error fetching tasks:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Create a task
router.post('/tasks', async (req, res) => {
  try {
    const result = await createTask(req.body);
    res.json({ id: result.id, success: true });
  } catch (error) {
    console.error('Error creating task:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── People ─────────────────────────────────────────────────────────
router.get('/people', async (req, res) => {
  try {
    const activeOnly = req.query.active !== 'false';
    res.json(await getPeople(activeOnly));
  } catch (error) {
    console.error('Error fetching people:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Create a person (external contacts, partners)
router.post('/people', async (req, res) => {
  try {
    const result = await createPerson(req.body);
    res.json({ id: result.id, success: true });
  } catch (error) {
    console.error('Error creating person:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Update person job description / position level
router.patch('/people/:id', async (req, res) => {
  try {
    await updatePerson(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating person:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Departments ────────────────────────────────────────────────────
router.get('/departments', async (req, res) => {
  try {
    const activeOnly = req.query.active !== 'false';
    res.json(await getDepartments(activeOnly));
  } catch (error) {
    console.error('Error fetching departments:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.patch('/departments/:id', async (req, res) => {
  try {
    await updateDepartment(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating department:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Quarterly Rocks ────────────────────────────────────────────────
router.get('/rocks', async (req, res) => {
  try { res.json(await getQuarterlyRocks()); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/rocks', async (req, res) => {
  try {
    const result = await createRock(req.body);
    res.json({ id: result.id, success: true });
  } catch (error) {
    console.error('Error creating rock:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Planning Cycles ────────────────────────────────────────────────
router.get('/planning-cycles', async (req, res) => {
  try { res.json(await getPlanningCycles()); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── Scorecard Metrics ──────────────────────────────────────────────
router.get('/scorecard-metrics', async (req, res) => {
  try { res.json(await getScorecardMetrics()); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/scorecard-metrics', async (req, res) => {
  try {
    const result = await createScorecardMetric(req.body);
    res.json({ id: result.id, success: true });
  } catch (error) {
    console.error('Error creating metric:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── EOS Issues ─────────────────────────────────────────────────────
router.get('/eos-issues', async (req, res) => {
  try {
    const unresolvedOnly = req.query.all !== 'true';
    res.json(await getEosIssues(unresolvedOnly));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/eos-issues', async (req, res) => {
  try {
    const result = await createEosIssue(req.body);
    res.json({ id: result.id, success: true });
  } catch (error) {
    console.error('Error creating EOS issue:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Speaker Aliases ────────────────────────────────────────────────
router.get('/speaker-aliases', async (req, res) => {
  try { res.json(await getSpeakerAliases()); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/speaker-aliases', async (req, res) => {
  try {
    const result = await createSpeakerAlias(req.body);
    res.json({ id: result.id, success: true });
  } catch (error) {
    console.error('Error creating speaker alias:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.patch('/speaker-aliases/:id', async (req, res) => {
  try {
    await updateSpeakerAlias(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating speaker alias:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Meeting Register ───────────────────────────────────────────────
router.get('/meeting-register', async (req, res) => {
  try { res.json(await getMeetingRegister()); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/meeting-register', async (req, res) => {
  try {
    const result = await createMeetingRegister(req.body);
    res.json({ id: result.id, success: true });
  } catch (error) {
    console.error('Error creating meeting register entry:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Agent Config ───────────────────────────────────────────────────
router.get('/agent-config', async (req, res) => {
  try { res.json(await getAgentConfig()); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

router.patch('/agent-config/:id', async (req, res) => {
  try {
    await updateAgentConfig(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating agent config:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Aggregated Context (single call for agent) ─────────────────────
router.get('/context', async (req, res) => {
  try {
    const ctx = await getFullContext();
    res.json(ctx);
  } catch (error) {
    console.error('Error fetching context:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Notion Block Helpers ───────────────────────────────────────────

function richText(content, bold = false) {
  const rt = { type: 'text', text: { content: String(content ?? '') } };
  if (bold) rt.annotations = { bold: true };
  return rt;
}

function buildHeading(level, text) {
  const key = `heading_${level}`;
  return { object: 'block', type: key, [key]: { rich_text: [richText(text)] } };
}

function buildParagraph(segments) {
  // segments can be a string or array of {text, bold?} objects
  if (typeof segments === 'string') {
    return {
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [richText(segments)] }
    };
  }
  return {
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: segments.map(s => richText(s.text, s.bold)) }
  };
}

function buildDivider() {
  return { object: 'block', type: 'divider', divider: {} };
}

function buildCallout(text, emoji = '📊') {
  return {
    object: 'block', type: 'callout',
    callout: {
      rich_text: [richText(text)],
      icon: { type: 'emoji', emoji }
    }
  };
}

function buildTableRow(cells) {
  return {
    object: 'block', type: 'table_row',
    table_row: {
      cells: cells.map(cell => [richText(cell)])
    }
  };
}

function buildTable(headers, rows) {
  return {
    object: 'block', type: 'table',
    table: {
      table_width: headers.length,
      has_column_header: true,
      has_row_header: false,
      children: [
        buildTableRow(headers),
        ...rows.map(row => buildTableRow(row))
      ]
    }
  };
}

function buildToggle(title, childBlocks) {
  return {
    object: 'block', type: 'toggle',
    toggle: {
      rich_text: [richText(title)],
      children: childBlocks
    }
  };
}

// ─── Meeting Note Section Builders ──────────────────────────────────

const EOS_MEETING_TYPES = new Set(['L10', 'Quarterly', 'Annual', 'Same Page', 'State of Company', 'Quarterly Conversation']);

function buildCompanyHeader(meetingType, orgName, subtitle) {
  const resolvedOrgName = orgName || 'FUEL CORE SOLUTIONS';
  const defaultSubtitle = EOS_MEETING_TYPES.has(meetingType) ? 'EOS / Traction Framework' : null;
  const resolvedSubtitle = subtitle !== undefined ? subtitle : defaultSubtitle;
  const typeLabels = {
    'L10': 'Level 10 Meeting Notes',
    'Quarterly': 'Quarterly Meeting Notes',
    'Annual': 'Annual Planning Notes',
    'Same Page': 'Same Page Meeting Notes',
    'State of Company': 'State of the Company Notes',
    'Quarterly Conversation': 'Quarterly Conversation Notes',
    'Other': 'Meeting Notes',
    'General': 'Meeting Notes'
  };
  const blocks = [
    buildHeading(1, resolvedOrgName),
    buildParagraph([
      { text: typeLabels[meetingType] || 'Meeting Notes', bold: false }
    ])
  ];
  if (resolvedSubtitle) {
    blocks.push(buildParagraph([{ text: resolvedSubtitle, bold: false }]));
  }
  blocks.push(buildDivider());
  return blocks;
}

function buildMeetingInfoSection(info, date, durationSeconds) {
  const blocks = [buildHeading(2, 'MEETING INFORMATION')];
  const durationMins = durationSeconds ? Math.round(durationSeconds / 60) : null;
  const rows = [];
  if (date) rows.push(['Date', date]);
  if (info.time) rows.push(['Time', info.time]);
  if (durationMins) rows.push(['Duration', `~${durationMins} minutes`]);
  if (info.location) rows.push(['Location', info.location]);
  if (info.facilitator) rows.push(['Facilitator', info.facilitator]);
  if (info.scribe) rows.push(['Scribe / Notes', info.scribe || 'Fireflies AI']);
  if (info.attendees?.length) rows.push(['Attendees', info.attendees.join(', ')]);
  if (rows.length) blocks.push(buildTable(['Field', 'Details'], rows));
  return blocks;
}

function buildSegueSection(segue) {
  const blocks = [buildDivider(), buildHeading(2, 'SEGUE — Good News')];
  const rows = segue.map(s => [s.person, s.personal || '', s.professional || '']);
  blocks.push(buildTable(['Person', 'Personal Good News', 'Professional Good News'], rows));
  return blocks;
}

function buildScorecardSection(scorecard) {
  const blocks = [buildDivider(), buildHeading(2, 'SCORECARD REVIEW')];
  const rows = scorecard.map(s => [s.metric, s.owner, s.goal || '', s.actual || '', s.status]);
  blocks.push(buildTable(['Metric', 'Owner', 'Goal', 'Actual', 'Status'], rows));
  return blocks;
}

function buildRockReviewSection(rockReview) {
  const blocks = [buildDivider(), buildHeading(2, 'ROCK REVIEW — 90-Day Priorities')];
  const rows = rockReview.map(r => [r.rock, r.owner, r.due || '', r.status]);
  blocks.push(buildTable(['Rock', 'Owner', 'Due', 'Status'], rows));
  return blocks;
}

function buildTodoReviewSection(todoReview) {
  const blocks = [buildDivider(), buildHeading(2, 'TO-DO LIST REVIEW')];
  const rows = todoReview.items.map(t => [t.todo, t.owner, t.status]);
  blocks.push(buildTable(['To-Do', 'Owner', 'Status'], rows));
  if (todoReview.completion_rate) {
    blocks.push(buildCallout(`Completion Rate: ${todoReview.completion_rate}`, '📈'));
  }
  return blocks;
}

function buildHeadlinesSection(headlines) {
  const blocks = [buildDivider(), buildHeading(2, 'CUSTOMER/EMPLOYEE HEADLINES')];
  for (const h of headlines) {
    const prefix = h.type ? `[${h.type}] ` : '';
    const suffix = h.dropped_to_issues ? ' → Dropped to Issues List' : '';
    blocks.push({
      object: 'block', type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: [richText(`${prefix}${h.headline}${suffix}`)] }
    });
  }
  return blocks;
}

function buildIDSSection(idsIssues) {
  const blocks = [buildDivider(), buildHeading(1, 'IDS — IDENTIFY, DISCUSS, SOLVE')];
  idsIssues.forEach((issue, i) => {
    blocks.push(buildHeading(2, `Issue ${i + 1}: ${issue.title}`));
    blocks.push(buildParagraph([{ text: 'Issue: ', bold: true }, { text: issue.issue }]));
    if (issue.root_cause) {
      blocks.push(buildParagraph([{ text: 'Root Cause: ', bold: true }, { text: issue.root_cause }]));
    }
    if (issue.discussion_summary) {
      blocks.push(buildParagraph([{ text: 'Discussion Summary: ', bold: true }, { text: issue.discussion_summary }]));
    }
    blocks.push(buildParagraph([{ text: 'Solution: ', bold: true }, { text: issue.solution }]));
  });
  return blocks;
}

function buildConcludeSection(concludeTodos) {
  const blocks = [buildDivider(), buildHeading(1, 'CONCLUDE — New To-Dos')];
  const rows = concludeTodos.map(t => [t.todo, t.owner, t.due_date, t.department || '']);
  blocks.push(buildTable(['To-Do', 'Owner', 'Due Date', 'Department'], rows));
  return blocks;
}

function buildCascadingMessagesSection(messages) {
  const blocks = [buildDivider(), buildHeading(1, 'CASCADING MESSAGES')];
  const rows = messages.map(m => [m.message, m.who_communicates || '', m.to_whom || '']);
  blocks.push(buildTable(['Message', 'Who Communicates', 'To Whom'], rows));
  return blocks;
}

function buildNextMeetingSection(nextMeeting) {
  const blocks = [buildDivider(), buildHeading(1, 'NEXT MEETING')];
  const parts = [];
  if (nextMeeting.date) parts.push(`Date: ${nextMeeting.date}`);
  if (nextMeeting.time) parts.push(`Time: ${nextMeeting.time}`);
  if (nextMeeting.location) parts.push(`Location: ${nextMeeting.location}`);
  blocks.push(buildParagraph(parts.join(' | ')));
  return blocks;
}

function buildMeetingRatingSection(meetingRating) {
  const blocks = [buildDivider(), buildHeading(2, 'MEETING RATING')];
  const rows = meetingRating.ratings.map(r => [r.attendee, r.rating === 0 || r.rating === 'To be submitted' ? 'To be submitted' : String(r.rating)]);
  blocks.push(buildTable(['Attendee', 'Rating (1\u201310)'], rows));
  blocks.push(buildParagraph([{ text: 'Target Average: 8+', bold: true }]));
  if (meetingRating.average != null && meetingRating.average > 0) {
    blocks.push(buildCallout(`Average Rating: ${meetingRating.average}/10`, '⭐'));
  }
  return blocks;
}

function buildEndFooter(orgName) {
  const label = orgName || 'Fuel Core Solutions';
  return [
    buildDivider(),
    buildParagraph([{ text: `End of Meeting Notes \u2014 ${label}`, bold: true }])
  ];
}

// ─── Simple format (backward compatible) ────────────────────────────

function buildSimpleNoteBlocks(overview, actionItems, keyPoints) {
  const blocks = [];
  if (overview) {
    blocks.push(buildHeading(2, 'Overview'));
    blocks.push(buildParagraph(overview));
  }
  if (actionItems?.length > 0) {
    blocks.push(buildHeading(2, 'Action Items'));
    for (const item of actionItems) {
      blocks.push({
        object: 'block', type: 'to_do',
        to_do: { rich_text: [richText(item)], checked: false }
      });
    }
  }
  if (keyPoints?.length > 0) {
    blocks.push(buildHeading(2, 'Key Points'));
    for (const point of keyPoints) {
      blocks.push({
        object: 'block', type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [richText(point)] }
      });
    }
  }
  return blocks;
}

// ─── Create Meeting Note Route ──────────────────────────────────────

router.post('/notes', async (req, res) => {
  try {
    const {
      title, date, duration_seconds, meeting_type, project_id,
      meeting_info, segue, scorecard, rock_review, todo_review,
      headlines, ids_issues, conclude_todos, cascading_messages,
      next_meeting, meeting_rating,
      overview, action_items, key_points,
      people_ids, department_ids, organization_name
    } = req.body;

    const children = [];

    // Detect structured vs simple format — use structured for ANY meeting type if structured fields are present
    const hasStructuredSections = (
      segue || scorecard || rock_review || todo_review ||
      ids_issues || conclude_todos || meeting_rating || meeting_info
    );

    // ALWAYS use structured format — company header first
    children.push(...buildCompanyHeader(meeting_type, organization_name));

    if (hasStructuredSections) {
      // Structured format — rich tables, toggles, dividers
      if (meeting_info) children.push(...buildMeetingInfoSection(meeting_info, date, duration_seconds));
      if (segue?.length) children.push(...buildSegueSection(segue));
      if (scorecard?.length) children.push(...buildScorecardSection(scorecard));
      if (rock_review?.length) children.push(...buildRockReviewSection(rock_review));
      if (todo_review?.items?.length) children.push(...buildTodoReviewSection(todo_review));
      if (headlines?.length) children.push(...buildHeadlinesSection(headlines));
      if (ids_issues?.length) children.push(...buildIDSSection(ids_issues));
      if (conclude_todos?.length) children.push(...buildConcludeSection(conclude_todos));
      if (cascading_messages?.length) children.push(...buildCascadingMessagesSection(cascading_messages));
      if (next_meeting) children.push(...buildNextMeetingSection(next_meeting));
      if (meeting_rating?.ratings?.length) children.push(...buildMeetingRatingSection(meeting_rating));
    } else {
      // Fallback: still use structured layout even for simple data
      if (overview) {
        children.push(buildDivider());
        children.push(buildHeading(2, 'OVERVIEW'));
        children.push(buildParagraph(overview));
      }
      if (action_items?.length > 0) {
        children.push(buildDivider());
        children.push(buildHeading(2, 'ACTION ITEMS'));
        const rows = action_items.map((item, i) => [String(i + 1), item, '']);
        children.push(buildTable(['#', 'Action Item', 'Owner'], rows));
      }
      if (key_points?.length > 0) {
        children.push(buildDivider());
        children.push(buildHeading(2, 'KEY DISCUSSION POINTS'));
        const rows = key_points.map((point, i) => [String(i + 1), point]);
        children.push(buildTable(['#', 'Key Point'], rows));
      }
    }

    // ALWAYS add end footer
    children.push(...buildEndFooter(organization_name));

    console.log(`Building meeting note with ${children.length} top-level blocks (structured: ${!!hasStructuredSections})`);

    // Meeting type emoji mapping
    const noteEmoji = {
      'L10': '🔟', 'Quarterly': '📊', 'Annual': '📅',
      'Same Page': '🤝', 'State of Company': '🏢',
      'Quarterly Conversation': '💬', 'General': '🎙️'
    };

    const properties = {
      Name: { title: [{ text: { content: title || 'Meeting Notes' } }] },
      Type: { select: { name: 'Meeting' } }
    };

    if (date) {
      properties['Note Date'] = { date: { start: date.split('T')[0] } };
    }

    if (duration_seconds) {
      properties['Duration (Seconds)'] = { number: duration_seconds };
    }

    // Support both single project_id and multi-project project_ids array
    const allProjectIds = [
      ...(req.body.project_ids || []),
      ...(project_id && !req.body.project_ids ? [project_id] : [])
    ].filter(Boolean);
    if (allProjectIds.length) {
      properties['Project'] = { relation: allProjectIds.map(id => ({ id })) };
    }

    if (people_ids?.length) {
      properties['People'] = { relation: people_ids.map(id => ({ id })) };
    }

    const result = await notion.pages.create({
      parent: { database_id: DATABASES.notes },
      icon: { type: 'emoji', emoji: noteEmoji[meeting_type] || '🎙️' },
      properties,
      children
    });

    console.log(`Created meeting note: ${title} (ID: ${result.id})`);
    res.json({ id: result.id, success: true });
  } catch (error) {
    console.error('Error creating note:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Meeting Agenda Section Builders ─────────────────────────────

function buildAgendaCompanyHeader(meetingType, orgName, subtitle) {
  const resolvedOrgName = orgName || 'FUEL CORE SOLUTIONS';
  const defaultSubtitle = EOS_MEETING_TYPES.has(meetingType) ? 'EOS / Traction Framework' : null;
  const resolvedSubtitle = subtitle !== undefined ? subtitle : defaultSubtitle;
  const typeLabels = {
    'L10': 'Level 10 Meeting Agenda',
    'Quarterly': 'Quarterly Meeting Agenda',
    'Annual': 'Annual Planning Agenda',
    'Same Page': 'Same Page Meeting Agenda',
    'State of Company': 'State of the Company Agenda',
    'Quarterly Conversation': 'Quarterly Conversation Agenda',
    'Other': 'Meeting Agenda',
    'General': 'Meeting Agenda'
  };
  const blocks = [
    buildHeading(1, resolvedOrgName),
    buildParagraph([
      { text: typeLabels[meetingType] || 'Meeting Agenda', bold: false }
    ])
  ];
  if (resolvedSubtitle) {
    blocks.push(buildParagraph([{ text: resolvedSubtitle, bold: false }]));
  }
  blocks.push(buildDivider());
  return blocks;
}

function buildAgendaInfoSection(meetingDate, durationMinutes, location, facilitator, attendees) {
  const blocks = [buildHeading(2, 'MEETING INFORMATION')];
  const rows = [];
  if (meetingDate) rows.push(['Date', meetingDate]);
  if (durationMinutes) rows.push(['Duration', `${durationMinutes} minutes`]);
  if (location) rows.push(['Location', location]);
  if (facilitator) rows.push(['Facilitator', facilitator]);
  if (attendees?.length) rows.push(['Attendees', attendees.join(', ')]);
  if (rows.length) blocks.push(buildTable(['Field', 'Details'], rows));
  return blocks;
}

function buildAgendaL10Segments(rocks, issues, agendaItems) {
  const blocks = [];

  // L10 intro description
  blocks.push(buildDivider());
  blocks.push(buildParagraph([{
    text: 'The EOS (Entrepreneurial Operating System) Level 10 Meeting™ is a 90-minute weekly, structured agenda designed to foster accountability, tackle issues, and ensure team alignment. Key sections include a 5-minute Segue (personal/professional wins), Scorecard and Rock (priorities) reviews, Headlines, To-Do list, 60-minute IDS (Identify, Discuss, Solve), and a 5-minute wrap-up/rating.',
    bold: false
  }]));

  // 1. Segue
  blocks.push(buildDivider());
  blocks.push(buildHeading(2, '1. SEGUE — 5 minutes'));
  blocks.push(buildParagraph([{ text: 'Personal and professional bests to get everyone focused and connected.', bold: false }]));

  // 2. Scorecard Review
  blocks.push(buildDivider());
  blocks.push(buildHeading(2, '2. SCORECARD REVIEW — 5 minutes'));
  blocks.push(buildParagraph([{ text: 'Review 5–15 high-level, weekly measurables.', bold: false }]));

  // 3. Rock Review
  blocks.push(buildDivider());
  blocks.push(buildHeading(2, '3. ROCK REVIEW — 5 minutes'));
  blocks.push(buildParagraph([{ text: 'Update on quarterly priorities (on track/off track).', bold: false }]));
  if (rocks?.length > 0) {
    const rows = rocks.map((r, i) => [String(i + 1), r, '☐ On Track  /  ☐ Off Track']);
    blocks.push(buildTable(['#', 'Rock / 90-Day Priority', 'Status'], rows));
  }

  // 4. Customer / Employee Headlines
  blocks.push(buildDivider());
  blocks.push(buildHeading(2, '4. CUSTOMER / EMPLOYEE HEADLINES — 5 minutes'));
  blocks.push(buildParagraph([{ text: 'Brief updates on crucial feedback.', bold: false }]));

  // 5. To-Do List Review
  blocks.push(buildDivider());
  blocks.push(buildHeading(2, '5. TO-DO LIST REVIEW — 5 minutes'));
  blocks.push(buildParagraph([{ text: "Review previous week's tasks (aiming for 90%+ completion).", bold: false }]));
  if (agendaItems?.length > 0) {
    const rows = agendaItems.map((item, i) => [String(i + 1), item, '☐ Done  /  ☐ Not Done']);
    blocks.push(buildTable(['#', 'To-Do / Carry-Over Item', 'Status'], rows));
  }

  // 6. IDS — Identify, Discuss, Solve
  blocks.push(buildDivider());
  blocks.push(buildHeading(2, '6. IDS (IDENTIFY, DISCUSS, SOLVE) — 60 minutes'));
  blocks.push(buildParagraph([{ text: 'The core of the meeting. Tackle issues on the list, finding root causes and actionable solutions.', bold: false }]));
  if (issues?.length > 0) {
    const rows = issues.map((issue, i) => [String(i + 1), issue, '']);
    blocks.push(buildTable(['#', 'Issue for Discussion', 'Solution / Owner'], rows));
  }

  // 7. Conclude
  blocks.push(buildDivider());
  blocks.push(buildHeading(2, '7. CONCLUDE — 5 minutes'));
  blocks.push(buildParagraph([{ text: 'Recap action items, determine "cascading messages" for the company, and rate the meeting.', bold: false }]));

  // Key Principles
  blocks.push(buildDivider());
  blocks.push(buildHeading(2, 'KEY PRINCIPLES FOR SUCCESS'));
  const principles = [
    ['Same Time / Day', 'Run at the same time every week to create a consistent rhythm'],
    ['No Reporting / Updates', 'The first 30 minutes are for exceptions only, not detailed updates'],
    ['90-Minute Limit', 'Strict timekeeping ensures efficiency'],
    ['Rating', 'Participants rate the meeting 1–10 to ensure it is effective']
  ];
  blocks.push(buildTable(['Principle', 'Why It Matters'], principles));

  return blocks;
}

function buildAgendaEndFooter(orgName) {
  const label = orgName || 'Fuel Core Solutions';
  return [
    buildDivider(),
    buildParagraph([{ text: `End of Meeting Agenda — ${label}`, bold: true }])
  ];
}

// Create a meeting agenda (EOS/Traction format — structured)
router.post('/agendas', async (req, res) => {
  try {
    const {
      title,
      meeting_date,
      meeting_type,
      duration_minutes,
      location,
      facilitator,
      attendees,
      rocks_to_review,
      known_issues,
      agenda_items,
      project_id,
      organization_name
    } = req.body;

    const children = [];

    // Company branding header
    children.push(...buildAgendaCompanyHeader(meeting_type, organization_name));

    // Meeting information table
    children.push(...buildAgendaInfoSection(meeting_date, duration_minutes, location, facilitator, attendees));

    // L10 — full structured format with rocks, issues, and to-dos embedded per section
    if (meeting_type === 'L10') {
      children.push(...buildAgendaL10Segments(rocks_to_review, known_issues, agenda_items));
    } else {
      // Non-L10: generic sections for rocks, issues, items
      if (rocks_to_review?.length > 0) {
        children.push(buildDivider(), buildHeading(2, 'ROCKS TO REVIEW — 90-Day Priorities'));
        const rows = rocks_to_review.map((r, i) => [String(i + 1), r, 'On Track / Off Track']);
        children.push(buildTable(['#', 'Rock', 'Status'], rows));
      }
      if (known_issues?.length > 0) {
        children.push(buildDivider(), buildHeading(2, 'ISSUES FOR IDS'));
        const rows = known_issues.map((issue, i) => [String(i + 1), issue, 'To be discussed']);
        children.push(buildTable(['#', 'Issue', 'Solution / Owner'], rows));
      }
      if (agenda_items?.length > 0) {
        children.push(buildDivider(), buildHeading(2, 'AGENDA ITEMS'));
        const rows = agenda_items.map((item, i) => [String(i + 1), item, '']);
        children.push(buildTable(['#', 'Item', 'Notes'], rows));
      }
    }

    // End footer
    children.push(...buildAgendaEndFooter(organization_name));

    console.log(`Building meeting agenda with ${children.length} top-level blocks`);

    // Meeting type emoji mapping
    const typeEmoji = {
      'L10': '🔟',
      'Quarterly': '📊',
      'Annual': '📅',
      'Same Page': '🤝',
      'State of Company': '🏢',
      'Quarterly Conversation': '💬',
      'Other': '📋'
    };

    const properties = {
      Name: { title: [{ text: { content: title || 'Meeting Agenda' } }] },
      Type: { select: { name: 'Agenda' } }
    };

    if (meeting_date) {
      properties['Note Date'] = { date: { start: meeting_date } };
    }

    if (duration_minutes) {
      properties['Duration (Seconds)'] = { number: duration_minutes * 60 };
    }

    if (project_id) {
      properties['Project'] = { relation: [{ id: project_id }] };
    }

    const result = await notion.pages.create({
      parent: { database_id: DATABASES.notes },
      icon: { type: 'emoji', emoji: typeEmoji[meeting_type] || '📋' },
      properties,
      children
    });

    console.log(`Created meeting agenda: ${title} for ${meeting_date} (ID: ${result.id})`);
    res.json({ id: result.id, success: true });
  } catch (error) {
    console.error('Error creating agenda:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Transcript Storage ───────────────────────────────────────────

function formatTimestamp(seconds) {
  if (!seconds && seconds !== 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function buildTranscriptBlocks(sentences, transcriptUrl) {
  const blocks = [];

  // Header
  blocks.push(buildHeading(2, '📄 FULL TRANSCRIPT'));
  if (transcriptUrl) {
    blocks.push({
      object: 'block', type: 'paragraph',
      paragraph: {
        rich_text: [
          richText('View on Fireflies: '),
          { type: 'text', text: { content: transcriptUrl, link: { url: transcriptUrl } } }
        ]
      }
    });
  }
  blocks.push(buildDivider());

  // Group sentences into segments of ~30 per block
  const CHUNK = 30;
  for (let i = 0; i < sentences.length; i += CHUNK) {
    const group = sentences.slice(i, i + CHUNK);
    const lines = group.map(s => {
      const ts = formatTimestamp(s.start_time ?? s.raw_start_time ?? null);
      const speaker = s.speaker_name || '';
      const prefix = ts && speaker ? `[${ts}] ${speaker}: `
                   : ts            ? `[${ts}] `
                   : speaker       ? `${speaker}: `
                   : '';
      return prefix + (s.text || '').trim();
    });
    const content = lines.join('\n');
    // Notion paragraph text has a 2000 char limit — further split if needed
    for (let j = 0; j < content.length; j += 1900) {
      blocks.push(buildParagraph([{ text: content.slice(j, j + 1900), bold: false }]));
    }
  }

  return blocks;
}

// POST /api/notes/:id/transcript — append transcript as child page inside meeting note
router.post('/notes/:id/transcript', async (req, res) => {
  try {
    const noteId = req.params.id;
    const { sentences = [], transcript_url } = req.body;

    if (!sentences.length) {
      return res.status(400).json({ error: 'sentences array is required and must not be empty' });
    }

    // 1. Create child page inside the meeting note
    const childPage = await notion.pages.create({
      parent: { page_id: noteId },
      icon: { type: 'emoji', emoji: '📄' },
      properties: {
        title: { title: [{ text: { content: '📄 Full Transcript' } }] }
      }
    });

    const childPageId = childPage.id;

    // 2. Build transcript blocks
    const allBlocks = buildTranscriptBlocks(sentences, transcript_url);

    // 3. Append in batches of 100 (Notion API limit)
    const BATCH = 100;
    for (let i = 0; i < allBlocks.length; i += BATCH) {
      await notion.blocks.children.append({
        block_id: childPageId,
        children: allBlocks.slice(i, i + BATCH)
      });
    }

    console.log(`Appended transcript (${sentences.length} sentences, ${allBlocks.length} blocks) to note ${noteId}`);
    res.json({ success: true, child_page_id: childPageId, blocks_written: allBlocks.length });
  } catch (error) {
    console.error('Error appending transcript:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
