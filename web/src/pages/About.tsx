export function About() {
  return (
    <section className="prose">
      <h1>About this build</h1>
      <p>
        The frontend only calls API endpoints that exist. Today that is <code>GET /api/health</code>. Catalogue,
        accounts, cart and orders appear here as the matching backend steps are implemented and tested.
      </p>
      <p>
        Payments are simulated end to end: there is no payment gateway, and the interface never asks for card
        details. Admin and demo-viewer permissions will be enforced by the API, not by hiding buttons.
      </p>
    </section>
  );
}
