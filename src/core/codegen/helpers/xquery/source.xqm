module namespace ig = "https://github.com/regionstockholm/intehrgrator/ns/helpers/source";

(: --- Source access (fontoxpath-authored paths → XQuery 3.1) --- :)

declare function ig:iterable-sequence($nodes as item()*) as item()* {
  if ($nodes instance of array(*)) then $nodes?*
  else $nodes
};

declare function ig:lookup-sequence($ctx as item()*, $path as xs:string) as item()* {
  (: Dynamic or non-literal loop paths — prefer compile-time $. / / paths from export :) 
  if (starts-with($path, "$"))
  then let $nodes := ig:json-lookup($ctx, $path)
       return if ($nodes instance of array(*)) then $nodes?* else $nodes
  else error(
    QName("http://intehrgrator.local/xquery", "DYNAMIC-LOOP-PATH"),
    "Prefer compile-time literal loop PATH from intEHRgrator export; got: " || $path
  )
};

declare function ig:string-at($ctx as item()*, $path as xs:string) as xs:string? {
  let $value := ig:lookup($ctx, $path)
  return if (empty($value)) then () else xs:string($value)
};

declare function ig:number-at($ctx as item()*, $path as xs:string) as xs:decimal? {
  let $value := ig:lookup($ctx, $path)
  return if (empty($value)) then () else xs:decimal($value)
};

declare function ig:boolean-at($ctx as item()*, $path as xs:string) as xs:boolean? {
  let $value := ig:lookup($ctx, $path)
  return if (empty($value)) then () else xs:boolean($value)
};

declare function ig:lookup($ctx as item()*, $path as xs:string) as item()* {
  if (starts-with($path, "$"))
  then ig:json-lookup($ctx, $path)
  else error(
    QName("http://intehrgrator.local/xquery", "DYNAMIC-XML-PATH"),
    "Prefer compile-time literal XML paths from intEHRgrator export; got: " || $path
  )
};

declare function ig:json-lookup($ctx as item()*, $path as xs:string) as item()* {
  let $body := replace(replace(replace($path, "^\\$\\.?", ""), "\\[(\\d+)\\]", ".$1"), "\\[\\*\\]", ".*")
  let $segments := tokenize($body, "\\.")[. ne ""]
  return fold-left(
    $segments,
    $ctx,
    function($acc as item()*, $seg as xs:string) as item()* {
      if (empty($acc)) then ()
      else if ($seg eq "*") then
        if ($acc instance of array(*)) then $acc?* else $acc
      else if ($seg castable as xs:integer) then
        if ($acc instance of array(*)) then $acc?(xs:integer($seg)) else ($acc)[xs:integer($seg)]
      else if ($acc instance of array(*)) then $acc?*?($seg)
      else $acc?($seg)
    }
  )
};

(: Base64 text, as openEHR Array<Octet> integers. :)
declare function ig:octet-bytes($text as xs:string?) as xs:integer* {
  if (empty($text) or normalize-space($text) eq "") then ()
  else
    let $src := replace($text, "=+$", "")
    let $alphabet := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    let $vals :=
      for $cp in string-to-codepoints($src)
      return string-length(substring-before($alphabet, codepoints-to-string($cp)))
    let $bits := string-join(for $v in $vals return ig:six-bits($v), "")
    return
      for $i in 0 to (string-length($bits) idiv 8 - 1)
      return ig:bits-to-int(substring($bits, $i * 8 + 1, 8))
};

declare function ig:six-bits($n as xs:integer) as xs:string {
  string-join(
    for $shift in (32, 16, 8, 4, 2, 1)
    return if (($n idiv $shift) mod 2 eq 1) then "1" else "0"
  , "")
};

declare function ig:pow2($n as xs:integer) as xs:integer {
  if ($n le 0) then 1 else 2 * ig:pow2($n - 1)
};

declare function ig:bits-to-int($bits as xs:string) as xs:integer {
  sum(
    for $i in 1 to string-length($bits)
    return if (substring($bits, $i, 1) eq "1")
           then ig:pow2(string-length($bits) - $i)
           else 0
  )
};

