#!/usr/bin/env node

/**
 * Health Monitor and Auto-Recovery System
 * Monitors meeting automation system health and auto-recovers from common issues
 */

const axios = require('axios');
const { setInterval } = require('timers');

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://127.0.0.1:3000';
const AGENT_URL = process.env.AGENT_URL || 'http://127.0.0.1:8000';
const NOTION_API_BASE = process.env.NOTION_API_BASE || 'http://127.0.0.1:3000';
const CHECK_INTERVAL = parseInt(process.env.HEALTH_CHECK_INTERVAL) || 60000; // 1 minute

class HealthMonitor {
  constructor() {
    this.issues = [];
    this.lastHealthCheck = null;
  }

  async checkServiceHealth(url, serviceName) {
    try {
      const response = await axios.get(`${url}/health`, { timeout: 5000 });
      return { healthy: true, status: response.status, service: serviceName };
    } catch (error) {
      return { 
        healthy: false, 
        error: error.message, 
        service: serviceName,
        code: error.code || 'UNKNOWN'
      };
    }
  }

  async checkMeetingRegisterHealth() {
    try {
      const response = await axios.get(`${NOTION_API_BASE}/api/meeting-register`, { timeout: 10000 });
      const meetings = response.data || [];
      const unprocessed = meetings.filter(m => m.processingStatus !== 'Completed');
      
      // Check for problematic patterns
      const issues = [];
      
      // High retry counts
      const highRetries = unprocessed.filter(m => (m.retryCount || 0) > 50);
      if (highRetries.length > 0) {
        issues.push({
          type: 'HIGH_RETRY_COUNT',
          count: highRetries.length,
          details: highRetries.slice(0, 3).map(m => ({ id: m.id, title: m.title, retryCount: m.retryCount }))
        });
      }

      // Rate limited meetings
      const rateLimited = unprocessed.filter(m => m.lastErrorMessage?.toLowerCase().includes('too many requests'));
      if (rateLimited.length > 0) {
        issues.push({
          type: 'RATE_LIMITED',
          count: rateLimited.length,
          details: rateLimited.slice(0, 3).map(m => ({ id: m.id, title: m.title }))
        });
      }

      // Missing external IDs
      const missingIds = unprocessed.filter(m => !m.externalMeetingId && m.transcriptSource?.includes('fireflies.ai'));
      if (missingIds.length > 0) {
        issues.push({
          type: 'MISSING_EXTERNAL_IDS',
          count: missingIds.length,
          details: missingIds.slice(0, 3).map(m => ({ id: m.id, title: m.title }))
        });
      }

      return { 
        healthy: issues.length === 0,
        totalMeetings: meetings.length,
        unprocessed: unprocessed.length,
        issues
      };
    } catch (error) {
      return { 
        healthy: false, 
        error: error.message,
        service: 'Meeting Register'
      };
    }
  }

  async autoRecoverHighRetries() {
    try {
      console.log('🔧 Auto-recovering high retry count meetings...');
      
      const response = await axios.get(`${NOTION_API_BASE}/api/meeting-register`, { timeout: 10000 });
      const meetings = response.data || [];
      
      const highRetries = meetings.filter(m => (m.retryCount || 0) > 50 && m.processingStatus !== 'Completed');
      
      for (const meeting of highRetries) {
        try {
          await axios.patch(`${NOTION_API_BASE}/api/meeting-register/${meeting.id}`, {
            retryCount: 0,
            processingStatus: 'Pending',
            nextRetryAt: new Date().toISOString(),
            lastErrorMessage: '',
            lastErrorCode: '',
            retrySource: 'auto_recovery_high_retries'
          });
          console.log(`  ✅ Reset: ${meeting.title} (${meeting.retryCount} → 0 retries)`);
        } catch (error) {
          console.log(`  ❌ Failed to reset ${meeting.title}: ${error.message}`);
        }
      }
      
      console.log(`🔄 Auto-recovery completed for ${highRetries.length} meetings`);
    } catch (error) {
      console.error('❌ Auto-recovery failed:', error.message);
    }
  }

  async autoRecoverMissingIds() {
    try {
      console.log('🆔 Auto-recovering missing external meeting IDs...');
      
      const response = await axios.get(`${NOTION_API_BASE}/api/meeting-register`, { timeout: 10000 });
      const meetings = response.data || [];
      
      const missingIds = meetings.filter(m => 
        !m.externalMeetingId && 
        m.transcriptSource?.includes('fireflies.ai/view/') &&
        m.processingStatus !== 'Completed'
      );
      
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
              retrySource: 'auto_recovery_missing_ids'
            });
            console.log(`  ✅ Added ID: ${meeting.title} → ${externalId}`);
          }
        } catch (error) {
          console.log(`  ❌ Failed to update ${meeting.title}: ${error.message}`);
        }
      }
      
      console.log(`🆔 Auto-recovery completed for ${missingIds.length} meetings`);
    } catch (error) {
      console.error('❌ Auto-recovery failed:', error.message);
    }
  }

  async performHealthCheck() {
    const timestamp = new Date().toISOString();
    console.log(`\n🏥 Health Check - ${timestamp}`);
    
    const results = {
      timestamp,
      services: {},
      meetingRegister: null,
      actions: []
    };

    // Check webhook server
    results.services.webhook = await this.checkServiceHealth(WEBHOOK_URL, 'Webhook Server');
    
    // Check agent
    results.services.agent = await this.checkServiceHealth(AGENT_URL, 'Agent');
    
    // Check meeting register health
    results.meetingRegister = await this.checkMeetingRegisterHealth();

    // Auto-recovery actions
    if (results.meetingRegister.issues) {
      for (const issue of results.meetingRegister.issues) {
        switch (issue.type) {
          case 'HIGH_RETRY_COUNT':
            await this.autoRecoverHighRetries();
            results.actions.push('AUTO_RECOVERED_HIGH_RETRIES');
            break;
          case 'MISSING_EXTERNAL_IDS':
            await this.autoRecoverMissingIds();
            results.actions.push('AUTO_RECOVERED_MISSING_IDS');
            break;
          case 'RATE_LIMITED':
            console.log(`⏰ Rate limited meetings detected: ${issue.count}. Will retry after cooldown.`);
            results.actions.push('RATE_LIMIT_DETECTED');
            break;
        }
      }
    }

    // Summary
    const allHealthy = Object.values(results.services).every(s => s.healthy) && 
                      (results.meetingRegister?.healthy !== false);

    if (allHealthy) {
      console.log('✅ All systems healthy');
    } else {
      console.log('⚠️ Health issues detected:');
      Object.values(results.services).forEach(s => {
        if (!s.healthy) console.log(`  - ${s.service}: ${s.error || 'Unhealthy'}`);
      });
      if (results.meetingRegister && !results.meetingRegister.healthy) {
        console.log(`  - Meeting Register: ${results.meetingRegister.error || 'Issues detected'}`);
      }
    }

    this.lastHealthCheck = results;
    return results;
  }

  start() {
    console.log('🚀 Health Monitor started');
    console.log(`📍 Checking every ${CHECK_INTERVAL/1000} seconds`);
    
    // Initial check
    this.performHealthCheck();
    
    // Regular checks
    setInterval(() => {
      this.performHealthCheck();
    }, CHECK_INTERVAL);
  }
}

// Start monitoring if run directly
if (require.main === module) {
  const monitor = new HealthMonitor();
  monitor.start();
}

module.exports = HealthMonitor;
