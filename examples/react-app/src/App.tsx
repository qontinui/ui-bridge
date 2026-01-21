/**
 * UI Bridge React Example
 *
 * Demonstrates how to use UI Bridge hooks in a React application.
 */

import React, { useState } from 'react';
import {
  UIBridgeProvider,
  useUIElement,
  useUIComponent,
  useUIBridge,
} from 'ui-bridge';

/**
 * Login Form Component
 *
 * Demonstrates element registration and component actions.
 */
function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  // Register individual elements
  const emailInput = useUIElement({
    id: 'login-email',
    type: 'input',
    label: 'Email Input',
  });

  const passwordInput = useUIElement({
    id: 'login-password',
    type: 'input',
    label: 'Password Input',
  });

  const submitButton = useUIElement({
    id: 'login-submit',
    type: 'button',
    label: 'Submit Button',
  });

  // Register component with actions
  useUIComponent({
    id: 'login-form',
    name: 'Login Form',
    description: 'User authentication form',
    actions: [
      {
        id: 'login',
        label: 'Submit Login',
        description: 'Submit the login form with credentials',
        handler: async (params?: unknown) => {
          const p = params as { email?: string; password?: string } | undefined;
          if (p?.email) setEmail(p.email);
          if (p?.password) setPassword(p.password);

          // Simulate login
          await new Promise((resolve) => setTimeout(resolve, 500));
          setMessage('Login successful!');
          return { success: true };
        },
      },
      {
        id: 'clear',
        label: 'Clear Form',
        description: 'Clear all form fields',
        handler: () => {
          setEmail('');
          setPassword('');
          setMessage('');
          return { cleared: true };
        },
      },
    ],
    elementIds: ['login-email', 'login-password', 'login-submit'],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(`Logging in as ${email}...`);
    setTimeout(() => setMessage('Login successful!'), 500);
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <h2>Login</h2>

      <div style={styles.field}>
        <label htmlFor="email">Email:</label>
        <input
          ref={emailInput.ref}
          id="email"
          type="email"
          data-ui-id="login-email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          style={styles.input}
        />
      </div>

      <div style={styles.field}>
        <label htmlFor="password">Password:</label>
        <input
          ref={passwordInput.ref}
          id="password"
          type="password"
          data-ui-id="login-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          style={styles.input}
        />
      </div>

      <button
        ref={submitButton.ref}
        type="submit"
        data-ui-id="login-submit"
        style={styles.button}
      >
        Login
      </button>

      {message && <p style={styles.message}>{message}</p>}
    </form>
  );
}

/**
 * Status Panel
 *
 * Displays UI Bridge status and discovered elements.
 */
function StatusPanel() {
  const bridge = useUIBridge();
  const [elements, setElements] = useState<Array<{ id: string; type: string }>>([]);
  const [discovering, setDiscovering] = useState(false);

  const handleDiscover = async () => {
    setDiscovering(true);
    try {
      const response = await bridge.discover({ interactiveOnly: true });
      setElements(response.elements.map((e) => ({ id: e.id, type: e.type })));
    } catch (error) {
      console.error('Discovery failed:', error);
    }
    setDiscovering(false);
  };

  return (
    <div style={styles.panel}>
      <h3>UI Bridge Status</h3>

      <p>
        <strong>Available:</strong> {bridge.available ? 'Yes' : 'No'}
      </p>

      <p>
        <strong>Registered Elements:</strong> {bridge.elements.length}
      </p>

      <p>
        <strong>Registered Components:</strong> {bridge.components.length}
      </p>

      <button onClick={handleDiscover} disabled={discovering} style={styles.button}>
        {discovering ? 'Discovering...' : 'Discover Elements'}
      </button>

      {elements.length > 0 && (
        <div style={styles.list}>
          <h4>Discovered Elements:</h4>
          <ul>
            {elements.map((el) => (
              <li key={el.id}>
                {el.id} ({el.type})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Main App Component
 */
function App() {
  return (
    <UIBridgeProvider
      features={{
        renderLog: true,
        control: true,
        debug: true,
      }}
      config={{
        verbose: true,
      }}
    >
      <div style={styles.container}>
        <h1>UI Bridge React Example</h1>

        <div style={styles.content}>
          <LoginForm />
          <StatusPanel />
        </div>

        <div style={styles.footer}>
          <p>
            Open the browser console to see UI Bridge events.
            <br />
            Use the Python client or HTTP API to control this form.
          </p>
        </div>
      </div>
    </UIBridgeProvider>
  );
}

/**
 * Styles
 */
const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '20px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  content: {
    display: 'flex',
    gap: '40px',
    flexWrap: 'wrap',
  },
  form: {
    flex: '1',
    minWidth: '300px',
    padding: '20px',
    border: '1px solid #e0e0e0',
    borderRadius: '8px',
    backgroundColor: '#f9f9f9',
  },
  field: {
    marginBottom: '16px',
  },
  input: {
    display: 'block',
    width: '100%',
    padding: '8px 12px',
    marginTop: '4px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '14px',
  },
  button: {
    padding: '10px 20px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  message: {
    marginTop: '16px',
    padding: '10px',
    backgroundColor: '#d4edda',
    borderRadius: '4px',
    color: '#155724',
  },
  panel: {
    flex: '1',
    minWidth: '300px',
    padding: '20px',
    border: '1px solid #e0e0e0',
    borderRadius: '8px',
    backgroundColor: '#f0f7ff',
  },
  list: {
    marginTop: '16px',
    fontSize: '14px',
  },
  footer: {
    marginTop: '40px',
    padding: '20px',
    textAlign: 'center',
    color: '#666',
    fontSize: '14px',
  },
};

export default App;
