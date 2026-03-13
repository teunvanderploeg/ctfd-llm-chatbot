/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";
import { validateCTFdAuth } from "./auth";
import { checkRateLimit, incrementRateLimit } from "./rateLimit";

export default {
	/**
	 * Main request handler for the Worker
	 */
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// Validate and strip /chatproxy prefix
		if (!url.pathname.startsWith("/chatproxy")) {
			return new Response("Forbidden", { status: 403 });
		}

		// Strip /chatproxy prefix from pathname
		const strippedPath = url.pathname.slice("/chatproxy".length) || "/";
		url.pathname = strippedPath;

		// Create a new request with the modified URL
		const modifiedRequest = new Request(url.toString(), {
			method: request.method,
			headers: request.headers,
			body: request.body,
			redirect: request.redirect,
		});

		// Handle static assets (frontend)
		if (strippedPath === "/" || !strippedPath.startsWith("/api/")) {
			return env.ASSETS.fetch(modifiedRequest);
		}

		// API Routes
		if (strippedPath === "/api/chat") {
			// Handle POST requests for chat
			if (request.method === "POST") {
				return handleChatRequest(modifiedRequest, env);
			}

			// Method not allowed for other request types
			return new Response("Method not allowed", { status: 405 });
		}

		// Handle 404 for unmatched routes
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		// Step 1: Validate CTFd authentication
		const user = await validateCTFdAuth(request, env);
		if (!user) {
			return new Response(
				JSON.stringify({
					error: "Unauthorized - Invalid or missing authentication token",
				}),
				{
					status: 401,
					headers: { "content-type": "application/json" },
				},
			);
		}

		// Step 2: Check rate limit
		const rateLimit = await checkRateLimit(user.userId, env);
		if (rateLimit.exceeded) {
			return new Response(
				JSON.stringify({
					error: "Rate limit exceeded - Maximum 5 queries per minute",
					remaining: 0,
				}),
				{
					status: 429,
					headers: { "content-type": "application/json" },
				},
			);
		}

		// Step 3: Increment rate limit counter
		await incrementRateLimit(user.userId, env);

		// Step 4: Parse JSON request body
		const { messages = [], conversationId } = (await request.json()) as {
			messages: ChatMessage[];
			conversationId?: string;
		};

		// Step 4a: Validate chat history limits
		const MAX_MESSAGES = 50;
		const MAX_CONTENT_LENGTH = 50000; // 50K characters

		// Check message count
		if (messages.length > MAX_MESSAGES) {
			return new Response(
				JSON.stringify({
					error: `Chat history too long`,
					code: "HISTORY_TOO_LONG",
				}),
				{
					status: 400,
					headers: { "content-type": "application/json" },
				},
			);
		}

		// Check total content length
		const totalContentLength = messages.reduce(
			(sum, msg) => sum + (msg.content?.length || 0),
			0,
		);
		if (totalContentLength > MAX_CONTENT_LENGTH) {
			return new Response(
				JSON.stringify({
					error: `Chat history too long`,
					code: "HISTORY_TOO_LONG",
				}),
				{
					status: 400,
					headers: { "content-type": "application/json" },
				},
			);
		}

		// Log prompt to Analytics Engine
		const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
		if (lastUserMessage && env.ANALYTICS) {
			env.ANALYTICS.writeDataPoint({
				indexes: [user.userId.toString()],
				blobs: [
					conversationId || "unknown",
					lastUserMessage.content.slice(0, 1024),
				],
				doubles: [user.userId],
			});
		}

		// Add system prompt if not present
		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: env.SYSTEM_PROMPT });
		}

		// Step 5: Process AI request
		const aiOptions = env.AI_GATEWAY_ID
			? {
					// Gateway must have firewall disabled for streaming to work.
					gateway: {
						id: env.AI_GATEWAY_ID,
						skipCache: true,
						cacheTtl: 180,
						metadata: {
							user_id: user.userId,
							conversation_id: conversationId || "unknown",
							user_text: "user_" + user.userId,
						},
					},
				}
			: undefined;

		const result = await env.AI.run(
			env.AI_MODEL,
			{
				messages,
				max_tokens: 4096,
				stream: true,
			},
			aiOptions,
		);

		return new Response(result as ReadableStream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		return Response.json(
			{ error: error instanceof Error ? error.message : "Failed to process request" },
			{ status: 502 },
		);
	}
}
