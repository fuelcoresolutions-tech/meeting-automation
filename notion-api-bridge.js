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

export default router;
