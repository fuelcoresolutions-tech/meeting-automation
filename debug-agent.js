import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const FIREFLY_API_KEY = process.env.FIREFLY_API_KEY;
const MEETING_ID = '01KGQJ3KSC8240EWJFQSJ5G2EE';
const AGENT_URL = 'https://meeting-automation-production.up.railway.app';

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

  const response = await axios.post(
    'https://api.fireflies.ai/graphql',
    { query, variables: { transcriptId: meetingId } },
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

  const transcript = response.data.data.transcript;
  
  // Convert timestamp to ISO date string if needed
  if (transcript.date && typeof transcript.date === 'number') {
    transcript.date = new Date(transcript.date).toISOString();
  }

  return transcript;
}

async function main() {
  try {
    console.log('🔍 Fetching transcript...');
    const transcript = await getTranscript(MEETING_ID);
    
    console.log('\n📋 Transcript data being sent to agent:');
    console.log(JSON.stringify(transcript, null, 2));

    console.log('\n🚀 Sending to agent...');
    
    try {
      const response = await axios.post(
        `${AGENT_URL}/process-transcript`,
        transcript,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 60000
        }
      );
      
      console.log('✅ Success!');
      console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
      if (error.response) {
        console.error('❌ Agent Error:');
        console.error('Status:', error.response.status);
        console.error('Data:', JSON.stringify(error.response.data, null, 2));
      } else {
        console.error('❌ Error:', error.message);
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
