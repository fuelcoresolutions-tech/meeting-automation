# Backfill Procedure - Emergency Recovery

## When to Use This Procedure
Use this only when:
- System was down for extended period (days+)
- API credits expired and meetings were lost
- Migration from old system to new retry system
- Payment gaps longer than 24 hours

## Quick Backfill Commands

### Step 1: Find Stuck Meetings
```bash
curl -X GET http://127.0.0.1:3000/api/meeting-register | jq '.[] | select(.processingStatus == "Speaker Review" or .processingStatus == "Not started" or .processingStatus == "Pending") | select(.externalMeetingId == "") | select(.transcriptSource | contains("fireflies.ai")) | {id: .id, title: .title, meetingDate: .meetingDate, transcriptSource: .transcriptSource}'
```

### Step 2: Create Backfill Script
Create temporary script with stuck meetings:
```javascript
// stuck-meetings.js
import axios from 'axios';

const stuckMeetings = [
  // Paste results from Step 1 here
];

function extractFirefliesId(url) {
  const match = url.match(/\/view\/([A-Z0-9]+)/);
  return match ? match[1] : '';
}

async function backfillMeeting(meeting) {
  const externalMeetingId = extractFirefliesId(meeting.transcriptSource);
  const updateData = {
    externalMeetingId: externalMeetingId,
    processingStatus: "Pending",
    retryCount: 0,
    nextRetryAt: new Date().toISOString(),
    retrySource: "emergency_backfill"
  };
  
  await axios.patch(
    `http://127.0.0.1:3000/api/meeting-register/${meeting.id}`,
    updateData
  );
}

// Process all meetings
for (const meeting of stuckMeetings) {
  await backfillMeeting(meeting);
}
```

### Step 3: Execute Backfill
```bash
node stuck-meetings.js
curl -X POST http://127.0.0.1:8000/worker/retry-pending-now
```

### Step 4: Clean Up
```bash
rm stuck-meetings.js
```

## Production Safety Rules

### NEVER in Production:
- Don't leave backfill scripts in main repo
- Don't commit temporary backfill files
- Don't use "backfill_apr_2026" as retry source in production
- Don't run backfills during business hours

### ALWAYS in Production:
- Use `retrySource: "emergency_backfill_[date]"`
- Monitor system load during backfill
- Have API credits available before backfill
- Test in staging first

## Prevention Instead of Backfill

### Better System Design:
1. **Immediate queuing**: All webhooks queue immediately
2. **Health monitoring**: Alert on stuck meetings > 12 hours
3. **Auto-requeue**: STALE_REQUEUE_HOURS handles gaps automatically
4. **API monitoring**: Alert on credit exhaustion

### Monitoring Commands:
```bash
# Check for meetings without external IDs
curl -X GET http://127.0.0.1:3000/api/meeting-register | jq '.[] | select(.externalMeetingId == "") | .title'

# Check retry queue health
curl -X GET http://127.0.0.1:3000/api/meeting-register | jq '.[] | select(.processingStatus == "Failed") | {title: .title, retryCount: .retryCount, lastError: .lastErrorMessage}'

# Check stale meetings
curl -X GET http://127.0.0.1:3000/api/meeting-register | jq '.[] | select(.processingStatus != "Completed" and (.lastAttemptAt == null or (.lastAttemptAt | fromdateiso8601) < (now - 86400))) | .title'
```

## Emergency Contacts
- System Admin: [contact]
- Notion Admin: [contact]  
- API Provider: [contact]

## Version History
- v1.0: Initial procedure (April 2026)
- v1.1: Added production safety rules
- v1.2: Added monitoring commands
