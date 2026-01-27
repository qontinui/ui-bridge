//! AST visitor module
//!
//! Traverses the AST and instruments JSX elements with UI Bridge attributes.

use std::collections::{HashMap, HashSet};
use swc_core::common::DUMMY_SP;
use swc_core::ecma::ast::*;
use swc_core::ecma::visit::{VisitMut, VisitMutWith};

use crate::alias_generator::{format_aliases, generate_aliases, AliasContext};
use crate::config::PluginConfig;
use crate::id_generator::{generate_id, get_semantic_type, IdContext};
use crate::text_extractor::{
    extract_text_content, get_attribute_value, get_tag_name, has_attribute, is_html_element,
};

/// The main AST visitor that instruments JSX elements
pub struct UIBridgeVisitor {
    config: PluginConfig,
    filename: String,
    /// Stack of component names we're currently inside
    component_stack: Vec<String>,
    /// Counter for element indices per tag type
    element_counters: HashMap<String, usize>,
    /// Set of IDs we've already generated (to detect collisions)
    processed_ids: HashSet<String>,
}

impl UIBridgeVisitor {
    /// Create a new visitor with the given configuration
    pub fn new(config: PluginConfig, filename: String) -> Self {
        Self {
            config,
            filename,
            component_stack: vec![],
            element_counters: HashMap::new(),
            processed_ids: HashSet::new(),
        }
    }

    /// Get the current component name (if any)
    fn current_component(&self) -> Option<&str> {
        self.component_stack.last().map(|s| s.as_str())
    }

    /// Get the next element index for a tag type
    fn get_element_index(&mut self, tag_name: &str) -> usize {
        let counter = self.element_counters.entry(tag_name.to_string()).or_insert(0);
        *counter += 1;
        *counter
    }

    /// Add an attribute to a JSX element
    fn add_attribute(&self, element: &mut JSXOpeningElement, name: &str, value: &str) {
        element.attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
            span: DUMMY_SP,
            name: JSXAttrName::Ident(IdentName {
                span: DUMMY_SP,
                sym: name.into(),
            }),
            value: Some(JSXAttrValue::Lit(Lit::Str(Str {
                span: DUMMY_SP,
                value: value.into(),
                raw: None,
            }))),
        }));
    }

    /// Check if a name looks like a React component (starts with uppercase)
    fn is_component_name(name: &str) -> bool {
        name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false)
    }

    /// Process a JSX element
    fn process_jsx_element(&mut self, n: &mut JSXElement) {
        // Get tag name
        let tag_name = match get_tag_name(&n.opening) {
            Some(name) => name,
            None => return, // Skip member expressions
        };

        // Only instrument lowercase HTML elements
        if !is_html_element(&tag_name) {
            return;
        }

        // Check if should instrument
        if !self.config.should_instrument(&tag_name) {
            return;
        }

        // Skip if already has data-ui-id
        if self.config.skip_existing && has_attribute(&n.opening, &self.config.id_attribute) {
            return;
        }

        // Check component filters
        if self.config.should_skip_component(self.current_component()) {
            return;
        }

        // Extract context for ID generation
        let text_content = extract_text_content(&n.children);
        let aria_label = get_attribute_value(&n.opening, "aria-label");
        let placeholder = get_attribute_value(&n.opening, "placeholder");
        let title = get_attribute_value(&n.opening, "title");
        let name = get_attribute_value(&n.opening, "name");
        let existing_id = get_attribute_value(&n.opening, "id");
        let input_type = get_attribute_value(&n.opening, "type");
        let element_index = self.get_element_index(&tag_name);

        // Generate ID
        let id_ctx = IdContext {
            component_name: self.current_component(),
            file_path: &self.filename,
            tag_name: &tag_name,
            text_content: text_content.as_deref(),
            aria_label: aria_label.as_deref(),
            placeholder: placeholder.as_deref(),
            title: title.as_deref(),
            existing_id: existing_id.as_deref(),
            element_index,
        };

        let generated_id = generate_id(&self.config, &id_ctx);

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
        let semantic_type = get_semantic_type(
            &tag_name,
            input_type.as_deref(),
            placeholder.as_deref(),
            name.as_deref(),
        );
        self.add_attribute(&mut n.opening, &self.config.type_attribute, &semantic_type);

        // Generate and add aliases
        if self.config.generate_aliases {
            let alias_ctx = AliasContext {
                tag_name: &tag_name,
                text_content: text_content.as_deref(),
                aria_label: aria_label.as_deref(),
                placeholder: placeholder.as_deref(),
                title: title.as_deref(),
                name: name.as_deref(),
            };

            let aliases = generate_aliases(&self.config, &alias_ctx);
            if !aliases.is_empty() {
                let aliases_str = format_aliases(&aliases);
                self.add_attribute(&mut n.opening, &self.config.aliases_attribute, &aliases_str);
            }
        }

        if self.config.verbose {
            eprintln!(
                "[ui-bridge-swc-plugin] Instrumented <{}> as \"{}\"",
                tag_name, final_id
            );
        }
    }
}

impl VisitMut for UIBridgeVisitor {
    // Track function declarations (function MyComponent() {})
    fn visit_mut_fn_decl(&mut self, n: &mut FnDecl) {
        let name = n.ident.sym.as_str().to_string();
        if Self::is_component_name(&name) {
            self.component_stack.push(name);
            n.visit_mut_children_with(self);
            self.component_stack.pop();
        } else {
            n.visit_mut_children_with(self);
        }
    }

    // Track variable declarations with arrow functions (const MyComponent = () => {})
    fn visit_mut_var_declarator(&mut self, n: &mut VarDeclarator) {
        if let Pat::Ident(ident) = &n.name {
            let name = ident.id.sym.as_str().to_string();
            if Self::is_component_name(&name) {
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

    // Track class methods (for class components with render method)
    fn visit_mut_class_method(&mut self, n: &mut ClassMethod) {
        // We don't push class names here since class declaration handles it
        n.visit_mut_children_with(self);
    }

    // Track class declarations
    fn visit_mut_class_decl(&mut self, n: &mut ClassDecl) {
        let name = n.ident.sym.as_str().to_string();
        if Self::is_component_name(&name) {
            self.component_stack.push(name);
            n.visit_mut_children_with(self);
            self.component_stack.pop();
        } else {
            n.visit_mut_children_with(self);
        }
    }

    // Process JSX elements
    fn visit_mut_jsx_element(&mut self, n: &mut JSXElement) {
        // Visit children first (depth-first)
        n.visit_mut_children_with(self);

        // Then process this element
        self.process_jsx_element(n);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_component_name() {
        assert!(UIBridgeVisitor::is_component_name("MyComponent"));
        assert!(UIBridgeVisitor::is_component_name("Button"));
        assert!(!UIBridgeVisitor::is_component_name("button"));
        assert!(!UIBridgeVisitor::is_component_name("myComponent"));
    }
}
