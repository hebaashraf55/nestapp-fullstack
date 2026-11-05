import { PHOTO_CREDITS } from '../lib/photoCredits';

export function About() {
  return (
    <section className="prose">
      <h1>About this build</h1>
      <p>
        Atelier Noor is a portfolio storefront: a NestJS + MongoDB API with a React front end. The
        brands, products and prices are invented for the demo.
      </p>
      <p>
        Payments are simulated end to end: there is no payment gateway, and the interface never asks
        for card details. Admin and demo-viewer permissions are enforced by the API, not by hiding
        buttons.
      </p>
      <h2>Photo credits</h2>
      <p>
        Product photos are from <a href="https://unsplash.com">Unsplash</a>, used under the{' '}
        <a href="https://unsplash.com/license">Unsplash License</a>. Thank you to:
      </p>
      <ul className="credits">
        {PHOTO_CREDITS.map((c) => (
          <li key={c.file}>
            <a href={c.url} target="_blank" rel="noreferrer">
              {c.photographer}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
