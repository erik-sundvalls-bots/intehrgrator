package main

// Blockly text, math and list blocks for Go Template (issue #393).
//
// `blk "name" args...` mirrors blocklyOp in
// src/core/codegen/helpers/blockly_ops.ts; the per-block parity test compares
// the two. Positions are 1-based like Blockly; a non-finite number gives nil.
// Text positions count code points (runes), as every other language does.

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// jsString is JavaScript String(v) for JSON values (nil gives "").
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case float32, int, int64, json.Number:
		return strconv.FormatFloat(toFloat(x), 'f', -1, 64)
	case []any:
		parts := make([]string, len(x))
		for i, item := range x {
			parts[i] = jsString(item)
		}
		return strings.Join(parts, ",")
	case map[string]any:
		return "[object Object]"
	}
	return fmt.Sprint(v)
}

// jsNum is JavaScript Number(v) (NaN where JavaScript gives NaN).
func jsNum(v any) float64 {
	if f, ok := numOf(v); ok {
		return f
	}
	return math.NaN()
}

// log10Exact is math.Log10 with exact powers of ten exact (Go gives
// 2.9999999999999996 for 1000; JavaScript, Java and XQuery give 3).
func log10Exact(x float64) float64 {
	r := math.Log10(x)
	if n := math.Round(r); n != r && math.Abs(n) < 300 && math.Pow(10, n) == x {
		return n
	}
	return r
}

func finiteOrNil(f float64) any {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return nil
	}
	if f == 0 {
		return 0.0
	}
	return f
}

func blkStart(where any, at any, n int) (int, error) {
	switch jsString(where) {
	case "FIRST":
		return 0, nil
	case "FROM_END":
		return n - int(math.Trunc(jsNum(at))), nil
	case "FROM_START":
		return int(math.Trunc(jsNum(at))) - 1, nil
	}
	return 0, fmt.Errorf("unsupported position %s (RANDOM is not supported in generated code)", jsString(where))
}

func blkEnd(where any, at any, n int) (int, error) {
	switch jsString(where) {
	case "LAST":
		return n, nil
	case "FROM_END":
		return n - int(math.Trunc(jsNum(at))) + 1, nil
	case "FROM_START":
		return int(math.Trunc(jsNum(at))), nil
	}
	return 0, fmt.Errorf("unsupported position %s", jsString(where))
}

func blkRange(n int, args []any) (int, int, error) {
	start, err := blkStart(argAt(args, 0), argAt(args, 1), n)
	if err != nil {
		return 0, 0, err
	}
	end, err := blkEnd(argAt(args, 2), argAt(args, 3), n)
	if err != nil {
		return 0, 0, err
	}
	if start < 0 {
		start = 0
	}
	if end > n {
		end = n
	}
	if end < start {
		end = start
	}
	return start, end, nil
}

func argAt(args []any, i int) any {
	if i < len(args) {
		return args[i]
	}
	return nil
}

func blkNumbers(v any) []float64 {
	out := []float64{}
	for _, item := range asListHelper(v) {
		switch x := item.(type) {
		case nil, bool:
			continue
		case string:
			if strings.TrimSpace(x) == "" {
				continue
			}
		}
		f, ok := numOf(item)
		if ok && !math.IsNaN(f) && !math.IsInf(f, 0) {
			out = append(out, f)
		}
	}
	return out
}

func isPrimeNum(f float64) bool {
	if f != math.Trunc(f) || f < 2 {
		return false
	}
	n := int64(f)
	if n < 4 {
		return true
	}
	if n%2 == 0 {
		return false
	}
	for i := int64(3); i*i <= n; i += 2 {
		if n%i == 0 {
			return false
		}
	}
	return true
}

func blkSum(xs []float64) float64 {
	s := 0.0
	for _, x := range xs {
		s += x
	}
	return s
}

func compareStrings(a, b string) int {
	if a < b {
		return -1
	}
	if a > b {
		return 1
	}
	return 0
}

// blkHelper evaluates one Blockly op (see BLOCKLY_OP_NAMES in blockly_ops.ts).
func blkHelper(name string, args ...any) (any, error) {
	a := func(i int) any { return argAt(args, i) }
	switch name {
	case "text_length":
		return float64(len([]rune(jsString(a(0))))), nil
	case "text_isEmpty":
		return jsString(a(0)) == "", nil
	case "text_indexOf":
		t := []rune(jsString(a(0)))
		f := []rune(jsString(a(1)))
		idx := -1
		if jsString(a(2)) == "LAST" {
			for i := len(t) - len(f); i >= 0; i-- {
				if string(t[i:i+len(f)]) == string(f) {
					idx = i
					break
				}
			}
		} else {
			for i := 0; i+len(f) <= len(t); i++ {
				if string(t[i:i+len(f)]) == string(f) {
					idx = i
					break
				}
			}
		}
		return float64(idx + 1), nil
	case "text_charAt":
		t := []rune(jsString(a(0)))
		var i int
		if jsString(a(1)) == "LAST" {
			i = len(t) - 1
		} else {
			var err error
			if i, err = blkStart(a(1), a(2), len(t)); err != nil {
				return nil, err
			}
		}
		if i < 0 || i >= len(t) {
			return "", nil
		}
		return string(t[i]), nil
	case "text_getSubstring":
		t := []rune(jsString(a(0)))
		s, e, err := blkRange(len(t), args[1:])
		if err != nil {
			return nil, err
		}
		return string(t[s:e]), nil
	case "math_single":
		x := jsNum(a(1))
		switch jsString(a(0)) {
		case "ROOT":
			return finiteOrNil(math.Sqrt(x)), nil
		case "ABS":
			return finiteOrNil(math.Abs(x)), nil
		case "NEG":
			return finiteOrNil(-x), nil
		case "LN":
			return finiteOrNil(math.Log(x)), nil
		case "LOG10":
			return finiteOrNil(log10Exact(x)), nil
		case "EXP":
			return finiteOrNil(math.Exp(x)), nil
		case "POW10":
			return finiteOrNil(math.Pow(10, x)), nil
		}
		return nil, fmt.Errorf("unsupported math_single operator %s", jsString(a(0)))
	case "math_number_property":
		n := jsNum(a(1))
		if math.IsNaN(n) || math.IsInf(n, 0) {
			return false, nil
		}
		switch jsString(a(0)) {
		case "EVEN":
			return math.Mod(n, 2) == 0, nil
		case "ODD":
			return math.Abs(math.Mod(n, 2)) == 1, nil
		case "PRIME":
			return isPrimeNum(n), nil
		case "WHOLE":
			return math.Mod(n, 1) == 0, nil
		case "POSITIVE":
			return n > 0, nil
		case "NEGATIVE":
			return n < 0, nil
		case "DIVISIBLE_BY":
			d := jsNum(a(2))
			return !math.IsNaN(d) && !math.IsInf(d, 0) && d != 0 && math.Mod(n, d) == 0, nil
		}
		return nil, fmt.Errorf("unsupported math_number_property %s", jsString(a(0)))
	case "math_on_list":
		xs := blkNumbers(a(1))
		op := jsString(a(0))
		switch op {
		case "SUM":
			return finiteOrNil(blkSum(xs)), nil
		case "MODE":
			counts := map[float64]int{}
			order := []float64{}
			top := 0
			for _, x := range xs {
				if counts[x] == 0 {
					order = append(order, x)
				}
				counts[x]++
				if counts[x] > top {
					top = counts[x]
				}
			}
			out := []any{}
			for _, x := range order {
				if counts[x] == top {
					out = append(out, x)
				}
			}
			return out, nil
		case "MIN", "MAX", "AVERAGE", "MEDIAN", "STD_DEV":
			if len(xs) == 0 {
				return nil, nil
			}
		default:
			return nil, fmt.Errorf("unsupported math_on_list operator %s (RANDOM is not supported in generated code)", op)
		}
		switch op {
		case "MIN":
			m := xs[0]
			for _, x := range xs {
				m = math.Min(m, x)
			}
			return m, nil
		case "MAX":
			m := xs[0]
			for _, x := range xs {
				m = math.Max(m, x)
			}
			return m, nil
		case "AVERAGE":
			return finiteOrNil(blkSum(xs) / float64(len(xs))), nil
		case "MEDIAN":
			s := append([]float64{}, xs...)
			sort.Float64s(s)
			mid := len(s) / 2
			if len(s)%2 == 1 {
				return s[mid], nil
			}
			return (s[mid-1] + s[mid]) / 2, nil
		}
		mean := blkSum(xs) / float64(len(xs))
		v := 0.0
		for _, x := range xs {
			v += (x - mean) * (x - mean)
		}
		return finiteOrNil(math.Sqrt(v / float64(len(xs)))), nil
	case "lists_isEmpty":
		return len(asListHelper(a(0))) == 0, nil
	case "lists_indexOf":
		items := asListHelper(a(0))
		if jsString(a(2)) == "LAST" {
			for i := len(items) - 1; i >= 0; i-- {
				if sameHelper(items[i], a(1)) {
					return float64(i + 1), nil
				}
			}
			return 0.0, nil
		}
		for i, item := range items {
			if sameHelper(item, a(1)) {
				return float64(i + 1), nil
			}
		}
		return 0.0, nil
	case "lists_getSublist":
		items := asListHelper(a(0))
		s, e, err := blkRange(len(items), args[1:])
		if err != nil {
			return nil, err
		}
		return append([]any{}, items[s:e]...), nil
	case "lists_reverse":
		items := asListHelper(a(0))
		out := make([]any, len(items))
		for i, item := range items {
			out[len(items)-1-i] = item
		}
		return out, nil
	case "lists_sort":
		out := append([]any{}, asListHelper(a(0))...)
		kind := jsString(a(1))
		dir := 1
		if jsNum(a(2)) < 0 {
			dir = -1
		}
		cmp := func(x, y any) int {
			switch kind {
			case "TEXT":
				return compareStrings(jsString(x), jsString(y))
			case "IGNORE_CASE":
				return compareStrings(strings.ToLower(jsString(x)), strings.ToLower(jsString(y)))
			}
			p, q := jsNum(x), jsNum(y)
			if p < q {
				return -1
			}
			if p > q {
				return 1
			}
			return 0
		}
		sort.SliceStable(out, func(i, j int) bool { return dir*cmp(out[i], out[j]) < 0 })
		return out, nil
	case "lists_split":
		delim := jsString(a(2))
		if jsString(a(0)) == "JOIN" {
			items := asListHelper(a(1))
			parts := make([]string, len(items))
			for i, item := range items {
				parts[i] = jsString(item)
			}
			return strings.Join(parts, delim), nil
		}
		parts := strings.Split(jsString(a(1)), delim)
		out := make([]any, len(parts))
		for i, p := range parts {
			out[i] = p
		}
		return out, nil
	case "power":
		return finiteOrNil(math.Pow(jsNum(a(0)), jsNum(a(1)))), nil
	case "round_up":
		return finiteOrNil(math.Ceil(jsNum(a(0)))), nil
	case "round_down":
		return finiteOrNil(math.Floor(jsNum(a(0)))), nil
	}
	return nil, fmt.Errorf("unknown Blockly op %s", name)
}
