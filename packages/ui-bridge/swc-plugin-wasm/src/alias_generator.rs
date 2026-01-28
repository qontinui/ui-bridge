//! Alias generation module
//!
//! Generates semantic aliases for UI elements to enable fuzzy matching.

use crate::config::PluginConfig;

/// Context for generating aliases
#[derive(Debug, Default)]
pub struct AliasContext<'a> {
    pub tag_name: &'a str,
    pub text_content: Option<&'a str>,
    pub aria_label: Option<&'a str>,
    pub placeholder: Option<&'a str>,
    pub title: Option<&'a str>,
    pub name: Option<&'a str>,
}

/// Generate aliases for an element
pub fn generate_aliases(config: &PluginConfig, ctx: &AliasContext) -> Vec<String> {
    let mut aliases: Vec<String> = vec![];

    // Add text content as primary alias
    if let Some(text) = ctx.text_content {
        let normalized = normalize_for_alias(text);
        if !normalized.is_empty() {
            aliases.push(normalized.clone());
            // Add synonyms
            for syn in get_synonyms(&normalized) {
                if !aliases.contains(&syn) {
                    aliases.push(syn);
                }
            }
        }
    }

    // Add aria-label
    if let Some(label) = ctx.aria_label {
        let normalized = normalize_for_alias(label);
        if !normalized.is_empty() && !aliases.contains(&normalized) {
            aliases.push(normalized);
        }
    }

    // Add placeholder
    if let Some(ph) = ctx.placeholder {
        let normalized = normalize_for_alias(ph);
        if !normalized.is_empty() && !aliases.contains(&normalized) {
            aliases.push(normalized);
        }
    }

    // Add title
    if let Some(t) = ctx.title {
        let normalized = normalize_for_alias(t);
        if !normalized.is_empty() && !aliases.contains(&normalized) {
            aliases.push(normalized);
        }
    }

    // Add name attribute
    if let Some(n) = ctx.name {
        let normalized = normalize_for_alias(n);
        if !normalized.is_empty() && !aliases.contains(&normalized) {
            aliases.push(normalized);
        }
    }

    // Limit to max aliases
    aliases.truncate(config.max_aliases);
    aliases
}

/// Format aliases as a comma-separated string
pub fn format_aliases(aliases: &[String]) -> String {
    aliases.join(",")
}

/// Normalize text for use as an alias
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

/// Get common synonyms for text
fn get_synonyms(text: &str) -> Vec<String> {
    let mut synonyms = vec![];

    // Define synonym groups
    let synonym_map: &[(&[&str], &[&str])] = &[
        // Submit/Send variations
        (
            &["submit", "send", "go"],
            &["submit", "send", "go", "confirm"],
        ),
        // Sign in/Login variations
        (
            &["sign in", "signin", "log in", "login"],
            &["sign in", "signin", "log in", "login", "authenticate"],
        ),
        // Sign up/Register variations
        (
            &["sign up", "signup", "register", "create account"],
            &["sign up", "signup", "register", "create account", "join"],
        ),
        // Sign out/Logout variations
        (
            &["sign out", "signout", "log out", "logout"],
            &["sign out", "signout", "log out", "logout", "exit"],
        ),
        // Cancel/Close variations
        (
            &["cancel", "close", "dismiss", "x"],
            &["cancel", "close", "dismiss", "exit", "abort"],
        ),
        // Save variations
        (
            &["save", "store", "keep"],
            &["save", "store", "keep", "persist", "apply"],
        ),
        // Delete/Remove variations
        (
            &["delete", "remove", "trash"],
            &["delete", "remove", "trash", "discard", "erase"],
        ),
        // Edit/Modify variations
        (
            &["edit", "modify", "change", "update"],
            &["edit", "modify", "change", "update", "alter"],
        ),
        // Search/Find variations
        (
            &["search", "find", "lookup"],
            &["search", "find", "lookup", "query", "filter"],
        ),
        // Next/Continue variations
        (
            &["next", "continue", "proceed", "forward"],
            &["next", "continue", "proceed", "forward", "advance"],
        ),
        // Back/Previous variations
        (
            &["back", "previous", "prev", "return"],
            &["back", "previous", "prev", "return", "go back"],
        ),
        // Start/Begin variations
        (
            &["start", "begin", "launch", "run"],
            &["start", "begin", "launch", "run", "execute", "initiate"],
        ),
        // Stop/End variations
        (
            &["stop", "end", "halt", "pause"],
            &["stop", "end", "halt", "pause", "terminate"],
        ),
        // Add/Create variations
        (
            &["add", "create", "new", "plus"],
            &["add", "create", "new", "plus", "insert"],
        ),
        // Download variations
        (
            &["download", "export", "save as"],
            &["download", "export", "save as", "get"],
        ),
        // Upload variations
        (
            &["upload", "import", "attach"],
            &["upload", "import", "attach", "add file"],
        ),
        // Confirm/OK variations
        (
            &["confirm", "ok", "okay", "yes", "accept"],
            &["confirm", "ok", "okay", "yes", "accept", "agree"],
        ),
        // Deny/No variations
        (
            &["deny", "no", "reject", "decline"],
            &["deny", "no", "reject", "decline", "refuse"],
        ),
        // Help variations
        (
            &["help", "support", "info", "information"],
            &["help", "support", "info", "information", "faq"],
        ),
        // Settings variations
        (
            &["settings", "preferences", "options", "config"],
            &["settings", "preferences", "options", "config", "configure"],
        ),
        // Profile/Account variations
        (
            &["profile", "account", "user"],
            &["profile", "account", "user", "my account"],
        ),
        // Home variations
        (
            &["home", "main", "dashboard"],
            &["home", "main", "dashboard", "start page"],
        ),
        // Menu variations
        (
            &["menu", "navigation", "nav"],
            &["menu", "navigation", "nav", "hamburger"],
        ),
        // Refresh/Reload variations
        (
            &["refresh", "reload", "update"],
            &["refresh", "reload", "update", "sync"],
        ),
        // Copy variations
        (
            &["copy", "duplicate", "clone"],
            &["copy", "duplicate", "clone", "replicate"],
        ),
        // Paste variations
        (&["paste", "insert"], &["paste", "insert", "put"]),
        // Share variations
        (
            &["share", "send to"],
            &["share", "send to", "forward", "distribute"],
        ),
        // View/Show variations
        (
            &["view", "show", "display", "see"],
            &["view", "show", "display", "see", "reveal"],
        ),
        // Hide variations
        (
            &["hide", "conceal"],
            &["hide", "conceal", "collapse", "minimize"],
        ),
        // Expand/More variations
        (
            &["expand", "more", "show more"],
            &["expand", "more", "show more", "details", "see all"],
        ),
        // Collapse/Less variations
        (
            &["collapse", "less", "show less"],
            &["collapse", "less", "show less", "hide details"],
        ),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_for_alias() {
        assert_eq!(normalize_for_alias("  Sign In  "), "sign in");
        assert_eq!(normalize_for_alias("Submit!@#Form"), "submitform");
        assert_eq!(normalize_for_alias("Enter Email"), "enter email");
    }

    #[test]
    fn test_get_synonyms() {
        let synonyms = get_synonyms("sign in");
        assert!(synonyms.contains(&"signin".to_string()));
        assert!(synonyms.contains(&"login".to_string()));
        assert!(synonyms.contains(&"log in".to_string()));

        let synonyms = get_synonyms("submit");
        assert!(synonyms.contains(&"send".to_string()));
        assert!(synonyms.contains(&"confirm".to_string()));
    }

    #[test]
    fn test_generate_aliases() {
        let config = PluginConfig::default();
        let ctx = AliasContext {
            tag_name: "button",
            text_content: Some("Sign In"),
            ..Default::default()
        };

        let aliases = generate_aliases(&config, &ctx);
        assert!(aliases.contains(&"sign in".to_string()));
        assert!(aliases.contains(&"login".to_string()) || aliases.contains(&"signin".to_string()));
    }

    #[test]
    fn test_generate_aliases_with_multiple_sources() {
        let config = PluginConfig::default();
        let ctx = AliasContext {
            tag_name: "input",
            placeholder: Some("Email address"),
            aria_label: Some("Enter your email"),
            ..Default::default()
        };

        let aliases = generate_aliases(&config, &ctx);
        assert!(aliases.contains(&"email address".to_string()));
        assert!(aliases.contains(&"enter your email".to_string()));
    }

    #[test]
    fn test_max_aliases() {
        let mut config = PluginConfig::default();
        config.max_aliases = 2;

        let ctx = AliasContext {
            tag_name: "button",
            text_content: Some("Sign In"),
            aria_label: Some("Login button"),
            placeholder: Some("Click to sign in"),
            ..Default::default()
        };

        let aliases = generate_aliases(&config, &ctx);
        assert!(aliases.len() <= 2);
    }

    #[test]
    fn test_format_aliases() {
        let aliases = vec!["sign in".to_string(), "login".to_string()];
        assert_eq!(format_aliases(&aliases), "sign in,login");
    }
}
