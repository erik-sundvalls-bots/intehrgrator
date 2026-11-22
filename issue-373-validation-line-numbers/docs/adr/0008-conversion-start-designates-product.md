# Conversion start designates the product; it is not a Scratch script

- Status: superseded by [ADR 0010](0010-product-stack-and-instance-encoding.md)
- Date: 2026-09-09

The canvas is declarative (ADR 0001). A Scratch-style hat is the obvious “conversion starts here” affordance, but Scratch’s green flag means “when clicked, run the statement stack.” **Conversion start** is still that hat: it snaps onto an **Instance root**, and scaffolding attaches one if missing. It only marks which tree is the product. The instance root has a previous notch for Start and no next notch — no sequential “then do this.” Mapping preview and codegen walk that tree.

**Considered:** a wrapping C-block “file”; today’s implicit top block; Start as an event with a statement stack. Rejected: the wrap is less discoverable than a hat; an implicit root does not teach schema-less JSON/XML/text products; a statement stack would break the Verifiable Mapping Subset and ADR 0001.

Multiple products, Collate, JSONL packaging, `CONTRIBUTION`, and Start-on-`for_each_source` as a file/stream driver are deferred. `for_each_source` stays nested iteration inside the instance tree. Running convert many times and collating files stays outside this script.
