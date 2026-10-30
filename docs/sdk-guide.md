# Reusable JavaScript SDK Integration Guide

The AI Assistant SDK enables zero-dependency integration into any web application or framework.

---

## 1. Zero-Code Script Tag Integration

Add a `<script>` tag to your website's `<head>` or before `</body>`:

```html
<script
  src="https://your-assistant-domain.com/sdk/assistant.js"
  data-assistant-id="default"
  data-theme="auto"
  data-position="bottom-right"
  defer
></script>
```

### Supported `data-*` Attributes:

| Attribute | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `data-assistant-id` | string | `"default"` | ID of the assistant preset (`default`, `researcher`, `support`, `coder`). |
| `data-api-url` | URL string | `window.location.origin` | Base URL of the backend server. |
| `data-theme` | `'light' \| 'dark' \| 'auto'` | `"auto"` | Widget color theme mode. |
| `data-primary-color` | hex color | `"#4f46e5"` | Custom brand color for launcher & user bubbles. |
| `data-position` | string | `"bottom-right"` | `bottom-right`, `bottom-left`, `top-right`, `top-left`. |
| `data-greeting` | string | preset default | Custom initial welcome greeting. |
| `data-autoload` | `'true' \| 'false'` | `"true"` | Auto-initialize on DOM ready. |

---

## 2. Programmatic JavaScript API

When the SDK loads, it registers a global object on `window.AssistantSDK`.

### Initialization
```javascript
// Manual or customized initialization
await window.AssistantSDK.init({
  assistantId: 'researcher',
  apiUrl: 'https://api.yourdomain.com',
  theme: 'dark',
  primaryColor: '#0284c7',
  position: 'bottom-right',
  greeting: 'Welcome! How can I assist with your research today?'
});
```

### Methods Reference

#### `AssistantSDK.open()`
Opens the chat panel and automatically focuses the message textarea.

#### `AssistantSDK.close()`
Closes the chat panel and returns keyboard focus to the floating launcher button.

#### `AssistantSDK.toggle()`
Toggles the open/closed state of the chat panel.

#### `AssistantSDK.sendMessage(text)`
Sends a message into the conversation programmatically as the user:
```javascript
window.AssistantSDK.sendMessage('Please explain how to configure CORS in Express.');
```

#### `AssistantSDK.summarize(text, options)`
Executes standalone text summarization directly:
```javascript
const result = await window.AssistantSDK.summarize(myLongArticleText, {
  style: 'bullet_points',
  focus: 'security implications',
  stream: true,
  onChunk: (chunk) => {
    console.log('Stream chunk:', chunk);
  }
});
console.log('Final summary:', result.text);
```

#### `AssistantSDK.clearConversation()`
Clears active conversation messages on both client and server and resets the UI.

#### `AssistantSDK.setTheme(theme)`
Dynamically switches theme without page reload:
```javascript
window.AssistantSDK.setTheme('dark'); // 'light' | 'dark' | 'auto'
```

#### `AssistantSDK.setPosition(position)`
Dynamically moves the launcher button and dialog anchor:
```javascript
window.AssistantSDK.setPosition('bottom-left');
```

#### `AssistantSDK.getState()`
Returns snapshot of current state:
```javascript
const state = window.AssistantSDK.getState();
// { initialized: true, isOpen: false, isGenerating: false, messageCount: 4, ... }
```

#### `AssistantSDK.destroy()`
Unmounts the Shadow DOM from the document, aborts active requests, and clears event listeners.

---

## 3. Event Handling

Subscribe to SDK events using `AssistantSDK.on(eventName, handler)`:

```javascript
// Conversation event listeners
const unsubscribe = AssistantSDK.on('message:received', (message) => {
  console.log('Assistant answered:', message.content);
});

AssistantSDK.on('open', () => {
  console.log('Chat panel was opened');
});

AssistantSDK.on('close', () => {
  console.log('Chat panel was closed');
});

AssistantSDK.on('error', (err) => {
  console.error('Assistant error:', err.message);
});

AssistantSDK.on('conversation:cleared', () => {
  console.log('Conversation was reset');
});
```

---

## 4. Framework Integrations

### React / Next.js
```tsx
import React, { useEffect } from 'react';

export const AIAssistant: React.FC = () => {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://your-assistant-domain.com/sdk/assistant.js';
    script.setAttribute('data-assistant-id', 'default');
    script.async = true;
    document.body.appendChild(script);

    return () => {
      if (window.AssistantSDK) {
        window.AssistantSDK.destroy();
      }
      if (script.parentNode) {
        document.body.removeChild(script);
      }
    };
  }, []);

  return null;
};
```

### Vue 3
```vue
<script setup>
import { onMounted, onUnmounted } from 'vue';

onMounted(() => {
  const script = document.createElement('script');
  script.src = 'https://your-assistant-domain.com/sdk/assistant.js';
  script.setAttribute('data-assistant-id', 'support');
  script.async = true;
  document.body.appendChild(script);
});

onUnmounted(() => {
  if (window.AssistantSDK) {
    window.AssistantSDK.destroy();
  }
});
</script>

<template>
  <!-- Widget is mounted into Shadow DOM at body root -->
</template>
```

