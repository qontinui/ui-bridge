//! UI Bridge SWC Plugin
//!
//! A Rust-based SWC plugin that automatically instruments JSX elements with
//! UI Bridge attributes (`data-ui-id`, `data-ui-aliases`, `data-ui-type`).
//!
//! This plugin is compatible with Next.js 15+ and other SWC-based build systems,
//! providing the same functionality as the Babel plugin but running natively
//! in SWC for better performance and compatibility with `next/font`.
//!
//! # Example
//!
//! ```js
//! // next.config.js
//! module.exports = {
//!   experimental: {
//!     swcPlugins: [
//!       ['@qontinui/ui-bridge-swc-plugin', {
//!         elements: ['button', 'input', 'a', 'form'],
//!         idPrefix: 'ui',
//!       }]
//!     ]
//!   }
//! };
//! ```
//!
//! # Transformation Example
//!
//! Input:
//! ```jsx
//! <button onClick={handleSubmit}>Sign In</button>
//! ```
//!
//! Output:
//! ```jsx
//! <button
//!   onClick={handleSubmit}
//!   data-ui-id="ui-login-form-sign-in-button"
//!   data-ui-type="button"
//!   data-ui-aliases="sign in,signin,login,log in"
//! >
//!   Sign In
//! </button>
//! ```

use swc_core::ecma::ast::Program;
use swc_core::ecma::visit::{as_folder, FoldWith};
use swc_core::plugin::{plugin_transform, proxies::TransformPluginProgramMetadata};

mod alias_generator;
mod config;
mod id_generator;
mod text_extractor;
mod visitor;

use config::PluginConfig;
use visitor::UIBridgeVisitor;

/// The main plugin transform entry point
///
/// This function is called by SWC for each file being compiled.
/// It parses the plugin configuration and applies the UI Bridge transformation.
#[plugin_transform]
pub fn process_transform(program: Program, metadata: TransformPluginProgramMetadata) -> Program {
    // Parse configuration from plugin options
    let config: PluginConfig = metadata
        .get_transform_plugin_config()
        .and_then(|config_str| serde_json::from_str(&config_str).ok())
        .unwrap_or_default();

    // Get filename for ID generation
    let filename = metadata
        .get_context(&swc_core::common::plugin::metadata::TransformPluginMetadataContextKind::Filename)
        .unwrap_or_else(|| "unknown".to_string());

    if config.verbose {
        eprintln!("[ui-bridge-swc-plugin] Processing: {}", filename);
    }

    // Create visitor and transform the program
    let visitor = UIBridgeVisitor::new(config.clone(), filename.clone());
    let result = program.fold_with(&mut as_folder(visitor));

    if config.verbose {
        eprintln!("[ui-bridge-swc-plugin] Finished: {}", filename);
    }

    result
}

// Note: PluginConfig and UIBridgeVisitor are already accessible via the use statements above.
// Individual module tests are in their respective files (config.rs, visitor.rs, etc.)
