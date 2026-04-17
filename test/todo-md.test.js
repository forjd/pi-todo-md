import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeTodoActionOnFile, locateTodoFile } from "../src/todo-md.js";

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

test("listing normalizes legacy markdown without embedded IDs", async () => {
  const root = await makeTempDir();
  const todoPath = join(root, "TODO.md");

  await writeFile(
    todoPath,
    "# TODO\n\n## Tasks\n- [ ] legacy task\n- [x] old done task\n",
    "utf8",
  );

  const result = await executeTodoActionOnFile(todoPath, { action: "list" });
  assert.equal(result.details.counts.total, 2);

  const markdown = await readFile(todoPath, "utf8");
  assert.match(markdown, /pi-todo-md:id=1/);
  assert.match(markdown, /pi-todo-md:id=2/);
});
