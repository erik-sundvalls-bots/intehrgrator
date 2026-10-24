# Mapping Spec view is a compact projection

The Mapping Spec tab is a dense, editable **projection** of Blockly workspace JSON, not the JSON document itself. Download/Upload still round-trip native Blockly JSON. The alternative — keeping pretty-printed Blockly JSON in CodeMirror and hiding chrome with replace decorations — forced JSON line numbers, wasted scroll for `xml_text` / `DV_*` / nested `AND` wrappers, and made text-generation (`text_code`) uneditable.

Safe widget edits write Blockly fields in place (source paths, map keys, literals, compare operands, loops, `text_code`). This does not change ADR 0001: Blockly JSON remains the canonical Mapping Specification in the Project Bundle.
