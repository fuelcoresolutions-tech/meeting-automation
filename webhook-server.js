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
const ENABLE_IMMEDIATE_PROCESSING = process.env.ENABLE_IMMEDIATE_PROCESSING === 'true';

// Parse JSON bodies and preserve raw body for signature verification
// 5mb limit to accommodate large transcript payloads (1500+ sentences)
app.use(express.json({
  limit: '5mb',
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
  if (!WEBHOOK_SECRET) {
    return true;
  }

  if (!signature) {
    return false;
  }

  const cleanSignature = signature.startsWith('sha256=') ? signature.slice(7) : signature;

  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  if (cleanSignature.length !== expectedSignature.length) {
    return false;
  }

  const isValid = crypto.timingSafeEqual(
    Buffer.from(cleanSignature),
    Buffer.from(expectedSignature)
  );

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

  if (WEBHOOK_SECRET && !verifySignature(req.rawBody, signature)) {
    console.error('Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  if (payload.eventType === 'Transcription completed') {
    try {
      console.log('Fetching transcript from Fireflies...');
      const transcript = await getTranscript(payload.meetingId);

      if (!transcript) {
        throw new Error('Transcript not found');
      }

      console.log(`Fetched transcript: ${transcript.title}`);
      // Queue-first design:
      // 1) Upsert a durable row in Meeting Register
      // 2) Let the retry worker process asynchronously
      // This prevents dropped work when API credits are temporarily unavailable.
      const meetingDate = transcript.date
        ? new Date(transcript.date).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
      // Auto-extract externalMeetingId if missing from transcriptSource
      let externalMeetingId = transcript.id || payload.meetingId;
      if (!externalMeetingId && transcript.transcript_url) {
        const match = transcript.transcript_url.match(/\/view\/([A-Z0-9]+)/);
        externalMeetingId = match ? match[1] : '';
      }
      
      const upsertPayload = {
        externalMeetingId: externalMeetingId,
        title: transcript.title || 'Untitled Meeting',
        meetingDate,
        meetingFormat: 'Virtual',
        processingStatus: 'Pending',
        transcriptSource: transcript.transcript_url || '',
        retryCount: 0,
        retrySource: 'fireflies_webhook',
        nextRetryAt: new Date().toISOString(),
        forceRerun: false,
      };
      const upsertResponse = await axios.post(
        `http://127.0.0.1:${PORT}/api/meeting-register/upsert-by-external`,
        upsertPayload,
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
      );
      console.log('Meeting queued/upserted:', upsertResponse.data);

      // Optional compatibility mode to keep prior behavior during rollout.
      // Default is OFF for durability.
      const immediateProcessing = {
        attempted: ENABLE_IMMEDIATE_PROCESSING,
        success: false,
        deferred: false,
        error: null,
      };
      if (ENABLE_IMMEDIATE_PROCESSING) {
        console.log('Immediate processing is enabled; forwarding transcript to Claude Agent...');
        try {
          await axios.post(
            `${CLAUDE_AGENT_URL}/process-transcript`,
            transcript,
            {
              headers: { 'Content-Type': 'application/json' },
              timeout: 120000
            }
          );
          immediateProcessing.success = true;
        } catch (dispatchError) {
          immediateProcessing.deferred = true;
          immediateProcessing.error = dispatchError.message;
          console.warn(
            'Immediate processing failed; meeting remains queued for durable retry worker:',
            dispatchError.message
          );
          if (upsertResponse.data?.id) {
            try {
              await axios.patch(
                `http://127.0.0.1:${PORT}/api/meeting-register/${upsertResponse.data.id}`,
                {
                  processingStatus: 'Pending',
                  nextRetryAt: new Date().toISOString(),
                  retrySource: 'immediate_processing_deferred',
                  lastErrorCode: 'IMMEDIATE_PROCESSING_DEFERRED',
                  lastErrorMessage: `Immediate processing deferred: ${dispatchError.message}`,
                },
                { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
              );
            } catch (patchError) {
              console.warn('Failed to record deferred immediate-processing state:', patchError.message);
            }
          }
        }
      }

      res.status(200).json({
        success: true,
        message: 'Transcript queued for durable background processing',
        meetingId: payload.meetingId,
        queue: upsertResponse.data,
        immediateProcessing,
      });

    } catch (error) {
      console.error('Error processing transcript:', error.message);

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

    const meetingDate = transcript.date
      ? new Date(transcript.date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];
    const queueResponse = await axios.post(
      `http://127.0.0.1:${PORT}/api/meeting-register/upsert-by-external`,
      {
        externalMeetingId: transcript.id || meetingId,
        title: transcript.title || 'Untitled Meeting',
        meetingDate,
        meetingFormat: 'Virtual',
        processingStatus: 'Pending',
        transcriptSource: transcript.transcript_url || '',
        retryCount: 0,
        nextRetryAt: new Date().toISOString(),
        forceRerun: false,
        retrySource: 'manual_test_endpoint',
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );

    res.json({
      success: true,
      transcript: { id: transcript.id, title: transcript.title },
      queue: queueResponse.data
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
