# AI API Endpoints

REST API endpoints for AI-native UI automation.

## Search Elements

```
POST /__ui-bridge__/ai/search

{
  "query": "login button",
  "filters": { "type": "button", "visible": true },
  "limit": 10
}
```

## Execute Instruction

```
POST /__ui-bridge__/ai/execute

{
  "instruction": "click the submit button",
  "context": { "currentPage": "login" }
}
```

## Make Assertion

```
POST /__ui-bridge__/ai/assert

{
  "target": "error message",
  "assertion": "hidden"
}
```

## Batch Assertions

```
POST /__ui-bridge__/ai/assert-batch

{
  "assertions": [
    { "target": "success message", "assertion": "visible" },
    { "target": "error message", "assertion": "hidden" }
  ]
}
```

## Get Semantic Snapshot

```
GET /__ui-bridge__/ai/semantic-snapshot
```

## Get Page Summary

```
GET /__ui-bridge__/ai/page-summary
```

## Get Visual Context

```
GET /__ui-bridge__/ai/visual-context?format=json
```

## Get Navigation Hints

```
GET /__ui-bridge__/ai/navigation-hints
```

## Find Navigation Path

```
POST /__ui-bridge__/ai/find-path

{
  "target": "checkout page",
  "from": "home"
}
```

## Resolve Intent

```
POST /__ui-bridge__/ai/resolve-intent

{
  "intent": "log in with test credentials"
}
```

## Get Error Context

```
POST /__ui-bridge__/ai/error-context

{
  "error": {
    "code": "ELEMENT_NOT_FOUND",
    "message": "Could not find element: submit-btn"
  }
}
```
