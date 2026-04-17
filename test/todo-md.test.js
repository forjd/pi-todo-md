import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARCHIVE_SECTION, executeTodoActionOnFile, locateTodoFile } from "../src/todo-md.js";

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), "pi-todo-md-"));
}

function getSection(result, name) {
  return result.details.sections.find((section) => section.name === name);
}

test("locateTodoFile prefers the git root when no TODO.md exists yet", async () => {
  const root = await makeTempDir();
  await mkdir(join(root, ".git"));
  const nested = join(root, "packages", "app", "src");
  await mkdir(nested, { recursive: true });

  const todoPath = await locateTodoFile(nested);
  assert.equal(todoPath, join(root, "TODO.md"));
});

test("add, list, check, uncheck, and remove work on a fresh TODO.md", async () => {
  const root = await makeTempDir();
  const todoPath = join(root, "TODO.md");

  let result = await executeTodoActionOnFile(todoPath, { action: "add", text: "ship the plugin" });
  assert.match(result.message, /Added #1/);
  assert.equal(result.details.counts.total, 1);
  assert.equal(getSection(result, "Tasks").items[0].text, "ship the plugin");

  let markdown = await readFile(todoPath, "utf8");
  assert.match(markdown, /<!-- pi-todo-md:id=1 -->/);

  result = await executeTodoActionOnFile(todoPath, { action: "check", id: 1 });
  assert.equal(getSection(result, "Tasks").items[0].checked, true);

  result = await executeTodoActionOnFile(todoPath, { action: "uncheck", id: 1 });
  assert.equal(getSection(result, "Tasks").items[0].checked, false);

  result = await executeTodoActionOnFile(todoPath, { action: "remove", id: 1 });
  assert.equal(result.details.counts.total, 0);

  markdown = await readFile(todoPath, "utf8");
  assert.match(markdown, /^# TODO/m);
  assert.doesNotMatch(markdown, /ship the plugin/);
});

test("next_task recommends the first useful open task", async () => {
  const root = await makeTempDir();
  const todoPath = join(root, "TODO.md");

  await executeTodoActionOnFile(todoPath, { action: "add", text: "first task" });
  await executeTodoActionOnFile(todoPath, { action: "add", text: "second task" });
  await executeTodoActionOnFile(todoPath, { action: "check", id: 1 });
  await executeTodoActionOnFile(todoPath, { action: "add_subtask", id: 2, text: "finish docs" });

  let result = await executeTodoActionOnFile(todoPath, { action: "next_task" });
  assert.match(result.message, /Next task: #2/);
  assert.equal(result.details.affectedItem.id, 2);

  result = await executeTodoActionOnFile(todoPath, { action: "next_task", section: "Tasks" });
  assert.equal(result.details.affectedItem.id, 2);

  await executeTodoActionOnFile(todoPath, { action: "check", id: 2 });
  result = await executeTodoActionOnFile(todoPath, { action: "next_task" });
  assert.match(result.message, /No open tasks found/);
});

test("focus mode marks tasks and affects recommendations", async () => {
  const root = await makeTempDir();
  const todoPath = join(root, "TODO.md");

  await executeTodoActionOnFile(todoPath, { action: "add", text: "first task" });
  await executeTodoActionOnFile(todoPath, { action: "add", text: "second task" });
  await executeTodoActionOnFile(todoPath, { action: "focus_task", id: 2 });

  let result = await executeTodoActionOnFile(todoPath, { action: "list_focused" });
  assert.equal(result.details.counts.total, 1);
  assert.equal(result.details.affectedItem, undefined);
  assert.equal(getSection(result, "Tasks").items[0].focused, true);

  result = await executeTodoActionOnFile(todoPath, { action: "next_task" });
  assert.equal(result.details.affectedItem.id, 2);
  assert.equal(result.details.affectedItem.focused, true);

  const markdown = await readFile(todoPath, "utf8");
  assert.match(markdown, /second task \[focus\] <!-- pi-todo-md:id=2 -->/);

  result = await executeTodoActionOnFile(todoPath, { action: "unfocus_task", id: 2 });
  assert.equal(getSection(result, "Tasks").items[1].focused, false);
});

test("priority metadata round-trips and influences next_task", async () => {
  const root = await makeTempDir();
  const todoPath = join(root, "TODO.md");

  await executeTodoActionOnFile(todoPath, { action: "add", text: "first task" });
  await executeTodoActionOnFile(todoPath, { action: "add", text: "second task" });
  await executeTodoActionOnFile(todoPath, { action: "set_priority", id: 2, priority: "high" });

  let result = await executeTodoActionOnFile(todoPath, { action: "next_task" });
  assert.equal(result.details.affectedItem.id, 2);
  assert.equal(result.details.affectedItem.priority, "high");

  let markdown = await readFile(todoPath, "utf8");
  assert.match(markdown, /second task \[high\] <!-- pi-todo-md:id=2 -->/);

  result = await executeTodoActionOnFile(todoPath, { action: "clear_priority", id: 2 });
  assert.equal(getSection(result, "Tasks").items[1].priority, undefined);

  markdown = await readFile(todoPath, "utf8");
  assert.doesNotMatch(markdown, /\[high\]/);
});

test("section management can create, rename, move, and remove sections", async () => {
  const root = await makeTempDir();
  const todoPath = join(root, "TODO.md");

  let result = await executeTodoActionOnFile(todoPath, { action: "create_section", section: "Inbox" });
  assert.match(result.message, /Created section Inbox/);

  await executeTodoActionOnFile(todoPath, { action: "add", section: "Inbox", text: "triage work" });
  result = await executeTodoActionOnFile(todoPath, {
    action: "rename_section",
    section: "Inbox",
    targetSection: "Backlog",
  });
  assert.match(result.message, /Renamed section Inbox to Backlog/);
  assert.equal(getSection(result, "Backlog").items[0].text, "triage work");

  result = await executeTodoActionOnFile(todoPath, {
    action: "move_section",
    section: "Backlog",
    index: 1,
  });
  assert.equal(result.details.sections[0].name, "Backlog");

  result = await executeTodoActionOnFile(todoPath, {
    action: "remove_section",
    section: "Backlog",
    targetSection: "Tasks",
  });
  assert.match(result.message, /Removed section Backlog and moved its tasks to Tasks/);
  assert.equal(getSection(result, "Tasks").items.at(-1).text, "triage work");

  const markdown = await readFile(todoPath, "utf8");
  assert.doesNotMatch(markdown, /## Backlog/);
});

test("rename and bulk_add support richer task updates", async () => {
  const root = await makeTempDir();
  const todoPath = join(root, "TODO.md");

  let result = await executeTodoActionOnFile(todoPath, {
    action: "bulk_add",
    section: "Inbox",
    items: ["first task", "second task", "third task"],
    index: 1,
  });

  assert.equal(result.details.counts.total, 3);
  assert.deepEqual(
    getSection(result, "Inbox").items.map((item) => item.text),
    ["first task", "second task", "third task"],
  );

  result = await executeTodoActionOnFile(todoPath, {
    action: "rename",
    id: 2,
    text: "second task renamed",
  });

  assert.equal(getSection(result, "Inbox").items[1].text, "second task renamed");

  const markdown = await readFile(todoPath, "utf8");
  assert.match(markdown, /second task renamed/);
});

test("notes and subtasks round-trip through markdown and actions", async () => {
  const root = await makeTempDir();
  const todoPath = join(root, "TODO.md");

  await executeTodoActionOnFile(todoPath, { action: "add", text: "ship the plugin" });
  await executeTodoActionOnFile(todoPath, {
    action: "set_note",
    id: 1,
    text: "publish after docs\nannounce in Discord",
  });
  await executeTodoActionOnFile(todoPath, {
    action: "add_subtask",
    id: 1,
    text: "write docs",
  });
  await executeTodoActionOnFile(todoPath, {
    action: "add_subtask",
    id: 1,
    text: "publish package",
  });

  let result = await executeTodoActionOnFile(todoPath, {
    action: "check_subtask",
    id: 1,
    subtask: 2,
  });

  const task = getSection(result, "Tasks").items[0];
  assert.deepEqual(task.notes, ["publish after docs", "announce in Discord"]);
  assert.deepEqual(
    task.subtasks.map((subtask) => ({ index: subtask.index, text: subtask.text, checked: subtask.checked })),
    [
      { index: 1, text: "write docs", checked: false },
      { index: 2, text: "publish package", checked: true },
    ],
  );

  let markdown = await readFile(todoPath, "utf8");
  assert.match(markdown, /  - note: publish after docs/);
  assert.match(markdown, /  - note: announce in Discord/);
  assert.match(markdown, /  - \[ \] write docs/);
  assert.match(markdown, /  - \[x\] publish package/);

  result = await executeTodoActionOnFile(todoPath, { action: "clear_note", id: 1 });
  assert.deepEqual(getSection(result, "Tasks").items[0].notes, []);

  markdown = await readFile(todoPath, "utf8");
  assert.doesNotMatch(markdown, /note:/);
});

test("move and prioritize can reorder work across sections", async () => {
  const root = await makeTempDir();
  const todoPath = join(root, "TODO.md");

  await executeTodoActionOnFile(todoPath, { action: "add", text: "first task" });
  await executeTodoActionOnFile(todoPath, { action: "add", text: "second task" });
  await executeTodoActionOnFile(todoPath, { action: "add", text: "third task" });

  let result = await executeTodoActionOnFile(todoPath, {
    action: "move",
    id: 2,
    section: "In Progress",
    index: 1,
  });
  assert.equal(getSection(result, "In Progress").items[0].id, 2);

  result = await executeTodoActionOnFile(todoPath, {
    action: "prioritize",
    id: 3,
    section: "In Progress",
  });

  const inProgress = getSection(result, "In Progress").items.map((item) => item.id);
  assert.deepEqual(inProgress, [3, 2]);

  const tasks = getSection(result, "Tasks").items.map((item) => item.id);
  assert.deepEqual(tasks, [1]);
});

test("archive_done moves completed tasks into the archive section", async () => {
  const root = await makeTempDir();
  const todoPath = join(root, "TODO.md");

  await executeTodoActionOnFile(todoPath, { action: "add", text: "done task" });
  await executeTodoActionOnFile(todoPath, { action: "add", text: "open task" });
  await executeTodoActionOnFile(todoPath, { action: "check", id: 1 });

  const result = await executeTodoActionOnFile(todoPath, { action: "archive_done" });
  assert.match(result.message, /Archived 1 completed task/);
  assert.deepEqual(getSection(result, "Tasks").items.map((item) => item.id), [2]);
  assert.deepEqual(getSection(result, ARCHIVE_SECTION).items.map((item) => item.id), [1]);

  const markdown = await readFile(todoPath, "utf8");
  assert.match(markdown, /## Archive/);
  assert.match(markdown, /- \[x\] done task <!-- pi-todo-md:id=1 -->/);
});

test("listing normalizes legacy markdown without embedded IDs", async () => {
  const root = await makeTempDir();
  const todoPath = join(root, "TODO.md");

  await writeFile(
    todoPath,
    "# TODO\n\n## Tasks\n- [ ] legacy task\n  - note: keep old formatting working\n  - [x] legacy subtask\n- [x] old done task\n",
    "utf8",
  );

  const result = await executeTodoActionOnFile(todoPath, { action: "list" });
  assert.equal(result.details.counts.total, 2);
  assert.deepEqual(getSection(result, "Tasks").items[0].notes, ["keep old formatting working"]);
  assert.equal(getSection(result, "Tasks").items[0].subtasks[0].text, "legacy subtask");

  const markdown = await readFile(todoPath, "utf8");
  assert.match(markdown, /pi-todo-md:id=1/);
  assert.match(markdown, /pi-todo-md:id=2/);
});
