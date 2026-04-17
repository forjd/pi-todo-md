import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";

export const TODO_FILE_NAME = "TODO.md";
export const DEFAULT_TITLE = "TODO";
export const DEFAULT_SECTION = "Tasks";
export const ARCHIVE_SECTION = "Archive";
export const TODO_SCHEMA_VERSION = 1;
export const SCHEMA_MARKER_PREFIX = "pi-todo-md:schema=";
export const ID_MARKER_PREFIX = "pi-todo-md:id=";

function cloneDocument(document) {
  return {
    schema: normalizeSchemaVersion(document.schema),
    title: document.title,
    sections: document.sections.map((section) => ({
      name: section.name,
      items: section.items.map((item) => ({
        ...item,
        focused: Boolean(item.focused),
        priority: normalizePriority(item.priority),
        notes: [...(item.notes ?? [])],
        subtasks: (item.subtasks ?? []).map((subtask) => ({ ...subtask })),
      })),
    })),
  };
}

export function sanitizeSingleLine(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function locateTodoFile(startDir) {
  const originalDir = resolve(startDir);
  let currentDir = originalDir;
  const rootDir = parse(currentDir).root;

  while (true) {
    const todoPath = join(currentDir, TODO_FILE_NAME);
    if (await pathExists(todoPath)) return todoPath;

    const gitMarker = join(currentDir, ".git");
    if (await pathExists(gitMarker)) return todoPath;

    if (currentDir === rootDir) break;
    currentDir = dirname(currentDir);
  }

  return join(originalDir, TODO_FILE_NAME);
}

function normalizeSectionName(value) {
  return sanitizeSingleLine(value) || DEFAULT_SECTION;
}

function normalizeTaskText(value) {
  const text = sanitizeSingleLine(value);
  if (!text) throw new Error("Task text is required.");
  return text;
}

function normalizeTaskTexts(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("At least one task is required.");
  }

  const tasks = values.map((value) => normalizeTaskText(value)).filter(Boolean);
  if (tasks.length === 0) throw new Error("At least one task is required.");
  return tasks;
}

function normalizeNoteLines(value) {
  const source = String(value ?? "").replace(/\r\n/g, "\n");
  const lines = source
    .split("\n")
    .map((line) => sanitizeSingleLine(line))
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error("At least one note line is required.");
  }

  return lines;
}

function normalizeIndex(index) {
  if (index === undefined || index === null) return undefined;
  const parsed = Number(index);
  if (!Number.isFinite(parsed)) throw new Error("index must be a number.");
  return Math.max(0, Math.floor(parsed) - 1);
}

function normalizeSubtaskIndex(index) {
  if (index === undefined || index === null) {
    throw new Error("A valid subtask number is required.");
  }

  const parsed = Number(index);
  if (!Number.isFinite(parsed)) throw new Error("subtask must be a number.");
  const normalized = Math.floor(parsed) - 1;
  if (normalized < 0) throw new Error("subtask must be at least 1.");
  return normalized;
}

function getNextId(document) {
  let nextId = 1;
  for (const section of document.sections) {
    for (const item of section.items) {
      nextId = Math.max(nextId, Number(item.id) + 1);
    }
  }
  return nextId;
}

function findSection(document, sectionName) {
  const normalizedName = normalizeSectionName(sectionName);
  return document.sections.find((section) => section.name.toLowerCase() === normalizedName.toLowerCase());
}

function ensureSection(document, sectionName) {
  const existing = findSection(document, sectionName);
  if (existing) return existing;

  const created = { name: normalizeSectionName(sectionName), items: [] };
  document.sections.push(created);
  return created;
}

function requireSection(document, sectionName) {
  const section = findSection(document, sectionName);
  if (!section) {
    throw new Error(`Section ${normalizeSectionName(sectionName)} was not found.`);
  }
  return section;
}

function findSectionIndex(document, sectionName) {
  const normalizedName = normalizeSectionName(sectionName);
  return document.sections.findIndex((section) => section.name.toLowerCase() === normalizedName.toLowerCase());
}

function insertItem(items, item, index) {
  const targetIndex = index === undefined ? items.length : Math.min(Math.max(index, 0), items.length);
  items.splice(targetIndex, 0, item);
  return targetIndex;
}

function normalizeSchemaVersion(value) {
  if (value === undefined || value === null || value === "") return TODO_SCHEMA_VERSION;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return TODO_SCHEMA_VERSION;
  return parsed;
}

function assertSupportedSchemaVersion(document) {
  const schema = normalizeSchemaVersion(document.schema);
  if (schema > TODO_SCHEMA_VERSION) {
    throw new Error(
      `TODO.md schema ${schema} is newer than this version of pi-todo-md supports (${TODO_SCHEMA_VERSION}). Please upgrade pi-todo-md.`,
    );
  }
}

const TODO_SCHEMA_MIGRATIONS = new Map([
  // Add future step migrations here, keyed by the source schema version.
  // Example: [1, migrateTodoSchema1To2],
]);

function applyTodoSchemaMigration(document, schema) {
  const migrate = TODO_SCHEMA_MIGRATIONS.get(schema);
  if (!migrate) {
    throw new Error(
      `TODO.md schema ${schema} is older than the current schema ${TODO_SCHEMA_VERSION}, but no migration path is registered.`,
    );
  }

  return {
    ...migrate(document),
    schema: schema + 1,
  };
}

export function migrateTodoDocument(document) {
  assertSupportedSchemaVersion(document);

  let migrated = cloneDocument(document);
  let schema = normalizeSchemaVersion(migrated.schema);

  while (schema < TODO_SCHEMA_VERSION) {
    migrated = applyTodoSchemaMigration(migrated, schema);
    schema = normalizeSchemaVersion(migrated.schema);
  }

  migrated.schema = TODO_SCHEMA_VERSION;
  return migrated;
}

function normalizePriority(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const priority = sanitizeSingleLine(value).toLowerCase();
  if (!["low", "medium", "high"].includes(priority)) {
    throw new Error("priority must be low, medium, or high.");
  }
  return priority;
}

function createTask(id, text, checked = false, options = {}) {
  return {
    id,
    text: normalizeTaskText(text),
    checked: Boolean(checked),
    focused: Boolean(options.focused),
    priority: normalizePriority(options.priority),
    notes: [],
    subtasks: [],
  };
}

function findItem(document, itemId) {
  const parsedId = Number(itemId);
  if (!Number.isInteger(parsedId) || parsedId < 1) {
    throw new Error("A valid numeric id is required.");
  }

  for (const section of document.sections) {
    const index = section.items.findIndex((item) => item.id === parsedId);
    if (index !== -1) {
      return {
        item: section.items[index],
        section,
        index,
      };
    }
  }

  throw new Error(`Task #${parsedId} was not found.`);
}

function findSubtask(item, subtaskIndex) {
  const normalizedIndex = normalizeSubtaskIndex(subtaskIndex);
  const subtasks = item.subtasks ?? [];
  if (normalizedIndex >= subtasks.length) {
    throw new Error(`Subtask ${normalizedIndex + 1} was not found on #${item.id}.`);
  }

  return {
    subtask: subtasks[normalizedIndex],
    index: normalizedIndex,
  };
}

function buildTaskView(item, sectionName) {
  return {
    id: item.id,
    text: item.text,
    checked: item.checked,
    focused: Boolean(item.focused),
    priority: normalizePriority(item.priority),
    section: sectionName,
    notes: [...(item.notes ?? [])],
    subtasks: (item.subtasks ?? []).map((subtask, index) => ({
      index: index + 1,
      text: subtask.text,
      checked: subtask.checked,
      parentId: item.id,
      section: sectionName,
    })),
  };
}

function renderTaskMetadata(item) {
  const markers = [];
  if (item.focused) markers.push("[focus]");
  if (item.priority) markers.push(`[${item.priority}]`);
  return markers.length > 0 ? ` ${markers.join(" ")}` : "";
}

function extractTaskMetadata(rawText) {
  let text = sanitizeSingleLine(rawText);
  let focused = false;
  let priority;

  while (true) {
    const match = text.match(/\s+\[(focus|low|medium|high)\]\s*$/i);
    if (!match) break;
    const marker = match[1].toLowerCase();
    if (marker === "focus") focused = true;
    else priority = marker;
    text = text.slice(0, match.index).trimEnd();
  }

  return {
    text: normalizeTaskText(text),
    focused,
    priority,
  };
}

function countOpenSubtasks(item) {
  return (item.subtasks ?? []).filter((subtask) => !subtask.checked).length;
}

export function recommendNextTask(document, options = {}) {
  const filterSection = options.section ? normalizeSectionName(options.section) : undefined;
  let best;

  document.sections.forEach((section, sectionIndex) => {
    if (section.name.toLowerCase() === ARCHIVE_SECTION.toLowerCase()) return;
    if (filterSection && section.name.toLowerCase() !== filterSection.toLowerCase()) return;

    section.items.forEach((item, itemIndex) => {
      if (item.checked) return;

      const candidate = {
        ...buildTaskView(item, section.name),
        openSubtasks: countOpenSubtasks(item),
        sectionIndex,
        itemIndex,
      };

      if (!best) {
        best = candidate;
        return;
      }

      if (candidate.focused && !best.focused) {
        best = candidate;
        return;
      }
      if (!candidate.focused && best.focused) {
        return;
      }

      const priorityRank = { high: 3, medium: 2, low: 1 };
      const candidatePriority = priorityRank[candidate.priority] ?? 0;
      const bestPriority = priorityRank[best.priority] ?? 0;
      if (candidatePriority > bestPriority) {
        best = candidate;
        return;
      }
      if (candidatePriority < bestPriority) {
        return;
      }

      const bestHasOpenSubtasks = best.openSubtasks > 0;
      const candidateHasOpenSubtasks = candidate.openSubtasks > 0;
      if (candidateHasOpenSubtasks && !bestHasOpenSubtasks) {
        best = candidate;
        return;
      }
      if (candidateHasOpenSubtasks === bestHasOpenSubtasks) {
        if (candidate.sectionIndex < best.sectionIndex) {
          best = candidate;
          return;
        }
        if (candidate.sectionIndex === best.sectionIndex && candidate.itemIndex < best.itemIndex) {
          best = candidate;
        }
      }
    });
  });

  return best;
}

export function getFocusedTasks(document, options = {}) {
  const limit = options.limit ?? Infinity;
  const tasks = [];

  for (const section of document.sections) {
    if (section.name.toLowerCase() === ARCHIVE_SECTION.toLowerCase()) continue;
    for (const item of section.items) {
      if (!item.focused || item.checked) continue;
      tasks.push(buildTaskView(item, section.name));
      if (tasks.length >= limit) return tasks;
    }
  }

  return tasks;
}

export function buildTodoContextSummary(document, options = {}) {
  const path = options.path ?? TODO_FILE_NAME;
  const focusedTasks = getFocusedTasks(document, { limit: options.maxFocused ?? 3 });
  const nextTask = recommendNextTask(document, options.section ? { section: options.section } : undefined);
  const sections = document.sections.map(buildSectionView);
  const counts = summarizeSections(sections);

  if (counts.total === 0) return undefined;

  const lines = [`TODO.md (${path})`, `${counts.open} open, ${counts.done} done`];

  if (focusedTasks.length > 0) {
    lines.push("Focused tasks:");
    for (const task of focusedTasks) {
      lines.push(`- #${task.id} ${task.text}${renderTaskMetadata(task)}`);
    }
  }

  if (nextTask) {
    const subtaskSuffix = nextTask.openSubtasks > 0
      ? `; ${nextTask.openSubtasks} open subtask${nextTask.openSubtasks === 1 ? "" : "s"}`
      : "";
    lines.push(`Next task: #${nextTask.id} ${nextTask.text}${renderTaskMetadata(nextTask)} (${nextTask.section}${subtaskSuffix})`);
  }

  return lines.join("\n");
}

function buildSectionView(section) {
  const items = section.items.map((item) => buildTaskView(item, section.name));
  const open = items.filter((item) => !item.checked).length;
  const done = items.length - open;

  return {
    name: section.name,
    total: items.length,
    open,
    done,
    items,
  };
}

function summarizeSections(sections) {
  return sections.reduce(
    (accumulator, section) => {
      accumulator.sections += 1;
      accumulator.total += section.total;
      accumulator.open += section.open;
      accumulator.done += section.done;
      return accumulator;
    },
    { sections: 0, total: 0, open: 0, done: 0 },
  );
}

function formatListMessage(sections, counts, filterSection) {
  const heading = filterSection ? `${DEFAULT_TITLE} · ${filterSection}` : DEFAULT_TITLE;
  const lines = [heading, `${counts.open} open, ${counts.done} done`];

  if (counts.total === 0) {
    lines.push("", filterSection ? `No tasks in ${filterSection}.` : "No tasks yet.");
    return lines.join("\n");
  }

  for (const section of sections) {
    lines.push("", `## ${section.name}`);
    for (const item of section.items) {
      lines.push(`- [${item.checked ? "x" : " "}] #${item.id} ${item.text}${renderTaskMetadata(item)}`);
      for (const note of item.notes ?? []) {
        lines.push(`  - note: ${note}`);
      }
      for (const subtask of item.subtasks ?? []) {
        lines.push(`  - [${subtask.checked ? "x" : " "}] (${subtask.index}) ${subtask.text}`);
      }
    }
  }

  return lines.join("\n");
}

function createActionResult(document, action, options = {}) {
  const sections = (options.sections ?? document.sections.map(buildSectionView)).map((section) => ({
    ...section,
    items: section.items.map((item) => ({
      ...item,
      notes: [...(item.notes ?? [])],
      subtasks: (item.subtasks ?? []).map((subtask) => ({ ...subtask })),
    })),
  }));
  const counts = summarizeSections(sections);
  const summary = `${counts.open} open, ${counts.done} done across ${counts.sections} section${counts.sections === 1 ? "" : "s"}`;

  return {
    changed: Boolean(options.changed),
    document,
    message: options.message ?? summary,
    details: {
      action,
      affectedItem: options.affectedItem ? { ...options.affectedItem } : undefined,
      affectedItems: options.affectedItems?.map((item) => ({ ...item })),
      affectedSubtask: options.affectedSubtask ? { ...options.affectedSubtask } : undefined,
      counts,
      filterSection: options.filterSection,
      sections,
      summary,
    },
  };
}

export function parseTodoMarkdown(markdown = "") {
  const document = {
    schema: TODO_SCHEMA_VERSION,
    title: DEFAULT_TITLE,
    sections: [],
  };

  let currentSection = null;
  let currentTask = null;
  let sawTitle = false;

  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.replace(/\t/g, "  ").trimEnd();
    const leading = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trimStart();

    if (!trimmed) continue;

    if (leading === 0) {
      const schemaMatch = trimmed.match(new RegExp(`^<!--\\s*${SCHEMA_MARKER_PREFIX}(\\d+)\\s*-->$`));
      if (schemaMatch) {
        document.schema = normalizeSchemaVersion(schemaMatch[1]);
        currentTask = null;
        continue;
      }
    }

    if (!sawTitle && leading === 0) {
      const titleMatch = trimmed.match(/^#\s+(.+?)\s*$/);
      if (titleMatch) {
        document.title = sanitizeSingleLine(titleMatch[1]) || DEFAULT_TITLE;
        sawTitle = true;
        currentTask = null;
        continue;
      }
    }

    if (leading === 0) {
      const sectionMatch = trimmed.match(/^##+\s+(.+?)\s*$/);
      if (sectionMatch) {
        currentSection = ensureSection(document, sectionMatch[1]);
        currentTask = null;
        continue;
      }

      const taskMatch = trimmed.match(/^[*-]\s+\[( |x|X)\]\s+(.*?)(?:\s*<!--\s*pi-todo-md:id=(\d+)\s*-->)?\s*$/);
      if (taskMatch) {
        if (!currentSection) currentSection = ensureSection(document, DEFAULT_SECTION);
        const metadata = extractTaskMetadata(taskMatch[2]);
        currentTask = createTask(
          taskMatch[3] ? Number(taskMatch[3]) : undefined,
          metadata.text,
          taskMatch[1].toLowerCase() === "x",
          { focused: metadata.focused, priority: metadata.priority },
        );
        currentSection.items.push(currentTask);
        continue;
      }

      currentTask = null;
      continue;
    }

    if (!currentTask) continue;

    const subtaskMatch = trimmed.match(/^[*-]\s+\[( |x|X)\]\s+(.+?)\s*$/);
    if (subtaskMatch) {
      currentTask.subtasks.push({
        text: normalizeTaskText(subtaskMatch[2]),
        checked: subtaskMatch[1].toLowerCase() === "x",
      });
      continue;
    }

    const noteText = trimmed
      .replace(/^[*-]\s+/, "")
      .replace(/^note:\s*/i, "");
    const normalizedNote = sanitizeSingleLine(noteText);
    if (normalizedNote) {
      currentTask.notes.push(normalizedNote);
    }
  }

  if (document.sections.length === 0) {
    document.sections.push({ name: DEFAULT_SECTION, items: [] });
  }

  const usedIds = new Set();
  let nextId = 1;

  for (const section of document.sections) {
    for (const item of section.items) {
      const parsedId = Number(item.id);
      if (!Number.isInteger(parsedId) || parsedId < 1 || usedIds.has(parsedId)) {
        while (usedIds.has(nextId)) nextId += 1;
        item.id = nextId;
      } else {
        item.id = parsedId;
      }
      usedIds.add(item.id);
      nextId = Math.max(nextId, item.id + 1);
      item.focused = Boolean(item.focused);
      item.priority = normalizePriority(item.priority);
      item.notes = [...(item.notes ?? [])];
      item.subtasks = (item.subtasks ?? []).map((subtask) => ({
        text: normalizeTaskText(subtask.text),
        checked: Boolean(subtask.checked),
      }));
    }
  }

  document.schema = normalizeSchemaVersion(document.schema);
  return document;
}

export function renderTodoMarkdown(document) {
  const normalized = cloneDocument(document);
  if (normalized.sections.length === 0) {
    normalized.sections.push({ name: DEFAULT_SECTION, items: [] });
  }

  const lines = [
    `# ${normalized.title || DEFAULT_TITLE}`,
    `<!-- ${SCHEMA_MARKER_PREFIX}${TODO_SCHEMA_VERSION} -->`,
    "",
  ];

  normalized.sections.forEach((section, index) => {
    lines.push(`## ${normalizeSectionName(section.name)}`);
    for (const item of section.items) {
      lines.push(`- [${item.checked ? "x" : " "}] ${normalizeTaskText(item.text)}${renderTaskMetadata(item)} <!-- ${ID_MARKER_PREFIX}${item.id} -->`);
      for (const note of item.notes ?? []) {
        lines.push(`  - note: ${sanitizeSingleLine(note)}`);
      }
      for (const subtask of item.subtasks ?? []) {
        lines.push(`  - [${subtask.checked ? "x" : " "}] ${normalizeTaskText(subtask.text)}`);
      }
    }
    if (index !== normalized.sections.length - 1) lines.push("");
  });

  return `${lines.join("\n").trimEnd()}\n`;
}

export function applyTodoAction(document, params) {
  const workingDocument = cloneDocument(document);
  const action = params.action;

  switch (action) {
    case "list": {
      const filterSection = params.section ? normalizeSectionName(params.section) : undefined;
      const sections = filterSection
        ? workingDocument.sections
            .filter((section) => section.name.toLowerCase() === filterSection.toLowerCase())
            .map(buildSectionView)
        : workingDocument.sections.map(buildSectionView);
      const counts = summarizeSections(sections);

      return createActionResult(workingDocument, action, {
        changed: false,
        filterSection,
        message: formatListMessage(sections, counts, filterSection),
        sections,
      });
    }

    case "next_task": {
      const recommendation = recommendNextTask(workingDocument, { section: params.section });
      const filterSection = params.section ? normalizeSectionName(params.section) : undefined;

      if (!recommendation) {
        return createActionResult(workingDocument, action, {
          changed: false,
          filterSection,
          message: filterSection
            ? `No open tasks found in ${filterSection}.`
            : "No open tasks found.",
        });
      }

      const metadataSuffix = renderTaskMetadata(recommendation);
      const subtaskSuffix = recommendation.openSubtasks > 0
        ? ` (${recommendation.openSubtasks} open subtask${recommendation.openSubtasks === 1 ? "" : "s"})`
        : "";

      return createActionResult(workingDocument, action, {
        changed: false,
        filterSection,
        message: `Next task: #${recommendation.id} in ${recommendation.section}: ${recommendation.text}${metadataSuffix}${subtaskSuffix}`,
        affectedItem: recommendation,
      });
    }

    case "list_focused": {
      const sections = workingDocument.sections
        .filter((section) => section.name.toLowerCase() !== ARCHIVE_SECTION.toLowerCase())
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => item.focused),
        }))
        .filter((section) => section.items.length > 0)
        .map(buildSectionView);
      const counts = summarizeSections(sections);

      return createActionResult(workingDocument, action, {
        changed: false,
        message:
          counts.total === 0
            ? "No focused tasks."
            : formatListMessage(sections, counts, "Focus"),
        sections,
      });
    }

    case "create_section": {
      const name = normalizeSectionName(params.section);
      const existing = findSection(workingDocument, name);
      if (existing) {
        return createActionResult(workingDocument, action, {
          changed: false,
          message: `Section ${existing.name} already exists.`,
        });
      }

      ensureSection(workingDocument, name);
      return createActionResult(workingDocument, action, {
        changed: true,
        message: `Created section ${name}.`,
      });
    }

    case "rename_section": {
      const section = requireSection(workingDocument, params.section);
      if (params.targetSection === undefined && params.text === undefined) {
        throw new Error("targetSection or text is required for rename_section.");
      }
      const targetName = normalizeSectionName(params.targetSection ?? params.text);
      if (section.name.toLowerCase() === targetName.toLowerCase()) {
        return createActionResult(workingDocument, action, {
          changed: false,
          message: `Section ${section.name} already has that name.`,
        });
      }
      if (findSection(workingDocument, targetName)) {
        throw new Error(`Section ${targetName} already exists.`);
      }

      const previousName = section.name;
      section.name = targetName;
      return createActionResult(workingDocument, action, {
        changed: true,
        message: `Renamed section ${previousName} to ${targetName}.`,
      });
    }

    case "remove_section": {
      const sectionIndex = findSectionIndex(workingDocument, params.section);
      if (sectionIndex === -1) {
        throw new Error(`Section ${normalizeSectionName(params.section)} was not found.`);
      }

      const section = workingDocument.sections[sectionIndex];
      const targetName = params.targetSection ? normalizeSectionName(params.targetSection) : undefined;
      if (section.items.length > 0) {
        if (!targetName) {
          throw new Error(`Section ${section.name} is not empty. Provide targetSection to move its tasks first.`);
        }
        if (section.name.toLowerCase() === targetName.toLowerCase()) {
          throw new Error("targetSection must be different from the section being removed.");
        }
        const targetSection = ensureSection(workingDocument, targetName);
        targetSection.items.push(...section.items);
      }

      workingDocument.sections.splice(sectionIndex, 1);
      if (workingDocument.sections.length === 0) {
        workingDocument.sections.push({ name: DEFAULT_SECTION, items: [] });
      }

      return createActionResult(workingDocument, action, {
        changed: true,
        message: targetName
          ? `Removed section ${section.name} and moved its tasks to ${targetName}.`
          : `Removed empty section ${section.name}.`,
      });
    }

    case "move_section": {
      const sectionIndex = findSectionIndex(workingDocument, params.section);
      if (sectionIndex === -1) {
        throw new Error(`Section ${normalizeSectionName(params.section)} was not found.`);
      }
      const targetIndex = normalizeIndex(params.index);
      if (targetIndex === undefined) {
        throw new Error("index is required for move_section.");
      }

      const [section] = workingDocument.sections.splice(sectionIndex, 1);
      const boundedIndex = Math.min(Math.max(targetIndex, 0), workingDocument.sections.length);
      workingDocument.sections.splice(boundedIndex, 0, section);
      const changed = boundedIndex !== sectionIndex;

      return createActionResult(workingDocument, action, {
        changed,
        message: changed
          ? `Moved section ${section.name} to position ${boundedIndex + 1}.`
          : `Section ${section.name} is already at position ${boundedIndex + 1}.`,
      });
    }

    case "add": {
      const section = ensureSection(workingDocument, params.section);
      const item = createTask(getNextId(workingDocument), params.text, false);
      const targetIndex = insertItem(section.items, item, normalizeIndex(params.index));

      return createActionResult(workingDocument, action, {
        changed: true,
        message: `Added #${item.id} to ${section.name}${targetIndex === 0 ? " at the top" : ""}: ${item.text}`,
        affectedItem: { ...buildTaskView(item, section.name), section: section.name },
      });
    }

    case "bulk_add": {
      const section = ensureSection(workingDocument, params.section);
      const texts = normalizeTaskTexts(params.items);
      const startIndex = normalizeIndex(params.index);
      const addedItems = [];
      let lastIndex = section.items.length;

      texts.forEach((text, offset) => {
        const item = createTask(getNextId(workingDocument), text, false);
        const insertionIndex = startIndex === undefined ? undefined : startIndex + offset;
        lastIndex = insertItem(section.items, item, insertionIndex);
        addedItems.push({ ...buildTaskView(item, section.name), section: section.name });
      });

      return createActionResult(workingDocument, action, {
        changed: true,
        message:
          texts.length === 1
            ? `Added #${addedItems[0].id} to ${section.name}${lastIndex === 0 ? " at the top" : ""}: ${addedItems[0].text}`
            : `Added ${texts.length} tasks to ${section.name}${startIndex === 0 ? " starting at the top" : ""}.`,
        affectedItem: texts.length === 1 ? addedItems[0] : undefined,
        affectedItems: addedItems,
      });
    }

    case "check":
    case "uncheck": {
      const desiredState = action === "check";
      const found = findItem(workingDocument, params.id);
      const alreadyInState = found.item.checked === desiredState;
      found.item.checked = desiredState;

      return createActionResult(workingDocument, action, {
        changed: !alreadyInState,
        message: alreadyInState
          ? `Task #${found.item.id} is already ${desiredState ? "checked" : "unchecked"}.`
          : `${desiredState ? "Checked" : "Unchecked"} #${found.item.id}: ${found.item.text}`,
        affectedItem: { ...buildTaskView(found.item, found.section.name), section: found.section.name },
      });
    }

    case "rename": {
      const found = findItem(workingDocument, params.id);
      const nextText = normalizeTaskText(params.text);
      const changed = found.item.text !== nextText;
      found.item.text = nextText;

      return createActionResult(workingDocument, action, {
        changed,
        message: changed
          ? `Renamed #${found.item.id} in ${found.section.name}: ${found.item.text}`
          : `Task #${found.item.id} already has that text.`,
        affectedItem: { ...buildTaskView(found.item, found.section.name), section: found.section.name },
      });
    }

    case "focus_task":
    case "unfocus_task": {
      const desiredState = action === "focus_task";
      const found = findItem(workingDocument, params.id);
      const changed = found.item.focused !== desiredState;
      found.item.focused = desiredState;

      return createActionResult(workingDocument, action, {
        changed,
        message: changed
          ? `${desiredState ? "Focused" : "Unfocused"} #${found.item.id} in ${found.section.name}: ${found.item.text}`
          : `Task #${found.item.id} is already ${desiredState ? "focused" : "not focused"}.`,
        affectedItem: { ...buildTaskView(found.item, found.section.name), section: found.section.name },
      });
    }

    case "set_priority": {
      const found = findItem(workingDocument, params.id);
      const nextPriority = normalizePriority(params.priority);
      const changed = found.item.priority !== nextPriority;
      found.item.priority = nextPriority;

      return createActionResult(workingDocument, action, {
        changed,
        message: changed
          ? `Set priority on #${found.item.id} in ${found.section.name} to ${nextPriority}.`
          : `Task #${found.item.id} already has priority ${nextPriority}.`,
        affectedItem: { ...buildTaskView(found.item, found.section.name), section: found.section.name },
      });
    }

    case "clear_priority": {
      const found = findItem(workingDocument, params.id);
      const changed = found.item.priority !== undefined;
      found.item.priority = undefined;

      return createActionResult(workingDocument, action, {
        changed,
        message: changed
          ? `Cleared priority on #${found.item.id} in ${found.section.name}.`
          : `Task #${found.item.id} does not have a priority.`,
        affectedItem: { ...buildTaskView(found.item, found.section.name), section: found.section.name },
      });
    }

    case "set_note": {
      const found = findItem(workingDocument, params.id);
      const notes = normalizeNoteLines(params.text);
      const changed = JSON.stringify(found.item.notes ?? []) !== JSON.stringify(notes);
      found.item.notes = notes;

      return createActionResult(workingDocument, action, {
        changed,
        message: changed
          ? `Updated notes on #${found.item.id} in ${found.section.name}.`
          : `Task #${found.item.id} already has those notes.`,
        affectedItem: { ...buildTaskView(found.item, found.section.name), section: found.section.name },
      });
    }

    case "append_note": {
      const found = findItem(workingDocument, params.id);
      const notes = normalizeNoteLines(params.text);
      found.item.notes.push(...notes);

      return createActionResult(workingDocument, action, {
        changed: true,
        message: `Added ${notes.length} note line${notes.length === 1 ? "" : "s"} to #${found.item.id} in ${found.section.name}.`,
        affectedItem: { ...buildTaskView(found.item, found.section.name), section: found.section.name },
      });
    }

    case "clear_note": {
      const found = findItem(workingDocument, params.id);
      const noteCount = (found.item.notes ?? []).length;
      found.item.notes = [];

      return createActionResult(workingDocument, action, {
        changed: noteCount > 0,
        message:
          noteCount > 0
            ? `Cleared notes on #${found.item.id} in ${found.section.name}.`
            : `Task #${found.item.id} does not have notes.`,
        affectedItem: { ...buildTaskView(found.item, found.section.name), section: found.section.name },
      });
    }

    case "add_subtask": {
      const found = findItem(workingDocument, params.id);
      const subtask = {
        text: normalizeTaskText(params.text),
        checked: false,
      };
      found.item.subtasks.push(subtask);
      const index = found.item.subtasks.length;

      return createActionResult(workingDocument, action, {
        changed: true,
        message: `Added subtask ${index} to #${found.item.id} in ${found.section.name}: ${subtask.text}`,
        affectedItem: { ...buildTaskView(found.item, found.section.name), section: found.section.name },
        affectedSubtask: {
          index,
          text: subtask.text,
          checked: subtask.checked,
          parentId: found.item.id,
          section: found.section.name,
        },
      });
    }

    case "check_subtask":
    case "uncheck_subtask": {
      const desiredState = action === "check_subtask";
      const found = findItem(workingDocument, params.id);
      const located = findSubtask(found.item, params.subtask);
      const alreadyInState = located.subtask.checked === desiredState;
      located.subtask.checked = desiredState;

      return createActionResult(workingDocument, action, {
        changed: !alreadyInState,
        message: alreadyInState
          ? `Subtask ${located.index + 1} on #${found.item.id} is already ${desiredState ? "checked" : "unchecked"}.`
          : `${desiredState ? "Checked" : "Unchecked"} subtask ${located.index + 1} on #${found.item.id}: ${located.subtask.text}`,
        affectedItem: { ...buildTaskView(found.item, found.section.name), section: found.section.name },
        affectedSubtask: {
          index: located.index + 1,
          text: located.subtask.text,
          checked: located.subtask.checked,
          parentId: found.item.id,
          section: found.section.name,
        },
      });
    }

    case "remove_subtask": {
      const found = findItem(workingDocument, params.id);
      const located = findSubtask(found.item, params.subtask);
      const [removed] = found.item.subtasks.splice(located.index, 1);

      return createActionResult(workingDocument, action, {
        changed: true,
        message: `Removed subtask ${located.index + 1} from #${found.item.id} in ${found.section.name}: ${removed.text}`,
        affectedItem: { ...buildTaskView(found.item, found.section.name), section: found.section.name },
        affectedSubtask: {
          index: located.index + 1,
          text: removed.text,
          checked: removed.checked,
          parentId: found.item.id,
          section: found.section.name,
        },
      });
    }

    case "archive_done": {
      const filterSection = params.section ? normalizeSectionName(params.section) : undefined;
      const archiveSection = findSection(workingDocument, ARCHIVE_SECTION);
      const movedItems = [];

      for (const section of workingDocument.sections) {
        if (section.name.toLowerCase() === ARCHIVE_SECTION.toLowerCase()) continue;
        if (filterSection && section.name.toLowerCase() !== filterSection.toLowerCase()) continue;

        const remaining = [];
        for (const item of section.items) {
          if (item.checked) {
            movedItems.push({ item, from: section.name });
          } else {
            remaining.push(item);
          }
        }
        section.items = remaining;
      }

      if (movedItems.length === 0) {
        return createActionResult(workingDocument, action, {
          changed: false,
          message: filterSection
            ? `No completed tasks to archive from ${filterSection}.`
            : "No completed tasks to archive.",
        });
      }

      const targetSection = archiveSection ?? ensureSection(workingDocument, ARCHIVE_SECTION);
      const affectedItems = [];
      for (const moved of movedItems) {
        targetSection.items.push(moved.item);
        affectedItems.push({ ...buildTaskView(moved.item, ARCHIVE_SECTION), section: ARCHIVE_SECTION, from: moved.from });
      }

      return createActionResult(workingDocument, action, {
        changed: true,
        message: `Archived ${movedItems.length} completed task${movedItems.length === 1 ? "" : "s"} to ${ARCHIVE_SECTION}.`,
        affectedItems,
      });
    }

    case "remove": {
      const found = findItem(workingDocument, params.id);
      const [removed] = found.section.items.splice(found.index, 1);

      return createActionResult(workingDocument, action, {
        changed: true,
        message: `Removed #${removed.id} from ${found.section.name}: ${removed.text}`,
        affectedItem: { ...buildTaskView(removed, found.section.name), section: found.section.name },
      });
    }

    case "move": {
      const found = findItem(workingDocument, params.id);
      const targetSection = ensureSection(workingDocument, params.section || found.section.name);
      const [moved] = found.section.items.splice(found.index, 1);
      const targetIndex = insertItem(targetSection.items, moved, normalizeIndex(params.index));

      return createActionResult(workingDocument, action, {
        changed: true,
        message: `Moved #${moved.id} to ${targetSection.name} at position ${targetIndex + 1}: ${moved.text}`,
        affectedItem: { ...buildTaskView(moved, targetSection.name), section: targetSection.name },
      });
    }

    case "prioritize": {
      const found = findItem(workingDocument, params.id);
      const targetSection = ensureSection(workingDocument, params.section || found.section.name);
      const [moved] = found.section.items.splice(found.index, 1);
      targetSection.items.unshift(moved);
      const changed = !(found.section.name === targetSection.name && found.index === 0);

      return createActionResult(workingDocument, action, {
        changed,
        message: changed
          ? `Moved #${moved.id} to the top of ${targetSection.name}: ${moved.text}`
          : `Task #${moved.id} is already at the top of ${targetSection.name}.`,
        affectedItem: { ...buildTaskView(moved, targetSection.name), section: targetSection.name },
      });
    }

    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}

export async function executeTodoActionOnFile(todoPath, params) {
  let original = "";
  try {
    original = await readFile(todoPath, "utf8");
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }

  const document = migrateTodoDocument(parseTodoMarkdown(original));
  const result = applyTodoAction(document, params);
  const nextMarkdown = renderTodoMarkdown(result.document);
  const written = original !== nextMarkdown;

  if (written) {
    await mkdir(dirname(todoPath), { recursive: true });
    await writeFile(todoPath, nextMarkdown, "utf8");
  }

  return {
    changed: result.changed,
    message: result.message,
    details: {
      ...result.details,
      path: todoPath,
      written,
    },
  };
}
