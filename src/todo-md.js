import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";

export const TODO_FILE_NAME = "TODO.md";
export const DEFAULT_TITLE = "TODO";
export const DEFAULT_SECTION = "Tasks";
export const ARCHIVE_SECTION = "Archive";
export const ID_MARKER_PREFIX = "pi-todo-md:id=";

function cloneDocument(document) {
  return {
    title: document.title,
    sections: document.sections.map((section) => ({
      name: section.name,
      items: section.items.map((item) => ({
        ...item,
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

function insertItem(items, item, index) {
  const targetIndex = index === undefined ? items.length : Math.min(Math.max(index, 0), items.length);
  items.splice(targetIndex, 0, item);
  return targetIndex;
}

function createTask(id, text, checked = false) {
  return {
    id,
    text: normalizeTaskText(text),
    checked: Boolean(checked),
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

function countOpenSubtasks(item) {
  return (item.subtasks ?? []).filter((subtask) => !subtask.checked).length;
}

function recommendNextTask(document, options = {}) {
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
      lines.push(`- [${item.checked ? "x" : " "}] #${item.id} ${item.text}`);
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
        currentTask = createTask(taskMatch[3] ? Number(taskMatch[3]) : undefined, taskMatch[2], taskMatch[1].toLowerCase() === "x");
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
      item.notes = [...(item.notes ?? [])];
      item.subtasks = (item.subtasks ?? []).map((subtask) => ({
        text: normalizeTaskText(subtask.text),
        checked: Boolean(subtask.checked),
      }));
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

      const subtaskSuffix = recommendation.openSubtasks > 0
        ? ` (${recommendation.openSubtasks} open subtask${recommendation.openSubtasks === 1 ? "" : "s"})`
        : "";

      return createActionResult(workingDocument, action, {
        changed: false,
        filterSection,
        message: `Next task: #${recommendation.id} in ${recommendation.section}: ${recommendation.text}${subtaskSuffix}`,
        affectedItem: recommendation,
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
