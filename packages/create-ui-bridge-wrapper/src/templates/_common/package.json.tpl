{
  "name": "{{PACKAGE_NAME}}",
  "version": "0.1.0",
  "description": "UI Bridge wrapper — {{DISPLAY_NAME}}",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "build": "tsup && tsc -p tsconfig.build.json",
    "dev": "tsup --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "clean": "rimraf dist"
  },
  "peerDependencies": {
    "@qontinui/ui-bridge": "{{UI_BRIDGE_DEP_SPEC}}",
    "@qontinui/ui-bridge-wrapper": "{{WRAPPER_DEP_SPEC}}"{{#IF_REACT_DEP}},
    "react": "^18.0.0 || ^19.0.0"{{/IF_REACT_DEP}}
  },
  "dependencies": {{{#IF_PLAYWRIGHT}}
    "@qontinui/ui-bridge-headless": "{{HEADLESS_DEP_SPEC}}"{{/IF_PLAYWRIGHT}}{{#IF_WS_DEP}}{{#IF_PLAYWRIGHT}},{{/IF_PLAYWRIGHT}}
    "ws": "^8.18.0"{{/IF_WS_DEP}}
  },
  "devDependencies": {
    "@types/node": "^20.10.0",{{#IF_REACT_DEP}}
    "@types/react": "^19.0.0",
    "react": "^19.0.0",{{/IF_REACT_DEP}}{{#IF_WS_DEP}}
    "@types/ws": "^8.5.0",{{/IF_WS_DEP}}
    "rimraf": "^5.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.3.0",
    "vitest": "^4.1.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
