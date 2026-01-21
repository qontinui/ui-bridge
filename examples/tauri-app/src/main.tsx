import React from 'react';
import ReactDOM from 'react-dom/client';
import { UIBridgeProvider } from 'ui-bridge';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UIBridgeProvider
      features={{
        control: true,
        renderLog: true,
        debug: true,
      }}
      config={{
        // Tauri apps use a local server
        // The Rust backend serves UI Bridge endpoints
        serverPort: 9876,
      }}
    >
      <App />
    </UIBridgeProvider>
  </React.StrictMode>
);
