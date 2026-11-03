module namespace igrm = "https://github.com/regionstockholm/intehrgrator/ns/helpers/rm";
declare namespace rm = "http://schemas.openehr.org/v1";
declare namespace xsi = "http://www.w3.org/2001/XMLSchema-instance";

(: --- DV_* constructors (RM XML) --- :)

declare function igrm:dv-text($value as xs:string?) as element(rm:value) {
  element rm:value {
    attribute xsi:type { "DV_TEXT" },
    element rm:value { $value }
  }
};

declare function igrm:dv-coded-text($value as xs:string?, $code as xs:string?, $terminology as xs:string?) as element(rm:value) {
  element rm:value {
    attribute xsi:type { "DV_CODED_TEXT" },
    element rm:value { $value },
    element rm:defining_code {
      element rm:terminology_id { element rm:value { $terminology } },
      element rm:code_string { $code }
    }
  }
};

declare function igrm:dv-quantity($magnitude as xs:decimal?, $units as xs:string?) as element(rm:value) {
  element rm:value {
    attribute xsi:type { "DV_QUANTITY" },
    element rm:magnitude { $magnitude },
    element rm:units { $units }
  }
};

declare function igrm:dv-count($magnitude as xs:integer?) as element(rm:value) {
  element rm:value {
    attribute xsi:type { "DV_COUNT" },
    element rm:magnitude { $magnitude }
  }
};

declare function igrm:dv-boolean($value as xs:boolean?) as element(rm:value) {
  element rm:value {
    attribute xsi:type { "DV_BOOLEAN" },
    element rm:value { $value }
  }
};

declare function igrm:dv-date-time($value as xs:string?) as element(rm:value) {
  element rm:value {
    attribute xsi:type { "DV_DATE_TIME" },
    element rm:value { $value }
  }
};

declare function igrm:dv-uri($value as xs:string?) as element(rm:value) {
  element rm:value {
    attribute xsi:type { "DV_URI" },
    element rm:value { $value }
  }
};

declare function igrm:as-value($rm-type as xs:string, $value as item()*) as element()* {
  switch ($rm-type)
    case "DV_QUANTITY" return igrm:dv-quantity(($value)[1] ! xs:decimal(.), ())
    case "DV_COUNT" return igrm:dv-count(($value)[1] ! xs:integer(.))
    case "DV_INTEGER" return igrm:dv-count(($value)[1] ! xs:integer(.))
    case "DV_BOOLEAN" return igrm:dv-boolean(($value)[1] ! xs:boolean(.))
    case "DV_DATE_TIME" return igrm:dv-date-time(($value)[1] ! xs:string(.))
    case "DV_DATE" return igrm:dv-date-time(($value)[1] ! xs:string(.))
    case "DV_TIME" return igrm:dv-date-time(($value)[1] ! xs:string(.))
    case "DV_URI" return igrm:dv-uri(($value)[1] ! xs:string(.))
    case "DV_EHR_URI" return igrm:dv-uri(($value)[1] ! xs:string(.))
    case "DV_CODED_TEXT" return igrm:dv-coded-text(($value)[1] ! xs:string(.), (), ())
    default return igrm:dv-text(($value)[1] ! xs:string(.))
};

