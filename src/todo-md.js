import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";

export const TODO_FILE_NAME = "TODO.md";
export const DEFAULT_TITLE = "TODO";
export const DEFAULT_SECTION = "Tasks";
export const ID_MARKER_PREFIX = "pi-todo-md:id=";

function cloneDocument(document) {
  return {
    title: document.title,
    sections: document.sections.map((section) => ({
      name: section.name,
      items: section.items.map((item) => ({ ...item })),
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

function normalizeIndex(index) {
  if (index === undefined || index === null) return undefined;
  const parsed = Number(index);
  if (!Number.isFinite(parsed)) throw new Error("index must be a number.");
  return Math.max(0, Math.floor(parsed) - 1);
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

function ensureSection(document, sectionName) {
  const normalizedName = normalizeSectionName(sectionName);
  const existing = document.sections.find(
    (section) => section.name.toLowerCase() === normalizedName.toLowerCase(),
  );

  if (existing) return existing;

  const created = { name: normalizedName, items: [] };
  document.sections.push(created);
  return created;
}

function insertItem(items, item, index) {
  const targetIndex = index === undefined ? items.length : Math.min(Math.max(index, 0), items.length);
  items.splice(targetIndex, 0, item);
  return targetIndex;
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

function buildSectionView(section) {
  const open = section.items.filter((item) => !item.checked).length;
  const done = section.items.length - open;
  return {
    name: section.name,
    total: section.items.length,
    open,
    done,
    items: section.items.map((item) => ({
      id: item.id,
      text: item.text,
      checked: item.checked,
      section: section.name,
    })),
  };
}

function summarizeSections(sections) {
  const totals = sections.reduce(
    (accumulator, section) => {
      accumulator.sections += 1;
      accumulator.total += section.total;
      accumulator.open += section.open;
      accumulator.done += section.done;
      return accumulator;
    },
    { sections: 0, total: 0, open: 0, done: 0 },
  );

  return totals;
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
      lines.push(`- [${item.checked ? "x" : " "}] #${item.id} ${item.text}`);
    }
  }

  return lines.join("\n");
}

function createActionResult(document, action, options = {}) {
  const sections = (options.sections ?? document.sections.map(buildSectionView)).map((section) => ({
    ...section,
    items: section.items.map((item) => ({ ...item })),
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
      counts,
      filterSection: options.filterSection,
      sections,
      summary,
    },
  };
}

export function parseTodoMarkdown(markdown = "") {
  const document = {
    title: DEFAULT_TITLE,
    sections: [],
  };

  let currentSection = null;
  let sawTitle = false;

  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();

    if (!sawTitle) {
      const titleMatch = line.match(/^#\s+(.+?)\s*$/);
      if (titleMatch) {
        document.title = sanitizeSingleLine(titleMatch[1]) || DEFAULT_TITLE;
        sawTitle = true;
        continue;
      }
    }

    const sectionMatch = line.match(/^##+\s+(.+?)\s*$/);
    if (sectionMatch) {
      currentSection = ensureSection(document, sectionMatch[1]);
      continue;
    }

    const taskMatch = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*?)(?:\s*<!--\s*pi-todo-md:id=(\d+)\s*-->)?\s*$/);
    if (taskMatch) {
      if (!currentSection) currentSection = ensureSection(document, DEFAULT_SECTION);
      currentSection.items.push({
        id: taskMatch[3] ? Number(taskMatch[3]) : undefined,
        text: normalizeTaskText(taskMatch[2]),
        checked: taskMatch[1].toLowerCase() === "x",
      });
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
    }
  }

  return document;
}

export function renderTodoMarkdown(document) {
  const normalized = cloneDocument(document);
  if (normalized.sections.length === 0) {
    normalized.sections.push({ name: DEFAULT_SECTION, items: [] });
  }

  const lines = [`# ${normalized.title || DEFAULT_TITLE}`, ""];

  normalized.sections.forEach((section, index) => {
    lines.push(`## ${normalizeSectionName(section.name)}`);
    for (const item of section.items) {
      lines.push(`- [${item.checked ? "x" : " "}] ${normalizeTaskText(item.text)} <!-- ${ID_MARKER_PREFIX}${item.id} -->`);
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

    case "add": {
      const section = ensureSection(workingDocument, params.section);
      const item = {
        id: getNextId(workingDocument),
        text: normalizeTaskText(params.text),
        checked: false,
      };
      const targetIndex = insertItem(section.items, item, normalizeIndex(params.index));

      return createActionResult(workingDocument, action, {
        changed: true,
        message: `Added #${item.id} to ${section.name}${targetIndex === 0 ? " at the top" : ""}: ${item.text}`,
        affectedItem: { ...item, section: section.name },
      });
    }

    case "bulk_add": {
      const section = ensureSection(workingDocument, params.section);
      const texts = normalizeTaskTexts(params.items);
      const startIndex = normalizeIndex(params.index);
      const addedItems = [];
      let lastIndex = section.items.length;

      texts.forEach((text, offset) => {
        const item = {
          id: getNextId(workingDocument),
          text,
          checked: false,
        };
        const insertionIndex = startIndex === undefined ? undefined : startIndex + offset;
        lastIndex = insertItem(section.items, item, insertionIndex);
        addedItems.push({ ...item, section: section.name });
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
        affectedItem: { ...found.item, section: found.section.name },
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
        affectedItem: { ...found.item, section: found.section.name },
      });
    }

    case "remove": {
      const found = findItem(workingDocument, params.id);
      const [removed] = found.section.items.splice(found.index, 1);

      return createActionResult(workingDocument, action, {
        changed: true,
        message: `Removed #${removed.id} from ${found.section.name}: ${removed.text}`,
        affectedItem: { ...removed, section: found.section.name },
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
        affectedItem: { ...moved, section: targetSection.name },
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
        affectedItem: { ...moved, section: targetSection.name },
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

  const document = parseTodoMarkdown(original);
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
