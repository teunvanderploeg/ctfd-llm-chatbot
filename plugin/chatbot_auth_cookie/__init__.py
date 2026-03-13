import datetime
import logging

import jwt
from flask import current_app, request, session

logger = logging.getLogger(__name__)

from .config import get_jwt_secret

COOKIE_NAME = "chatbot_auth"


def generate_chatbot_jwt(user_id, secret, lifetime_seconds):
    """
    Generate a JWT token containing the user_id.
    
    Args:
        user_id: The user ID to include in the token
        secret: The signing key for the JWT
        lifetime_seconds: Token expiration time in seconds
        
    Returns:
        str: The encoded JWT token
    """
    payload = {
        "user_id": user_id,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(seconds=lifetime_seconds),
        "iat": datetime.datetime.utcnow(),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def get_session_cookie_properties(app):
    """
    Get the cookie properties from the app's session interface.
    These match the properties used by CTFd's session cookie.
    
    Args:
        app: The Flask application instance
        
    Returns:
        dict: Cookie properties (httponly, secure, samesite, domain, path, expires)
    """
    session_interface = app.session_interface
    
    # Get cookie properties from session interface
    httponly = session_interface.get_cookie_httponly(app)
    secure = session_interface.get_cookie_secure(app)
    samesite = session_interface.get_cookie_samesite(app)
    domain = session_interface.get_cookie_domain(app)
    path = session_interface.get_cookie_path(app)
    
    # Get expiration time if session is permanent
    expires = None
    if session.permanent:
        expires = session_interface.get_expiration_time(app, session)
    
    return {
        "httponly": httponly,
        "secure": secure,
        "samesite": samesite,
        "domain": domain,
        "path": path,
        "expires": expires,
    }


def should_set_cookie(response):
    """
    Determine if we should set the chatbot_auth cookie.
    
    We set it when:
    1. Session was modified and contains a user ID (login occurred)
    2. The chatbot_auth cookie is not already present or needs updating
    
    Args:
        response: The Flask response object
        
    Returns:
        bool: True if we should set the cookie
    """
    # Check if session was modified and has a user ID
    if not session.modified:
        return False
    
    user_id = session.get("id")
    if not user_id:
        return False
    
    # Check if we already have a valid chatbot_auth cookie for this user
    existing_cookie = request.cookies.get(COOKIE_NAME)
    if existing_cookie:
        # Verify the existing cookie is still valid
        try:
            secret = get_jwt_secret()
            if secret:
                decoded = jwt.decode(existing_cookie, secret, algorithms=["HS256"])
                if decoded.get("user_id") == user_id:
                    # Cookie is valid and matches current user, no need to update
                    return False
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
            # Cookie is invalid or expired, we should set a new one
            pass
    
    return True


def should_clear_cookie(response):
    """
    Determine if we should clear the chatbot_auth cookie.
    
    We clear it when:
    1. Session was cleared (logout occurred) - session is empty and was modified
    2. The session cookie is being deleted (indicated by session being empty)
    
    Args:
        response: The Flask response object
        
    Returns:
        bool: True if we should clear the cookie
    """
    # Check if we have an existing chatbot_auth cookie
    existing_cookie = request.cookies.get(COOKIE_NAME)
    if not existing_cookie:
        # No cookie to clear
        return False
    
    # Check if session is empty (logout occurred)
    # When logout_user() is called, it does session.clear(), making the session empty
    # An empty session is falsy, and session.get('id') will return None
    user_id = session.get("id")
    
    # If session was modified and is now empty (no user_id), it's a logout
    if session.modified and not user_id:
        return True
    
    # Also check if session is completely empty (falsy)
    # This handles the case where session.clear() was called
    if not session and existing_cookie:
        return True
    
    return False


def load(app):
    """
    Load the chatbot auth cookie plugin.
    
    This plugin sets a chatbot_auth cookie containing a JWT with the user_id
    after successful login. The cookie uses the same properties as CTFd's
    session cookie.
    
    Args:
        app: The Flask application instance
    """
    jwt_secret = get_jwt_secret()
    
    if not jwt_secret:
        logger.warning(
            "Chatbot auth cookie plugin loaded but CHATBOT_JWT_SECRET is not set. "
            "Plugin will not set cookies."
        )
        return
    
    @app.after_request
    def set_chatbot_auth_cookie(response):
        """
        After request hook to set or clear the chatbot_auth cookie.
        """
        try:
            # Check if we should clear the cookie (logout)
            if should_clear_cookie(response):
                cookie_props = get_session_cookie_properties(app)
                response.delete_cookie(
                    COOKIE_NAME,
                    domain=cookie_props["domain"],
                    path=cookie_props["path"],
                )
                return response
            
            # Check if we should set the cookie (login)
            if should_set_cookie(response):
                user_id = session.get("id")
                if user_id:
                    lifetime = app.config.get("PERMANENT_SESSION_LIFETIME", 604800)
                    token = generate_chatbot_jwt(user_id, jwt_secret, lifetime)
                    
                    cookie_props = get_session_cookie_properties(app)
                    response.set_cookie(
                        COOKIE_NAME,
                        token,
                        expires=cookie_props["expires"],
                        httponly=cookie_props["httponly"],
                        secure=cookie_props["secure"],
                        samesite=cookie_props["samesite"],
                        domain=cookie_props["domain"],
                        path=cookie_props["path"],
                    )
                    logger.debug(f"Set chatbot_auth cookie for user_id={user_id}")
            
        except Exception as e:
            # Log error but don't break the request
            logger.error(f"Error setting chatbot_auth cookie: {e}", exc_info=True)
        
        return response
    
    logger.info("Chatbot auth cookie plugin loaded successfully")

