/**
 * LLM Chat App Frontend
 *
 * Handles the chat UI interactions and communication with the backend API.
 */

// Configure marked.js for safe markdown rendering
marked.setOptions({
	breaks: true,
	gfm: true,
	headerIds: false,
	mangle: false,
});

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

const basePath = window.location.pathname.startsWith('/chatproxy') ? '/chatproxy' : '';

// Chat state
let conversationId = `conv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
let chatHistory = [
	{
		role: "assistant",
		content: "Hello! I'm the CTC chat app! How can I help you today?",
	},
];
let isProcessing = false;

// Auto-resize textarea as user types
userInput.addEventListener("input", function () {
	this.style.height = "auto";
	this.style.height = this.scrollHeight + "px";
});

// Send message on Enter (without Shift)
userInput.addEventListener("keydown", function (e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});

sendButton.addEventListener("click", sendMessage);

/**
 * Extracts a human-readable error message from an API error response body.
 */
function extractErrorMessage(body) {
	if (!body || !body.error) return null;

	let err = body.error;

	// Unwrap stringified JSON
	if (typeof err === "string") {
		try { err = JSON.parse(err); } catch { return err; }
	}

	if (typeof err === "string") return err;
	if (err.message) return err.message;
	if (Array.isArray(err) && err[0]?.message) return err[0].message;
	if (Array.isArray(err.error) && err.error[0]?.message) return err.error[0].message;

	return "An unknown error occurred";
}

async function sendMessage() {
	const message = userInput.value.trim();
	if (message === "" || isProcessing) return;

	isProcessing = true;
	userInput.disabled = true;
	sendButton.disabled = true;

	addMessageToChat("user", message);
	userInput.value = "";
	userInput.style.height = "auto";
	typingIndicator.classList.add("visible");
	chatHistory.push({ role: "user", content: message });

	let conversationEnded = false;
	const assistantMessageEl = document.createElement("div");
	assistantMessageEl.className = "message assistant-message";
	const assistantTextEl = document.createElement("div");
	assistantMessageEl.appendChild(assistantTextEl);
	chatMessages.appendChild(assistantMessageEl);
	chatMessages.scrollTop = chatMessages.scrollHeight;

	try {
		const response = await fetch(`${basePath}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ messages: chatHistory, conversationId }),
		});

		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			if (body.code === "HISTORY_TOO_LONG") {
				conversationEnded = true;
				assistantMessageEl.remove();
				addMessageToChat("assistant", (body.error || "Chat history too long") + ". Please reload to start a new conversation.", true);
				return;
			}
			const msg = extractErrorMessage(body);
			throw new Error(msg || `Request failed (${response.status})`);
		}

		if (!response.body) throw new Error("Response body is null");

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let responseText = "";
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (!done) {
				buffer += decoder.decode(value, { stream: true });
			}

			const parsed = consumeSseEvents(done ? buffer + "\n\n" : buffer);
			buffer = parsed.buffer;

			for (const data of parsed.events) {
				if (data === "[DONE]") break;
				const json = JSON.parse(data);
				if (json.error) {
					console.error(json.error);
					throw new Error("An error occurred");
				}
				const content = json.response ?? json.choices?.[0]?.delta?.content ?? "";
				if (content) {
					responseText += content;
					assistantTextEl.innerHTML = DOMPurify.sanitize(marked.parse(responseText));
					chatMessages.scrollTop = chatMessages.scrollHeight;
				}
			}

			if (done) break;
		}

		if (responseText.length > 0) {
			chatHistory.push({ role: "assistant", content: responseText });
		} else {
			assistantMessageEl.remove();
		}
	} catch (error) {
		console.error("Error:", error);
		assistantMessageEl.remove();
		addMessageToChat("assistant", error.message || "Something went wrong.", true);
	} finally {
		typingIndicator.classList.remove("visible");
		isProcessing = false;
		if (conversationEnded) {
			userInput.disabled = true;
			sendButton.textContent = "Reload";
			sendButton.disabled = false;
			sendButton.onclick = () => window.location.reload();
		} else {
			userInput.disabled = false;
			sendButton.disabled = false;
			userInput.focus();
		}
	}
}

function addMessageToChat(role, content, isError = false) {
	const messageEl = document.createElement("div");
	messageEl.className = `message ${role}-message${isError ? " error-message" : ""}`;

	if (role === "user") {
		const p = document.createElement("p");
		p.textContent = content;
		messageEl.appendChild(p);
	} else {
		const div = document.createElement("div");
		div.innerHTML = DOMPurify.sanitize(marked.parse(content));
		messageEl.appendChild(div);
	}

	chatMessages.appendChild(messageEl);
	chatMessages.scrollTop = chatMessages.scrollHeight;
}

function consumeSseEvents(buffer) {
	let normalized = buffer.replace(/\r/g, "");
	const events = [];
	let idx;
	while ((idx = normalized.indexOf("\n\n")) !== -1) {
		const rawEvent = normalized.slice(0, idx);
		normalized = normalized.slice(idx + 2);

		const dataLines = [];
		for (const line of rawEvent.split("\n")) {
			if (line.startsWith("data:")) {
				dataLines.push(line.slice(5).trimStart());
			}
		}
		if (dataLines.length > 0) events.push(dataLines.join("\n"));
	}
	return { events, buffer: normalized };
}
