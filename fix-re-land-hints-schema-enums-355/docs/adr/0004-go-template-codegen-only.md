# Go template is a codegen-only Conversion script language

Go `text/template` is added as a Conversion script language whose output is generated from the Blockly Mapping Model — not authored in a Template tab. Handlebars retains its Authored Template tab for Kintegrate compatibility; Go template does not get one.

**Considered:** giving Go template the same dual surface as Handlebars (Authored Template tab + codegen). Rejected because the existing Go mapping scripts (FLAT→TakeCare XML) are a reference, not the intEHRgrator authoring path. The Blockly canvas with `xml_element`/`xml_text`/`xml_attribute`/`controls_if`/`source_query` blocks is the editing surface; `text_code` (language = Go Template) nests **VMS-Go** snippets inside XML text nodes when needed ([ADR 0009](0009-verifiable-template-dialects.md)). `generate(model, "go-template")` produces the equivalent Go template code. A future Blockly→Handlebars codegen adapter may follow the same pattern.
