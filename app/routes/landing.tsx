import { Link } from "react-router";
import { BrandMark } from "../components/BrandLogo";

export default function Landing() {
  return (
    <main className="landing">
      <section className="landing-hero">
        <div>
          <div className="brand large"><span className="brand-mark"><BrandMark /></span><span>Flowmail</span></div>
          <h1>Open-source lifecycle email, running on your Cloudflare account.</h1>
          <p>Import contacts, draft a lifecycle email, approve a limited send, and handle replies with Agent-assisted drafts.</p>
          <div className="row-actions">
            <a className="button-link" href="https://deploy.workers.cloudflare.com/?url=https://github.com/yangkui/flowmail">Deploy to Cloudflare</a>
            <Link className="secondary-link" to="/setup">Open console</Link>
          </div>
        </div>
      </section>
      <section className="landing-band">
        <div><strong>Send</strong><span>Queue-backed lifecycle campaigns</span></div>
        <div><strong>Reply</strong><span>Inbound routing and attribution</span></div>
        <div><strong>Follow up</strong><span>Agent drafts, human approval</span></div>
      </section>
    </main>
  );
}
