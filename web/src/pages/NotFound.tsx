import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <section className="prose">
      <h1>Page not found</h1>
      <p>That page does not exist.</p>
      <Link to="/">Back to home</Link>
    </section>
  );
}
