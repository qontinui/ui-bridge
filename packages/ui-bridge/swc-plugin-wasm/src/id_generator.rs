//! ID generation module
//!
//! Generates deterministic, semantic IDs for UI elements.

use crate::config::PluginConfig;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Context for generating an element ID
#[derive(Debug, Default)]
pub struct IdContext<'a> {
    pub component_name: Option<&'a str>,
    pub file_path: &'a str,
    pub tag_name: &'a str,
    pub text_content: Option<&'a str>,
    pub aria_label: Option<&'a str>,
    pub placeholder: Option<&'a str>,
    pub title: Option<&'a str>,
    pub existing_id: Option<&'a str>,
    pub element_index: usize,
}

/// Generate a unique ID for an element
pub fn generate_id(config: &PluginConfig, ctx: &IdContext) -> String {
    let mut parts: Vec<String> = vec![config.id_prefix.clone()];

    // Add component name
    if config.include_component_name {
        if let Some(name) = ctx.component_name {
            parts.push(to_kebab_case(name));
        }
    }

    // Add file path (optional)
    if config.include_file_path {
        let file_part = extract_file_name(ctx.file_path);
        if !file_part.is_empty() {
            parts.push(to_kebab_case(&file_part));
        }
    }

    // Add descriptive part (prefer existing id > text > aria > placeholder > title)
    let descriptor = ctx
        .existing_id
        .or(ctx.text_content)
        .or(ctx.aria_label)
        .or(ctx.placeholder)
        .or(ctx.title);

    if let Some(desc) = descriptor {
        let normalized = normalize_text(desc);
        if !normalized.is_empty() {
            parts.push(normalized);
        }
    }

    // Add element type
    let semantic_type = get_element_type_suffix(ctx.tag_name);
    parts.push(semantic_type.to_string());

    let id = parts.join("-");

    // Optionally hash for shorter IDs
    if config.hash_ids {
        hash_id(&id)
    } else {
        id
    }
}

/// Get the semantic type for an element
pub fn get_semantic_type(
    tag_name: &str,
    input_type: Option<&str>,
    placeholder: Option<&str>,
    name: Option<&str>,
) -> String {
    match tag_name {
        "button" => "button".to_string(),
        "a" => "link".to_string(),
        "form" => "form".to_string(),
        "select" => "dropdown".to_string(),
        "textarea" => "textarea".to_string(),
        "input" => {
            // Check input type first
            if let Some(input_type) = input_type {
                match input_type {
                    "email" => return "email-input".to_string(),
                    "password" => return "password-input".to_string(),
                    "search" => return "search-input".to_string(),
                    "tel" => return "phone-input".to_string(),
                    "url" => return "url-input".to_string(),
                    "number" => return "number-input".to_string(),
                    "checkbox" => return "checkbox".to_string(),
                    "radio" => return "radio".to_string(),
                    "submit" => return "submit-button".to_string(),
                    "file" => return "file-input".to_string(),
                    "date" => return "date-input".to_string(),
                    "time" => return "time-input".to_string(),
                    _ => {}
                }
            }

            // Infer from placeholder or name
            if let Some(p) = placeholder {
                let lower = p.to_lowercase();
                if lower.contains("email") {
                    return "email-input".to_string();
                }
                if lower.contains("password") {
                    return "password-input".to_string();
                }
                if lower.contains("search") {
                    return "search-input".to_string();
                }
                if lower.contains("phone") || lower.contains("tel") {
                    return "phone-input".to_string();
                }
            }

            if let Some(n) = name {
                let lower = n.to_lowercase();
                if lower.contains("email") {
                    return "email-input".to_string();
                }
                if lower.contains("password") {
                    return "password-input".to_string();
                }
            }

            "input".to_string()
        }
        _ => tag_name.to_string(),
    }
}

/// Convert a string to kebab-case
fn to_kebab_case(s: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = s.chars().collect();

    for (i, &c) in chars.iter().enumerate() {
        if c.is_uppercase() {
            // Add hyphen before uppercase if:
            // 1. Previous char was lowercase, OR
            // 2. Previous char was uppercase AND next char is lowercase (handles acronyms like "URLInput")
            if !result.is_empty() && !result.ends_with('-') {
                let prev_was_upper = i > 0 && chars[i - 1].is_uppercase();
                let prev_was_lower = i > 0 && chars[i - 1].is_lowercase();
                let next_is_lower = i + 1 < chars.len() && chars[i + 1].is_lowercase();

                if prev_was_lower || (prev_was_upper && next_is_lower) {
                    result.push('-');
                }
            }
            result.push(c.to_lowercase().next().unwrap());
        } else if c.is_alphanumeric() {
            result.push(c);
        } else if !result.is_empty() && !result.ends_with('-') {
            result.push('-');
        }
    }

    // Remove trailing dash
    if result.ends_with('-') {
        result.pop();
    }

    result
}

/// Normalize text for use in an ID
fn normalize_text(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .take(4) // Limit to 4 words
        .collect::<Vec<_>>()
        .join("-")
}

/// Extract file name from path (without extension)
fn extract_file_name(path: &str) -> String {
    path.split(['/', '\\'])
        .last()
        .unwrap_or("unknown")
        .split('.')
        .next()
        .unwrap_or("unknown")
        .to_string()
}

/// Get the element type suffix for an ID
fn get_element_type_suffix(tag_name: &str) -> &str {
    match tag_name {
        "a" => "link",
        "button" => "button",
        "input" => "input",
        "select" => "dropdown",
        "textarea" => "textarea",
        "form" => "form",
        _ => tag_name,
    }
}

/// Hash an ID for shorter strings
fn hash_id(id: &str) -> String {
    let mut hasher = DefaultHasher::new();
    id.hash(&mut hasher);
    format!("ui-{:08x}", hasher.finish() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_kebab_case() {
        assert_eq!(to_kebab_case("LoginForm"), "login-form");
        assert_eq!(to_kebab_case("MyComponent"), "my-component");
        assert_eq!(to_kebab_case("URLInput"), "url-input");
        assert_eq!(to_kebab_case("already-kebab"), "already-kebab");
        assert_eq!(to_kebab_case("with spaces"), "with-spaces");
    }

    #[test]
    fn test_normalize_text() {
        assert_eq!(normalize_text("Sign In"), "sign-in");
        assert_eq!(normalize_text("Submit Form Now"), "submit-form-now");
        assert_eq!(
            normalize_text("This is a very long text that should be truncated"),
            "this-is-a-very"
        );
        assert_eq!(normalize_text("Email!@#$Address"), "email-address");
    }

    #[test]
    fn test_extract_file_name() {
        assert_eq!(extract_file_name("/src/components/LoginForm.tsx"), "LoginForm");
        assert_eq!(extract_file_name("C:\\Users\\App\\Button.jsx"), "Button");
        assert_eq!(extract_file_name("Component.tsx"), "Component");
    }

    #[test]
    fn test_generate_id() {
        let config = PluginConfig::default();
        let ctx = IdContext {
            component_name: Some("LoginForm"),
            file_path: "/src/LoginForm.tsx",
            tag_name: "button",
            text_content: Some("Sign In"),
            ..Default::default()
        };

        let id = generate_id(&config, &ctx);
        assert_eq!(id, "ui-login-form-sign-in-button");
    }

    #[test]
    fn test_generate_id_with_placeholder() {
        let config = PluginConfig::default();
        let ctx = IdContext {
            component_name: Some("LoginForm"),
            file_path: "/src/LoginForm.tsx",
            tag_name: "input",
            placeholder: Some("Enter your email"),
            ..Default::default()
        };

        let id = generate_id(&config, &ctx);
        assert_eq!(id, "ui-login-form-enter-your-email-input");
    }

    #[test]
    fn test_generate_id_hashed() {
        let mut config = PluginConfig::default();
        config.hash_ids = true;

        let ctx = IdContext {
            component_name: Some("LoginForm"),
            tag_name: "button",
            text_content: Some("Sign In"),
            ..Default::default()
        };

        let id = generate_id(&config, &ctx);
        assert!(id.starts_with("ui-"));
        assert_eq!(id.len(), 11); // "ui-" + 8 hex chars
    }

    #[test]
    fn test_get_semantic_type() {
        assert_eq!(get_semantic_type("button", None, None, None), "button");
        assert_eq!(get_semantic_type("a", None, None, None), "link");
        assert_eq!(
            get_semantic_type("input", Some("email"), None, None),
            "email-input"
        );
        assert_eq!(
            get_semantic_type("input", Some("password"), None, None),
            "password-input"
        );
        assert_eq!(
            get_semantic_type("input", None, Some("Enter email"), None),
            "email-input"
        );
        assert_eq!(get_semantic_type("input", None, None, None), "input");
    }
}
