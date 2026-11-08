# Initial registration (MHV1) for maternity care

Pages 76–87 in `vendor/obstetrix/documentation` (not on GitHub) are a poor markdown conversion of a Swedish description of the UI and semantics of the app that produces data matching `obx-mhv1.review-1.schema.json`.

It is a form in four parts; screenshots live in that same vendor documentation folder, including previous pregnancies.

Generated exports sometimes tag `Personnummer` and previous-pregnancy `Ar` as JSON Schema `format: "time"`. Those are a Swedish identity number and a calendar year, not clock times — this copy of the schema corrects that.
