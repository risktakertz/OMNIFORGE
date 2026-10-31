import TaskList from "./task-list";

export default function Home() {
  return (
    <main id="main" style={{ maxWidth: 720, margin: "0 auto", padding: "48px 16px" }}>
      <h1 style={{ color: "#0f766e" }}>Sample Web App</h1>
      <p>
        Interactive starter: a client-side task list with honest, local-only state.
        Wire a real database only when the product needs one (Supabase/Postgres are
        pre-approved adapters — see <code>docs/UPSTREAM_INTEGRATIONS.md</code>).
      </p>
      <TaskList />
    </main>
  );
}
