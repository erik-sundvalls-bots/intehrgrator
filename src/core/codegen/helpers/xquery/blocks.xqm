module namespace igbk = "https://github.com/regionstockholm/intehrgrator/ns/helpers/blocks";
declare namespace array = "http://www.w3.org/2005/xpath-functions/array";

(: --- Blockly text / math / list blocks (issue #393) --- :)

declare function igbk:items($v as item()*) as item()* {
  for $x in $v return if ($x instance of array(*)) then $x?* else $x
};

declare function igbk:finite-or-error($n as xs:numeric, $form as xs:string) as empty-sequence() {
  if ($n ne $n or $n = xs:double("INF") or $n = xs:double("-INF"))
  then error((), concat("The target form ", $form, " cannot express ", string($n), "; Infinity and NaN are not permitted."))
  else ()
};

declare function igbk:plain-decimal($n as xs:numeric) as xs:string {
  let $_ := igbk:finite-or-error($n, "xml-decimal")
  return if ($n = 0) then "0"
    else if ($n = floor($n) and abs($n) lt 1e15) then string(xs:integer($n))
    else string(xs:decimal($n))
};

declare function igbk:num-text($n as xs:numeric) as xs:string {
  igbk:plain-decimal($n)
};

declare function igbk:xml-double-text($n as xs:numeric) as xs:string {
  if ($n ne $n) then "NaN"
  else if ($n = xs:double("INF")) then "INF"
  else if ($n = xs:double("-INF")) then "-INF"
  else igbk:plain-decimal($n)
};

declare function igbk:json-atom($n as xs:numeric) as xs:numeric {
  let $_ := igbk:finite-or-error($n, "json")
  return if ($n = floor($n) and abs($n) le 9007199254740991) then xs:integer($n)
    else $n
};

declare function igbk:json-canon($v as item()*) as item()* {
  if (empty($v)) then ()
  else if (count($v) gt 1) then for $x in $v return igbk:json-canon($x)
  else if ($v instance of array(*)) then array { for $x in $v?* return igbk:json-canon($x) }
  else if ($v instance of map(*)) then map:merge(for $k in map:keys($v) return map { $k: igbk:json-canon($v($k)) })
  else if ($v instance of xs:numeric) then igbk:json-atom($v)
  else $v
};

declare function igbk:text($v as item()*) as xs:string {
  if (empty($v)) then ""
  else if (count($v) gt 1 or $v instance of array(*))
  then string-join(for $x in igbk:items($v) return igbk:text($x), ",")
  else if ($v instance of map(*)) then "[object Object]"
  else if ($v instance of xs:boolean) then (if ($v) then "true" else "false")
  else if ($v instance of xs:numeric) then igbk:num-text($v)
  else string($v)
};

declare function igbk:num($v as item()*) as xs:double {
  if (empty($v)) then 0e0
  else let $x := $v[1]
  return if ($x instance of xs:boolean) then (if ($x) then 1e0 else 0e0)
    else if ($x instance of xs:numeric) then xs:double($x)
    else if ($x instance of array(*) or $x instance of map(*)) then xs:double("NaN")
    else let $s := normalize-space(string($x))
         return if ($s eq "") then 0e0 else number($s)
};

declare function igbk:finite($d as xs:double) as xs:double? {
  if ($d ne $d or $d = xs:double("INF") or $d = xs:double("-INF")) then ()
  else if ($d eq 0) then 0e0
  else $d
};

declare function igbk:trunc($v as item()*) as xs:integer {
  let $n := igbk:num($v)
  return if ($n ne $n) then 0 else if ($n ge 0) then xs:integer(floor($n)) else xs:integer(ceiling($n))
};

declare function igbk:start($where as item()*, $at as item()*, $len as xs:integer) as xs:integer {
  let $w := igbk:text($where)
  return if ($w eq "FIRST") then 0
    else if ($w eq "FROM_END") then $len - igbk:trunc($at)
    else if ($w eq "FROM_START") then igbk:trunc($at) - 1
    else error(QName("https://github.com/regionstockholm/intehrgrator/ns/helpers/blocks", "UNSUPPORTED"),
      "Unsupported position " || $w || " (RANDOM is not supported in generated code)")
};

declare function igbk:end($where as item()*, $at as item()*, $len as xs:integer) as xs:integer {
  let $w := igbk:text($where)
  return if ($w eq "LAST") then $len
    else if ($w eq "FROM_END") then $len - igbk:trunc($at) + 1
    else if ($w eq "FROM_START") then igbk:trunc($at)
    else error(QName("https://github.com/regionstockholm/intehrgrator/ns/helpers/blocks", "UNSUPPORTED"),
      "Unsupported position " || $w)
};

(: 0-based [start, end) clamped to the length, as Blockly slices. :)
declare function igbk:range($len as xs:integer, $a as array(*), $from as xs:integer) as xs:integer+ {
  let $start := max((0, igbk:start(igbk:arg($a, $from), igbk:arg($a, $from + 1), $len)))
  let $end := min(($len, igbk:end(igbk:arg($a, $from + 2), igbk:arg($a, $from + 3), $len)))
  return ($start, max(($start, $end)))
};

declare function igbk:arg($a as array(*), $i as xs:integer) as item()* {
  if ($i le array:size($a)) then $a($i) else ()
};

declare function igbk:same($a as item()*, $b as item()*) as xs:boolean {
  if (empty($a) or empty($b)) then (empty($a) and empty($b))
  else if ($a instance of xs:numeric and $b instance of xs:numeric) then $a = $b
  else if ($a instance of xs:boolean and $b instance of xs:boolean) then $a eq $b
  else if (($a instance of xs:boolean) or ($b instance of xs:boolean)
    or ($a instance of xs:numeric) or ($b instance of xs:numeric)) then false()
  else deep-equal($a, $b)
};

declare function igbk:numbers($v as item()*) as xs:double* {
  for $x in igbk:items($v)
  where not($x instance of xs:boolean) and normalize-space(string($x)) ne ""
  let $d := igbk:num($x)
  where $d eq $d and $d ne xs:double("INF") and $d ne xs:double("-INF")
  return $d
};

declare function igbk:is-prime($n as xs:double) as xs:boolean {
  if ($n ne floor($n) or $n lt 2) then false()
  else let $v := xs:integer($n)
  return if ($v lt 4) then true()
    else if ($v mod 2 eq 0) then false()
    else every $i in (1 to xs:integer(floor(math:sqrt($v)) idiv 2)) satisfies $v mod (2 * $i + 1) ne 0
};

declare function igbk:index-of-text($t as xs:string, $f as xs:string, $last as xs:boolean) as xs:integer {
  let $n := string-length($f)
  let $hits := for $i in 1 to string-length($t) - $n + 1
               where substring($t, $i, $n) eq $f
               return $i
  return if (empty($hits)) then 0 else if ($last) then $hits[last()] else $hits[1]
};

(: Stable merge sort; $cmp returns -1, 0 or 1. :)
declare function igbk:merge-sort($xs as item()*, $cmp as function(item(), item()) as xs:integer) as item()* {
  if (count($xs) le 1) then $xs
  else let $mid := count($xs) idiv 2
  return igbk:merge(
    igbk:merge-sort(subsequence($xs, 1, $mid), $cmp),
    igbk:merge-sort(subsequence($xs, $mid + 1), $cmp),
    $cmp)
};

declare function igbk:merge($a as item()*, $b as item()*, $cmp as function(item(), item()) as xs:integer) as item()* {
  if (empty($a)) then $b
  else if (empty($b)) then $a
  else if ($cmp($b[1], $a[1]) lt 0) then ($b[1], igbk:merge($a, subsequence($b, 2), $cmp))
  else ($a[1], igbk:merge(subsequence($a, 2), $b, $cmp))
};

declare function igbk:cmp-text($x as xs:string, $y as xs:string) as xs:integer {
  if ($x lt $y) then -1 else if ($x gt $y) then 1 else 0
};

declare function igbk:cmp-num($x as xs:double, $y as xs:double) as xs:integer {
  if ($x lt $y) then -1 else if ($x gt $y) then 1 else 0
};

declare function igbk:op($name as xs:string, $a as array(*)) as item()* {
  if ($name eq "text_length") then string-length(igbk:text(igbk:arg($a, 1)))
  else if ($name eq "text_isEmpty") then igbk:text(igbk:arg($a, 1)) eq ""
  else if ($name eq "text_indexOf") then
    igbk:index-of-text(igbk:text(igbk:arg($a, 1)), igbk:text(igbk:arg($a, 2)), igbk:text(igbk:arg($a, 3)) eq "LAST")
  else if ($name eq "text_charAt") then
    let $t := igbk:text(igbk:arg($a, 1))
    let $len := string-length($t)
    let $i := if (igbk:text(igbk:arg($a, 2)) eq "LAST") then $len - 1 else igbk:start(igbk:arg($a, 2), igbk:arg($a, 3), $len)
    return if ($i ge 0 and $i lt $len) then substring($t, $i + 1, 1) else ""
  else if ($name eq "text_getSubstring") then
    let $t := igbk:text(igbk:arg($a, 1))
    let $r := igbk:range(string-length($t), $a, 2)
    return substring($t, $r[1] + 1, $r[2] - $r[1])
  else if ($name eq "math_single") then
    let $op := igbk:text(igbk:arg($a, 1))
    let $x := igbk:num(igbk:arg($a, 2))
    return if ($op eq "ROOT") then igbk:finite(math:sqrt($x))
      else if ($op eq "ABS") then igbk:finite(abs($x))
      else if ($op eq "NEG") then igbk:finite(-$x)
      else if ($op eq "LN") then igbk:finite(math:log($x))
      else if ($op eq "LOG10") then igbk:finite(math:log10($x))
      else if ($op eq "EXP") then igbk:finite(math:exp($x))
      else if ($op eq "POW10") then igbk:finite(math:pow(10e0, $x))
      else error(QName("https://github.com/regionstockholm/intehrgrator/ns/helpers/blocks", "UNSUPPORTED"),
        "Unsupported math_single operator " || $op)
  else if ($name eq "math_number_property") then
    let $prop := igbk:text(igbk:arg($a, 1))
    let $n := igbk:num(igbk:arg($a, 2))
    return if ($n ne $n or $n = xs:double("INF") or $n = xs:double("-INF")) then false()
      else if ($prop eq "EVEN") then $n mod 2 eq 0
      else if ($prop eq "ODD") then abs($n mod 2) eq 1
      else if ($prop eq "PRIME") then igbk:is-prime($n)
      else if ($prop eq "WHOLE") then $n mod 1 eq 0
      else if ($prop eq "POSITIVE") then $n gt 0
      else if ($prop eq "NEGATIVE") then $n lt 0
      else if ($prop eq "DIVISIBLE_BY") then
        let $d := igbk:num(igbk:arg($a, 3))
        return $d eq $d and $d ne 0 and $d ne xs:double("INF") and $d ne xs:double("-INF") and $n mod $d eq 0
      else error(QName("https://github.com/regionstockholm/intehrgrator/ns/helpers/blocks", "UNSUPPORTED"),
        "Unsupported math_number_property " || $prop)
  else if ($name eq "math_on_list") then
    let $op := igbk:text(igbk:arg($a, 1))
    let $xs := igbk:numbers(igbk:arg($a, 2))
    return if ($op eq "SUM") then igbk:finite(sum($xs, 0e0))
      else if ($op eq "MODE") then
        let $counts := for $x in distinct-values($xs) return count($xs[. eq $x])
        let $top := max(($counts, 0))
        return for $x in distinct-values($xs) where count($xs[. eq $x]) eq $top return $x
      else if (not($op = ("MIN", "MAX", "AVERAGE", "MEDIAN", "STD_DEV"))) then
        error(QName("https://github.com/regionstockholm/intehrgrator/ns/helpers/blocks", "UNSUPPORTED"),
          "Unsupported math_on_list operator " || $op || " (RANDOM is not supported in generated code)")
      else if (empty($xs)) then ()
      else if ($op eq "MIN") then min($xs)
      else if ($op eq "MAX") then max($xs)
      else if ($op eq "AVERAGE") then igbk:finite(sum($xs) div count($xs))
      else if ($op eq "MEDIAN") then
        let $s := igbk:merge-sort($xs, igbk:cmp-num#2)
        let $mid := count($s) idiv 2
        return if (count($s) mod 2 eq 1) then $s[$mid + 1] else ($s[$mid] + $s[$mid + 1]) div 2
      else
        let $mean := sum($xs) div count($xs)
        return igbk:finite(math:sqrt(sum(for $x in $xs return ($x - $mean) * ($x - $mean)) div count($xs)))
  else if ($name eq "lists_isEmpty") then empty(igbk:items(igbk:arg($a, 1)))
  else if ($name eq "lists_indexOf") then
    let $items := igbk:items(igbk:arg($a, 1))
    let $find := igbk:arg($a, 2)
    let $hits := for $item at $i in $items where igbk:same($item, $find) return $i
    return if (empty($hits)) then 0
      else if (igbk:text(igbk:arg($a, 3)) eq "LAST") then $hits[last()] else $hits[1]
  else if ($name eq "lists_getSublist") then
    let $items := igbk:items(igbk:arg($a, 1))
    let $r := igbk:range(count($items), $a, 2)
    return subsequence($items, $r[1] + 1, $r[2] - $r[1])
  else if ($name eq "lists_reverse") then reverse(igbk:items(igbk:arg($a, 1)))
  else if ($name eq "lists_sort") then
    let $type := igbk:text(igbk:arg($a, 2))
    let $dir := if (igbk:num(igbk:arg($a, 3)) lt 0) then -1 else 1
    let $cmp := if ($type eq "TEXT") then function($x, $y) { $dir * igbk:cmp-text(igbk:text($x), igbk:text($y)) }
      else if ($type eq "IGNORE_CASE") then
        function($x, $y) { $dir * igbk:cmp-text(lower-case(igbk:text($x)), lower-case(igbk:text($y))) }
      else function($x, $y) { $dir * igbk:cmp-num(igbk:num($x), igbk:num($y)) }
    return igbk:merge-sort(igbk:items(igbk:arg($a, 1)), $cmp)
  else if ($name eq "lists_split") then
    let $delim := igbk:text(igbk:arg($a, 3))
    return if (igbk:text(igbk:arg($a, 1)) eq "JOIN")
      then string-join(for $x in igbk:items(igbk:arg($a, 2)) return igbk:text($x), $delim)
      else let $t := igbk:text(igbk:arg($a, 2))
        return if ($delim eq "") then (for $cp in string-to-codepoints($t) return codepoints-to-string($cp))
          else if ($t eq "") then ""
          else tokenize($t, replace($delim, "([.\\?*+{}()|^$\[\]\-])", "\\$1"))
  else if ($name eq "power") then igbk:finite(math:pow(igbk:num(igbk:arg($a, 1)), igbk:num(igbk:arg($a, 2))))
  else if ($name eq "round_up") then igbk:finite(ceiling(igbk:num(igbk:arg($a, 1))))
  else if ($name eq "round_down") then igbk:finite(floor(igbk:num(igbk:arg($a, 1))))
  else error(QName("https://github.com/regionstockholm/intehrgrator/ns/helpers/blocks", "UNKNOWN"),
    "Unknown Blockly op " || $name)
};
