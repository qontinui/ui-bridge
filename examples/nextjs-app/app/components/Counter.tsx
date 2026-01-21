'use client';

import { useState } from 'react';
import { useUIElement, useUIComponent } from 'ui-bridge';

export default function Counter() {
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
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <button
        ref={decrementBtn.ref}
        data-ui-id="counter-decrement"
        onClick={() => setCount((c) => c - 1)}
        style={{ padding: '0.5rem 1rem', fontSize: '1.2rem' }}
      >
        -
      </button>

      <span
        data-ui-id="counter-value"
        style={{ fontSize: '2rem', fontWeight: 'bold', minWidth: '3rem', textAlign: 'center' }}
      >
        {count}
      </span>

      <button
        ref={incrementBtn.ref}
        data-ui-id="counter-increment"
        onClick={() => setCount((c) => c + 1)}
        style={{ padding: '0.5rem 1rem', fontSize: '1.2rem' }}
      >
        +
      </button>

      <button
        ref={resetBtn.ref}
        data-ui-id="counter-reset"
        onClick={() => setCount(0)}
        style={{ padding: '0.5rem 1rem', marginLeft: '1rem' }}
      >
        Reset
      </button>
    </div>
  );
}
