# State API Endpoints

REST API endpoints for state management.

## Get Current State

```
GET /__ui-bridge__/state/current
```

## List All States

```
GET /__ui-bridge__/state/list
```

## Get State Details

```
GET /__ui-bridge__/state/:stateId
```

## Validate State

```
POST /__ui-bridge__/state/validate

{
  "stateId": "logged-in"
}
```

## Navigate to State

```
POST /__ui-bridge__/state/navigate

{
  "target": "dashboard",
  "variables": { "email": "user@example.com", "password": "secret" }
}
```

## Execute Transition

```
POST /__ui-bridge__/state/transition

{
  "transition": "logged-out -> logged-in",
  "variables": { "email": "user@example.com", "password": "secret" }
}
```

## Find Path

```
POST /__ui-bridge__/state/find-path

{
  "from": "logged-out",
  "to": "checkout"
}
```

## Get Discovered States

```
GET /__ui-bridge__/state/discovered
```

## Get Component State

```
GET /__ui-bridge__/state/component/:componentId
```

## Get All Component States

```
GET /__ui-bridge__/state/components
```

## Watch State Changes (SSE)

```
GET /__ui-bridge__/state/watch
```

## Export State Machine

```
GET /__ui-bridge__/state/export?format=json
```

## Import State Machine

```
POST /__ui-bridge__/state/import

{
  "stateMachine": { "states": {...}, "transitions": {...} },
  "merge": false
}
```
