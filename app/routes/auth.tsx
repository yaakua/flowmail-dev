import { useState } from "react";
import { useNavigate } from "react-router";
import { BrandMark } from "../components/BrandLogo";
import { api } from "../lib/api";

export default function Auth() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("flowmail-admin");
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  async function signIn() {
    try {
      await api<{ ok: true }>("/api/public/auth/session", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      navigate("/setup", { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="brand large"><span className="brand-mark"><BrandMark /></span><span>Flowmail</span></div>
        <h1>Sign in to Flowmail</h1>
        <p>Default username is admin and default password is flowmail-admin.</p>
        <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="admin" />
        <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="flowmail-admin" type="password" />
        <button disabled={!username || !password} onClick={signIn}>Sign in</button>
        {message ? <p className="muted">{message}</p> : null}
      </section>
    </main>
  );
}
