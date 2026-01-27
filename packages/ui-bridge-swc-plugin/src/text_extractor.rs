//! Text extraction module
//!
//! Extracts text content from JSX elements and their children.

use swc_core::ecma::ast::*;

/// Extract text content from JSX children
pub fn extract_text_content(children: &[JSXElementChild]) -> Option<String> {
    let mut text_parts: Vec<String> = vec![];

    for child in children {
        match child {
            JSXElementChild::JSXText(text) => {
                let text_str = text.value.as_str();
                let trimmed = text_str.trim();
                if !trimmed.is_empty() {
                    text_parts.push(trimmed.to_string());
                }
            }
            JSXElementChild::JSXExprContainer(expr) => {
                // Handle string literals in expressions like {"text"}
                if let JSXExpr::Expr(e) = &expr.expr {
                    if let Expr::Lit(Lit::Str(s)) = e.as_ref() {
                        let trimmed = s.value.as_str().trim();
                        if !trimmed.is_empty() {
                            text_parts.push(trimmed.to_string());
                        }
                    }
                    // Handle template literals like {`text`}
                    if let Expr::Tpl(tpl) = e.as_ref() {
                        for quasi in &tpl.quasis {
                            let trimmed = quasi.raw.as_str().trim();
                            if !trimmed.is_empty() {
                                text_parts.push(trimmed.to_string());
                            }
                        }
                    }
                }
            }
            // Recursively extract from nested JSX elements (like <span>text</span>)
            JSXElementChild::JSXElement(el) => {
                if let Some(text) = extract_text_content(&el.children) {
                    text_parts.push(text);
                }
            }
            JSXElementChild::JSXFragment(frag) => {
                if let Some(text) = extract_text_content(&frag.children) {
                    text_parts.push(text);
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

/// Get an attribute value from a JSX element as a string
pub fn get_attribute_value(element: &JSXOpeningElement, attr_name: &str) -> Option<String> {
    for attr in &element.attrs {
        if let JSXAttrOrSpread::JSXAttr(jsx_attr) = attr {
            let name = match &jsx_attr.name {
                JSXAttrName::Ident(ident) => ident.sym.as_str(),
                JSXAttrName::JSXNamespacedName(_ns) => {
                    // Handle namespaced attributes like aria-label
                    // They're stored as JSXNamespacedName with ns="aria" and name="label"
                    // But actually, aria-label is just an Ident with the full name
                    continue;
                }
            };

            if name == attr_name {
                return match &jsx_attr.value {
                    Some(JSXAttrValue::Lit(Lit::Str(s))) => Some(s.value.as_str().to_string()),
                    Some(JSXAttrValue::JSXExprContainer(expr)) => {
                        if let JSXExpr::Expr(e) = &expr.expr {
                            if let Expr::Lit(Lit::Str(s)) = e.as_ref() {
                                return Some(s.value.as_str().to_string());
                            }
                        }
                        None
                    }
                    _ => None,
                };
            }
        }
    }
    None
}

/// Check if element has a specific attribute
pub fn has_attribute(element: &JSXOpeningElement, attr_name: &str) -> bool {
    element.attrs.iter().any(|attr| {
        if let JSXAttrOrSpread::JSXAttr(jsx_attr) = attr {
            if let JSXAttrName::Ident(ident) = &jsx_attr.name {
                return ident.sym.as_str() == attr_name;
            }
        }
        false
    })
}

/// Get the tag name from a JSX element
pub fn get_tag_name(element: &JSXOpeningElement) -> Option<String> {
    match &element.name {
        JSXElementName::Ident(ident) => Some(ident.sym.as_str().to_string()),
        JSXElementName::JSXMemberExpr(_) => None, // Skip Component.SubComponent
        JSXElementName::JSXNamespacedName(_) => None, // Skip namespaced elements
    }
}

/// Check if a tag name is a lowercase HTML element (not a React component)
pub fn is_html_element(tag_name: &str) -> bool {
    tag_name
        .chars()
        .next()
        .map(|c| c.is_lowercase())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_html_element() {
        assert!(is_html_element("button"));
        assert!(is_html_element("div"));
        assert!(is_html_element("input"));
        assert!(!is_html_element("Button"));
        assert!(!is_html_element("MyComponent"));
    }
}
