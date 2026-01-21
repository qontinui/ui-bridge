'use client';

import { useState } from 'react';
import { useUIElement, useUIComponent } from 'ui-bridge';

export default function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const nameInput = useUIElement({
    id: 'contact-name',
    type: 'input',
    label: 'Name Input',
  });

  const emailInput = useUIElement({
    id: 'contact-email',
    type: 'input',
    label: 'Email Input',
  });

  const messageInput = useUIElement({
    id: 'contact-message',
    type: 'textarea',
    label: 'Message Input',
  });

  const submitButton = useUIElement({
    id: 'contact-submit',
    type: 'button',
    label: 'Submit Button',
  });

  useUIComponent({
    id: 'contact-form',
    name: 'Contact Form',
    description: 'A contact form with name, email, and message fields',
    actions: [
      {
        id: 'submit',
        label: 'Submit Form',
        handler: async (params) => {
          const data = params as { name?: string; email?: string; message?: string };
          // Use provided params or current state
          const formData = {
            name: data.name ?? name,
            email: data.email ?? email,
            message: data.message ?? message,
          };

          // Simulate form submission
          console.log('Form submitted:', formData);
          setSubmitted(true);

          return {
            success: true,
            timestamp: Date.now(),
            data: formData,
          };
        },
      },
      {
        id: 'reset',
        label: 'Reset Form',
        handler: async () => {
          setName('');
          setEmail('');
          setMessage('');
          setSubmitted(false);
          return { success: true };
        },
      },
      {
        id: 'fill',
        label: 'Fill Form',
        handler: async (params) => {
          const data = params as { name?: string; email?: string; message?: string };
          if (data.name) setName(data.name);
          if (data.email) setEmail(data.email);
          if (data.message) setMessage(data.message);
          return { success: true };
        },
      },
    ],
    elementIds: ['contact-name', 'contact-email', 'contact-message', 'contact-submit'],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div
        data-ui-id="contact-success"
        style={{
          padding: '1rem',
          background: '#d4edda',
          border: '1px solid #c3e6cb',
          borderRadius: '4px',
        }}
      >
        <p>Thank you for your message, {name || 'friend'}!</p>
        <p>We will get back to you at {email || 'your email'}.</p>
        <button
          data-ui-id="contact-back"
          onClick={() => {
            setSubmitted(false);
            setName('');
            setEmail('');
            setMessage('');
          }}
          style={{ marginTop: '1rem' }}
        >
          Send Another Message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <label htmlFor="name" style={{ display: 'block', marginBottom: '0.25rem' }}>
          Name
        </label>
        <input
          ref={nameInput.ref}
          id="name"
          data-ui-id="contact-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          required
          style={{ width: '100%', padding: '0.5rem' }}
        />
      </div>

      <div>
        <label htmlFor="email" style={{ display: 'block', marginBottom: '0.25rem' }}>
          Email
        </label>
        <input
          ref={emailInput.ref}
          id="email"
          data-ui-id="contact-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          required
          style={{ width: '100%', padding: '0.5rem' }}
        />
      </div>

      <div>
        <label htmlFor="message" style={{ display: 'block', marginBottom: '0.25rem' }}>
          Message
        </label>
        <textarea
          ref={messageInput.ref}
          id="message"
          data-ui-id="contact-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Your message..."
          required
          rows={4}
          style={{ width: '100%', padding: '0.5rem' }}
        />
      </div>

      <button
        ref={submitButton.ref}
        data-ui-id="contact-submit"
        type="submit"
        style={{ padding: '0.75rem 1.5rem', cursor: 'pointer' }}
      >
        Send Message
      </button>
    </form>
  );
}
