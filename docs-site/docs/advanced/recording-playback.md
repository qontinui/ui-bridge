# Recording & Playback

UI Bridge can record user interactions and play them back for automation.

## Recording Sessions

```typescript
import { Recorder } from '@anthropic/ui-bridge';

const recorder = new Recorder(registry);

recorder.start();
// ... user performs actions ...
const recording = recorder.stop();
```

## Playback

```typescript
import { Player } from '@anthropic/ui-bridge';

const player = new Player(registry);

await player.play(recording, {
  speed: 1.0,
  pauseBetweenActions: 500,
  stopOnError: true,
});
```

## Playback Control

```typescript
player.pause();
player.resume();
player.stop();
await player.seekTo(actionIndex);
await player.stepForward();
```

## Script Export

### JavaScript

```typescript
import { exportToJS } from '@anthropic/ui-bridge';

const script = exportToJS(recording);
// async function runAutomation(client) {
//   await client.type('email-input', 'user@example.com');
//   await client.click('login-btn');
// }
```

### Playwright

```typescript
import { exportToPlaywright } from '@anthropic/ui-bridge';

const script = exportToPlaywright(recording);
```

## Data Handling

### Sensitive Data

```typescript
const recorder = new Recorder(registry, {
  sensitiveFields: ['password', 'ssn'],
  maskSensitive: true,
  maskChar: '*',
});
```

### Variables

```typescript
const parameterized = recorder.parameterize({
  'user@example.com': '{{email}}',
  '********': '{{password}}',
});

await player.play(parameterized, {
  variables: { email: 'actual@email.com', password: 'actual-password' },
});
```
