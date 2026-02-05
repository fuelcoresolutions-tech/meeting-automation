import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_KEY });

const DATABASES = {
  projects: process.env.NOTION_PROJECTS_DATABASE_ID,
  tasks: process.env.NOTION_TASKS_DATABASE_ID,
  notes: process.env.NOTION_NOTES_DATABASE_ID
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
  const { name, status, priority, dueDate, projectId, parentTaskId, description, definitionOfDone } = taskData;

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
            content: description
          }
        }
      ]
    };
  }

  if (definitionOfDone) {
    properties['Definition of Done'] = {
      rich_text: [
        {
          text: {
            content: definitionOfDone
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

  const pageData = {
    parent: {
      database_id: DATABASES.tasks
    },
    properties
  };

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

export { notion, DATABASES };
