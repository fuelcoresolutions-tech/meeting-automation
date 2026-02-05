import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const FIREFLY_API_KEY = process.env.FIREFLY_API_KEY;
const MEETING_ID = '01KGQJ3KSC8240EWJFQSJ5G2EE';

async function getTranscript(meetingId) {
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
      console.error('GraphQL errors:', JSON.stringify(response.data.errors, null, 2));
      return null;
    }

    return response.data.data.transcript;
  } catch (error) {
    console.error('Error fetching transcript:', error.message);
    return null;
  }
}

async function main() {
  console.log('🔍 Fetching transcript details...\n');
  
  const transcript = await getTranscript(MEETING_ID);
  
  if (!transcript) {
    console.log('❌ Transcript not found');
    return;
  }

  console.log('✅ Transcript found:\n');
  console.log(JSON.stringify(transcript, null, 2));
  
  // Check what the agent expects
  console.log('\n\n📋 Checking data structure...');
  console.log(`ID: ${transcript.id ? '✅' : '❌'} ${transcript.id}`);
  console.log(`Title: ${transcript.title ? '✅' : '❌'} ${transcript.title}`);
  console.log(`Date: ${transcript.date ? '✅' : '❌'} ${transcript.date}`);
  console.log(`Duration: ${transcript.duration !== undefined ? '✅' : '❌'} ${transcript.duration}`);
  console.log(`Summary: ${transcript.summary ? '✅' : '❌'}`);
  console.log(`Sentences: ${transcript.sentences ? '✅' : '❌'} (${transcript.sentences?.length || 0} sentences)`);
}

main();
