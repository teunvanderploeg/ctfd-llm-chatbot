/**
 * LLM Chat App Frontend
 *
 * Handles the multi-thread chat UI, browser persistence, and communication
 * with the backend API.
 */

marked.setOptions({
	breaks: true,
	gfm: true,
	headerIds: false,
	mangle: false,
});

const STORAGE_KEY = "ctc-chat-state-v1";
const DEFAULT_THREAD_TITLE = "New Chat";
const DEFAULT_GREETING = "Hello! I'm the CTC chat app! How can I help you today?";
const MOBILE_MEDIA_QUERY = "(max-width: 900px)";
const UNGROUPED_GROUP_LABEL = "Other Chats";
const MENU_TRIGGER_ICON_SVG =
	'<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"></circle><circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none"></circle></svg>';
const RENAME_ICON_SVG =
	'<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h4.5L19 9.5 14.5 5 4 15.5V20Z" stroke-width="1.8" stroke-linejoin="round"></path><path d="M12.5 7 17 11.5" stroke-width="1.8" stroke-linecap="round"></path></svg>';
const DELETE_ICON_SVG =
	'<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7h14" stroke-width="1.8" stroke-linecap="round"></path><path d="M9 7V4.5h6V7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path><path d="M8 10v7" stroke-width="1.8" stroke-linecap="round"></path><path d="M12 10v7" stroke-width="1.8" stroke-linecap="round"></path><path d="M16 10v7" stroke-width="1.8" stroke-linecap="round"></path><path d="M6.5 7 7 19h10l.5-12" stroke-width="1.8" stroke-linejoin="round"></path></svg>';
const COPY_ICON_SVG =
	'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2"></rect><path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"></path></svg>';
const CHECK_ICON_SVG =
	'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 9.5 17 19 7.5"></path></svg>';

const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");
const threadList = document.getElementById("thread-list");
const newThreadButton = document.getElementById("new-thread-button");
const newGroupButton = document.getElementById("new-group-button");
const sidebarToggle = document.getElementById("sidebar-toggle");
const sidebarCloseButton = document.getElementById("sidebar-close-button");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const threadSidebar = document.getElementById("thread-sidebar");
const nameModal = document.getElementById("name-modal");
const nameDialogTitle = document.getElementById("name-dialog-title");
const nameDialogInput = document.getElementById("name-dialog-input");
const nameDialogError = document.getElementById("name-dialog-error");
const nameDialogForm = document.getElementById("name-dialog-form");
const nameDialogCancelButton = document.getElementById("name-dialog-cancel");
const nameDialogSubmitButton = document.getElementById("name-dialog-submit");
const nameDialogCloseButton = document.getElementById("name-dialog-close");

const basePath = window.location.pathname.startsWith("/chatproxy") ? "/chatproxy" : "";
const pendingThreads = new Set();

let threads = [];
let groups = [];
let activeThreadId = null;
let isSidebarOpen = false;
let isDesktopSidebarVisible = true;
let openThreadMenuId = null;
let openGroupMenuName = null;
let draggedThreadId = null;
let activeNameDialog = null;

function resizeUserInput() {
	userInput.style.height = "auto";

	const maxHeight = parseFloat(getComputedStyle(userInput).maxHeight);
	const nextHeight = Number.isNaN(maxHeight)
		? userInput.scrollHeight
		: Math.min(userInput.scrollHeight, maxHeight);

	userInput.style.height = `${nextHeight}px`;
	userInput.style.overflowY = userInput.scrollHeight > nextHeight ? "auto" : "hidden";
}

function generateThreadId() {
	return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getNowIso() {
	return new Date().toISOString();
}

function createGreetingMessage() {
	return { role: "assistant", content: DEFAULT_GREETING, isError: false };
}

function createThread() {
	const now = getNowIso();
	return {
		id: generateThreadId(),
		title: DEFAULT_THREAD_TITLE,
		titleSource: "auto",
		groupName: "",
		messages: [createGreetingMessage()],
		createdAt: now,
		updatedAt: now,
		viewedAt: now,
		ended: false,
	};
}

function isUntouchedThread(thread) {
	return (
		thread &&
		!thread.ended &&
		!pendingThreads.has(thread.id) &&
		thread.titleSource === "auto" &&
		thread.title === DEFAULT_THREAD_TITLE &&
		thread.messages.length === 1 &&
		thread.messages[0]?.role === "assistant" &&
		thread.messages[0]?.content === DEFAULT_GREETING &&
		thread.messages[0]?.isError === false
	);
}

function normalizeMessage(raw) {
	if (!raw || typeof raw.content !== "string") return null;
	if (!["system", "user", "assistant"].includes(raw.role)) return null;

	return {
		role: raw.role,
		content: raw.content,
		isError: Boolean(raw.isError),
	};
}

function normalizeThread(raw) {
	if (!raw || typeof raw !== "object") return null;

	const messages = Array.isArray(raw.messages)
		? raw.messages.map(normalizeMessage).filter(Boolean)
		: [];

	const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : getNowIso();
	const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt;
	const viewedAt = typeof raw.viewedAt === "string" ? raw.viewedAt : updatedAt;

	return {
		id: typeof raw.id === "string" && raw.id ? raw.id : generateThreadId(),
		title:
			typeof raw.title === "string" && raw.title.trim()
				? raw.title.trim()
				: DEFAULT_THREAD_TITLE,
		titleSource: raw.titleSource === "manual" ? "manual" : "auto",
		groupName: typeof raw.groupName === "string" ? raw.groupName.trim() : "",
		messages: messages.length > 0 ? messages : [createGreetingMessage()],
		createdAt,
		updatedAt,
		viewedAt,
		ended: Boolean(raw.ended),
	};
}

function normalizeGroupName(value) {
	return typeof value === "string" ? value.trim() : "";
}

function isReservedGroupName(value) {
	return normalizeGroupName(value) === UNGROUPED_GROUP_LABEL;
}

function normalizeGroups(rawGroups, sourceThreads) {
	const normalizedGroups = [];
	const seen = new Set();

	for (const rawGroup of Array.isArray(rawGroups) ? rawGroups : []) {
		const name = normalizeGroupName(rawGroup);
		if (!name || isReservedGroupName(name) || seen.has(name)) continue;
		seen.add(name);
		normalizedGroups.push(name);
	}

	for (const thread of sourceThreads) {
		const name = normalizeGroupName(thread.groupName);
		if (!name || isReservedGroupName(name) || seen.has(name)) continue;
		seen.add(name);
		normalizedGroups.push(name);
	}

	return normalizedGroups;
}

function getThreadById(threadId) {
	return threads.find((thread) => thread.id === threadId) || null;
}

function validateGroupName(value, currentName = "") {
	if (!value) return "Enter a group name.";
	if (isReservedGroupName(value)) return `"${UNGROUPED_GROUP_LABEL}" is reserved.`;
	if (value !== currentName && groups.includes(value)) return "That group already exists.";
	return "";
}

function loadState() {
	try {
		const rawState = localStorage.getItem(STORAGE_KEY);
		if (!rawState) return;

		const parsed = JSON.parse(rawState);
		if (!parsed || !Array.isArray(parsed.threads)) return;

		const normalizedThreads = parsed.threads.map(normalizeThread).filter(Boolean);
		if (normalizedThreads.length === 0) return;

		threads = normalizedThreads;
		groups = normalizeGroups(parsed.groups, normalizedThreads);
		activeThreadId = normalizedThreads.some((thread) => thread.id === parsed.activeThreadId)
			? parsed.activeThreadId
			: normalizedThreads[0].id;
		if (typeof parsed.sidebarVisible === "boolean") {
			isDesktopSidebarVisible = parsed.sidebarVisible;
		}
	} catch (error) {
		console.warn("Failed to restore chat state:", error);
	}
}

function persistState() {
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				activeThreadId,
				groups,
				sidebarVisible: isDesktopSidebarVisible,
				threads,
			}),
		);
	} catch (error) {
		console.warn("Failed to persist chat state:", error);
	}
}

function getActiveThread() {
	return getThreadById(activeThreadId);
}

function replaceThread(nextThread) {
	threads = threads.map((thread) => (thread.id === nextThread.id ? nextThread : thread));
}

function updateThread(threadId, updater) {
	const thread = getThreadById(threadId);
	if (!thread) return null;

	const nextThread = updater(thread);
	if (!nextThread) return null;

	replaceThread(nextThread);
	return nextThread;
}

function setThreadViewed(threadId, viewedAt = getNowIso()) {
	return updateThread(threadId, (thread) => ({ ...thread, viewedAt }));
}

function setThreadTitle(threadId, title) {
	return updateThread(threadId, (thread) => ({
		...thread,
		title,
		titleSource: "manual",
	}));
}

function assignThreadToGroup(threadId, groupName) {
	const normalizedGroupName = normalizeGroupName(groupName);

	return updateThread(threadId, (thread) => {
		if (thread.groupName === normalizedGroupName) return null;
		return {
			...thread,
			groupName: normalizedGroupName,
		};
	});
}

function addGroup(groupName) {
	if (!groupName || groups.includes(groupName)) return false;
	groups = [...groups, groupName];
	return true;
}

function renameGroupInState(currentName, nextName) {
	let didRename = false;
	threads = threads.map((thread) => {
		if (normalizeGroupName(thread.groupName) !== currentName) {
			return thread;
		}

		didRename = true;
		return { ...thread, groupName: nextName };
	});

	if (!didRename) return false;

	groups = groups.map((name) => (name === currentName ? nextName : name));
	return true;
}

function dissolveGroup(groupName) {
	let didChange = false;
	threads = threads.map((thread) => {
		if (normalizeGroupName(thread.groupName) !== groupName) {
			return thread;
		}

		didChange = true;
		return { ...thread, groupName: "" };
	});

	if (!groups.includes(groupName)) return didChange;

	groups = groups.filter((name) => name !== groupName);
	return true;
}

function selectLatestThread(threadList = threads) {
	return [...threadList].sort(compareThreadDates)[0] || null;
}

function renderViews(view = "all") {
	if (view === "threadList") {
		renderThreadList();
		return;
	}

	if (view === "activeThread") {
		renderActiveThread();
		return;
	}

	renderAll();
}

function closeOpenMenus(shouldRender = false) {
	const hadOpenMenus = Boolean(openThreadMenuId || openGroupMenuName);
	openThreadMenuId = null;
	openGroupMenuName = null;

	if (shouldRender && hadOpenMenus) {
		renderThreadList();
	}
}

function isNameDialogOpen() {
	return Boolean(activeNameDialog);
}

function setNameDialogVisibility(visible) {
	nameModal.classList.toggle("visible", visible);
	nameModal.setAttribute("aria-hidden", visible ? "false" : "true");
	document.body.classList.toggle("name-dialog-open", visible);
}

function clearNameDialogError() {
	nameDialogError.textContent = "";
	nameDialogError.classList.remove("visible");
}

function showNameDialogError(message) {
	nameDialogError.textContent = message;
	nameDialogError.classList.add("visible");
}

function closeNameDialog(result = null) {
	if (!activeNameDialog) return;

	const { resolve, returnFocusTo } = activeNameDialog;
	activeNameDialog = null;
	nameDialogForm.reset();
	clearNameDialogError();
	setNameDialogVisibility(false);
	resolve(result);

	if (returnFocusTo instanceof HTMLElement && document.contains(returnFocusTo)) {
		returnFocusTo.focus();
	}
}

function openNameDialog({
	title,
	submitLabel,
	initialValue = "",
	placeholder = "Type a name",
	validate,
}) {
	if (activeNameDialog) {
		closeNameDialog();
	}

	const returnFocusTo = document.activeElement;

	nameDialogTitle.textContent = title;
	nameDialogSubmitButton.textContent = submitLabel;
	nameDialogInput.value = initialValue;
	nameDialogInput.placeholder = placeholder;
	clearNameDialogError();
	setNameDialogVisibility(true);
	closeOpenMenus(true);

	return new Promise((resolve) => {
		activeNameDialog = {
			resolve,
			returnFocusTo,
			validate:
				typeof validate === "function"
					? validate
					: (value) => (value ? "" : "Enter a name."),
		};

		window.requestAnimationFrame(() => {
			nameDialogInput.focus();
			nameDialogInput.select();
		});
	});
}

function submitNameDialog() {
	if (!activeNameDialog) return;

	const value = nameDialogInput.value.trim();
	const error = activeNameDialog.validate(value);
	if (error) {
		showNameDialogError(error);
		nameDialogInput.focus();
		return;
	}

	closeNameDialog(value);
}

function setSidebarOpen(open) {
	if (!open) {
		closeOpenMenus(true);
	}

	isSidebarOpen = open;
	threadSidebar.classList.toggle("open", open);
	sidebarBackdrop.classList.toggle("visible", open);
	document.body.classList.toggle("sidebar-open", open);
}

function applyDesktopSidebarVisibility() {
	document.body.classList.toggle("sidebar-collapsed", !isDesktopSidebarVisible);
}

function isMobileViewport() {
	return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function toggleSidebarVisibility() {
	if (isMobileViewport()) {
		setSidebarOpen(!isSidebarOpen);
		return;
	}

	isDesktopSidebarVisible = !isDesktopSidebarVisible;
	closeOpenMenus(true);
	applyDesktopSidebarVisibility();
	persistState();
}

function closeSidebarVisibility() {
	if (isMobileViewport()) {
		setSidebarOpen(false);
		return;
	}

	if (!isDesktopSidebarVisible) return;

	isDesktopSidebarVisible = false;
	closeOpenMenus(true);
	applyDesktopSidebarVisibility();
	persistState();
}

function scrollMessagesToBottom() {
	chatMessages.scrollTop = chatMessages.scrollHeight;
}

function focusComposer() {
	if (!userInput.disabled) {
		userInput.focus();
	}
}

function clearComposer() {
	userInput.value = "";
	resizeUserInput();
}

function getThreadTitleFromMessage(content) {
	const normalized = content.replace(/\s+/g, " ").trim();
	if (!normalized) return DEFAULT_THREAD_TITLE;
	return normalized.length > 48 ? `${normalized.slice(0, 45)}...` : normalized;
}

function getThreadRelativeTime(updatedAt) {
	const deltaSeconds = Math.max(0, Math.round((Date.now() - new Date(updatedAt).getTime()) / 1000));
	if (deltaSeconds < 30) return "now";
	if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m`;
	if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h`;
	if (deltaSeconds < 604800) return `${Math.floor(deltaSeconds / 86400)}d`;
	return `${Math.floor(deltaSeconds / 604800)}w`;
}

function getThreadStatus(thread) {
	if (pendingThreads.has(thread.id)) {
		return "Thinking";
	}

	if (thread.ended) {
		return "Limit";
	}

	const latestAssistantMessage = [...thread.messages]
		.reverse()
		.find((message) => message.role === "assistant" && message.content.trim());

	if (latestAssistantMessage?.isError) {
		return "Error";
	}

	return getThreadRelativeTime(thread.updatedAt);
}

function hasUnreadUpdates(thread) {
	return new Date(thread.updatedAt).getTime() > new Date(thread.viewedAt || thread.updatedAt).getTime();
}

function isRecentlyUpdated(thread) {
	return Date.now() - new Date(thread.updatedAt).getTime() < 10 * 60 * 1000;
}

function groupThreadsForDisplay(sourceThreads) {
	const threadsByGroup = new Map();
	for (const groupName of groups) {
		threadsByGroup.set(groupName, []);
	}

	const ungroupedThreads = [];

	for (const thread of sourceThreads) {
		const groupName = normalizeGroupName(thread.groupName);
		if (!groupName) {
			ungroupedThreads.push(thread);
			continue;
		}

		if (!threadsByGroup.has(groupName)) {
			threadsByGroup.set(groupName, []);
		}
		threadsByGroup.get(groupName).push(thread);
	}

	const orderedGroups = [...threadsByGroup.entries()].map(([groupName, groupThreads]) => ({
		label: groupName,
		groupName,
		threads: groupThreads.sort(compareThreadDates),
	}));

	orderedGroups.push({
		label: UNGROUPED_GROUP_LABEL,
		groupName: "",
		threads: ungroupedThreads.sort(compareThreadDates),
	});

	return orderedGroups;
}

function groupHasPendingThreads(groupName) {
	return threads.some(
		(thread) => normalizeGroupName(thread.groupName) === groupName && pendingThreads.has(thread.id),
	);
}

function compareThreadDates(a, b) {
	return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function createMenuTrigger({ actionType, idType, identifier, label, isOpen, disabled }) {
	const menuTrigger = document.createElement("button");
	menuTrigger.className = "thread-menu-trigger";
	menuTrigger.type = "button";
	menuTrigger.dataset[actionType] = "toggle-menu";
	menuTrigger.dataset[idType] = identifier;
	menuTrigger.disabled = disabled;
	menuTrigger.setAttribute("aria-label", label);
	menuTrigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
	menuTrigger.innerHTML = MENU_TRIGGER_ICON_SVG;
	return menuTrigger;
}

function createMenuButton({
	actionType,
	idType,
	identifier,
	action,
	label,
	title,
	iconSvg,
	disabled,
	danger = false,
}) {
	const button = document.createElement("button");
	button.className = `thread-menu-item${danger ? " delete" : ""}`;
	button.type = "button";
	button.dataset[actionType] = action;
	button.dataset[idType] = identifier;
	button.disabled = disabled;
	button.setAttribute("aria-label", label);
	button.setAttribute("title", title);
	button.innerHTML = iconSvg;
	return button;
}

function createThreadActions(thread) {
	const isOpen = openThreadMenuId === thread.id;
	const isPending = pendingThreads.has(thread.id);
	const actions = document.createElement("div");
	actions.className = `thread-actions${isOpen ? " open" : ""}`;

	const menu = document.createElement("div");
	menu.className = "thread-menu";
	menu.appendChild(
		createMenuButton({
			actionType: "threadAction",
			idType: "threadId",
			identifier: thread.id,
			action: "rename",
			label: `Rename chat ${thread.title}`,
			title: "Rename chat",
			iconSvg: RENAME_ICON_SVG,
			disabled: isPending,
		}),
	);
	menu.appendChild(
		createMenuButton({
			actionType: "threadAction",
			idType: "threadId",
			identifier: thread.id,
			action: "delete",
			label: `Delete chat ${thread.title}`,
			title: "Delete chat",
			iconSvg: DELETE_ICON_SVG,
			disabled: isPending,
			danger: true,
		}),
	);

	actions.appendChild(
		createMenuTrigger({
			actionType: "threadAction",
			idType: "threadId",
			identifier: thread.id,
			label: `Open actions for ${thread.title}`,
			isOpen,
			disabled: isPending,
		}),
	);
	actions.appendChild(menu);
	return actions;
}

function createGroupActions(groupName) {
	const isOpen = openGroupMenuName === groupName;
	const isDisabled = groupHasPendingThreads(groupName);
	const actions = document.createElement("div");
	actions.className = `thread-actions${isOpen ? " open" : ""}`;

	const menu = document.createElement("div");
	menu.className = "thread-menu";
	menu.appendChild(
		createMenuButton({
			actionType: "groupAction",
			idType: "groupName",
			identifier: groupName,
			action: "rename",
			label: `Rename group ${groupName}`,
			title: "Rename group",
			iconSvg: RENAME_ICON_SVG,
			disabled: isDisabled,
		}),
	);
	menu.appendChild(
		createMenuButton({
			actionType: "groupAction",
			idType: "groupName",
			identifier: groupName,
			action: "remove",
			label: `Remove group ${groupName}`,
			title: "Remove group",
			iconSvg: DELETE_ICON_SVG,
			disabled: isDisabled,
			danger: true,
		}),
	);

	actions.appendChild(
		createMenuTrigger({
			actionType: "groupAction",
			idType: "groupName",
			identifier: groupName,
			label: `Open actions for ${groupName}`,
			isOpen,
			disabled: isDisabled,
		}),
	);
	actions.appendChild(menu);
	return actions;
}

function renderThreadList() {
	threadList.innerHTML = "";

	for (const group of groupThreadsForDisplay(threads)) {
		const groupItem = document.createElement("li");
		groupItem.className = "thread-group";
		groupItem.dataset.groupName = group.groupName;

		const groupHeader = document.createElement("div");
		groupHeader.className = "thread-group-header";

		const groupLabel = document.createElement("div");
		groupLabel.className = "thread-group-label";
		groupLabel.textContent = group.label;
		groupHeader.appendChild(groupLabel);

		if (group.groupName) {
			groupHeader.appendChild(createGroupActions(group.groupName));
		}

		groupItem.appendChild(groupHeader);

		const groupBody = document.createElement("div");
		groupBody.className = "thread-group-body";

		for (const thread of group.threads) {
			const isUnread = thread.id !== activeThreadId && hasUnreadUpdates(thread);
			const item = document.createElement("div");
			item.className = `thread-list-item${thread.id === activeThreadId ? " active" : ""}`;
			item.dataset.threadId = thread.id;
			item.draggable = !pendingThreads.has(thread.id);

			const selectButton = document.createElement("button");
			selectButton.className = "thread-button";
			selectButton.type = "button";
			selectButton.dataset.threadId = thread.id;

			const leading = document.createElement("span");
			leading.className = "thread-button-leading";

			const unreadDot = document.createElement("span");
			unreadDot.className = `thread-unread-dot${isUnread ? "" : " hidden"}`;
			leading.appendChild(unreadDot);

			const title = document.createElement("span");
			title.className = "thread-button-title";
			title.textContent = thread.title;

			const meta = document.createElement("span");
			meta.className = "thread-button-meta";
			meta.textContent = getThreadStatus(thread);
			if (isUnread) {
				meta.classList.add("unread");
			} else if (isRecentlyUpdated(thread)) {
				meta.classList.add("recent");
			}

			const top = document.createElement("span");
			top.className = "thread-button-top";
			top.appendChild(leading);
			top.appendChild(title);
			top.appendChild(meta);

			selectButton.appendChild(top);
			item.appendChild(selectButton);
			item.appendChild(createThreadActions(thread));
			groupBody.appendChild(item);
		}

		if (group.threads.length === 0) {
			const emptyState = document.createElement("div");
			emptyState.className = "thread-group-empty";
			emptyState.textContent = "Drop chats here";
			groupBody.appendChild(emptyState);
		}

		groupItem.appendChild(groupBody);
		threadList.appendChild(groupItem);
	}
}

function renderMessage(message) {
	if (message.role === "system") return null;
	if (message.role === "assistant" && !message.content) return null;

	const messageEl = document.createElement("div");
	messageEl.className = `message ${message.role}-message${message.isError ? " error-message" : ""}`;

	if (message.role === "user") {
		const paragraph = document.createElement("p");
		paragraph.textContent = message.content;
		messageEl.appendChild(paragraph);
		return messageEl;
	}

	const content = document.createElement("div");
	content.innerHTML = DOMPurify.sanitize(marked.parse(message.content));
	if (!message.isError) {
		const actions = document.createElement("div");
		actions.className = "message-actions";

		const copyButton = document.createElement("button");
		copyButton.className = "message-action-button";
		copyButton.type = "button";
		copyButton.dataset.messageAction = "copy-answer";
		copyButton.dataset.messageContent = message.content;
		copyButton.dataset.originalIcon = COPY_ICON_SVG;
		copyButton.innerHTML = COPY_ICON_SVG;
		copyButton.setAttribute("aria-label", "Copy answer");
		copyButton.setAttribute("title", "Copy answer");
		actions.appendChild(copyButton);
		messageEl.appendChild(actions);
	}

	for (const pre of content.querySelectorAll("pre")) {
		const code = pre.querySelector("code");
		if (!code) continue;

		const wrap = document.createElement("div");
		wrap.className = "code-block-wrap";
		pre.parentNode.insertBefore(wrap, pre);
		wrap.appendChild(pre);

		const copyButton = document.createElement("button");
		copyButton.className = "code-copy-button";
		copyButton.type = "button";
		copyButton.dataset.messageAction = "copy-code";
		copyButton.dataset.messageContent = code.textContent || "";
		copyButton.dataset.originalIcon = COPY_ICON_SVG;
		copyButton.innerHTML = COPY_ICON_SVG;
		copyButton.setAttribute("aria-label", "Copy code");
		copyButton.setAttribute("title", "Copy code");
		wrap.appendChild(copyButton);
	}

	messageEl.appendChild(content);
	return messageEl;
}

function renderActiveThread() {
	const activeThread = getActiveThread();
	chatMessages.innerHTML = "";

	if (!activeThread) return;

	for (const message of activeThread.messages) {
		const messageEl = renderMessage(message);
		if (messageEl) {
			chatMessages.appendChild(messageEl);
		}
	}

	scrollMessagesToBottom();
}

function updateComposerState() {
	const activeThread = getActiveThread();
	const isPending = activeThread ? pendingThreads.has(activeThread.id) : false;
	const isEnded = Boolean(activeThread?.ended);

	typingIndicator.classList.toggle("visible", isPending);

	if (isEnded) {
		typingIndicator.classList.remove("visible");
		userInput.disabled = true;
		userInput.placeholder = "This chat reached the history limit. Start a new chat.";
		sendButton.textContent = "New chat";
		sendButton.disabled = false;
		resizeUserInput();
		return;
	}

	userInput.disabled = isPending;
	userInput.placeholder = "Type your message here...";
	sendButton.textContent = "Send";
	sendButton.disabled = isPending;
	resizeUserInput();
}

function renderAll() {
	renderThreadList();
	renderActiveThread();
	updateComposerState();
}

function setActiveThread(threadId) {
	if (!getThreadById(threadId)) return;

	activeThreadId = threadId;
	closeOpenMenus();
	setThreadViewed(threadId);
	clearComposer();
	persistState();
	renderAll();

	if (isMobileViewport()) {
		setSidebarOpen(false);
	}

	focusComposer();
}

function createNewThread() {
	const reusableThread = [...threads]
		.filter((thread) => isUntouchedThread(thread) && !normalizeGroupName(thread.groupName))
		.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

	if (reusableThread) {
		setActiveThread(reusableThread.id);
		return;
	}

	const newThread = createThread();
	threads = [...threads, newThread];
	activeThreadId = newThread.id;
	closeOpenMenus();
	clearComposer();
	persistState();
	renderAll();

	if (isMobileViewport()) {
		setSidebarOpen(false);
	}

	focusComposer();
}

async function renameThread(threadId) {
	const thread = getThreadById(threadId);
	if (!thread) return;

	const trimmed = await openNameDialog({
		title: "Rename chat",
		submitLabel: "Save",
		initialValue: thread.title,
		placeholder: "Chat name",
		validate: (value) => (value ? "" : "Enter a chat name."),
	});
	if (trimmed === null) return;

	setThreadTitle(threadId, trimmed);

	closeOpenMenus();
	persistState();
	renderAll();
}

async function createGroup() {
	const groupName = await openNameDialog({
		title: "Create group",
		submitLabel: "Create",
		placeholder: "Group name",
		validate: validateGroupName,
	});
	if (groupName === null) return;

	addGroup(groupName);
	closeOpenMenus();
	persistState();
	renderViews("threadList");
}

function moveThreadToGroup(threadId, groupName) {
	const updatedThread = assignThreadToGroup(threadId, groupName);
	if (!updatedThread) return;

	const normalizedGroupName = normalizeGroupName(groupName);
	if (normalizedGroupName && !groups.includes(normalizedGroupName)) {
		addGroup(normalizedGroupName);
	}

	closeOpenMenus();
	persistState();
	renderAll();
}

function deleteThread(threadId) {
	if (pendingThreads.has(threadId)) return;

	const remainingThreads = threads.filter((thread) => thread.id !== threadId);
	threads = remainingThreads.length > 0 ? remainingThreads : [createThread()];

	if (!threads.some((thread) => thread.id === activeThreadId)) {
		activeThreadId = selectLatestThread(threads)?.id || null;
	}

	closeOpenMenus();
	clearComposer();
	persistState();
	renderAll();
	focusComposer();
}

function toggleThreadMenu(threadId) {
	openThreadMenuId = openThreadMenuId === threadId ? null : threadId;
	openGroupMenuName = null;
	renderThreadList();
}

function toggleGroupMenu(groupName) {
	openGroupMenuName = openGroupMenuName === groupName ? null : groupName;
	openThreadMenuId = null;
	renderThreadList();
}

async function renameGroup(groupName) {
	const normalizedCurrent = normalizeGroupName(groupName);
	if (!normalizedCurrent || isReservedGroupName(normalizedCurrent) || groupHasPendingThreads(normalizedCurrent)) {
		return;
	}

	const normalizedNext = await openNameDialog({
		title: "Rename group",
		submitLabel: "Save",
		initialValue: normalizedCurrent,
		placeholder: "Group name",
		validate: (value) => validateGroupName(value, normalizedCurrent),
	});
	if (normalizedNext === null) return;

	if (normalizedNext === normalizedCurrent) {
		closeOpenMenus();
		renderViews("threadList");
		return;
	}

	renameGroupInState(normalizedCurrent, normalizedNext);
	closeOpenMenus();
	persistState();
	renderAll();
}

function removeGroup(groupName) {
	const normalizedGroupName = normalizeGroupName(groupName);
	if (
		!normalizedGroupName ||
		isReservedGroupName(normalizedGroupName) ||
		groupHasPendingThreads(normalizedGroupName)
	) {
		return;
	}

	const shouldRemove = window.confirm(
		`Remove "${normalizedGroupName}" and move its chats to ${UNGROUPED_GROUP_LABEL}?`,
	);
	if (!shouldRemove) return;

	dissolveGroup(normalizedGroupName);
	closeOpenMenus();
	persistState();
	renderAll();
}

function clearGroupDragHighlights() {
	threadList.querySelectorAll(".thread-group.drag-over").forEach((group) => {
		group.classList.remove("drag-over");
	});
}

function updateThreadMessages(threadId, updater, options = {}) {
	return updateThread(threadId, (thread) => {
		const updatedMessages = updater([...thread.messages]);
		if (!updatedMessages) return null;

		return {
			...thread,
			messages: updatedMessages,
			updatedAt: options.touch === false ? thread.updatedAt : getNowIso(),
			viewedAt:
				options.markViewed === true
					? getNowIso()
					: options.markViewed === false
						? thread.viewedAt
						: thread.id === activeThreadId
							? getNowIso()
							: thread.viewedAt,
			ended: options.ended ?? thread.ended,
		};
	});
}

function getRequestMessages(thread) {
	return thread.messages
		.filter((message) => !message.isError && ["system", "user", "assistant"].includes(message.role))
		.map(({ role, content }) => ({ role, content }));
}

function extractErrorMessage(body) {
	if (!body || !body.error) return null;

	let err = body.error;

	if (typeof err === "string") {
		try {
			err = JSON.parse(err);
		} catch {
			return err;
		}
	}

	if (typeof err === "string") return err;
	if (err.message) return err.message;
	if (Array.isArray(err) && err[0]?.message) return err[0].message;
	if (Array.isArray(err.error) && err.error[0]?.message) return err.error[0].message;

	return "An unknown error occurred";
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

		if (dataLines.length > 0) {
			events.push(dataLines.join("\n"));
		}
	}

	return { events, buffer: normalized };
}

async function copyTextToClipboard(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch (error) {
		console.error("Clipboard copy failed:", error);
		return false;
	}
}

function setTemporaryButtonIcon(button, iconSvg, timeoutMs = 1200) {
	const originalIcon = button.dataset.originalIcon || button.innerHTML;
	button.innerHTML = iconSvg;

	window.setTimeout(() => {
		button.innerHTML = originalIcon;
	}, timeoutMs);
}

function removeTrailingEmptyAssistantMessage(messages) {
	const nextMessages = [...messages];
	if (nextMessages.at(-1)?.role === "assistant" && !nextMessages.at(-1)?.content) {
		nextMessages.pop();
	}
	return nextMessages;
}

function appendAssistantErrorMessage(messages, content) {
	return [
		...removeTrailingEmptyAssistantMessage(messages),
		{ role: "assistant", content, isError: true },
	];
}

function prepareOutgoingThread(thread, message) {
	const shouldAutoTitle =
		thread.titleSource !== "manual" && thread.messages.filter((item) => item.role === "user").length === 0;

	return {
		...thread,
		title: shouldAutoTitle ? getThreadTitleFromMessage(message) : thread.title,
		messages: [...thread.messages, { role: "user", content: message, isError: false }, createAssistantPlaceholder()],
		updatedAt: getNowIso(),
	};
}

function createAssistantPlaceholder() {
	return { role: "assistant", content: "", isError: false };
}

async function requestChatResponse(thread) {
	if (!thread) {
		throw new Error("Chat thread not found.");
	}

	const response = await fetch(`${basePath}/api/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify({
			messages: getRequestMessages(thread),
			conversationId: thread.id,
		}),
	});

	if (response.ok) {
		return response;
	}

	const body = await response.json().catch(() => ({}));
	if (body.code === "HISTORY_TOO_LONG") {
		const error = new Error("HISTORY_TOO_LONG");
		error.cause = body;
		throw error;
	}

	throw new Error(extractErrorMessage(body) || `Request failed (${response.status})`);
}

function applyAssistantChunk(threadId, content, markViewed) {
	updateThreadMessages(
		threadId,
		(messages) => {
			const nextMessages = [...messages];
			const lastMessage = nextMessages.at(-1);
			if (!lastMessage || lastMessage.role !== "assistant") {
				return nextMessages;
			}

			nextMessages[nextMessages.length - 1] = {
				...lastMessage,
				content,
			};
			return nextMessages;
		},
		{ touch: false, markViewed },
	);
}

function finalizeAssistantPlaceholder(threadId) {
	updateThreadMessages(threadId, (messages) => removeTrailingEmptyAssistantMessage(messages));
}

function failThreadResponse(threadId, message, options = {}) {
	updateThreadMessages(
		threadId,
		(messages) => appendAssistantErrorMessage(messages, message),
		{ ended: options.ended },
	);
}

function handleRequestError(threadId, error) {
	if (error instanceof Error && error.message === "HISTORY_TOO_LONG") {
		const body = error.cause && typeof error.cause === "object" ? error.cause : {};
		failThreadResponse(
			threadId,
			`${body.error || "Chat history too long"}. Start a new chat to continue.`,
			{ ended: true },
		);
		return;
	}

	failThreadResponse(
		threadId,
		error instanceof Error ? error.message : "Something went wrong.",
	);
}

async function streamChatResponse(threadId, response) {
	if (!response.body) {
		throw new Error("Response body is null");
	}

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
				throw new Error("An error occurred");
			}

			const content = json.response ?? json.choices?.[0]?.delta?.content ?? "";
			if (!content) continue;

			responseText += content;
			applyAssistantChunk(threadId, responseText, activeThreadId === threadId);
			persistState();
			if (activeThreadId === threadId) {
				renderViews("activeThread");
			}
		}

		if (done) break;
	}

	return responseText;
}

async function sendMessage() {
	const activeThread = getActiveThread();
	const message = userInput.value.trim();

	if (!activeThread || !message || pendingThreads.has(activeThread.id) || activeThread.ended) {
		return;
	}

	replaceThread(prepareOutgoingThread(activeThread, message));

	pendingThreads.add(activeThread.id);
	clearComposer();
	persistState();
	renderAll();

	try {
		const currentThread = getThreadById(activeThread.id);
		const response = await requestChatResponse(currentThread);
		const responseText = await streamChatResponse(activeThread.id, response);

		if (!responseText) {
			finalizeAssistantPlaceholder(activeThread.id);
		}
	} catch (error) {
		console.error("Error:", error);
		handleRequestError(activeThread.id, error);
	} finally {
		pendingThreads.delete(activeThread.id);
		persistState();
		renderAll();
		focusComposer();
	}
}

function handleSendButtonClick() {
	const activeThread = getActiveThread();
	if (activeThread?.ended) {
		createNewThread();
		return;
	}

	sendMessage();
}

userInput.addEventListener("input", resizeUserInput);

userInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		handleSendButtonClick();
	}
});

sendButton.addEventListener("click", handleSendButtonClick);
newThreadButton.addEventListener("click", createNewThread);
newGroupButton.addEventListener("click", createGroup);
sidebarToggle.addEventListener("click", toggleSidebarVisibility);
sidebarCloseButton.addEventListener("click", closeSidebarVisibility);
sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false));

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && isNameDialogOpen()) {
		event.preventDefault();
		closeNameDialog();
		return;
	}

	if (event.key === "Escape" && isSidebarOpen) {
		setSidebarOpen(false);
		return;
	}

	if (event.key === "Escape" && (openThreadMenuId || openGroupMenuName)) {
		closeOpenMenus();
		renderThreadList();
	}
});

document.addEventListener("click", (event) => {
	if (isNameDialogOpen() && event.target === nameModal) {
		closeNameDialog();
		return;
	}

	if (!openThreadMenuId && !openGroupMenuName) return;
	if (event.target.closest(".thread-actions")) return;

	closeOpenMenus();
	renderThreadList();
});

nameDialogForm.addEventListener("submit", (event) => {
	event.preventDefault();
	submitNameDialog();
});

nameDialogInput.addEventListener("input", () => {
	if (nameDialogError.textContent) {
		clearNameDialogError();
	}
});

nameDialogCancelButton.addEventListener("click", () => closeNameDialog());
nameDialogCloseButton.addEventListener("click", () => closeNameDialog());

threadList.addEventListener("click", (event) => {
	const groupActionButton = event.target.closest("[data-group-action]");
	if (groupActionButton) {
		const groupName = groupActionButton.dataset.groupName;
		if (!groupName) return;

		if (groupActionButton.dataset.groupAction === "toggle-menu") {
			toggleGroupMenu(groupName);
			return;
		}

		if (groupActionButton.dataset.groupAction === "rename") {
			renameGroup(groupName);
			return;
		}

		if (groupActionButton.dataset.groupAction === "remove") {
			removeGroup(groupName);
		}
		return;
	}

	const actionButton = event.target.closest("[data-thread-action]");
	if (actionButton) {
		const threadId = actionButton.dataset.threadId;
		if (!threadId) return;

		if (actionButton.dataset.threadAction === "toggle-menu") {
			toggleThreadMenu(threadId);
			return;
		}

		if (actionButton.dataset.threadAction === "rename") {
			renameThread(threadId);
			return;
		}

		if (actionButton.dataset.threadAction === "delete") {
			deleteThread(threadId);
		}
		return;
	}

	const threadItem = event.target.closest(".thread-list-item[data-thread-id]");
	if (!threadItem || event.target.closest(".thread-actions")) return;

	setActiveThread(threadItem.dataset.threadId);
});

threadList.addEventListener("dragstart", (event) => {
	const threadItem = event.target.closest(".thread-list-item[data-thread-id]");
	if (!threadItem) return;

	draggedThreadId = threadItem.dataset.threadId;
	threadItem.classList.add("dragging");
	closeOpenMenus();

	if (event.dataTransfer) {
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", draggedThreadId);
	}
});

threadList.addEventListener("dragover", (event) => {
	if (!draggedThreadId) return;

	const groupTarget = event.target.closest(".thread-group[data-group-name]");
	if (!groupTarget) return;

	event.preventDefault();
	clearGroupDragHighlights();
	groupTarget.classList.add("drag-over");

	if (event.dataTransfer) {
		event.dataTransfer.dropEffect = "move";
	}
});

threadList.addEventListener("drop", (event) => {
	if (!draggedThreadId) return;

	const groupTarget = event.target.closest(".thread-group[data-group-name]");
	if (!groupTarget) return;

	event.preventDefault();
	const targetGroupName = groupTarget.dataset.groupName || "";
	moveThreadToGroup(draggedThreadId, targetGroupName);
	draggedThreadId = null;
	clearGroupDragHighlights();
});

threadList.addEventListener("dragend", () => {
	draggedThreadId = null;
	clearGroupDragHighlights();
	threadList.querySelectorAll(".thread-list-item.dragging").forEach((threadItem) => {
		threadItem.classList.remove("dragging");
	});
});

chatMessages.addEventListener("click", async (event) => {
	const actionButton = event.target.closest("[data-message-action]");
	if (!actionButton) return;

	const content = actionButton.dataset.messageContent || "";
	if (!content) return;

	const copied = await copyTextToClipboard(content);
	if (copied) {
		setTemporaryButtonIcon(actionButton, CHECK_ICON_SVG);
	}
});

window.addEventListener("resize", () => {
	if (!isMobileViewport() && isSidebarOpen) {
		setSidebarOpen(false);
	}
});

loadState();
applyDesktopSidebarVisibility();

if (threads.length === 0) {
	const initialThread = createThread();
	threads = [initialThread];
	activeThreadId = initialThread.id;
	persistState();
} else if (activeThreadId) {
	setThreadViewed(activeThreadId);
	persistState();
}

renderAll();
resizeUserInput();
focusComposer();
