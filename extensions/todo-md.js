import { relative } from "node:path";

import { StringEnum } from "@mariozechner/pi-ai";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import { executeTodoActionOnFile, locateTodoFile, sanitizeSingleLine } from "../src/todo-md.js";

const TODO_ACTIONS = ["list", "add", "bulk_add", "check", "uncheck", "rename", "remove", "move", "prioritize"];

const TodoMdParams = Type.Object({
  action: StringEnum(TODO_ACTIONS),
  text: Type.Optional(Type.String({ description: "Task text for add or rename" })),
  items: Type.Optional(
    Type.Array(Type.String(), { description: "Task texts for bulk_add" }),
  ),
  id: Type.Optional(Type.Integer({ description: "Task id for check, uncheck, rename, remove, move, or prioritize" })),
  section: Type.Optional(Type.String({ description: "Section name for add, bulk_add, move, prioritize, or list filtering" })),
  index: Type.Optional(Type.Integer({ description: "1-based position within the target section for add, bulk_add, or move" })),
});

function formatDisplayPath(path, cwd) {
  if (!path) return "TODO.md";
  if (!cwd) return path;
  const relativePath = relative(cwd, path);
  return relativePath || "TODO.md";
}

function renderSectionList(details, theme, expanded) {
  const lines = [];
  const sections = details.sections ?? [];
  const maxSections = expanded ? sections.length : Math.min(sections.length, 3);

  for (let sectionIndex = 0; sectionIndex < maxSections; sectionIndex += 1) {
    const section = sections[sectionIndex];
    lines.push(theme.fg("accent", `## ${section.name}`));

    const items = section.items ?? [];
    const maxItems = expanded ? items.length : Math.min(items.length, 5);
    for (let itemIndex = 0; itemIndex < maxItems; itemIndex += 1) {
      const item = items[itemIndex];
      const marker = item.checked ? theme.fg("success", "[x]") : theme.fg("muted", "[ ]");
      const id = theme.fg("accent", `#${item.id}`);
      const text = item.checked ? theme.fg("dim", item.text) : theme.fg("muted", item.text);
      lines.push(`${marker} ${id} ${text}`);
    }

    if (!expanded && items.length > maxItems) {
      lines.push(theme.fg("dim", `… ${items.length - maxItems} more in ${section.name}`));
    }
  }

  if (!expanded && sections.length > maxSections) {
    lines.push(theme.fg("dim", `… ${sections.length - maxSections} more section(s)`));
  }

  return lines;
}

class TodoListComponent {
  constructor(result, theme, cwd, onClose) {
    this.result = result;
    this.theme = theme;
    this.cwd = cwd;
    this.onClose = onClose;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  handleInput(data) {
    if (
      matchesKey(data, "escape") ||
      matchesKey(data, "ctrl+c") ||
      matchesKey(data, "return") ||
      matchesKey(data, "q")
    ) {
      this.onClose();
    }
  }

  render(width) {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const details = this.result.details;
    const counts = details.counts;
    const displayPath = formatDisplayPath(details.path, this.cwd);
    const lines = [];
    const theme = this.theme;

    lines.push("");
    lines.push(truncateToWidth(theme.fg("accent", " TODO.md "), width));
    lines.push(truncateToWidth(theme.fg("dim", `${displayPath} · ${counts.open} open · ${counts.done} done`), width));

    if (details.filterSection) {
      lines.push(truncateToWidth(theme.fg("muted", `Filter: ${details.filterSection}`), width));
    }

    if (counts.total === 0) {
      lines.push("");
      lines.push(truncateToWidth(theme.fg("dim", "No tasks yet."), width));
    } else {
      lines.push("");
      for (const sectionLine of renderSectionList(details, theme, true)) {
        lines.push(truncateToWidth(sectionLine, width));
      }
    }

    lines.push("");
    lines.push(truncateToWidth(theme.fg("dim", "Press Enter, q, or Escape to close"), width));
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

  pi.registerTool({
    name: "todo_md",
    label: "TODO.md",
    description:
      "Manage the project's TODO.md file with a structured API. Actions: list, add, bulk_add, check, uncheck, rename, remove, move, prioritize.",
    promptSnippet:
      "Use todo_md to manage the project's TODO.md file instead of editing the file directly.",
    promptGuidelines: [
      "Use todo_md when the user asks to manage the project task list or TODO.md.",
      "Use action='list' before mutating tasks when you need the current task IDs or section names.",
      "Use action='bulk_add' when the user gives you multiple tasks at once.",
      "Prefer move and prioritize over direct file edits when reordering tasks.",
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
        const sectionLines = renderSectionList(details, theme, expanded);
        if (sectionLines.length > 0) lines.push("", ...sectionLines);
      }

      return new Text(lines.join("\n"), 0, 0);
    },
  });

  pi.registerCommand("todos", {
    description: "Open a TODO.md browser (optionally filtered by section)",
    handler: async (args, ctx) => {
      const section = sanitizeSingleLine(args || "") || undefined;
      const result = await runTodo(ctx, { action: "list", section });
      const displayPath = formatDisplayPath(result.details.path, ctx.cwd);

      if (!ctx.hasUI) {
        ctx.ui.notify(`${displayPath}: ${result.details.counts.open} open / ${result.details.counts.done} done`, "info");
        return;
      }

      await ctx.ui.custom((_tui, theme, _kb, done) => new TodoListComponent(result, theme, ctx.cwd, () => done()));
    },
  });
}
