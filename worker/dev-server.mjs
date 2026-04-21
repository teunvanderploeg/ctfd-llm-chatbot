import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const devVarsPath = path.join(__dirname, ".dev.vars");

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const HOST = process.env.HOST || "127.0.0.1";

async function loadDevVars() {
	try {
		const content = await readFile(devVarsPath, "utf8");
		const values = {};

		for (const rawLine of content.split(/\r?\n/)) {
			const line = rawLine.trim();
			if (!line || line.startsWith("#")) continue;

			const separatorIndex = line.indexOf("=");
			if (separatorIndex === -1) continue;

			const key = line.slice(0, separatorIndex).trim();
			const value = line.slice(separatorIndex + 1).trim();
			values[key] = value;
		}

		return values;
	} catch {
		return {};
	}
}

const devVars = await loadDevVars();
const mockResponse =
	process.env.LOCAL_DEV_MOCK_RESPONSE ||
	devVars.LOCAL_DEV_MOCK_RESPONSE ||
	"Local mock server is running.";

function getContentType(filePath) {
	switch (path.extname(filePath)) {
		case ".html":
			return "text/html; charset=utf-8";
		case ".js":
			return "application/javascript; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		case ".json":
			return "application/json; charset=utf-8";
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".svg":
			return "image/svg+xml";
		default:
			return "application/octet-stream";
	}
}

function writeJson(response, statusCode, body) {
	response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
	response.end(JSON.stringify(body));
}

function writeSse(response, message) {
	response.writeHead(200, {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});

	response.write(`data: ${JSON.stringify({ response: message })}\n\n`);
	response.write("data: [DONE]\n\n");
	response.end();
}

async function serveStatic(response, requestPath) {
	const normalizedPath =
		requestPath === "/" || requestPath === "" ? "/index.html" : requestPath;
	const filePath = path.join(publicDir, normalizedPath.replace(/^\/+/, ""));

	try {
		const file = await readFile(filePath);
		response.writeHead(200, { "content-type": getContentType(filePath) });
		response.end(file);
	} catch {
		response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		response.end("Not found");
	}
}

const server = createServer(async (request, response) => {
	if (!request.url) {
		writeJson(response, 400, { error: "Missing request URL" });
		return;
	}

	const url = new URL(request.url, `http://${HOST}:${PORT}`);
	const requestPath = url.pathname.startsWith("/chatproxy")
		? url.pathname.slice("/chatproxy".length) || "/"
		: url.pathname;

	if (
		request.method === "POST" &&
		(requestPath === "/api/chat" || url.pathname === "/api/chat")
	) {
		let body = "";
		for await (const chunk of request) {
			body += chunk;
		}

		let payload = {};
		try {
			payload = body ? JSON.parse(body) : {};
		} catch {
			writeJson(response, 400, { error: "Invalid JSON body" });
			return;
		}

		const lastUserMessage =
			payload.messages
				?.filter((message) => message?.role === "user")
				?.at(-1)?.content || "";

		writeSse(
			response,
			`${mockResponse}\n\nLast user message:\n${lastUserMessage}`,
		);
		return;
	}

	if (request.method !== "GET" && request.method !== "HEAD") {
		writeJson(response, 405, { error: `Method ${request.method} not allowed` });
		return;
	}

	await serveStatic(response, requestPath);
});

server.listen(PORT, HOST, () => {
	console.log(`Local mock chat server running at http://${HOST}:${PORT}/chatproxy/`);
});
