import os
import logging

logger = logging.getLogger(__name__)


def get_jwt_secret():
    """
    Get the JWT signing key from the CHATBOT_JWT_SECRET environment variable.
    
    Returns:
        str: The JWT signing key, or None if not set
        
    Raises:
        ValueError: If the key is set but empty
    """
    secret = os.getenv("CHATBOT_JWT_SECRET")
    
    if secret is None:
        logger.warning(
            "CHATBOT_JWT_SECRET environment variable is not set. "
            "Chatbot auth cookie will not be set."
        )
        return None
    
    if not secret.strip():
        raise ValueError(
            "CHATBOT_JWT_SECRET environment variable is set but empty. "
            "Please provide a valid signing key."
        )
    
    return secret


