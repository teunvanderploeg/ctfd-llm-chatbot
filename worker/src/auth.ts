/**
 * JWT Authentication Module
 *
 * Validates CTFd authentication tokens from signed JWT cookies.
 * No external API calls - validation happens entirely in the Worker.
 */

import { Env, JWTPayload } from "./types";

const COOKIE_NAME = "chatbot_auth";

/**
 * Extracts the JWT token from the chatbot_auth cookie.
 */
export function parseJWTCookie(request: Request): string | null {
	const cookieHeader = request.headers.get("Cookie");
	if (!cookieHeader) {
		return null;
	}

	const cookies = cookieHeader.split(";").map((c) => c.trim());
	for (const cookie of cookies) {
		const [name, value] = cookie.split("=", 2);
		if (name === COOKIE_NAME && value) {
			return decodeURIComponent(value);
		}
	}

	return null;
}

/**
 * Base64 URL decode helper.
 */
function base64UrlDecode(str: string): Uint8Array {
	// Replace URL-safe characters with standard base64
	let base64 = str.replace(/-/g, "+").replace(/_/g, "/");

	// Add padding if needed
	while (base64.length % 4) {
		base64 += "=";
	}

	// Decode base64
	const binaryString = atob(base64);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes;
}

/**
 * Validates JWT signature and extracts payload.
 * Uses HS256 (HMAC-SHA256) algorithm.
 */
export async function validateJWT(
	token: string,
	secret: string,
): Promise<JWTPayload | null> {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) {
			return null;
		}

		const [headerB64, payloadB64, signatureB64] = parts;

		// Decode header to verify algorithm
		const headerBytes = base64UrlDecode(headerB64);
		const header = JSON.parse(new TextDecoder().decode(headerBytes));
		if (header.alg !== "HS256") {
			return null;
		}

		// Verify signature
		const data = `${headerB64}.${payloadB64}`;
		const signature = base64UrlDecode(signatureB64);

		// Import secret key
		const encoder = new TextEncoder();
		const keyData = encoder.encode(secret);
		const key = await crypto.subtle.importKey(
			"raw",
			keyData,
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["verify"],
		);

		// Verify signature
		const dataBytes = encoder.encode(data);
		const isValid = await crypto.subtle.verify(
			"HMAC",
			key,
			signature,
			dataBytes,
		);

		if (!isValid) {
			return null;
		}

		// Decode and parse payload
		const payloadBytes = base64UrlDecode(payloadB64);
		const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as JWTPayload;

		// Check expiration
		if (payload.exp && payload.exp < Date.now() / 1000) {
			return null;
		}

		return payload;
	} catch (error) {
		console.error("JWT validation error:", error);
		return null;
	}
}

/**
 * Extracts user ID from validated JWT payload.
 * Username is optional and not required.
 */
export function decodeJWTPayload(payload: JWTPayload): {
	userId: number;
	username?: string;
} {
	return {
		userId: payload.user_id,
		username: payload.username,
	};
}

/**
 * Validates CTFd authentication from request.
 * Returns user data on success, or null on failure.
 * Only user_id is required in the JWT payload.
 */
export async function validateCTFdAuth(
	request: Request,
	env: Env,
): Promise<{ userId: number; username?: string } | null> {
	const token = parseJWTCookie(request);
	if (!token) {
		return null;
	}

	const payload = await validateJWT(token, env.CHATBOT_JWT_SECRET);
	if (!payload) {
		return null;
	}

	return decodeJWTPayload(payload);
}

