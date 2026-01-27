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
      ],
    },
    {
      type: 'category',
      label: 'React Integration',
      items: [
        'react/provider',
        'react/hooks',
        'react/components',
        'react/auto-registration',
        'react/render-logging',
      ],
    },
    {
      type: 'category',
      label: 'Platform Guides',
      items: [
        'guides/web',
        'guides/tauri',
        'guides/mobile',
        'guides/ai-agent-testing',
      ],
    },
    {
      type: 'category',
      label: 'Server',
      items: [
        'server/overview',
        'server/express',
        'server/nextjs',
        'server/standalone',
      ],
    },
    {
      type: 'category',
      label: 'Python Client',
      items: [
        'python/installation',
        'python/usage',
        'python/ai-client',
        'python/types',
      ],
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
      ],
    },
    {
      type: 'category',
      label: 'Examples',
      items: [
        'examples/react-app',
        'examples/nextjs-app',
        'examples/tauri-app',
      ],
    },
  ],
};

export default sidebars;
