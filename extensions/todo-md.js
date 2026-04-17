import { relative } from "node:path";

import { StringEnum } from "@mariozechner/pi-ai";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import { ARCHIVE_SECTION, executeTodoActionOnFile, locateTodoFile, sanitizeSingleLine } from "../src/todo-md.js";

const TODO_ACTIONS = [
  "list",
  "list_focused",
  "next_task",
  "add",
  "bulk_add",
  "check",
  "uncheck",
  "rename",
  "focus_task",
  "unfocus_task",
  "set_note",
  "append_note",
  "clear_note",
  "add_subtask",
  "check_subtask",
  "uncheck_subtask",
  "remove_subtask",
  "archive_done",
  "remove",
  "move",
  "prioritize",
];

const TodoMdParams = Type.Object({
  action: StringEnum(TODO_ACTIONS),
  text: Type.Optional(Type.String({ description: "Task, note, or subtask text depending on the action" })),
  items: Type.Optional(Type.Array(Type.String(), { description: "Task texts for bulk_add" })),
  id: Type.Optional(Type.Integer({ description: "Task id for task-level actions" })),
  subtask: Type.Optional(Type.Integer({ description: "1-based subtask number for subtask actions" })),
  section: Type.Optional(Type.String({ description: "Section name for add, bulk_add, move, prioritize, archive_done, or list filtering" })),
  index: Type.Optional(Type.Integer({ description: "1-based position within the target section for add, bulk_add, or move" })),
});

function formatDisplayPath(path, cwd) {
  if (!path) return "TODO.md";
  if (!cwd) return path;
  const relativePath = relative(cwd, path);
  return relativePath || "TODO.md";
}

function findTaskInDetails(details, id) {
  for (const section of details.sections ?? []) {
    const item = section.items?.find((candidate) => candidate.id === id);
    if (item) return item;
  }
  return undefined;
}

function formatTaskLabel(item) {
  const focusTag = item.focused ? " [focus]" : "";
  return `${item.text}${focusTag}`;
}

function buildSectionList(details, options = {}) {
  const { expanded = false, showDone = true } = options;
  const lines = [];
  const sections = details.sections ?? [];
  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: (section.items ?? []).filter((item) => showDone || !item.checked),
    }))
    .filter((section) => section.items.length > 0 || expanded);
  const maxSections = expanded ? visibleSections.length : Math.min(visibleSections.length, 3);

  for (let sectionIndex = 0; sectionIndex < maxSections; sectionIndex += 1) {
    const section = visibleSections[sectionIndex];
    lines.push({ text: `## ${section.name}`, tone: "accent" });

    const items = section.items ?? [];
    const maxItems = expanded ? items.length : Math.min(items.length, 5);
    for (let itemIndex = 0; itemIndex < maxItems; itemIndex += 1) {
      const item = items[itemIndex];
      lines.push({
        text: `${item.checked ? "[x]" : "[ ]"} #${item.id} ${formatTaskLabel(item)}`,
        tone: item.checked ? "dim" : "muted",
      });

      for (const note of item.notes ?? []) {
        lines.push({ text: `  note: ${note}`, tone: "dim" });
      }

      const subtasks = (item.subtasks ?? []).filter((subtask) => showDone || !subtask.checked);
      for (const subtask of subtasks) {
        lines.push({
          text: `  ${subtask.checked ? "[x]" : "[ ]"} (${subtask.index}) ${subtask.text}`,
          tone: subtask.checked ? "dim" : "muted",
        });
      }
    }

    if (!expanded && items.length > maxItems) {
      lines.push({ text: `… ${items.length - maxItems} more in ${section.name}`, tone: "dim" });
    }
  }

  if (!expanded && visibleSections.length > maxSections) {
    lines.push({ text: `… ${visibleSections.length - maxSections} more section(s)`, tone: "dim" });
  }

  return lines;
}

function buildBrowserRows(details, showDone) {
  const rows = [];

  for (const section of details.sections ?? []) {
    const taskRows = [];
    for (const item of section.items ?? []) {
      if (!showDone && item.checked) continue;

      taskRows.push({
        kind: "task",
        key: `task:${item.id}`,
        id: item.id,
        checked: item.checked,
        focused: Boolean(item.focused),
        section: section.name,
        text: formatTaskLabel(item),
        notes: item.notes ?? [],
        subtasks: item.subtasks ?? [],
      });

      for (const note of item.notes ?? []) {
        taskRows.push({
          kind: "note",
          key: `note:${item.id}:${note}`,
          parentId: item.id,
          section: section.name,
          text: note,
        });
      }

      for (const subtask of item.subtasks ?? []) {
        if (!showDone && subtask.checked) continue;
        taskRows.push({
          kind: "subtask",
          key: `subtask:${item.id}:${subtask.index}`,
          parentId: item.id,
          index: subtask.index,
          checked: subtask.checked,
          section: section.name,
          text: subtask.text,
        });
      }
    }

    if (taskRows.length > 0) {
      rows.push({ kind: "section", key: `section:${section.name}`, text: section.name });
      rows.push(...taskRows);
    }
  }

  return rows;
}

function styleLine(theme, tone, text) {
  switch (tone) {
    case "accent":
      return theme.fg("accent", text);
    case "success":
      return theme.fg("success", text);
    case "warning":
      return theme.fg("warning", text);
    case "dim":
      return theme.fg("dim", text);
    case "muted":
    default:
      return theme.fg("muted", text);
  }
}

class TodoListComponent {
  constructor(tui, result, theme, cwd, state, done) {
    this.tui = tui;
    this.result = result;
    this.theme = theme;
    this.cwd = cwd;
    this.done = done;
    this.showDone = state?.showDone !== false;
    this.selectedKey = state?.selectionKey;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  getRows() {
    return buildBrowserRows(this.result.details, this.showDone);
  }

  getInteractiveRows() {
    return this.getRows().filter((row) => row.kind === "task" || row.kind === "subtask");
  }

  ensureSelection() {
    const interactiveRows = this.getInteractiveRows();
    if (interactiveRows.length === 0) {
      this.selectedKey = undefined;
      return;
    }

    if (!interactiveRows.some((row) => row.key === this.selectedKey)) {
      this.selectedKey = interactiveRows[0].key;
    }
  }

  getSelectedRow() {
    this.ensureSelection();
    return this.getInteractiveRows().find((row) => row.key === this.selectedKey);
  }

  moveSelection(delta) {
    const interactiveRows = this.getInteractiveRows();
    if (interactiveRows.length === 0) return;

    this.ensureSelection();
    const currentIndex = interactiveRows.findIndex((row) => row.key === this.selectedKey);
    const nextIndex = Math.min(Math.max(currentIndex + delta, 0), interactiveRows.length - 1);
    this.selectedKey = interactiveRows[nextIndex].key;
    this.refresh();
  }

  refresh() {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.tui.requestRender();
  }

  submit(action) {
    this.done({
      ...action,
      showDone: this.showDone,
      selectionKey: this.selectedKey,
    });
  }

  handleInput(data) {
    if (matchesKey(data, "escape") || matchesKey(data, "return") || data === "q" || data === "Q") {
      this.submit({ type: "close" });
      return;
    }

    if (matchesKey(data, "up") || data === "k" || data === "K") {
      this.moveSelection(-1);
      return;
    }

    if (matchesKey(data, "down") || data === "j" || data === "J") {
      this.moveSelection(1);
      return;
    }

    if (data === "o" || data === "O") {
      this.showDone = !this.showDone;
      this.ensureSelection();
      this.refresh();
      return;
    }

    if (data === "a" || data === "A") {
      this.submit({ type: "archive_done" });
      return;
    }

    const selected = this.getSelectedRow();
    if (!selected) return;

    if (data === "x" || data === "X") {
      if (selected.kind === "task") {
        this.submit({ type: selected.checked ? "uncheck_task" : "check_task", id: selected.id });
      } else if (selected.kind === "subtask") {
        this.submit({
          type: selected.checked ? "uncheck_subtask" : "check_subtask",
          id: selected.parentId,
          subtask: selected.index,
        });
      }
      return;
    }

    if ((data === "p" || data === "P") && selected.kind === "task") {
      this.submit({ type: "prioritize", id: selected.id });
      return;
    }

    if ((data === "f" || data === "F") && selected.kind === "task") {
      this.submit({ type: selected.focused ? "unfocus_task" : "focus_task", id: selected.id });
      return;
    }

    if ((data === "r" || data === "R") && selected.kind === "task") {
      this.submit({ type: "rename_task", id: selected.id });
      return;
    }

    if ((data === "n" || data === "N") && selected.kind === "task") {
      this.submit({ type: "edit_note", id: selected.id });
      return;
    }

    if ((data === "s" || data === "S") && selected.kind === "task") {
      this.submit({ type: "add_subtask", id: selected.id });
      return;
    }

    if (data === "d" || data === "D") {
      if (selected.kind === "task") {
        this.submit({ type: "remove_task", id: selected.id });
      } else if (selected.kind === "subtask") {
        this.submit({ type: "remove_subtask", id: selected.parentId, subtask: selected.index });
      }
    }
  }

  render(width) {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    this.ensureSelection();
    const details = this.result.details;
    const counts = details.counts;
    const displayPath = formatDisplayPath(details.path, this.cwd);
    const lines = [];
    const theme = this.theme;
    const rows = this.getRows();

    lines.push("");
    lines.push(truncateToWidth(theme.fg("accent", " TODO.md "), width));
    lines.push(truncateToWidth(theme.fg("dim", `${displayPath} · ${counts.open} open · ${counts.done} done`), width));

    if (details.filterSection) {
      lines.push(truncateToWidth(theme.fg("muted", `Filter: ${details.filterSection}`), width));
    }

    lines.push(truncateToWidth(theme.fg("dim", `Mode: ${this.showDone ? "all tasks" : "open tasks only"}`), width));
    lines.push("");

    if (rows.length === 0) {
      lines.push(truncateToWidth(theme.fg("dim", "No visible tasks."), width));
    } else {
      for (const row of rows) {
        if (row.kind === "section") {
          lines.push(truncateToWidth(theme.fg("accent", `## ${row.text}`), width));
          continue;
        }

        let baseText = "";
        let tone = "muted";

        if (row.kind === "task") {
          baseText = `${row.checked ? "[x]" : "[ ]"} #${row.id} ${row.text}`;
          tone = row.checked ? "dim" : "muted";
        } else if (row.kind === "note") {
          baseText = `  note: ${row.text}`;
          tone = "dim";
        } else if (row.kind === "subtask") {
          baseText = `  ${row.checked ? "[x]" : "[ ]"} (${row.index}) ${row.text}`;
          tone = row.checked ? "dim" : "muted";
        }

        const isSelected = row.key === this.selectedKey;
        const prefix = row.kind === "task" || row.kind === "subtask" ? (isSelected ? "› " : "  ") : "  ";
        const styled = styleLine(theme, isSelected ? "accent" : tone, `${prefix}${baseText}`);
        lines.push(truncateToWidth(isSelected ? theme.bg("selectedBg", styled) : styled, width));
      }
    }

    lines.push("");
    lines.push(truncateToWidth(theme.fg("dim", "↑↓/j/k move • x toggle • f focus • r rename • n note • s subtask"), width));
    lines.push(truncateToWidth(theme.fg("dim", "p prioritize • d delete • a archive done • o toggle done • Enter/q/Esc close"), width));
    lines.push("");

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate() {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

export default function (pi) {
  async function runTodo(ctx, params) {
    const todoPath = await locateTodoFile(ctx.cwd);
    return withFileMutationQueue(todoPath, async () => {
      const result = await executeTodoActionOnFile(todoPath, params);
      return result;
    });
  }

  async function refreshList(ctx, section) {
    return runTodo(ctx, { action: "list", section });
  }

  pi.registerTool({
    name: "todo_md",
    label: "TODO.md",
    description:
      "Manage the project's TODO.md file with a structured API. Actions: list, list_focused, next_task, add, bulk_add, rename, focus_task, unfocus_task, set_note, append_note, clear_note, add_subtask, check_subtask, uncheck_subtask, remove_subtask, check, uncheck, remove, move, prioritize, archive_done.",
    promptSnippet:
      "Use todo_md to manage the project's TODO.md file instead of editing the file directly.",
    promptGuidelines: [
      "Use todo_md when the user asks to manage the project task list or TODO.md.",
      "Use action='list' before mutating tasks when you need the current task IDs, notes, subtasks, or section names.",
      "Use action='list_focused' when the user asks to see the active working set.",
      "Use action='next_task' when the user asks what to work on next.",
      "Use action='focus_task' or 'unfocus_task' to mark what is actively being worked on.",
      "Use action='bulk_add' when the user gives you multiple tasks at once.",
      "Use note and subtask actions instead of rewriting TODO.md by hand.",
      `Use action='archive_done' to move completed tasks into ${ARCHIVE_SECTION}.`,
    ],
    parameters: TodoMdParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await runTodo(ctx, params);
      return {
        content: [{ type: "text", text: result.message }],
        details: result.details,
      };
    },

    renderCall(args, theme) {
      const parts = [theme.fg("toolTitle", theme.bold("todo_md ")), theme.fg("muted", args.action)];
      if (args.id !== undefined) parts.push(` ${theme.fg("accent", `#${args.id}`)}`);
      if (args.subtask !== undefined) parts.push(` ${theme.fg("accent", `subtask:${args.subtask}`)}`);
      if (args.section) parts.push(` ${theme.fg("accent", `[${args.section}]`)}`);
      if (args.index !== undefined) parts.push(` ${theme.fg("dim", `@${args.index}`)}`);
      if (args.items?.length) parts.push(` ${theme.fg("dim", `${args.items.length} item(s)`)}`);
      if (args.text) parts.push(` ${theme.fg("dim", JSON.stringify(args.text))}`);
      return new Text(parts.join(""), 0, 0);
    },

    renderResult(result, { expanded }, theme, context) {
      const details = result.details;
      const fallbackText = result.content.find((part) => part.type === "text")?.text ?? "Done";
      if (!details) return new Text(fallbackText, 0, 0);

      const lines = [theme.fg("success", fallbackText)];
      lines.push(theme.fg("dim", `${formatDisplayPath(details.path, context.cwd)} · ${details.summary}`));

      if (details.affectedItems?.length > 1 && !expanded) {
        lines.push(theme.fg("dim", `${details.affectedItems.length} tasks affected`));
      }

      if (expanded || details.action === "list") {
        const sectionLines = buildSectionList(details, { expanded, showDone: true });
        if (sectionLines.length > 0) {
          lines.push("");
          for (const line of sectionLines) {
            lines.push(styleLine(theme, line.tone, line.text));
          }
        }
      }

      return new Text(lines.join("\n"), 0, 0);
    },
  });

  pi.registerCommand("todos", {
    description: "Open an interactive TODO.md browser (optionally filtered by section)",
    handler: async (args, ctx) => {
      const section = sanitizeSingleLine(args || "") || undefined;
      let result = await refreshList(ctx, section);
      const displayPath = formatDisplayPath(result.details.path, ctx.cwd);

      if (!ctx.hasUI) {
        ctx.ui.notify(`${displayPath}: ${result.details.counts.open} open / ${result.details.counts.done} done`, "info");
        return;
      }

      let browserState = { showDone: true, selectionKey: undefined };

      while (true) {
        const action = await ctx.ui.custom((_tui, theme, _kb, done) =>
          new TodoListComponent(_tui, result, theme, ctx.cwd, browserState, done),
        );

        if (!action || action.type === "close") {
          return;
        }

        browserState = {
          showDone: action.showDone !== false,
          selectionKey: action.selectionKey,
        };

        let mutationResult;

        switch (action.type) {
          case "check_task":
            mutationResult = await runTodo(ctx, { action: "check", id: action.id });
            break;
          case "focus_task":
            mutationResult = await runTodo(ctx, { action: "focus_task", id: action.id });
            break;
          case "unfocus_task":
            mutationResult = await runTodo(ctx, { action: "unfocus_task", id: action.id });
            break;
          case "uncheck_task":
            mutationResult = await runTodo(ctx, { action: "uncheck", id: action.id });
            break;
          case "check_subtask":
            mutationResult = await runTodo(ctx, { action: "check_subtask", id: action.id, subtask: action.subtask });
            break;
          case "uncheck_subtask":
            mutationResult = await runTodo(ctx, { action: "uncheck_subtask", id: action.id, subtask: action.subtask });
            break;
          case "prioritize":
            mutationResult = await runTodo(ctx, { action: "prioritize", id: action.id });
            break;
          case "remove_task":
            mutationResult = await runTodo(ctx, { action: "remove", id: action.id });
            break;
          case "remove_subtask":
            mutationResult = await runTodo(ctx, { action: "remove_subtask", id: action.id, subtask: action.subtask });
            break;
          case "archive_done":
            mutationResult = await runTodo(ctx, { action: "archive_done", section });
            break;
          case "rename_task": {
            const task = findTaskInDetails(result.details, action.id);
            const nextText = await ctx.ui.editor("Rename task", task?.text ?? "");
            if (nextText === undefined) continue;
            mutationResult = await runTodo(ctx, { action: "rename", id: action.id, text: nextText });
            break;
          }
          case "edit_note": {
            const task = findTaskInDetails(result.details, action.id);
            const currentNotes = (task?.notes ?? []).join("\n");
            const nextNotes = await ctx.ui.editor("Edit task note", currentNotes);
            if (nextNotes === undefined) continue;
            mutationResult = nextNotes.trim()
              ? await runTodo(ctx, { action: "set_note", id: action.id, text: nextNotes })
              : await runTodo(ctx, { action: "clear_note", id: action.id });
            break;
          }
          case "add_subtask": {
            const subtaskText = await ctx.ui.input("Add subtask", "Describe the subtask");
            if (!subtaskText?.trim()) continue;
            mutationResult = await runTodo(ctx, { action: "add_subtask", id: action.id, text: subtaskText });
            break;
          }
          default:
            continue;
        }

        if (mutationResult?.message) {
          ctx.ui.notify(mutationResult.message, "info");
        }

        result = await refreshList(ctx, section);
      }
    },
  });
}
