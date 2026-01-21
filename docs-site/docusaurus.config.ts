import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'UI Bridge',
  tagline: 'AI-driven UI observation, control, and debugging',
  favicon: 'img/favicon.ico',

  url: 'https://qontinui.github.io',
  baseUrl: '/ui-bridge/',

  organizationName: 'qontinui',
  projectName: 'ui-bridge',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/qontinui/ui-bridge/tree/main/docs-site/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/ui-bridge-social-card.png',
    navbar: {
      title: 'UI Bridge',
      logo: {
        alt: 'UI Bridge Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://github.com/qontinui/ui-bridge',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/getting-started',
            },
            {
              label: 'API Reference',
              to: '/docs/api/overview',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/qontinui/ui-bridge',
            },
            {
              label: 'Issues',
              href: 'https://github.com/qontinui/ui-bridge/issues',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Qontinui',
              href: 'https://qontinui.io',
            },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} Qontinui. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['python', 'bash', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
