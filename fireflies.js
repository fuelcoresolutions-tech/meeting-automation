import axios from 'axios';
import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_KEY });
const FIREFLY_API_KEY = process.env.FIREFLY_API_KEY;
const NOTES_DATABASE_ID = process.env.NOTION_NOTES_DATABASE_ID;

/**
 * Fetch transcript details from Fireflies API
 */
export async function getTranscript(meetingId) {
  const query = `
    query Transcript($transcriptId: String!) {
      transcript(id: $transcriptId) {
        id
        title
        date
        duration
        organizer_email
        participants
        transcript_url
        summary {
          overview
          shorthand_bullet
          action_items
          keywords
        }
        sentences {
          speaker_name
          text
        }
      }
    }
  `;

  try {
    const response = await axios.post(
      'https://api.fireflies.ai/graphql',
      {
        query,
        variables: { transcriptId: meetingId }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FIREFLY_API_KEY}`
        }
      }
    );

    if (response.data.errors) {
      throw new Error(response.data.errors[0].message);
    }

    return response.data.data.transcript;
  } catch (error) {
    console.error('Error fetching transcript:', error.message);
    throw error;
  }
}

/**
 * Create a note in Notion with the transcript details
 */
export async function createNotionNote(transcript) {
  const { title, date, duration, summary, transcript_url } = transcript;

  // Build the page content blocks
  const children = [];

  // Add overview if available
  if (summary?.overview) {
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Overview' } }]
      }
    });
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: summary.overview } }]
      }
    });
  }

  // Add action items if available
  if (summary?.action_items && summary.action_items.length > 0) {
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Action Items' } }]
      }
    });

    for (const item of summary.action_items) {
      children.push({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: [{ type: 'text', text: { content: item } }],
          checked: false
        }
      });
    }
  }

  // Add key points if available
  if (summary?.shorthand_bullet && summary.shorthand_bullet.length > 0) {
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Key Points' } }]
      }
    });

    for (const point of summary.shorthand_bullet) {
      children.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: point } }]
        }
      });
    }
  }

  // Add transcript link
  if (transcript_url) {
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Full Transcript' } }]
      }
    });
    children.push({
      object: 'block',
      type: 'bookmark',
      bookmark: {
        url: transcript_url
      }
    });
  }

  // Create the Notion page
  const pageData = {
    parent: {
      database_id: NOTES_DATABASE_ID
    },
    icon: {
      type: 'emoji',
      emoji: '🎙️'
    },
    properties: {
      Name: {
        title: [
          {
            text: {
              content: title || 'Meeting Transcript'
            }
          }
        ]
      },
      Type: {
        select: {
          name: 'Meeting'
        }
      }
    },
    children
  };

  // Add date if available
  if (date) {
    pageData.properties['Note Date'] = {
      date: {
        start: new Date(date).toISOString().split('T')[0]
      }
    };
  }

  // Add duration if available
  if (duration) {
    pageData.properties['Duration (Seconds)'] = {
      number: duration
    };
  }

  try {
    const response = await notion.pages.create(pageData);
    console.log(`Note "${title}" created in Notion!`);
    console.log(`Page ID: ${response.id}`);
    return response;
  } catch (error) {
    console.error('Error creating Notion note:', error.message);
    throw error;
  }
}

/**
 * Main function: Fetch transcript and create Notion note
 */
export async function fetchTranscriptAndCreateNote(meetingId) {
  console.log(`Fetching transcript for meeting: ${meetingId}`);

  const transcript = await getTranscript(meetingId);

  if (!transcript) {
    throw new Error('Transcript not found');
  }

  console.log(`Creating Notion note for: ${transcript.title}`);

  const note = await createNotionNote(transcript);

  return note;
}
