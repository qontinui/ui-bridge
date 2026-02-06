# UI Bridge SWC Plugin Design

## Overview

A Rust-based SWC plugin that provides the same functionality as `@qontinui/ui-bridge-babel-plugin` but runs natively in SWC, making it compatible with Next.js 15+ and other SWC-based build systems.

## Why SWC Plugin?

| Problem                        | Solution                             |
| ------------------------------ | ------------------------------------ |
| Next.js 15 uses SWC by default | Native SWC plugin, no Babel fallback |
| `next/font` requires SWC       | Plugin runs within SWC, no conflict  |
| Babel is slower                | SWC is 20-70x faster                 |
| Future-proofing                | SWC adoption is growing              |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Next.js 15 Build                        │
├─────────────────────────────────────────────────────────────┤
│  Source Code (.tsx/.jsx)                                     │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                 SWC Compiler                         │    │
│  │  ┌───────────────────────────────────────────────┐  │    │
│  │  │           UI Bridge SWC Plugin                 │  │    │
│  │  │  ┌─────────────────────────────────────────┐  │  │    │
│  │  │  │  1. Parse JSX AST                       │  │  │    │
│  │  │  │  2. Find target elements (button, etc)  │  │  │    │
│  │  │  │  3. Extract context (text, aria, etc)   │  │  │    │
│  │  │  │  4. Generate ID (deterministic)         │  │  │    │
│  │  │  │  5. Generate aliases (synonyms)         │  │  │    │
│  │  │  │  6. Inject attributes                   │  │  │    │
│  │  │  └─────────────────────────────────────────┘  │  │    │
│  │  └───────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────┘    │
│         │                                                    │
│         ▼                                                    │
│  Transformed Code (with data-ui-id, data-ui-aliases, etc)   │
└─────────────────────────────────────────────────────────────┘
```

## Package Structure

```
ui-bridge-swc-plugin/
├── Cargo.toml              # Rust package manifest
├── src/
│   ├── lib.rs              # Plugin entry point
│   ├── config.rs           # Configuration parsing (from JSON)
│   ├── visitor.rs          # AST visitor implementation
│   ├── id_generator.rs     # ID generation logic
│   ├── alias_generator.rs  # Alias generation logic
│   ├── text_extractor.rs   # Extract text from JSX children
│   └── utils.rs            # Utility functions
├── tests/
│   ├── fixture/            # Test input/output files
│   └── integration.rs      # Integration tests
├── README.md
├── package.json            # NPM package for distribution
└── npm/                    # Platform-specific binaries
    ├── darwin-arm64/
    ├── darwin-x64/
    ├── linux-arm64/
    ├── linux-x64/
    ├── win32-arm64/
    └── win32-x64/
```

## Configuration

Configuration is passed via `next.config.js` (or `.swcrc`):

```js
// next.config.js
module.exports = {
  experimental: {
    swcPlugins: [
      [
        '@qontinui/ui-bridge-swc-plugin',
        {
          // Same options as Babel plugin for consistency
          elements: ['button', 'input', 'select', 'textarea', 'a', 'form'],
          idPrefix: 'ui',
          idAttribute: 'data-ui-id',
          aliasesAttribute: 'data-ui-aliases',
          typeAttribute: 'data-ui-type',
          generateAliases: true,
          includeComponentName: true,
          includeFilePath: false,
          hashIds: false,
          maxAliases: 5,
          skipExisting: true,
          verbose: false,
        },
      ],
    ],
  },
};
```

## Core Implementation

### 1. Plugin Entry Point (`lib.rs`)

```rust
use serde::Deserialize;
use swc_core::{
    ecma::{
        ast::Program,
        visit::{as_folder, FoldWith},
    },
    plugin::{plugin_transform, proxies::TransformPluginProgramMetadata},
};

mod config;
mod visitor;
mod id_generator;
mod alias_generator;
mod text_extractor;
mod utils;

use config::PluginConfig;
use visitor::UIBridgeVisitor;

#[plugin_transform]
pub fn process_transform(
    program: Program,
    metadata: TransformPluginProgramMetadata,
) -> Program {
    // Parse configuration from plugin options
    let config: PluginConfig = serde_json::from_str(
        &metadata
            .get_transform_plugin_config()
            .unwrap_or_default()
    ).unwrap_or_default();

    // Get filename for ID generation
    let filename = metadata
        .get_context(&swc_core::plugin::proxies::PluginCommentsProxy)
        .map(|ctx| ctx.filename.clone())
        .unwrap_or_else(|| "unknown".to_string());

    // Create visitor and transform
    let visitor = UIBridgeVisitor::new(config, filename);
    program.fold_with(&mut as_folder(visitor))
}
```

### 2. Configuration (`config.rs`)

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginConfig {
    #[serde(default = "default_elements")]
    pub elements: Vec<String>,

    #[serde(default = "default_id_prefix")]
    pub id_prefix: String,

    #[serde(default = "default_id_attribute")]
    pub id_attribute: String,

    #[serde(default = "default_aliases_attribute")]
    pub aliases_attribute: String,

    #[serde(default = "default_type_attribute")]
    pub type_attribute: String,

    #[serde(default = "default_true")]
    pub generate_aliases: bool,

    #[serde(default = "default_true")]
    pub include_component_name: bool,

    #[serde(default)]
    pub include_file_path: bool,

    #[serde(default)]
    pub hash_ids: bool,

    #[serde(default = "default_max_aliases")]
    pub max_aliases: usize,

    #[serde(default = "default_true")]
    pub skip_existing: bool,

    #[serde(default)]
    pub only_in_components: Vec<String>,

    #[serde(default)]
    pub skip_in_components: Vec<String>,

    #[serde(default)]
    pub verbose: bool,
}

fn default_elements() -> Vec<String> {
    vec![
        "button".into(), "input".into(), "select".into(),
        "textarea".into(), "a".into(), "form".into()
    ]
}

fn default_id_prefix() -> String { "ui".into() }
fn default_id_attribute() -> String { "data-ui-id".into() }
fn default_aliases_attribute() -> String { "data-ui-aliases".into() }
fn default_type_attribute() -> String { "data-ui-type".into() }
fn default_true() -> bool { true }
fn default_max_aliases() -> usize { 5 }

impl Default for PluginConfig {
    fn default() -> Self {
        Self {
            elements: default_elements(),
            id_prefix: default_id_prefix(),
            id_attribute: default_id_attribute(),
            aliases_attribute: default_aliases_attribute(),
            type_attribute: default_type_attribute(),
            generate_aliases: true,
            include_component_name: true,
            include_file_path: false,
            hash_ids: false,
            max_aliases: 5,
            skip_existing: true,
            only_in_components: vec![],
            skip_in_components: vec![],
            verbose: false,
        }
    }
}
```

### 3. AST Visitor (`visitor.rs`)

```rust
use swc_core::ecma::{
    ast::*,
    visit::{VisitMut, VisitMutWith},
};
use swc_core::common::DUMMY_SP;

use crate::config::PluginConfig;
use crate::id_generator::generate_id;
use crate::alias_generator::generate_aliases;
use crate::text_extractor::extract_text_content;

pub struct UIBridgeVisitor {
    config: PluginConfig,
    filename: String,
    component_stack: Vec<String>,
    element_counters: std::collections::HashMap<String, usize>,
    processed_ids: std::collections::HashSet<String>,
}

impl UIBridgeVisitor {
    pub fn new(config: PluginConfig, filename: String) -> Self {
        Self {
            config,
            filename,
            component_stack: vec![],
            element_counters: std::collections::HashMap::new(),
            processed_ids: std::collections::HashSet::new(),
        }
    }

    fn current_component(&self) -> Option<&String> {
        self.component_stack.last()
    }

    fn get_element_index(&mut self, tag_name: &str) -> usize {
        let counter = self.element_counters.entry(tag_name.to_string()).or_insert(0);
        *counter += 1;
        *counter
    }

    fn should_instrument(&self, tag_name: &str) -> bool {
        // Check if element type is in config.elements
        self.config.elements.iter().any(|e| e == tag_name)
    }

    fn has_attribute(&self, element: &JSXOpeningElement, attr_name: &str) -> bool {
        element.attrs.iter().any(|attr| {
            if let JSXAttrOrSpread::JSXAttr(jsx_attr) = attr {
                if let JSXAttrName::Ident(ident) = &jsx_attr.name {
                    return ident.sym.as_ref() == attr_name;
                }
            }
            false
        })
    }

    fn get_attribute_value(&self, element: &JSXOpeningElement, attr_name: &str) -> Option<String> {
        for attr in &element.attrs {
            if let JSXAttrOrSpread::JSXAttr(jsx_attr) = attr {
                if let JSXAttrName::Ident(ident) = &jsx_attr.name {
                    if ident.sym.as_ref() == attr_name {
                        if let Some(JSXAttrValue::Lit(Lit::Str(s))) = &jsx_attr.value {
                            return Some(s.value.to_string());
                        }
                    }
                }
            }
        }
        None
    }

    fn add_attribute(&self, element: &mut JSXOpeningElement, name: &str, value: &str) {
        element.attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
            span: DUMMY_SP,
            name: JSXAttrName::Ident(Ident::new(name.into(), DUMMY_SP)),
            value: Some(JSXAttrValue::Lit(Lit::Str(Str {
                span: DUMMY_SP,
                value: value.into(),
                raw: None,
            }))),
        }));
    }
}

impl VisitMut for UIBridgeVisitor {
    // Track component boundaries
    fn visit_mut_fn_decl(&mut self, n: &mut FnDecl) {
        let name = n.ident.sym.to_string();
        if name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
            self.component_stack.push(name);
            n.visit_mut_children_with(self);
            self.component_stack.pop();
        } else {
            n.visit_mut_children_with(self);
        }
    }

    fn visit_mut_var_declarator(&mut self, n: &mut VarDeclarator) {
        if let Pat::Ident(ident) = &n.name {
            let name = ident.id.sym.to_string();
            if name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
                if let Some(init) = &n.init {
                    if matches!(init.as_ref(), Expr::Arrow(_) | Expr::Fn(_)) {
                        self.component_stack.push(name);
                        n.visit_mut_children_with(self);
                        self.component_stack.pop();
                        return;
                    }
                }
            }
        }
        n.visit_mut_children_with(self);
    }

    fn visit_mut_jsx_element(&mut self, n: &mut JSXElement) {
        // Visit children first
        n.visit_mut_children_with(self);

        // Get tag name
        let tag_name = match &n.opening.name {
            JSXElementName::Ident(ident) => ident.sym.to_string(),
            _ => return, // Skip member expressions
        };

        // Only instrument lowercase HTML elements
        if !tag_name.chars().next().map(|c| c.is_lowercase()).unwrap_or(false) {
            return;
        }

        // Check if should instrument
        if !self.should_instrument(&tag_name) {
            return;
        }

        // Skip if already has data-ui-id
        if self.config.skip_existing && self.has_attribute(&n.opening, &self.config.id_attribute) {
            return;
        }

        // Check component filters
        if let Some(component) = self.current_component() {
            if !self.config.only_in_components.is_empty()
                && !self.config.only_in_components.contains(component) {
                return;
            }
            if self.config.skip_in_components.contains(component) {
                return;
            }
        }

        // Extract context for ID generation
        let text_content = extract_text_content(&n.children);
        let aria_label = self.get_attribute_value(&n.opening, "aria-label");
        let placeholder = self.get_attribute_value(&n.opening, "placeholder");
        let title = self.get_attribute_value(&n.opening, "title");
        let name = self.get_attribute_value(&n.opening, "name");
        let existing_id = self.get_attribute_value(&n.opening, "id");
        let element_index = self.get_element_index(&tag_name);

        // Generate ID
        let generated_id = generate_id(
            &self.config,
            self.current_component(),
            &self.filename,
            &tag_name,
            text_content.as_deref(),
            aria_label.as_deref(),
            placeholder.as_deref(),
            title.as_deref(),
            existing_id.as_deref(),
            element_index,
        );

        // Handle ID collisions
        let final_id = if self.processed_ids.contains(&generated_id) {
            format!("{}-{}", generated_id, element_index)
        } else {
            self.processed_ids.insert(generated_id.clone());
            generated_id
        };

        // Add data-ui-id
        self.add_attribute(&mut n.opening, &self.config.id_attribute, &final_id);

        // Add data-ui-type
        let semantic_type = get_semantic_type(&tag_name, placeholder.as_deref(), name.as_deref());
        self.add_attribute(&mut n.opening, &self.config.type_attribute, &semantic_type);

        // Generate and add aliases
        if self.config.generate_aliases {
            let aliases = generate_aliases(
                &self.config,
                &tag_name,
                text_content.as_deref(),
                aria_label.as_deref(),
                placeholder.as_deref(),
                title.as_deref(),
                name.as_deref(),
            );
            if !aliases.is_empty() {
                let aliases_str = aliases.join(",");
                self.add_attribute(&mut n.opening, &self.config.aliases_attribute, &aliases_str);
            }
        }
    }
}

fn get_semantic_type(tag_name: &str, placeholder: Option<&str>, name: Option<&str>) -> String {
    match tag_name {
        "button" => "button".to_string(),
        "a" => "link".to_string(),
        "input" => {
            // Could be enhanced to check type attribute
            if let Some(p) = placeholder {
                if p.to_lowercase().contains("email") { return "email-input".to_string(); }
                if p.to_lowercase().contains("password") { return "password-input".to_string(); }
                if p.to_lowercase().contains("search") { return "search-input".to_string(); }
            }
            "input".to_string()
        }
        "select" => "dropdown".to_string(),
        "textarea" => "textarea".to_string(),
        "form" => "form".to_string(),
        _ => tag_name.to_string(),
    }
}
```

### 4. ID Generator (`id_generator.rs`)

```rust
use crate::config::PluginConfig;

pub fn generate_id(
    config: &PluginConfig,
    component_name: Option<&String>,
    file_path: &str,
    tag_name: &str,
    text_content: Option<&str>,
    aria_label: Option<&str>,
    placeholder: Option<&str>,
    title: Option<&str>,
    existing_id: Option<&str>,
    element_index: usize,
) -> String {
    let mut parts: Vec<String> = vec![config.id_prefix.clone()];

    // Add component name
    if config.include_component_name {
        if let Some(name) = component_name {
            parts.push(to_kebab_case(name));
        }
    }

    // Add file path (optional)
    if config.include_file_path {
        let file_part = extract_file_name(file_path);
        parts.push(to_kebab_case(&file_part));
    }

    // Add descriptive part (prefer existing id > text > aria > placeholder > title)
    let descriptor = existing_id
        .or(text_content)
        .or(aria_label)
        .or(placeholder)
        .or(title);

    if let Some(desc) = descriptor {
        let normalized = normalize_text(desc);
        if !normalized.is_empty() {
            parts.push(normalized);
        }
    }

    // Add element type
    let semantic_type = match tag_name {
        "a" => "link",
        "button" => "button",
        "input" => "input",
        "select" => "dropdown",
        "textarea" => "textarea",
        "form" => "form",
        _ => tag_name,
    };
    parts.push(semantic_type.to_string());

    let id = parts.join("-");

    // Optionally hash for shorter IDs
    if config.hash_ids {
        hash_id(&id)
    } else {
        id
    }
}

fn to_kebab_case(s: &str) -> String {
    let mut result = String::new();
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                result.push('-');
            }
            result.push(c.to_lowercase().next().unwrap());
        } else {
            result.push(c);
        }
    }
    result
}

fn normalize_text(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .take(4) // Limit words
        .collect::<Vec<_>>()
        .join("-")
}

fn extract_file_name(path: &str) -> String {
    path.split(['/', '\\'])
        .last()
        .unwrap_or("unknown")
        .split('.')
        .next()
        .unwrap_or("unknown")
        .to_string()
}

fn hash_id(id: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    id.hash(&mut hasher);
    format!("ui-{:x}", hasher.finish() & 0xFFFFFFFF)
}
```

### 5. Alias Generator (`alias_generator.rs`)

```rust
use crate::config::PluginConfig;

pub fn generate_aliases(
    config: &PluginConfig,
    tag_name: &str,
    text_content: Option<&str>,
    aria_label: Option<&str>,
    placeholder: Option<&str>,
    title: Option<&str>,
    name: Option<&str>,
) -> Vec<String> {
    let mut aliases: Vec<String> = vec![];

    // Add text content as primary alias
    if let Some(text) = text_content {
        let normalized = normalize_for_alias(text);
        if !normalized.is_empty() {
            aliases.push(normalized.clone());
            // Add synonyms
            aliases.extend(get_synonyms(&normalized));
        }
    }

    // Add aria-label
    if let Some(label) = aria_label {
        let normalized = normalize_for_alias(label);
        if !normalized.is_empty() && !aliases.contains(&normalized) {
            aliases.push(normalized);
        }
    }

    // Add placeholder
    if let Some(ph) = placeholder {
        let normalized = normalize_for_alias(ph);
        if !normalized.is_empty() && !aliases.contains(&normalized) {
            aliases.push(normalized);
        }
    }

    // Add title
    if let Some(t) = title {
        let normalized = normalize_for_alias(t);
        if !normalized.is_empty() && !aliases.contains(&normalized) {
            aliases.push(normalized);
        }
    }

    // Add name attribute
    if let Some(n) = name {
        let normalized = normalize_for_alias(n);
        if !normalized.is_empty() && !aliases.contains(&normalized) {
            aliases.push(normalized);
        }
    }

    // Limit to max aliases
    aliases.truncate(config.max_aliases);
    aliases
}

fn normalize_for_alias(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn get_synonyms(text: &str) -> Vec<String> {
    let mut synonyms = vec![];

    let synonym_map: &[(&[&str], &[&str])] = &[
        // Submit/Send variations
        (&["submit", "send", "go"], &["submit", "send", "go", "confirm"]),
        // Sign in/Login variations
        (&["sign in", "signin", "log in", "login"], &["sign in", "signin", "log in", "login", "authenticate"]),
        // Sign up/Register variations
        (&["sign up", "signup", "register"], &["sign up", "signup", "register", "create account"]),
        // Cancel/Close variations
        (&["cancel", "close", "dismiss"], &["cancel", "close", "dismiss", "exit"]),
        // Save variations
        (&["save", "store"], &["save", "store", "persist"]),
        // Delete/Remove variations
        (&["delete", "remove"], &["delete", "remove", "trash", "discard"]),
        // Edit/Modify variations
        (&["edit", "modify", "change"], &["edit", "modify", "change", "update"]),
        // Search/Find variations
        (&["search", "find"], &["search", "find", "lookup", "query"]),
        // Next/Continue variations
        (&["next", "continue", "proceed"], &["next", "continue", "proceed", "forward"]),
        // Back/Previous variations
        (&["back", "previous", "prev"], &["back", "previous", "prev", "return"]),
        // Start/Begin variations
        (&["start", "begin", "launch", "run"], &["start", "begin", "launch", "run", "execute"]),
    ];

    for (triggers, all_synonyms) in synonym_map {
        if triggers.iter().any(|t| text.contains(t)) {
            for syn in *all_synonyms {
                if *syn != text && !synonyms.contains(&syn.to_string()) {
                    synonyms.push(syn.to_string());
                }
            }
            break;
        }
    }

    synonyms
}
```

### 6. Text Extractor (`text_extractor.rs`)

```rust
use swc_core::ecma::ast::*;

pub fn extract_text_content(children: &[JSXElementChild]) -> Option<String> {
    let mut text_parts: Vec<String> = vec![];

    for child in children {
        match child {
            JSXElementChild::JSXText(text) => {
                let trimmed = text.value.trim();
                if !trimmed.is_empty() {
                    text_parts.push(trimmed.to_string());
                }
            }
            JSXElementChild::JSXExprContainer(expr) => {
                // Handle string literals in expressions
                if let JSXExpr::Expr(e) = &expr.expr {
                    if let Expr::Lit(Lit::Str(s)) = e.as_ref() {
                        let trimmed = s.value.trim();
                        if !trimmed.is_empty() {
                            text_parts.push(trimmed.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }

    if text_parts.is_empty() {
        None
    } else {
        Some(text_parts.join(" "))
    }
}
```

## Build & Distribution

### Cargo.toml

```toml
[package]
name = "ui-bridge-swc-plugin"
version = "0.2.0"
edition = "2021"
license = "MIT"
description = "SWC plugin for automatic UI Bridge instrumentation"
repository = "https://github.com/qontinui/ui-bridge"

[lib]
crate-type = ["cdylib"]

[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
swc_core = { version = "0.90.*", features = [
    "ecma_plugin_transform",
    "ecma_visit",
    "ecma_ast",
    "common",
] }

[profile.release]
lto = true
opt-level = "z"
```

### Build Script

```bash
#!/bin/bash
# build.sh - Build for all platforms

# Build WASM target
cargo build --release --target wasm32-wasi

# Copy to npm directory
mkdir -p npm/wasm32-wasi
cp target/wasm32-wasi/release/ui_bridge_swc_plugin.wasm npm/wasm32-wasi/
```

### NPM Package (package.json)

```json
{
  "name": "@qontinui/ui-bridge-swc-plugin",
  "version": "0.2.0",
  "description": "SWC plugin for automatic UI Bridge instrumentation",
  "main": "index.js",
  "files": ["index.js", "index.d.ts", "*.wasm"],
  "keywords": ["swc", "plugin", "ui-bridge", "testing", "automation"],
  "repository": {
    "type": "git",
    "url": "https://github.com/qontinui/ui-bridge"
  },
  "license": "MIT",
  "peerDependencies": {
    "next": ">=13.0.0"
  }
}
```

## Usage in Next.js

```js
// next.config.js
module.exports = {
  experimental: {
    swcPlugins: [
      [
        '@qontinui/ui-bridge-swc-plugin',
        {
          elements: ['button', 'input', 'a', 'form'],
          idPrefix: 'ui',
          generateAliases: true,
        },
      ],
    ],
  },
};
```

## Testing Strategy

1. **Unit Tests**: Test individual functions (ID generation, alias generation)
2. **Fixture Tests**: Input JSX → Expected output JSX
3. **Integration Tests**: Full transformation with various configs
4. **Compatibility Tests**: Test with Next.js 15, 14, 13

## Migration from Babel Plugin

For users migrating from the Babel plugin:

1. **Remove Babel config** (if only used for UI Bridge)
2. **Install SWC plugin**: `npm install -D @qontinui/ui-bridge-swc-plugin`
3. **Update next.config.js** (see usage above)
4. **Same configuration options** - just move from babel.config.js to next.config.js

## Limitations

1. **SWC plugins are experimental** in Next.js (may change between versions)
2. **WASM overhead** - slightly larger bundle than native Babel
3. **Debugging** - harder to debug Rust code vs JavaScript

## Timeline Estimate

| Phase        | Duration    | Tasks                                          |
| ------------ | ----------- | ---------------------------------------------- |
| Setup        | 1 week      | Rust project, SWC dependencies, build pipeline |
| Core         | 2 weeks     | Visitor, ID generation, alias generation       |
| Testing      | 1 week      | Unit tests, fixtures, integration              |
| Distribution | 1 week      | NPM packaging, CI/CD, documentation            |
| **Total**    | **5 weeks** |                                                |
