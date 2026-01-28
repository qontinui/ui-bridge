//! Plugin configuration module
//!
//! Handles parsing and default values for plugin configuration options.

use serde::{Deserialize, Serialize};

/// Plugin configuration options
///
/// These match the Babel plugin configuration for consistency.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginConfig {
    /// Elements to instrument (e.g., ["button", "input", "a"])
    #[serde(default = "default_elements")]
    pub elements: Vec<String>,

    /// Prefix for generated IDs
    #[serde(default = "default_id_prefix")]
    pub id_prefix: String,

    /// Attribute name for the generated ID
    #[serde(default = "default_id_attribute")]
    pub id_attribute: String,

    /// Attribute name for aliases
    #[serde(default = "default_aliases_attribute")]
    pub aliases_attribute: String,

    /// Attribute name for element type
    #[serde(default = "default_type_attribute")]
    pub type_attribute: String,

    /// Whether to generate aliases from text content
    #[serde(default = "default_true")]
    pub generate_aliases: bool,

    /// Whether to include component name in generated ID
    #[serde(default = "default_true")]
    pub include_component_name: bool,

    /// Whether to include file path in generated ID
    #[serde(default)]
    pub include_file_path: bool,

    /// Whether to hash IDs for shorter strings
    #[serde(default)]
    pub hash_ids: bool,

    /// Maximum number of aliases per element
    #[serde(default = "default_max_aliases")]
    pub max_aliases: usize,

    /// Whether to skip elements that already have data-ui-id
    #[serde(default = "default_true")]
    pub skip_existing: bool,

    /// Only instrument in these components (empty = all)
    #[serde(default)]
    pub only_in_components: Vec<String>,

    /// Skip instrumentation in these components
    #[serde(default)]
    pub skip_in_components: Vec<String>,

    /// Enable verbose logging
    #[serde(default)]
    pub verbose: bool,
}

fn default_elements() -> Vec<String> {
    vec![
        "button".into(),
        "input".into(),
        "select".into(),
        "textarea".into(),
        "a".into(),
        "form".into(),
    ]
}

fn default_id_prefix() -> String {
    "ui".into()
}

fn default_id_attribute() -> String {
    "data-ui-id".into()
}

fn default_aliases_attribute() -> String {
    "data-ui-aliases".into()
}

fn default_type_attribute() -> String {
    "data-ui-type".into()
}

fn default_true() -> bool {
    true
}

fn default_max_aliases() -> usize {
    5
}

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

impl PluginConfig {
    /// Check if an element type should be instrumented
    pub fn should_instrument(&self, tag_name: &str) -> bool {
        self.elements.iter().any(|e| e == tag_name)
    }

    /// Check if we should skip based on component name
    pub fn should_skip_component(&self, component_name: Option<&str>) -> bool {
        if let Some(name) = component_name {
            // Check skip list
            if self.skip_in_components.iter().any(|c| c == name) {
                return true;
            }

            // Check only-in list (if non-empty)
            if !self.only_in_components.is_empty()
                && !self.only_in_components.iter().any(|c| c == name)
            {
                return true;
            }
        } else {
            // No component name - check if only_in_components is set
            if !self.only_in_components.is_empty() {
                return true;
            }
        }

        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = PluginConfig::default();
        assert_eq!(config.id_prefix, "ui");
        assert!(config.elements.contains(&"button".to_string()));
        assert!(config.generate_aliases);
    }

    #[test]
    fn test_should_instrument() {
        let config = PluginConfig::default();
        assert!(config.should_instrument("button"));
        assert!(config.should_instrument("input"));
        assert!(!config.should_instrument("div"));
        assert!(!config.should_instrument("span"));
    }

    #[test]
    fn test_should_skip_component() {
        let mut config = PluginConfig::default();

        // No restrictions
        assert!(!config.should_skip_component(Some("MyComponent")));

        // Skip specific component
        config.skip_in_components = vec!["SkipMe".into()];
        assert!(config.should_skip_component(Some("SkipMe")));
        assert!(!config.should_skip_component(Some("DontSkip")));

        // Only in specific components
        config.skip_in_components = vec![];
        config.only_in_components = vec!["OnlyThis".into()];
        assert!(!config.should_skip_component(Some("OnlyThis")));
        assert!(config.should_skip_component(Some("NotThis")));
    }

    #[test]
    fn test_deserialize_config() {
        let json = r#"{
            "elements": ["button", "a"],
            "idPrefix": "test",
            "generateAliases": false
        }"#;

        let config: PluginConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.id_prefix, "test");
        assert_eq!(config.elements, vec!["button", "a"]);
        assert!(!config.generate_aliases);
        // Defaults should be applied
        assert!(config.include_component_name);
    }
}
