# Cross-Framework Support

UI Bridge supports multiple frontend frameworks including Vue, Angular, Svelte, and vanilla JavaScript.

## Vue Integration

```typescript
// main.ts
import { createApp } from 'vue';
import { UIBridgePlugin } from '@anthropic/ui-bridge-vue';

const app = createApp(App);
app.use(UIBridgePlugin, { autoRegister: true });
app.mount('#app');
```

```vue
<template>
  <button v-ui-bridge="'submit-btn'" @click="submit">Submit</button>
</template>
```

## Angular Integration

```typescript
// app.module.ts
import { UIBridgeModule } from '@anthropic/ui-bridge-angular';

@NgModule({
  imports: [UIBridgeModule.forRoot({ autoRegister: true })],
})
export class AppModule {}
```

```html
<button uiBridge="submit-btn" (click)="submit()">Submit</button>
```

## Svelte Integration

```svelte
<script>
  import { uiBridge } from '@anthropic/ui-bridge-svelte';
</script>

<button use:uiBridge={'submit-btn'} on:click={submit}>Submit</button>
```

## Vanilla JavaScript

```html
<script type="module">
  import { UIBridge } from '@anthropic/ui-bridge';

  const bridge = new UIBridge({ autoRegister: true, observeDOM: true });
  bridge.init();
</script>

<button data-ui-id="submit-btn" data-ui-type="button">Submit</button>
```

## Consistent API

All framework adapters provide the same core API:

```typescript
interface UIBridgeAdapter {
  registry: UIBridgeRegistry;
  executeAction(id: string, action: string, value?: any): Promise<ActionResult>;
  getElementState(id: string): Promise<ElementState>;
  getControlSnapshot(): Promise<ControlSnapshot>;
  findElements(query: string): Promise<Element[]>;
}
```
