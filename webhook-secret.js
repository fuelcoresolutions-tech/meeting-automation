import crypto from 'crypto';

/**
 * Generate a secure webhook secret for Fireflies
 * @returns {string} - Cryptographically secure random string
 */
export function generateWebhookSecret() {
    // Generate a cryptographically secure random string (32 bytes)
    return crypto.randomBytes(32).toString('base64url');
}

/**
 * Verify webhook signature from Fireflies
 * @param {string} payload - The raw JSON payload
 * @param {string} signature - The signature from the X-Fireflies-Signature header
 * @param {string} secret - Your webhook secret
 * @returns {boolean} - Whether the signature is valid
 */
export function verifyWebhookSignature(payload, signature, secret) {
    if (!secret) {
        console.log('❌ No webhook secret configured');
        return false;
    }

    if (!signature) {
        console.log('❌ No signature provided');
        return false;
    }

    // Create expected signature using HMAC-SHA256
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload, 'utf8')
        .digest('hex');

    // Compare signatures securely
    return crypto.timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(expectedSignature, 'utf8')
    );
}

/**
 * Test signature verification
 */
export function testSignatureVerification() {
    const secret = generateWebhookSecret();
    const samplePayload = '{"test": "data"}';
    
    // Create signature
    const signature = crypto
        .createHmac('sha256', secret)
        .update(samplePayload, 'utf8')
        .digest('hex');

    // Test verification
    const isValid = verifyWebhookSignature(samplePayload, signature, secret);

    console.log('🔐 Webhook Secret:', secret);
    console.log('📝 Sample Payload:', samplePayload);
    console.log('🔏 Signature:', signature);
    console.log('✅ Verification Result:', isValid);

    return { secret, signature, isValid };
}

/**
 * Save webhook secret to .env file
 * @param {string} secret - The webhook secret to save
 */
export async function saveWebhookSecret(secret) {
    const fs = await import('fs');
    
    try {
        // Read existing .env file
        let envContent = '';
        try {
            envContent = fs.readFileSync('.env', 'utf8');
        } catch (error) {
            // File doesn't exist, create it
            envContent = '';
        }

        // Update or add FIREFLY_WEBHOOK_SECRET
        const lines = envContent.split('\n');
        let updated = false;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('FIREFLY_WEBHOOK_SECRET=')) {
                lines[i] = `FIREFLY_WEBHOOK_SECRET=${secret}`;
                updated = true;
                break;
            }
        }

        if (!updated) {
            lines.push(`FIREFLY_WEBHOOK_SECRET=${secret}`);
        }

        // Write back to .env
        fs.writeFileSync('.env', lines.join('\n') + '\n');
        console.log('✅ Webhook secret saved to .env file');

    } catch (error) {
        console.error('❌ Error saving webhook secret:', error.message);
    }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        console.log('🔐 Fireflies Webhook Secret Generator (Node.js)');
        console.log('='.repeat(50));

        // Generate new secret
        const secret = generateWebhookSecret();

        console.log('\n🎯 Generated Webhook Secret:');
        console.log(secret);

        // Save to .env
        await saveWebhookSecret(secret);

        // Test verification
        console.log('\n🧪 Testing Signature Verification:');
        testSignatureVerification();

        console.log('\n📋 Next Steps:');
        console.log('1. Copy the webhook secret above');
        console.log('2. Go to app.fireflies.ai/settings');
        console.log('3. In Developer settings, set the Webhook Secret');
        console.log('4. Your webhook server will now verify incoming requests');

        console.log('\n🔧 Webhook Secret Format:');
        console.log('- Length: 32 bytes');
        console.log('- Encoding: Base64 URL-safe');
        console.log('- Security: Cryptographically secure random');
    })();
}

export default {
    generateWebhookSecret,
    verifyWebhookSignature,
    testSignatureVerification,
    saveWebhookSecret
};
