/**
 * Type definitions for the LLM chat application.
 */

export interface Env {
	/**
	 * Binding for the Workers AI API.
	 */
	AI: Ai;

	/**
	 * Binding for static assets.
	 */
	ASSETS: { fetch: (request: Request) => Promise<Response> };

	/**
	 * KV namespace for rate limiting.
	 */
	RATE_LIMIT_KV: KVNamespace;

	/**
	 * JWT secret for validating CTFd authentication tokens.
	 */
	CHATBOT_JWT_SECRET: string;

	/**
	 * Optional AI Gateway ID for Workers AI requests.
	 */
	AI_GATEWAY_ID?: string;

	/**
	 * Optional Workers AI model override.
	 */
	AI_MODEL: keyof AiModels;

	/**
	 * System prompt for the chatbot.
	 */
	SYSTEM_PROMPT: string;

	/**
	 * Analytics Engine binding for prompt logging.
	 */
	ANALYTICS?: AnalyticsEngineDataset;
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

/**
 * JWT payload structure from CTFd authentication cookie.
 */
export interface JWTPayload {
	user_id: number;
	username?: string; // Optional - not required
	exp: number;
	iat?: number;
}

/**
 * Rate limit configuration constants.
 */
export const RATE_LIMIT = {
	MAX_REQUESTS: 5,
	WINDOW_SECONDS: 60,
} as const;
