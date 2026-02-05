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

// Create a meeting note
router.post('/notes', async (req, res) => {
  try {
    const { title, date, duration_seconds, overview, action_items, key_points, project_id } = req.body;

    const children = [];

    // Add overview
    if (overview) {
      children.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: 'Overview' } }] }
      });
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: overview } }] }
      });
    }

    // Add action items
    if (action_items?.length > 0) {
      children.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: 'Action Items' } }] }
      });
      for (const item of action_items) {
        children.push({
          object: 'block',
          type: 'to_do',
          to_do: { rich_text: [{ type: 'text', text: { content: item } }], checked: false }
        });
      }
    }

    // Add key points
    if (key_points?.length > 0) {
      children.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: 'Key Points' } }] }
      });
      for (const point of key_points) {
        children.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: [{ type: 'text', text: { content: point } }] }
        });
      }
    }

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
      icon: { type: 'emoji', emoji: '🎙️' },
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
