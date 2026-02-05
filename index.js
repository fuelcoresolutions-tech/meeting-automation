import { createProject, createTask } from './notion.js';

async function main() {
  try {
    // Create a new project
    // Available status options: Planned, On Hold, Doing, Ongoing, Done
    console.log('Creating a new project...\n');
    const project = await createProject({
      name: 'API Integration Project',
      status: 'Doing',
      description: 'Project to integrate various APIs into the FuelCore application.'
    });

    console.log('\n-----------------------------------\n');

    // Create a task linked to the project
    // Status options: To Do, Doing, Done
    // Priority options: Low, Medium, High
    console.log('Creating a new task...\n');
    await createTask({
      name: 'Set up Notion API endpoints',
      status: 'To Do',
      priority: 'High',
      dueDate: new Date().toISOString().split('T')[0],
      projectId: project.id,
      description: 'Configure the Notion API integration to manage projects and tasks programmatically.'
    });

    console.log('\n-----------------------------------\n');
    console.log('Both project and task created successfully!');

  } catch (error) {
    console.error('An error occurred:', error);
  }
}

main();
