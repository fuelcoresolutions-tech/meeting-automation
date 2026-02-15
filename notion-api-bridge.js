import express from 'express';
import { createProject, createTask, getProjects, getTasks, notion, DATABASES } from './notion.js';

const router = express.Router();

// Get all projects
router.get('/projects', async (req, res) => {
  try {
    const projects = await getProjects();
    const formatted = projects.map(p => ({
      id: p.id,
      name: p.properties.Name?.title?.[0]?.plain_text || 'Untitled',
      status: p.properties.Status?.status?.name || 'Unknown'
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

function buildCompanyHeader(meetingType) {
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
  return [
    buildHeading(1, 'FUEL CORE SOLUTIONS'),
    buildParagraph([
      { text: typeLabels[meetingType] || 'Meeting Notes', bold: false }
    ]),
    buildParagraph([
      { text: 'EOS / Traction Framework', bold: false }
    ]),
    buildDivider()
  ];
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

function buildEndFooter() {
  return [
    buildDivider(),
    buildParagraph([{ text: 'End of Meeting Notes \u2014 Fuel Core Solutions', bold: true }])
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
      overview, action_items, key_points
    } = req.body;

    const children = [];

    // Detect structured vs simple format — use structured for ANY meeting type if structured fields are present
    const hasStructuredSections = (
      segue || scorecard || rock_review || todo_review ||
      ids_issues || conclude_todos || meeting_rating || meeting_info
    );

    if (hasStructuredSections) {
      // Company branding header
      children.push(...buildCompanyHeader(meeting_type));
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
      // End footer
      children.push(...buildEndFooter());
    } else {
      // Simple format (backward compatible)
      children.push(...buildSimpleNoteBlocks(overview, action_items, key_points));
    }

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

    if (project_id) {
      properties['Project'] = { relation: [{ id: project_id }] };
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

// Create a meeting agenda (EOS/Traction format)
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
      project_id
    } = req.body;

    const children = [];

    // Meeting Details Section
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: 'Meeting Details' } }] }
    });

    const detailsText = [
      `📅 Date: ${meeting_date}`,
      `⏱️ Duration: ${duration_minutes || 90} minutes`,
      location ? `📍 Location: ${location}` : null,
      facilitator ? `👤 Facilitator: ${facilitator}` : null
    ].filter(Boolean).join('\n');

    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: detailsText } }] }
    });

    // Attendees Section
    if (attendees?.length > 0) {
      children.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: 'Attendees' } }] }
      });
      for (const attendee of attendees) {
        children.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: [{ type: 'text', text: { content: attendee } }] }
        });
      }
    }

    // Add L10 Meeting Structure if applicable
    if (meeting_type === 'L10') {
      children.push({
        object: 'block',
        type: 'divider',
        divider: {}
      });
      children.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: 'L10 Meeting Agenda' } }] }
      });

      // Standard L10 segments
      const l10Segments = [
        { time: '5 min', name: 'Segue', desc: 'Share personal and professional good news' },
        { time: '5 min', name: 'Scorecard Review', desc: 'Review weekly metrics - on/off track' },
        { time: '5 min', name: 'Rock Review', desc: 'Review quarterly priorities - on/off track' },
        { time: '5 min', name: 'Customer/Employee Headlines', desc: 'Notable news and updates' },
        { time: '5 min', name: 'To-Do Review', desc: 'Review last week\'s to-dos - done/not done' },
        { time: '60 min', name: 'IDS (Identify, Discuss, Solve)', desc: 'Work through issues list' },
        { time: '5 min', name: 'Conclude', desc: 'Recap to-dos, cascading messages, rate 1-10' }
      ];

      for (const segment of l10Segments) {
        children.push({
          object: 'block',
          type: 'toggle',
          toggle: {
            rich_text: [{ type: 'text', text: { content: `${segment.time} - ${segment.name}` } }],
            children: [{
              object: 'block',
              type: 'paragraph',
              paragraph: { rich_text: [{ type: 'text', text: { content: segment.desc } }] }
            }]
          }
        });
      }
    }

    // Rocks to Review Section
    if (rocks_to_review?.length > 0) {
      children.push({
        object: 'block',
        type: 'divider',
        divider: {}
      });
      children.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: '🪨 Rocks to Review' } }] }
      });
      for (const rock of rocks_to_review) {
        children.push({
          object: 'block',
          type: 'to_do',
          to_do: { rich_text: [{ type: 'text', text: { content: rock } }], checked: false }
        });
      }
    }

    // Known Issues for IDS Section
    if (known_issues?.length > 0) {
      children.push({
        object: 'block',
        type: 'divider',
        divider: {}
      });
      children.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: '⚠️ Issues for IDS' } }] }
      });
      for (const issue of known_issues) {
        children.push({
          object: 'block',
          type: 'numbered_list_item',
          numbered_list_item: { rich_text: [{ type: 'text', text: { content: issue } }] }
        });
      }
    }

    // Custom Agenda Items Section
    if (agenda_items?.length > 0) {
      children.push({
        object: 'block',
        type: 'divider',
        divider: {}
      });
      children.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: 'Agenda Items' } }] }
      });
      for (const item of agenda_items) {
        children.push({
          object: 'block',
          type: 'to_do',
          to_do: { rich_text: [{ type: 'text', text: { content: item } }], checked: false }
        });
      }
    }

    // Meeting type emoji mapping
    const typeEmoji = {
      'L10': '🔟',
      'Quarterly': '📊',
      'Annual': '📅',
      'Same Page': '🤝',
      'State of Company': '🏢',
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

export default router;
