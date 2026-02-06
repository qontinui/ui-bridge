import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/docs/getting-started">
            Get Started
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            to="/docs/api/overview"
            style={{ marginLeft: '1rem' }}
          >
            API Reference
          </Link>
        </div>
      </div>
    </header>
  );
}

type FeatureItem = {
  title: string;
  description: JSX.Element;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Element Control',
    description: (
      <>
        Programmatically interact with UI elements through a simple HTTP API. Click buttons, type
        into inputs, select options, and more.
      </>
    ),
  },
  {
    title: 'Component Actions',
    description: (
      <>
        Register high-level component actions that can be triggered remotely. Perfect for AI agents
        that need to interact with complex UI workflows.
      </>
    ),
  },
  {
    title: 'Workflow Engine',
    description: (
      <>
        Define multi-step workflows that execute a series of UI actions. Built-in error handling and
        retry logic for robust automation.
      </>
    ),
  },
  {
    title: 'Element Discovery',
    description: (
      <>
        Automatically discover controllable elements in your UI. Uses multiple identification
        strategies for reliable element targeting.
      </>
    ),
  },
  {
    title: 'Render Logging',
    description: (
      <>
        Capture DOM snapshots and track UI changes over time. Useful for debugging and understanding
        UI state transitions.
      </>
    ),
  },
  {
    title: 'Python Client',
    description: (
      <>
        Full-featured Python client library for controlling your UI from Python scripts, AI agents,
        or test automation frameworks.
      </>
    ),
  },
];

function Feature({ title, description }: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md padding-vert--lg">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

function HomepageFeatures(): JSX.Element {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} - ${siteConfig.tagline}`}
      description="UI Bridge - A unified framework for AI-driven UI observation, control, and debugging"
    >
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
