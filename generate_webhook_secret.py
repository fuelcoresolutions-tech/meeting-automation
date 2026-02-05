import hashlib
import secrets
import os
import hmac
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def generate_webhook_secret():
    """Generate a secure webhook secret for Fireflies"""
    # Generate a cryptographically secure random string
    secret = secrets.token_urlsafe(32)
    return secret

def save_webhook_secret(secret):
    """Save webhook secret to .env file"""
    env_file = '.env'
    
    # Read existing .env file
    try:
        with open(env_file, 'r') as f:
            lines = f.readlines()
    except FileNotFoundError:
        lines = []
    
    # Update or add FIREFLY_WEBHOOK_SECRET
    updated = False
    for i, line in enumerate(lines):
        if line.startswith('FIREFLY_WEBHOOK_SECRET='):
            lines[i] = f'FIREFLY_WEBHOOK_SECRET={secret}\n'
            updated = True
            break
    
    if not updated:
        lines.append(f'FIREFLY_WEBHOOK_SECRET={secret}\n')
    
    # Write back to .env
    with open(env_file, 'w') as f:
        f.writelines(lines)
    
    print(f"✅ Webhook secret saved to .env file")

def verify_webhook_signature(payload, signature, secret):
    """Verify webhook signature from Fireflies"""
    if not secret:
        print("❌ No webhook secret configured")
        return False
    
    if not signature:
        print("❌ No signature provided")
        return False
    
    # Create expected signature
    expected_signature = hmac \
        .new(secret.encode('utf-8'), payload.encode('utf-8'), hashlib.sha256) \
        .hexdigest()
    
    # Compare signatures securely
    is_valid = hmac.compare_digest(
        signature.encode('utf-8'),
        expected_signature.encode('utf-8')
    )
    
    return is_valid

def test_signature_verification():
    """Test the signature verification with sample data"""
    secret = generate_webhook_secret()
    sample_payload = '{"test": "data"}'
    
    # Create signature
    signature = hmac \
        .new(secret.encode('utf-8'), sample_payload.encode('utf-8'), hashlib.sha256) \
        .hexdigest()
    
    # Test verification
    is_valid = verify_webhook_signature(sample_payload, signature, secret)
    
    print(f"🔐 Webhook Secret: {secret}")
    print(f"📝 Sample Payload: {sample_payload}")
    print(f"🔏 Signature: {signature}")
    print(f"✅ Verification Result: {is_valid}")
    
    return secret, signature

def main():
    print("🔐 Fireflies Webhook Secret Generator")
    print("=" * 50)
    
    # Generate new secret
    secret = generate_webhook_secret()
    
    print(f"\n🎯 Generated Webhook Secret:")
    print(f"{secret}")
    
    # Save to .env
    save_webhook_secret(secret)
    
    # Test verification
    print(f"\n🧪 Testing Signature Verification:")
    test_signature_verification()
    
    print(f"\n📋 Next Steps:")
    print(f"1. Copy the webhook secret above")
    print(f"2. Go to app.fireflies.ai/settings")
    print(f"3. In Developer settings, set the Webhook Secret")
    print(f"4. Your webhook server will now verify incoming requests")
    
    print(f"\n🔧 Webhook Secret Format:")
    print(f"- Length: 32 bytes (43 characters when URL-safe encoded)")
    print(f"- Encoding: URL-safe base64")
    print(f"- Security: Cryptographically secure random")
    
    return secret

if __name__ == "__main__":
    webhook_secret = main()
