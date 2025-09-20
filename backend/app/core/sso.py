import base64
import hashlib
import hmac
import urllib.parse
from typing import Dict, Optional
from app.core.config import settings


def sign_payload(payload: str, secret: str) -> str:
    """
    Sign a payload with HMAC-SHA256.
    
    Args:
        payload: The payload to sign
        secret: The shared secret
        
    Returns:
        The hex-encoded signature
    """
    return hmac.new(
        secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()


def verify_payload(payload: str, signature: str, secret: str) -> bool:
    """
    Verify a signed payload.
    
    Args:
        payload: The payload to verify
        signature: The signature to check against
        secret: The shared secret
        
    Returns:
        True if signature is valid, False otherwise
    """
    expected_signature = sign_payload(payload, secret)
    return hmac.compare_digest(expected_signature, signature)


def decode_sso_payload(sso_payload: str) -> Dict[str, str]:
    """
    Decode a base64-encoded SSO payload into a dictionary.
    
    Args:
        sso_payload: Base64-encoded SSO payload
        
    Returns:
        Dictionary of key-value pairs from the payload
    """
    decoded_bytes = base64.b64decode(sso_payload)
    decoded_string = decoded_bytes.decode('utf-8')
    return dict(urllib.parse.parse_qsl(decoded_string))


def encode_sso_payload(data: Dict[str, str]) -> str:
    """
    Encode a dictionary into a base64-encoded SSO payload.
    
    Args:
        data: Dictionary of key-value pairs
        
    Returns:
        Base64-encoded SSO payload
    """
    query_string = urllib.parse.urlencode(data)
    encoded_bytes = base64.b64encode(query_string.encode('utf-8'))
    return encoded_bytes.decode('utf-8')


def generate_sso_response(
    nonce: str,
    external_id: str,
    email: str,
    username: str,
    name: Optional[str] = None,
    admin: bool = False,
    moderator: bool = False,
    secret: Optional[str] = None
) -> Dict[str, str]:
    """
    Generate an SSO response payload for Discourse.
    
    Args:
        nonce: The nonce from the original request
        external_id: Unique user ID from your system
        email: User's email address
        username: Username for Discourse (will be derived from email if not provided)
        name: User's full name (optional)
        admin: Whether user should be admin in Discourse
        moderator: Whether user should be moderator in Discourse
        secret: SSO secret (uses settings if not provided)
        
    Returns:
        Dictionary with 'sso' and 'sig' keys for the response
    """
    if secret is None:
        secret = settings.DISCOURSE_CONNECT_SECRET
        
    if not secret:
        raise ValueError("DISCOURSE_CONNECT_SECRET must be configured")
    
    # Prepare the response data
    response_data = {
        'nonce': nonce,
        'external_id': str(external_id),
        'email': email,
        'username': username or email.split('@')[0],  # Use email prefix as username if not provided
        'require_activation': 'false',  # Users from our system are already activated
    }
    
    # Add optional fields
    if name:
        response_data['name'] = name
    if admin:
        response_data['admin'] = 'true'
    if moderator:
        response_data['moderator'] = 'true'
    
    # Encode the payload
    sso_payload = encode_sso_payload(response_data)
    
    # Sign the payload
    signature = sign_payload(sso_payload, secret)
    
    return {
        'sso': sso_payload,
        'sig': signature
    }


def validate_sso_request(sso_payload: str, signature: str, secret: Optional[str] = None) -> Dict[str, str]:
    """
    Validate and decode an incoming SSO request from Discourse.
    
    Args:
        sso_payload: Base64-encoded SSO payload from Discourse
        signature: Signature from Discourse
        secret: SSO secret (uses settings if not provided)
        
    Returns:
        Decoded payload data
        
    Raises:
        ValueError: If signature is invalid or secret is not configured
    """
    if secret is None:
        secret = settings.DISCOURSE_CONNECT_SECRET
        
    if not secret:
        raise ValueError("DISCOURSE_CONNECT_SECRET must be configured")
    
    # Verify the signature
    if not verify_payload(sso_payload, signature, secret):
        raise ValueError("Invalid SSO signature")
    
    # Decode and return the payload
    return decode_sso_payload(sso_payload)


def generate_discourse_login_url() -> str:
    """
    Generate a URL to start login on Discourse.
    Since FastAPI is the SSO provider, this just points to Discourse login.
    
    Returns:
        Discourse login URL
    """
    if not settings.DISCOURSE_CONNECT_URL:
        raise ValueError("DISCOURSE_CONNECT_URL must be configured")
    
    discourse_url = settings.DISCOURSE_CONNECT_URL.rstrip('/')
    return f"{discourse_url}/login" 