'use client';

import { UIBridgeProvider } from 'ui-bridge';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>UI Bridge Next.js Example</title>
        <meta name="description" content="UI Bridge Next.js integration example" />
      </head>
      <body>
        <UIBridgeProvider
          features={{
            control: true,
            renderLog: true,
            debug: true,
          }}
          config={{
            apiPath: '/api/ui-bridge',
          }}
        >
          {children}
        </UIBridgeProvider>
      </body>
    </html>
  );
}
