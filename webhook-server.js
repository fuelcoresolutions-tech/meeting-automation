import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';
import { getTranscript } from './fireflies.js';
import notionApiBridge from './notion-api-bridge.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const CLAUDE_AGENT_URL = process.env.CLAUDE_AGENT_URL || 'http://localhost:8000';

// Parse JSON bodies and preserve raw body for signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Mount Notion API bridge for Claude agent to use
app.use('/api', notionApiBridge);

// Webhook secret for signature verification (optional but recommended)
const WEBHOOK_SECRET = process.env.FIREFLY_WEBHOOK_SECRET;

/**
 * Verify the webhook signature from Fireflies
 */
function verifySignature(rawBody, signature) {
  console.log('\n=== Signature Verification Debug ===');
  console.log('Webhook secret configured:', !!WEBHOOK_SECRET);
  console.log('Webhook secret (first 8 chars):', WEBHOOK_SECRET ? WEBHOOK_SECRET.substring(0, 8) + '...' : 'none');
  console.log('Webhook secret length:', WEBHOOK_SECRET ? WEBHOOK_SECRET.length : 0);

  if (!WEBHOOK_SECRET) {
    console.log('No webhook secret configured, skipping verification');
    return true;
  }

  // If no signature provided, fail verification when secret is configured
  if (!signature) {
    console.log('No signature provided in request header (x-hub-signature)');
    console.log('=== End Signature Debug ===\n');
    return false;
  }

  console.log('Received signature (raw):', signature);

  // Strip the 'sha256=' prefix if present (Fireflies sends it this way)
  const cleanSignature = signature.startsWith('sha256=') ? signature.slice(7) : signature;

  console.log('Received signature (cleaned):', cleanSignature);
  console.log('Received signature length:', cleanSignature.length);
  console.log('Raw body exists:', !!rawBody);
  console.log('Raw body length:', rawBody ? rawBody.length : 0);
  console.log('Raw body preview:', rawBody ? rawBody.substring(0, 150) + '...' : 'empty');

  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  console.log('Expected signature:', expectedSignature);
  console.log('Expected signature length:', expectedSignature.length);
  console.log('Signatures match:', cleanSignature === expectedSignature);

  // Ensure both buffers have same length before comparing
  if (cleanSignature.length !== expectedSignature.length) {
    console.log('FAILED: Length mismatch! Received:', cleanSignature.length, 'Expected:', expectedSignature.length);
    console.log('=== End Signature Debug ===\n');
    return false;
  }

  const isValid = crypto.timingSafeEqual(
    Buffer.from(cleanSignature),
    Buffer.from(expectedSignature)
  );

  console.log('Signature valid:', isValid);
  console.log('=== End Signature Debug ===\n');

  return isValid;
}

/**
 * Health check endpoint
 */
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Fireflies webhook server is running' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

/**
 * Fireflies webhook endpoint
 * Receives notifications when transcripts are completed
 */
app.post('/webhook/fireflies', async (req, res) => {
  const signature = req.headers['x-hub-signature'];
  const payload = req.body;

  console.log('\n========================================');
  console.log('Received Fireflies webhook');
  console.log('Event Type:', payload.eventType);
  console.log('Meeting ID:', payload.meetingId);
  console.log('Client Reference ID:', payload.clientReferenceId);
  console.log('========================================\n');

  // Verify signature if secret is configured
  if (WEBHOOK_SECRET && !verifySignature(req.rawBody, signature)) {
    console.error('Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Only process transcription completed events
  if (payload.eventType === 'Transcription completed') {
    try {
      // Step 1: Fetch the transcript from Fireflies
      console.log('Fetching transcript from Fireflies...');
      const transcript = await getTranscript(payload.meetingId);

      if (!transcript) {
        throw new Error('Transcript not found');
      }

      console.log(`Fetched transcript: ${transcript.title}`);

      // Step 2: Send to Claude Agent for intelligent processing
      console.log('Sending transcript to Claude Agent...');
      const agentResponse = await axios.post(
        `${CLAUDE_AGENT_URL}/process-transcript`,
        transcript,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000 // 30 second timeout for initial response
        }
      );

      console.log('Claude Agent processing started:', agentResponse.data);

      res.status(200).json({
        success: true,
        message: 'Transcript sent to Claude Agent for processing',
        meetingId: payload.meetingId,
        agentResponse: agentResponse.data
      });

    } catch (error) {
      console.error('Error processing transcript:', error.message);

      // Check if it's a connection error to Claude Agent
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        console.error('Claude Agent is not running. Please start it with: npm run agent');
        return res.status(503).json({
          error: 'Claude Agent unavailable',
          message: 'The Claude Agent service is not running. Please start it with: npm run agent'
        });
      }

      res.status(500).json({ error: 'Failed to process transcript', details: error.message });
    }
  } else {
    console.log('Ignoring event type:', payload.eventType);
    res.status(200).json({ success: true, message: 'Event acknowledged' });
  }
});

/**
 * Test endpoint to manually trigger processing
 */
app.post('/test/process-meeting', async (req, res) => {
  const { meetingId } = req.body;

  if (!meetingId) {
    return res.status(400).json({ error: 'meetingId is required' });
  }

  try {
    console.log(`Manually processing meeting: ${meetingId}`);
    const transcript = await getTranscript(meetingId);

    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    const agentResponse = await axios.post(
      `${CLAUDE_AGENT_URL}/process-transcript`,
      transcript,
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );

    res.json({
      success: true,
      transcript: { id: transcript.id, title: transcript.title },
      agentResponse: agentResponse.data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\nFireflies webhook server running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook/fireflies`);
  console.log(`Notion API bridge: http://localhost:${PORT}/api`);
  console.log(`Claude Agent URL: ${CLAUDE_AGENT_URL}`);
  console.log('\nTo expose publicly, use ngrok or deploy to a cloud service.\n');
});
