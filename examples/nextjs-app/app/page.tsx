'use client';

import ContactForm from './components/ContactForm';
import Counter from './components/Counter';

export default function Home() {
  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>UI Bridge Next.js Example</h1>
      <p>
        This example demonstrates UI Bridge integration with Next.js App Router.
        Control this UI from Python or any HTTP client.
      </p>

      <section style={{ marginTop: '2rem' }}>
        <h2>Counter Component</h2>
        <Counter />
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Contact Form</h2>
        <ContactForm />
      </section>

      <section style={{ marginTop: '2rem', padding: '1rem', background: '#f5f5f5' }}>
        <h3>Python Control Example</h3>
        <pre style={{ overflow: 'auto' }}>
{`from ui_bridge import UIBridgeClient

client = UIBridgeClient(
    base_url='http://localhost:3000',
    api_path='/api/ui-bridge'
)

# Increment counter
client.click('counter-increment')

# Fill contact form
client.type('contact-name', 'John Doe')
client.type('contact-email', 'john@example.com')
client.type('contact-message', 'Hello!')
client.click('contact-submit')
`}
        </pre>
      </section>
    </main>
  );
}
