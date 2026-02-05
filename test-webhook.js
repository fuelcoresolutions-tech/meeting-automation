import crypto from 'crypto';
import axios from 'axios';

const WEBHOOK_SECRET = '8c4b28f1dd2e4a618d7a88450e01b4e';
const WEBHOOK_URL = 'https://meeting-automation-production.up.railway.app/webhook/fireflies';

// Test payload
const payload = {
  eventType: 'Transcription completed',
  meetingId: '01KGQJ3KSC8240EWJFQSJ5G2EE'
};

// Generate signature
const signature = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(JSON.stringify(payload))
  .digest('hex');

console.log('🔐 Generated Signature:', signature);
console.log('📝 Payload:', JSON.stringify(payload));

// Send request with signature
axios.post(WEBHOOK_URL, payload, {
  headers: {
    'Content-Type': 'application/json',
    'x-hub-signature': signature
  }
})
.then(response => {
  console.log('✅ Success:', response.data);
})
.catch(error => {
  console.error('❌ Error:', error.response?.data || error.message);
});
