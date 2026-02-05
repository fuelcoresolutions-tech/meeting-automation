import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const FIREFLY_API_KEY = process.env.FIREFLY_API_KEY;

async function getTranscripts() {
  const query = `
    query Transcripts($limit: Int) {
      transcripts(limit: $limit) {
        id
        title
        date
        duration
        participants
      }
    }
  `;

  try {
    const response = await axios.post(
      'https://api.fireflies.ai/graphql',
      {
        query,
        variables: { limit: 10 }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FIREFLY_API_KEY}`
        }
      }
    );

    if (response.data.errors) {
      console.error('GraphQL errors:', response.data.errors);
      return null;
    }

    return response.data.data.transcripts;
  } catch (error) {
    console.error('Error fetching transcripts:', error.message);
    return null;
  }
}

async function main() {
  console.log('🔍 Fetching your Fireflies transcripts...\n');
  
  const transcripts = await getTranscripts();
  
  if (!transcripts || transcripts.length === 0) {
    console.log('❌ No transcripts found. Please upload a recording to Fireflies first.');
    return;
  }

  console.log(`✅ Found ${transcripts.length} transcripts:\n`);
  
  transcripts.forEach((t, i) => {
    console.log(`${i + 1}. ${t.title}`);
    console.log(`   ID: ${t.id}`);
    console.log(`   Date: ${new Date(t.date).toLocaleString()}`);
    console.log(`   Duration: ${Math.round(t.duration / 60)} minutes`);
    console.log(`   Participants: ${t.participants?.length || 0}`);
    console.log('');
  });

  console.log('\n📝 To test the webhook, use one of these meeting IDs:');
  console.log(`   node test-webhook.js <meeting-id>`);
}

main();
