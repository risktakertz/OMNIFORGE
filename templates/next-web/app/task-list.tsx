"use client";

import { useState } from "react";

type Task = { id: string; text: string; done: boolean };

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [text, setText] = useState("");

  function add() {
    const value = text.trim();
    if (!value) return;
    setTasks((t) => [...t, { id: crypto.randomUUID(), text: value, done: false }]);
    setText("");
  }

  return (
    <section aria-label="Tasks">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <label htmlFor="task" className="sr-only">New task</label>
        <input
          id="task"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a task…"
          style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #d6d3d1" }}
        />
        <button type="submit" style={{ background: "#0f766e", color: "#fff", border: 0, borderRadius: 8, padding: "10px 16px", fontWeight: 700 }}>
          Add
        </button>
      </form>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {tasks.map((t) => (
          <li key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #e7e5e4" }}>
            <input
              type="checkbox"
              checked={t.done}
              aria-label={`Mark ${t.text} done`}
              onChange={() => setTasks((all) => all.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}
            />
            <span style={{ textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
            <button onClick={() => setTasks((all) => all.filter((x) => x.id !== t.id))} style={{ marginLeft: "auto" }}>
              remove
            </button>
          </li>
        ))}
      </ul>
      {tasks.length === 0 && <p style={{ color: "#57534e" }}>Nothing yet — add your first task.</p>}
    </section>
  );
}
