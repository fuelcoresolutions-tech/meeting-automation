import axios from 'axios';

const NOTION_API_BASE = 'http://127.0.0.1:3000';

async function fixMeetingIssues() {
  console.log('🔧 Fixing meeting transcription issues...\n');
  
  try {
    // Get all unprocessed meetings
    const response = await axios.get(`${NOTION_API_BASE}/api/meeting-register`);
    const meetings = response.data || [];
    
    const unprocessed = meetings.filter(m => m.processingStatus !== 'Completed');
    console.log(`Found ${unprocessed.length} unprocessed meetings\n`);
    
    // Issue 1: Reset retry count for rate-limited meetings
    const rateLimited = unprocessed.filter(m => 
      m.retryCount > 100 && m.lastErrorMessage?.includes('Too many requests')
    );
    
    console.log(`🔄 Resetting ${rateLimited.length} rate-limited meetings:`);
    for (const meeting of rateLimited) {
      try {
        await axios.patch(`${NOTION_API_BASE}/api/meeting-register/${meeting.id}`, {
          retryCount: 0,
          processingStatus: 'Pending',
          nextRetryAt: new Date().toISOString(),
          lastErrorMessage: '',
          lastErrorCode: ''
        });
        console.log(`  ✅ Reset: ${meeting.title} (${meeting.retryCount} → 0 retries)`);
      } catch (error) {
        console.log(`  ❌ Failed to reset ${meeting.title}: ${error.message}`);
      }
    }
    
    // Issue 2: Extract externalMeetingId from transcriptSource for meetings without it
    const missingIds = unprocessed.filter(m => 
      !m.externalMeetingId && m.transcriptSource?.includes('fireflies.ai/view/')
    );
    
    console.log(`\n🆔 Extracting External IDs for ${missingIds.length} meetings:`);
    for (const meeting of missingIds) {
      try {
        const match = meeting.transcriptSource.match(/\/view\/([A-Z0-9]+)/);
        const externalId = match ? match[1] : '';
        
        if (externalId) {
          await axios.patch(`${NOTION_API_BASE}/api/meeting-register/${meeting.id}`, {
            externalMeetingId: externalId,
            processingStatus: 'Pending',
            retryCount: 0,
            nextRetryAt: new Date().toISOString(),
            retrySource: 'fix_external_id_apr2026'
          });
          console.log(`  ✅ Added ID: ${meeting.title} → ${externalId}`);
        } else {
          console.log(`  ⚠️ Could not extract ID from: ${meeting.transcriptSource}`);
        }
      } catch (error) {
        console.log(`  ❌ Failed to update ${meeting.title}: ${error.message}`);
      }
    }
    
    // Issue 3: Reset Speaker Review meetings to Pending
    const speakerReview = unprocessed.filter(m => m.processingStatus === 'Speaker Review');
    
    console.log(`\n🔄 Converting ${speakerReview.length} Speaker Review meetings to Pending:`);
    for (const meeting of speakerReview) {
      try {
        await axios.patch(`${NOTION_API_BASE}/api/meeting-register/${meeting.id}`, {
          processingStatus: 'Pending',
          retryCount: 0,
          nextRetryAt: new Date().toISOString(),
          retrySource: 'speaker_review_fix_apr2026'
        });
        console.log(`  ✅ Converted: ${meeting.title}`);
      } catch (error) {
        console.log(`  ❌ Failed to convert ${meeting.title}: ${error.message}`);
      }
    }
    
    console.log('\n🎯 Summary:');
    console.log(`  - Rate-limited meetings reset: ${rateLimited.length}`);
    console.log(`  - External IDs added: ${missingIds.length}`);
    console.log(`  - Speaker Review meetings converted: ${speakerReview.length}`);
    
  } catch (error) {
    console.error('❌ Error fixing meetings:', error.message);
  }
}

fixMeetingIssues();
