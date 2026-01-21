import { useState } from 'react';
import { useUIElement, useUIComponent } from 'ui-bridge';

function Counter() {
  const [count, setCount] = useState(0);

  const incrementBtn = useUIElement({
    id: 'counter-increment',
    type: 'button',
    label: 'Increment Button',
  });

  const decrementBtn = useUIElement({
    id: 'counter-decrement',
    type: 'button',
    label: 'Decrement Button',
  });

  const resetBtn = useUIElement({
    id: 'counter-reset',
    type: 'button',
    label: 'Reset Button',
  });

  useUIComponent({
    id: 'counter',
    name: 'Counter Component',
    description: 'A simple counter with increment, decrement, and reset actions',
    actions: [
      {
        id: 'increment',
        label: 'Increment',
        handler: async () => {
          setCount((c) => c + 1);
          return { count: count + 1 };
        },
      },
      {
        id: 'decrement',
        label: 'Decrement',
        handler: async () => {
          setCount((c) => c - 1);
          return { count: count - 1 };
        },
      },
      {
        id: 'reset',
        label: 'Reset',
        handler: async () => {
          setCount(0);
          return { count: 0 };
        },
      },
      {
        id: 'setCount',
        label: 'Set Count',
        handler: async (params) => {
          const { value } = params as { value: number };
          setCount(value);
          return { count: value };
        },
      },
    ],
    elementIds: ['counter-increment', 'counter-decrement', 'counter-reset'],
  });

  return (
    <div className="card">
      <div className="counter">
        <button
          ref={decrementBtn.ref}
          data-ui-id="counter-decrement"
          onClick={() => setCount((c) => c - 1)}
        >
          -
        </button>

        <span className="counter-value" data-ui-id="counter-value">
          {count}
        </span>

        <button
          ref={incrementBtn.ref}
          data-ui-id="counter-increment"
          onClick={() => setCount((c) => c + 1)}
        >
          +
        </button>

        <button
          ref={resetBtn.ref}
          data-ui-id="counter-reset"
          onClick={() => setCount(0)}
          style={{ marginLeft: '1rem' }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function FileManager() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');

  const openBtn = useUIElement({
    id: 'file-open',
    type: 'button',
    label: 'Open File Button',
  });

  const saveBtn = useUIElement({
    id: 'file-save',
    type: 'button',
    label: 'Save File Button',
  });

  useUIComponent({
    id: 'file-manager',
    name: 'File Manager',
    description: 'Desktop file operations - demonstrates Tauri integration',
    actions: [
      {
        id: 'openFile',
        label: 'Open File',
        handler: async (params) => {
          const { path } = params as { path?: string };
          // In a real app, this would use Tauri's dialog and fs APIs
          // import { open } from '@tauri-apps/api/dialog';
          // import { readTextFile } from '@tauri-apps/api/fs';
          const mockPath = path || '/example/file.txt';
          const mockContent = `Contents of ${mockPath}`;
          setSelectedFile(mockPath);
          setFileContent(mockContent);
          return { success: true, path: mockPath };
        },
      },
      {
        id: 'saveFile',
        label: 'Save File',
        handler: async (params) => {
          const { content } = params as { content?: string };
          const contentToSave = content || fileContent;
          // In a real app: await writeTextFile(selectedFile, contentToSave);
          console.log('Saving:', selectedFile, contentToSave);
          return { success: true, path: selectedFile };
        },
      },
      {
        id: 'clearFile',
        label: 'Clear',
        handler: async () => {
          setSelectedFile(null);
          setFileContent('');
          return { success: true };
        },
      },
    ],
    elementIds: ['file-open', 'file-save'],
  });

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          ref={openBtn.ref}
          data-ui-id="file-open"
          onClick={() => {
            setSelectedFile('/demo/sample.txt');
            setFileContent('Sample file content\nLine 2\nLine 3');
          }}
        >
          Open File
        </button>
        <button
          ref={saveBtn.ref}
          data-ui-id="file-save"
          onClick={() => console.log('Saving:', selectedFile, fileContent)}
          disabled={!selectedFile}
        >
          Save
        </button>
      </div>

      {selectedFile && (
        <div>
          <div style={{ marginBottom: '0.5rem', color: '#888', fontSize: '0.9rem' }}>
            File: {selectedFile}
          </div>
          <textarea
            data-ui-id="file-content"
            value={fileContent}
            onChange={(e) => setFileContent(e.target.value)}
            rows={6}
            style={{ fontFamily: 'monospace' }}
          />
        </div>
      )}

      {!selectedFile && (
        <p style={{ color: '#888' }}>No file selected. Click "Open File" to start.</p>
      )}
    </div>
  );
}

function App() {
  return (
    <div>
      <h1>UI Bridge Tauri Example</h1>
      <p>
        This example demonstrates UI Bridge integration with Tauri desktop apps.
        Control this app from Python or any HTTP client.
      </p>

      <h2>Counter</h2>
      <Counter />

      <h2>File Manager</h2>
      <FileManager />

      <h2>Python Control Example</h2>
      <div className="python-example">
        <pre>{`from ui_bridge import UIBridgeClient

client = UIBridgeClient(base_url='http://localhost:9876')

# Control counter
client.click('counter-increment')
client.component('counter').action('setCount', {'value': 42})

# Control file manager
client.component('file-manager').action('openFile', {
    'path': '/path/to/file.txt'
})

# Get element state
state = client.element('counter-value').state()
print(f"Counter value: {state['text']}")
`}</pre>
      </div>
    </div>
  );
}

export default App;
