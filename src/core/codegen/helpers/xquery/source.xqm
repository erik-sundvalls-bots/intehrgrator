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

