---
sidebar_position: 2
---

# Next.js Example App

A Next.js application demonstrating UI Bridge integration with App Router.

## Overview

This example shows how to:
- Set up UIBridgeProvider in a Next.js layout
- Create API routes for UI Bridge
- Use client components for interactivity
- Control the app from Python

## Source Code

The full example is available at: [examples/nextjs-app](https://github.com/qontinui/ui-bridge/tree/main/examples/nextjs-app)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/qontinui/ui-bridge.git
cd ui-bridge/examples/nextjs-app

# Install dependencies
npm install

# Start the app
npm run dev
```

The app runs at `http://localhost:3000` with UI Bridge at `http://localhost:3000/api/ui-bridge`.

## Project Structure

```
examples/nextjs-app/
├── app/
│   ├── api/
│   │   └── ui-bridge/
│   │       └── [...path]/
│   │           └── route.ts    # UI Bridge API routes
│   ├── layout.tsx              # Root layout with provider
│   ├── page.tsx                # Home page
│   └── components/
│       └── ContactForm.tsx     # Example form component
├── package.json
└── next.config.js
```

## Key Code

### API Route

```typescript title="app/api/ui-bridge/[...path]/route.ts"
import { createNextHandler } from 'ui-bridge-server/nextjs';

const handler = createNextHandler({
  features: {
    control: true,
    renderLog: true,
    debug: process.env.NODE_ENV === 'development',
  },
});

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
```

### Root Layout

```tsx title="app/layout.tsx"
import { UIBridgeProvider } from 'ui-bridge';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <UIBridgeProvider
          config={{ apiPath: '/api/ui-bridge' }}
        >
          {children}
        </UIBridgeProvider>
      </body>
    </html>
  );
}
```

### Client Component

```tsx title="app/components/ContactForm.tsx"
'use client';

import { useState } from 'react';
import { useUIElement, useUIComponent } from 'ui-bridge';

export default function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const nameInput = useUIElement({ id: 'contact-name', type: 'input' });
  const emailInput = useUIElement({ id: 'contact-email', type: 'input' });
  const messageInput = useUIElement({ id: 'contact-message', type: 'textarea' });
  const submitButton = useUIElement({ id: 'contact-submit', type: 'button' });

  useUIComponent({
    id: 'contact-form',
    name: 'Contact Form',
    actions: [
      {
        id: 'submit',
        handler: async (params) => {
          const data = params as { name: string; email: string; message: string };
          // Submit logic
          setSubmitted(true);
          return { success: true, timestamp: Date.now() };
        },
      },
      {
        id: 'reset',
        handler: async () => {
          setName('');
          setEmail('');
          setMessage('');
          setSubmitted(false);
        },
      },
    ],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  if (submitted) {
    return <div data-ui-id="contact-success">Thank you for your message!</div>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        ref={nameInput.ref}
        data-ui-id="contact-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
      />
      <input
        ref={emailInput.ref}
        data-ui-id="contact-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
      />
      <textarea
        ref={messageInput.ref}
        data-ui-id="contact-message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Message"
      />
      <button ref={submitButton.ref} data-ui-id="contact-submit" type="submit">
        Send
      </button>
    </form>
  );
}
```

## Controlling from Python

```python
from ui_bridge import UIBridgeClient

# Connect to Next.js API route
client = UIBridgeClient(
    base_url='http://localhost:3000',
    api_path='/api/ui-bridge'
)

# Fill the form
client.type('contact-name', 'John Doe')
client.type('contact-email', 'john@example.com')
client.type('contact-message', 'Hello, this is a test message!')

# Submit via button
client.click('contact-submit')

# Or use component action
client.component('contact-form').action('submit', {
    'name': 'John Doe',
    'email': 'john@example.com',
    'message': 'Hello!'
})
```

## Development vs Production

For production, consider:
- Adding authentication to API routes
- Disabling debug features
- Using environment variables for feature flags

```typescript title="app/api/ui-bridge/[...path]/route.ts"
const handler = createNextHandler({
  features: {
    control: process.env.ENABLE_UI_BRIDGE === 'true',
    debug: false,
  },
});
```
