/**
 * Rate Limiting Module
 *
 * Implements per-user rate limiting using Cloudflare KV storage.
 * Limits users to 5 requests per minute.
 */

import { Env, RATE_LIMIT } from "./types";

/**
 * Gets the rate limit key for a user in the current minute window.
 */
function getRateLimitKey(userId: number): string {
	const minuteWindow = Math.floor(Date.now() / 60000);
	return `ratelimit:${userId}:${minuteWindow}`;
}

/**
 * Checks if the user has exceeded the rate limit.
 * Returns the current request count and whether the limit is exceeded.
 */
export async function checkRateLimit(
	userId: number,
	env: Env,
): Promise<{ count: number; exceeded: boolean; remaining: number }> {
	const key = getRateLimitKey(userId);
	const value = await env.RATE_LIMIT_KV.get(key);

	const count = value ? parseInt(value, 10) : 0;
	const exceeded = count >= RATE_LIMIT.MAX_REQUESTS;
	const remaining = Math.max(0, RATE_LIMIT.MAX_REQUESTS - count);

	return { count, exceeded, remaining };
}

/**
 * Increments the rate limit counter for a user.
 * Sets TTL to 60 seconds to automatically expire old entries.
 */
export async function incrementRateLimit(
	userId: number,
	env: Env,
): Promise<void> {
	const key = getRateLimitKey(userId);
	const value = await env.RATE_LIMIT_KV.get(key);

	const count = value ? parseInt(value, 10) : 0;
	const newCount = count + 1;

	// Store with 60 second TTL (expires at end of current minute window)
	await env.RATE_LIMIT_KV.put(key, newCount.toString(), {
		expirationTtl: RATE_LIMIT.WINDOW_SECONDS,
	});
}

