import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    'getting-started',
    {
      type: 'category',
      label: 'Core Concepts',
      items: [
        'concepts/element-identification',
        'concepts/registry',
        'concepts/actions',
        'concepts/workflows',
        'concepts/drag-drop',
      ],
    },
    {
      type: 'category',
      label: 'React Integration',
      items: [
        'react/provider',
        'react/hooks',
        'react/hooks-registration',
        'react/hooks-state',
        'react/hooks-transitions',
        'react/hooks-navigation',
        'react/hooks-semantics',
        'react/hooks-app-context',
        'react/hooks-bridge-access',
        'react/hooks-integration',
        'react/components',
        'react/auto-registration',
        'react/render-logging',
      ],
    },
    {
      type: 'category',
      label: 'AI Features',
      items: [
        'ai/overview',
        'ai/intent-based-actions',
        'ai/visual-context',
        'ai/navigation-assistance',
      ],
    },
    {
      type: 'category',
      label: 'Error Handling & Recovery',
      items: ['recovery/structured-failure-feedback'],
    },
    {
      type: 'category',
      label: 'State Management',
      items: ['state/state-machine-integration'],
    },
    {
      type: 'category',
      label: 'Observability',
      items: ['observability/performance-metrics'],
    },
    {
      type: 'category',
      label: 'Advanced Features',
      items: [
        'advanced/websocket-communication',
        'advanced/recording-playback',
        'advanced/cross-framework-support',
        'advanced/component-state-exposure',
      ],
    },
    {
      type: 'category',
      label: 'Platform Guides',
      items: ['guides/web', 'guides/tauri', 'guides/mobile', 'guides/ai-agent-testing'],
    },
    {
      type: 'category',
      label: 'Server',
      items: ['server/overview', 'server/express', 'server/nextjs', 'server/standalone'],
    },
    {
      type: 'category',
      label: 'Wrappers',
      items: ['wrappers/authoring', 'wrappers/action-vocabulary'],
    },
    {
      type: 'category',
      label: 'Python Client',
      items: ['python/installation', 'python/usage', 'python/ai-client', 'python/types'],
    },
    {
      type: 'category',
      label: 'API Reference',
      items: [
        'api/overview',
        'api/control-endpoints',
        'api/discovery-endpoints',
        'api/workflow-endpoints',
        'api/render-log-endpoints',
        'api/ai-endpoints',
        'api/state-endpoints',
      ],
    },
    {
      type: 'category',
      label: 'Examples',
      items: ['examples/react-app', 'examples/nextjs-app', 'examples/tauri-app'],
    },
  ],
};

export default sidebars;
