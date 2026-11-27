// Go text/template executor compiled to WASM (GOOS=js GOARCH=wasm).
//
// JS API after wasm_exec.js + instantiate:
//
//	goTextTemplateExecute(templateSource: string, dataJson: string) → JSON string
//	{ ok: boolean, output?: string, error?: string }
//	goTextTemplateCheck(templateSource: string) → JSON string
//	{ ok: boolean, diagnostics?: [{ message: string }] }
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall/js"
	"text/template"
	"text/template/parse"
)

func main() {
	js.Global().Set("goTextTemplateExecute", js.FuncOf(execute))
	js.Global().Set("goTextTemplateCheck", js.FuncOf(check))
	js.Global().Set("goTextTemplateReady", js.ValueOf(true))
	select {}
}

func execute(_ js.Value, args []js.Value) any {
	if len(args) < 2 {
		return marshalResult(false, "", "goTextTemplateExecute(template, dataJson[, sheetsJson]) requires 2 arguments")
	}
	source := args[0].String()
	dataJSON := args[1].String()
	sheetsJSON := "{}"
	if len(args) >= 3 && args[2].Type() == js.TypeString && args[2].String() != "" {
		sheetsJSON = args[2].String()
	}
	if diags := checkSource(source); len(diags) > 0 {
		return marshalResult(false, "", diags[0].Message)
	}
	output, err := render(source, dataJSON, sheetsJSON)
	if err != nil {
		return marshalResult(false, "", err.Error())
	}
	return marshalResult(true, output, "")
}

func check(_ js.Value, args []js.Value) any {
	if len(args) < 1 {
		return marshalCheck(false, []diagnostic{{Message: "goTextTemplateCheck(template) requires 1 argument"}})
	}
	diags := checkSource(args[0].String())
	return marshalCheck(len(diags) == 0, diags)
}

type diagnostic struct {
	Message string `json:"message"`
}

func checkSource(source string) []diagnostic {
	var diags []diagnostic
	if reBlockAction.MatchString(source) {
		diags = append(diags, diagnostic{
			Message: "VMS-Go forbids {{block}} (unverified / not in declarative export)",
		})
	}
	trees, err := parse.Parse("mapping", source, "{{", "}}", parseFuncMaps()...)
	if err != nil {
		return append(diags, diagnostic{Message: fmt.Sprintf("Go template parse error: %v", err)})
	}
	calls := map[string][]string{}
	for name, tree := range trees {
		if tree == nil || tree.Root == nil {
			continue
		}
		walkNode(tree.Root, &diags, calls, name)
	}
	if cycle := findTemplateCycle(calls); cycle != "" {
		diags = append(diags, diagnostic{Message: cycle})
	}
	return diags
}

var reBlockAction = regexp.MustCompile(`\{\{[\s\-]*block\b`)

/** Func maps so identifiers parse; walk rejects forbidden ones. */
func parseFuncMaps() []map[string]any {
	allowed := map[string]any{}
	for name, fn := range funcMap() {
		allowed[name] = fn
	}
	for _, name := range []string{
		"and", "or", "not", "eq", "ne", "lt", "le", "gt", "ge", "index", "len",
	} {
		allowed[name] = true
	}
	// Include hostile builtins so they parse into IdentifierNodes we can reject.
	forbidden := map[string]any{}
	for name := range vmsGoForbiddenIdents {
		forbidden[name] = true
	}
	return []map[string]any{allowed, forbidden}
}

var vmsGoAllowedIdents = map[string]bool{
	"and": true, "or": true, "not": true,
	"eq": true, "ne": true, "lt": true, "le": true, "gt": true, "ge": true,
	"index": true, "len": true,
	"replace": true, "regexReplaceAll": true, "trim": true, "quote": true,
	"lower": true, "upper": true, "substr": true, "int": true,
	"handlebars": true, "dict": true,
	"decisionTable": true, "sheetLookup": true,
	"toJson": true, "jget": true, "rmToXml": true, "rmToXmlFrag": true, "xmlEscape": true,
	"codedText": true, "codePhrase": true, "partyVal": true, "dvVal": true,
	"rmObj": true, "list": true, "toNum": true, "nonEmpty": true, "whenVal": true,
	"concat": true, "coalesce": true,
	"add": true, "sub": true, "mul": true, "div": true,
	"same": true, "cmpNum": true, "ifElse": true, "switchVal": true,
	"title": true, "round": true, "mod": true, "clamp": true,
	"listAt": true, "count": true, "text": true,
	"blk": true,
}

var vmsGoForbiddenIdents = map[string]bool{
	"call": true, "html": true, "js": true, "urlquery": true,
	"print": true, "printf": true, "println": true, "slice": true,
	"include": true, "break": true, "continue": true,
}

func walkNode(node parse.Node, diags *[]diagnostic, calls map[string][]string, tmplName string) {
	if node == nil {
		return
	}
	switch n := node.(type) {
	case *parse.ListNode:
		for _, child := range n.Nodes {
			walkNode(child, diags, calls, tmplName)
		}
	case *parse.ActionNode:
		walkPipe(n.Pipe, diags, calls, tmplName)
	case *parse.IfNode:
		walkBranch(&n.BranchNode, diags, calls, tmplName)
	case *parse.RangeNode:
		walkBranch(&n.BranchNode, diags, calls, tmplName)
	case *parse.WithNode:
		*diags = append(*diags, diagnostic{
			Message: "VMS-Go forbids {{with}} (unverified / not in declarative export)",
		})
		walkBranch(&n.BranchNode, diags, calls, tmplName)
	case *parse.TemplateNode:
		if n.Name == "" {
			*diags = append(*diags, diagnostic{
				Message: "VMS-Go requires literal template names",
			})
		} else {
			calls[tmplName] = append(calls[tmplName], n.Name)
		}
		if n.Pipe != nil {
			walkPipe(n.Pipe, diags, calls, tmplName)
		}
	case *parse.BreakNode:
		*diags = append(*diags, diagnostic{
			Message: "VMS-Go forbids {{break}} (unverified / not in declarative export)",
		})
	case *parse.ContinueNode:
		*diags = append(*diags, diagnostic{
			Message: "VMS-Go forbids {{continue}} (unverified / not in declarative export)",
		})
	}
}

func walkBranch(n *parse.BranchNode, diags *[]diagnostic, calls map[string][]string, tmplName string) {
	if n.Pipe != nil {
		walkPipe(n.Pipe, diags, calls, tmplName)
	}
	if n.List != nil {
		walkNode(n.List, diags, calls, tmplName)
	}
	if n.ElseList != nil {
		walkNode(n.ElseList, diags, calls, tmplName)
	}
}

func walkPipe(pipe *parse.PipeNode, diags *[]diagnostic, calls map[string][]string, tmplName string) {
	if pipe == nil {
		return
	}
	for _, decl := range pipe.Decl {
		if decl != nil && pipe.IsAssign {
			*diags = append(*diags, diagnostic{
				Message: "VMS-Go forbids $name = reassignment (use := once inside define)",
			})
		}
	}
	for _, cmd := range pipe.Cmds {
		if cmd == nil || len(cmd.Args) == 0 {
			continue
		}
		if id, ok := cmd.Args[0].(*parse.IdentifierNode); ok {
			name := id.Ident
			if vmsGoForbiddenIdents[name] {
				*diags = append(*diags, diagnostic{
					Message: fmt.Sprintf("VMS-Go forbids %q (unverified / not in declarative export)", name),
				})
			} else if !vmsGoAllowedIdents[name] {
				*diags = append(*diags, diagnostic{
					Message: fmt.Sprintf("VMS-Go forbids unknown function %q (unverified / not in declarative export)", name),
				})
			}
		}
		for _, arg := range cmd.Args[1:] {
			walkArg(arg, diags, calls, tmplName)
		}
	}
}

func walkArg(arg parse.Node, diags *[]diagnostic, calls map[string][]string, tmplName string) {
	switch a := arg.(type) {
	case *parse.PipeNode:
		walkPipe(a, diags, calls, tmplName)
	case *parse.CommandNode:
		for _, child := range a.Args {
			walkArg(child, diags, calls, tmplName)
		}
	}
}

func findTemplateCycle(calls map[string][]string) string {
	const (
		white = 0
		gray  = 1
		black = 2
	)
	color := map[string]int{}
	var stack []string
	var dfs func(string) string
	dfs = func(n string) string {
		color[n] = gray
		stack = append(stack, n)
		for _, m := range calls[n] {
			switch color[m] {
			case white:
				if msg := dfs(m); msg != "" {
					return msg
				}
			case gray:
				return fmt.Sprintf("VMS-Go forbids cyclic define/template graph involving %q", m)
			}
		}
		stack = stack[:len(stack)-1]
		color[n] = black
		return ""
	}
	for n := range calls {
		if color[n] == white {
			if msg := dfs(n); msg != "" {
				return msg
			}
		}
	}
	// Also start from nodes that only appear as callees.
	for _, callees := range calls {
		for _, m := range callees {
			if color[m] == white {
				if msg := dfs(m); msg != "" {
					return msg
				}
			}
		}
	}
	return ""
}

func render(source, dataJSON, sheetsJSON string) (string, error) {
	var data any
	if err := json.Unmarshal([]byte(dataJSON), &data); err != nil {
		return "", fmt.Errorf("data JSON: %w", err)
	}
	sheets := map[string]any{}
	if strings.TrimSpace(sheetsJSON) != "" && sheetsJSON != "null" {
		if err := json.Unmarshal([]byte(sheetsJSON), &sheets); err != nil {
			return "", fmt.Errorf("sheets JSON: %w", err)
		}
		if sheets == nil {
			sheets = map[string]any{}
		}
	}
	tmpl, err := template.New("mapping").Option("missingkey=zero").Funcs(funcMapWithSheets(sheets)).Parse(source)
	if err != nil {
		return "", fmt.Errorf("parse: %w", err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("execute: %w", err)
	}
	return buf.String(), nil
}

func funcMap() template.FuncMap {
	return funcMapWithSheets(nil)
}

func funcMapWithSheets(sheets map[string]any) template.FuncMap {
	return template.FuncMap{
		"replace": func(old, new, src string) string {
			return strings.ReplaceAll(src, old, new)
		},
		// Sprig/Helm: regexReplaceAll REGEX SRC REPLACEMENT (not pipeline-last).
		// Chemo PROD `cleanAndQuoteFreeTextInput` calls it this way.
		"regexReplaceAll": func(pattern, src, repl string) string {
			re, err := regexp.Compile(pattern)
			if err != nil {
				return src
			}
			return re.ReplaceAllString(src, repl)
		},
		"trim": strings.TrimSpace,
		"quote": func(v any) string {
			return strconv.Quote(fmt.Sprint(v))
		},
		"lower": func(v any) string {
			return strings.ToLower(fmt.Sprint(v))
		},
		"upper": func(v any) string {
			return strings.ToUpper(fmt.Sprint(v))
		},
		"substr": func(start, end int, src string) string {
			if start < 0 {
				start = 0
			}
			if start > len(src) {
				return ""
			}
			if end > len(src) {
				end = len(src)
			}
			if end < start {
				return ""
			}
			return src[start:end]
		},
		"int": toInt,
		"dict": func(values ...any) map[string]any {
			m := make(map[string]any, len(values)/2)
			for i := 0; i+1 < len(values); i += 2 {
				m[fmt.Sprint(values[i])] = values[i+1]
			}
			return m
		},
		"handlebars": func(template string, context any) (string, error) {
			fn := js.Global().Get("goTextTemplateHandlebars")
			if fn.Type() != js.TypeFunction {
				return "", fmt.Errorf("VMS-Hbs handlebars() requires goTextTemplateHandlebars host callback")
			}
			if context == nil {
				context = map[string]any{}
			}
			raw, err := json.Marshal(context)
			if err != nil {
				return "", err
			}
			result := fn.Invoke(template, string(raw))
			if result.Type() != js.TypeString {
				return "", fmt.Errorf("goTextTemplateHandlebars must return a string")
			}
			return result.String(), nil
		},
		"decisionTable": func(name any, inputs any, outputCol any) (any, error) {
			return hostSheetCall("goTextTemplateDecisionTable", sheets, name, inputs, outputCol)
		},
		"sheetLookup": func(name any, matchCol any, matchVal any, returnCol any) (any, error) {
			return hostSheetCall("goTextTemplateSheetLookup", sheets, name, matchCol, matchVal, returnCol)
		},
		"toJson": func(v any) (string, error) {
			b, err := json.Marshal(v)
			if err != nil {
				return "null", err
			}
			return string(b), nil
		},
		"jget": jgetHelper,
		"xmlEscape": func(v any) string {
			if v == nil {
				return ""
			}
			return escapeXmlText(fmt.Sprint(v))
		},
		"rmToXml": rmToXmlHelper,
		"rmToXmlFrag": func(tag string, v any) string {
			var b strings.Builder
			writeRmXmlNode(&b, tag, v, false, 1)
			return b.String()
		},
		"codedText":  codedTextHelper,
		"codePhrase": codePhraseHelper,
		"partyVal":   partyValHelper,
		"dvVal":      dvValHelper,
		"rmObj":      rmObjHelper,
		"list":       listHelper,
		"toNum":      toNumHelper,
		"nonEmpty":   nonEmptyHelper,
		"whenVal": func(cond any, val any) any {
			if b, ok := cond.(bool); ok {
				if b {
					return val
				}
				return nil
			}
			if nonEmptyHelper(cond) {
				return val
			}
			return nil
		},
		"concat": func(values ...any) string {
			var b strings.Builder
			for _, v := range values {
				if v != nil {
					b.WriteString(fmt.Sprint(v))
				}
			}
			return b.String()
		},
		"coalesce": func(values ...any) any {
			for _, v := range values {
				if nonEmptyHelper(v) {
					return v
				}
			}
			return nil
		},
		"add": func(a, b any) float64 { return toFloat(a) + toFloat(b) },
		"sub": func(a, b any) float64 { return toFloat(a) - toFloat(b) },
		"mul": func(a, b any) float64 { return toFloat(a) * toFloat(b) },
		"div": func(a, b any) float64 {
			d := toFloat(b)
			if d == 0 {
				return 0
			}
			return toFloat(a) / d
		},
		// TypeScript-parity helpers for Blockly constructs (see go_template*.ts).
		"same":   sameHelper,
		"cmpNum": cmpNumHelper,
		"ifElse": func(cond, t, f any) any {
			if jsTruthy(cond) {
				return t
			}
			return f
		},
		"switchVal": switchValHelper,
		"title":     titleHelper,
		"round": func(v any) any {
			f, ok := numOf(v)
			if !ok {
				return nil
			}
			return math.Floor(f + 0.5)
		},
		"mod": func(a, b any) any {
			x, okA := numOf(a)
			y, okB := numOf(b)
			if !okA || !okB || y == 0 {
				return nil
			}
			return math.Mod(x, y)
		},
		"clamp": func(v, lo, hi any) any {
			return math.Min(toFloat(hi), math.Max(toFloat(lo), toFloat(v)))
		},
		"listAt": listAtHelper,
		"count":  func(v any) int { return len(asListHelper(v)) },
		"text":   textHelper,
		"blk":    blkHelper,
	}
}

// numOf is JavaScript Number(v) without NaN: ok=false where JS gives NaN.
func numOf(v any) (float64, bool) {
	switch n := v.(type) {
	case nil:
		return 0, true
	case bool:
		if n {
			return 1, true
		}
		return 0, true
	case string:
		s := strings.TrimSpace(n)
		if s == "" {
			return 0, true
		}
		f, err := strconv.ParseFloat(s, 64)
		return f, err == nil
	case float64, float32, int, int64, json.Number:
		return toFloat(n), true
	default:
		return 0, false
	}
}

func isNumber(v any) bool {
	switch v.(type) {
	case float64, float32, int, int64, json.Number:
		return true
	}
	return false
}

// sameHelper mirrors TypeScript sameItem: strict equality, numbers by value,
// objects and lists by JSON.
func sameHelper(a, b any) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	if isNumber(a) && isNumber(b) {
		return toFloat(a) == toFloat(b)
	}
	switch a.(type) {
	case map[string]any, []any:
		ja, errA := json.Marshal(a)
		jb, errB := json.Marshal(b)
		return errA == nil && errB == nil && bytes.Equal(ja, jb)
	}
	switch x := a.(type) {
	case string:
		y, ok := b.(string)
		return ok && x == y
	case bool:
		y, ok := b.(bool)
		return ok && x == y
	}
	return false
}

// cmpNumHelper mirrors TypeScript `Number(a) < Number(b)` (NaN compares false).
func cmpNumHelper(op string, a, b any) bool {
	x, okA := numOf(a)
	y, okB := numOf(b)
	if !okA || !okB {
		return false
	}
	switch op {
	case "lt":
		return x < y
	case "le":
		return x <= y
	case "gt":
		return x > y
	case "ge":
		return x >= y
	}
	return false
}

// jsTruthy is JavaScript truthiness (empty lists and maps are truthy).
func jsTruthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64, float32, int, int64, json.Number:
		f := toFloat(x)
		return f != 0 && !math.IsNaN(f)
	}
	return true
}

func switchValHelper(d any, rest ...any) any {
	if len(rest) == 0 {
		return nil
	}
	def := rest[len(rest)-1]
	pairs := rest[:len(rest)-1]
	for i := 0; i+1 < len(pairs); i += 2 {
		if sameHelper(d, pairs[i]) {
			return pairs[i+1]
		}
	}
	return def
}

var titleWord = regexp.MustCompile(`\S+`)

func titleHelper(v any) string {
	s := ""
	if v != nil {
		s = fmt.Sprint(v)
	}
	return titleWord.ReplaceAllStringFunc(s, func(w string) string {
		r := []rune(strings.ToLower(w))
		if len(r) == 0 {
			return w
		}
		return strings.ToUpper(string(r[0])) + string(r[1:])
	})
}

func asListHelper(v any) []any {
	switch x := v.(type) {
	case nil:
		return nil
	case []any:
		return x
	}
	return []any{v}
}

// listAtHelper mirrors TypeScript listGetIndex (1-based positions).
func listAtHelper(items any, where string, at any) any {
	list := asListHelper(items)
	n := int(toFloat(at))
	idx := n - 1
	switch where {
	case "FIRST":
		idx = 0
	case "LAST":
		idx = len(list) - 1
	case "FROM_END":
		idx = len(list) - n
	}
	if idx < 0 || idx >= len(list) {
		return nil
	}
	return list[idx]
}

// textHelper prints a value in a text document: nil is empty, lists and maps are JSON.
func textHelper(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case map[string]any, []any:
		b, err := json.Marshal(x)
		if err != nil {
			return ""
		}
		return string(b)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	}
	return fmt.Sprint(v)
}

func nonEmptyHelper(v any) bool {
	if v == nil {
		return false
	}
	switch x := v.(type) {
	case string:
		return strings.TrimSpace(x) != ""
	case []any:
		return len(x) > 0
	case map[string]any:
		return len(x) > 0
	case bool:
		return true
	default:
		return true
	}
}

func toFloat(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case json.Number:
		f, _ := n.Float64()
		return f
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(n), 64)
		return f
	default:
		f, _ := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(v)), 64)
		return f
	}
}

func toNumHelper(v any) any {
	if v == nil {
		return nil
	}
	switch n := v.(type) {
	case float64, float32, int, int64:
		return n
	case json.Number:
		if f, err := n.Float64(); err == nil {
			return f
		}
		return nil
	case string:
		s := strings.TrimSpace(n)
		if s == "" {
			return nil
		}
		if f, err := strconv.ParseFloat(s, 64); err == nil {
			return f
		}
		return nil
	default:
		return nil
	}
}

func jgetHelper(root any, path ...any) any {
	cur := root
	for _, seg := range path {
		if cur == nil {
			return nil
		}
		switch node := cur.(type) {
		case map[string]any:
			cur = node[fmt.Sprint(seg)]
		case []any:
			idx, ok := segToIndex(seg)
			if !ok || idx < 0 || idx >= len(node) {
				return nil
			}
			cur = node[idx]
		default:
			return nil
		}
	}
	return cur
}

func segToIndex(seg any) (int, bool) {
	switch v := seg.(type) {
	case int:
		return v, true
	case int64:
		return int(v), true
	case float64:
		return int(v), true
	case string:
		i, err := strconv.Atoi(strings.TrimSpace(v))
		return i, err == nil
	default:
		return 0, false
	}
}

func listHelper(items ...any) []any {
	out := make([]any, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		if sub, ok := item.([]any); ok {
			for _, x := range sub {
				if x != nil {
					out = append(out, x)
				}
			}
			continue
		}
		out = append(out, item)
	}
	return out
}

func rmObjHelper(pairs ...any) any {
	m := make(map[string]any, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		k := fmt.Sprint(pairs[i])
		v := pairs[i+1]
		if v == nil {
			continue
		}
		if arr, ok := v.([]any); ok && len(arr) == 0 {
			continue
		}
		m[k] = v
	}
	t, _ := m["_type"].(string)
	switch t {
	case "ELEMENT":
		if _, ok := m["value"]; !ok {
			return nil
		}
	case "ITEM_TREE", "SECTION":
		if _, ok := m["items"]; !ok {
			return nil
		}
	case "EVENT", "POINT_EVENT", "INTERVAL_EVENT":
		if _, ok := m["data"]; !ok {
			return nil
		}
	case "ACTIVITY":
		if _, ok := m["description"]; !ok {
			return nil
		}
	case "HISTORY":
		if _, ok := m["events"]; !ok {
			return nil
		}
	case "OBSERVATION":
		if _, ok := m["data"]; !ok {
			return nil
		}
	case "EVALUATION":
		if _, ok := m["data"]; !ok {
			return nil
		}
	case "INSTRUCTION":
		if _, ok := m["activities"]; !ok {
			return nil
		}
	case "ACTION":
		if _, ok := m["description"]; !ok {
			return nil
		}
	case "CLUSTER":
		if _, ok := m["items"]; !ok {
			return nil
		}
	}
	return m
}

func partyValHelper(val any, fallbackType string) any {
	if val == nil {
		if fallbackType == "PARTY_SELF" {
			return map[string]any{"_type": "PARTY_SELF"}
		}
		return nil
	}
	if m, ok := val.(map[string]any); ok {
		t, _ := m["_type"].(string)
		if t == "" {
			if fallbackType != "" {
				t = fallbackType
			} else {
				t = "PARTY_IDENTIFIED"
			}
		}
		out := map[string]any{"_type": t}
		for k, v := range m {
			if k == "_type" {
				continue
			}
			// Drop shorthand non-RM fields (e.g. `id` in defaults.composer) that fail strict RM deserialization.
			if t == "PARTY_IDENTIFIED" && k != "name" && k != "external_ref" && k != "identifiers" {
				continue
			}
			if t == "PARTY_SELF" && k != "external_ref" {
				continue
			}
			out[k] = v
		}
		return out
	}
	s := strings.TrimSpace(fmt.Sprint(val))
	if s == "" {
		if fallbackType == "PARTY_SELF" {
			return map[string]any{"_type": "PARTY_SELF"}
		}
		return nil
	}
	return map[string]any{"_type": "PARTY_IDENTIFIED", "name": s}
}

func codePhraseHelper(val any, terminology string) any {
	if val == nil {
		return nil
	}
	if m, ok := val.(map[string]any); ok {
		return m
	}
	s := strings.TrimSpace(fmt.Sprint(val))
	if s == "" {
		return nil
	}
	return map[string]any{
		"_type":          "CODE_PHRASE",
		"terminology_id": map[string]any{"_type": "TERMINOLOGY_ID", "value": terminology},
		"code_string":    s,
	}
}

func codedTextHelper(val any, terminology string, pairs ...string) any {
	if val == nil {
		return nil
	}
	if m, ok := val.(map[string]any); ok {
		return m
	}
	raw := strings.TrimSpace(fmt.Sprint(val))
	if raw == "" {
		return nil
	}
	lower := strings.ToLower(raw)
	for _, pair := range pairs {
		eqIdx := strings.IndexByte(pair, '=')
		if eqIdx <= 0 {
			continue
		}
		code := pair[:eqIdx]
		label := pair[eqIdx+1:]
		if lower == strings.ToLower(label) || lower == strings.ToLower(code) {
			return map[string]any{
				"_type": "DV_CODED_TEXT",
				"value": label,
				"defining_code": map[string]any{
					"_type":          "CODE_PHRASE",
					"terminology_id": map[string]any{"_type": "TERMINOLOGY_ID", "value": terminology},
					"code_string":    code,
				},
			}
		}
	}
	return map[string]any{
		"_type": "DV_CODED_TEXT",
		"value": raw,
		"defining_code": map[string]any{
			"_type":          "CODE_PHRASE",
			"terminology_id": map[string]any{"_type": "TERMINOLOGY_ID", "value": terminology},
			"code_string":    "",
		},
	}
}

func dvValHelper(rmType string, val any, prop string, extra ...any) any {
	if val == nil {
		return nil
	}
	if m, ok := val.(map[string]any); ok {
		return m
	}
	var outVal any = val
	switch rmType {
	case "DV_QUANTITY", "DV_COUNT", "DV_ORDINAL", "DV_PROPORTION":
		num := toNumHelper(val)
		if num == nil {
			return nil
		}
		outVal = num
	case "DV_BOOLEAN":
		switch b := val.(type) {
		case bool:
			outVal = b
		case string:
			l := strings.ToLower(strings.TrimSpace(b))
			if l == "true" || l == "1" {
				outVal = true
			} else if l == "false" || l == "0" {
				outVal = false
			} else {
				return nil
			}
		default:
			outVal = nonEmptyHelper(val)
		}
	default:
		s := fmt.Sprint(val)
		if strings.TrimSpace(s) == "" {
			return nil
		}
		outVal = s
	}
	m := map[string]any{
		"_type": rmType,
		prop:    outVal,
	}
	for i := 0; i+1 < len(extra); i += 2 {
		k := fmt.Sprint(extra[i])
		v := extra[i+1]
		if v != nil {
			m[k] = v
		}
	}
	return m
}

func escapeXmlText(s string) string {
	r := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&apos;",
	)
	return r.Replace(s)
}

func rmToXmlHelper(tag string, v any) (string, error) {
	if s, ok := v.(string); ok {
		trimmed := strings.TrimSpace(s)
		if strings.HasPrefix(trimmed, "{") {
			var parsed any
			if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
				v = parsed
			}
		}
	}
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	writeRmXmlNode(&b, tag, v, true, 0)
	return b.String(), nil
}

func writeRmXmlNode(b *strings.Builder, tag string, v any, isRoot bool, depth int) {
	if v == nil {
		return
	}
	if arr, ok := v.([]any); ok {
		for _, item := range arr {
			writeRmXmlNode(b, tag, item, isRoot, depth)
		}
		return
	}
	indent := strings.Repeat("  ", depth)
	if m, ok := v.(map[string]any); ok {
		b.WriteString(indent)
		b.WriteByte('<')
		b.WriteString(tag)
		if isRoot {
			b.WriteString(` xmlns="http://schemas.openehr.org/v1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`)
		}
		if t, ok := m["_type"].(string); ok && t != "" {
			b.WriteString(` xsi:type="`)
			b.WriteString(escapeXmlText(t))
			b.WriteByte('"')
		}
		if nid, ok := m["archetype_node_id"].(string); ok && nid != "" {
			b.WriteString(` archetype_node_id="`)
			b.WriteString(escapeXmlText(nid))
			b.WriteByte('"')
		}
		keys := make([]string, 0, len(m))
		for k := range m {
			if k == "_type" || k == "archetype_node_id" {
				continue
			}
			keys = append(keys, k)
		}
		sort.Strings(keys)
		hasChild := false
		for _, k := range keys {
			val := m[k]
			if val == nil {
				continue
			}
			if arr, ok := val.([]any); ok && len(arr) == 0 {
				continue
			}
			if !hasChild {
				b.WriteString(">\n")
				hasChild = true
			}
			if k == "terminology_id" {
				if _, isMap := val.(map[string]any); !isMap {
					val = map[string]any{"_type": "TERMINOLOGY_ID", "value": fmt.Sprint(val)}
				}
			}
			writeRmXmlNode(b, k, val, false, depth+1)
		}
		if hasChild {
			b.WriteString(indent)
			b.WriteString("</")
			b.WriteString(tag)
			b.WriteString(">\n")
		} else {
			b.WriteString("/>\n")
		}
		return
	}
	b.WriteString(indent)
	b.WriteByte('<')
	b.WriteString(tag)
	b.WriteByte('>')
	b.WriteString(escapeXmlText(fmt.Sprint(v)))
	b.WriteString("</")
	b.WriteString(tag)
	b.WriteString(">\n")
}

func hostSheetCall(fnName string, sheets map[string]any, name any, args ...any) (any, error) {
	fn := js.Global().Get(fnName)
	if fn.Type() != js.TypeFunction {
		return "", fmt.Errorf("%s host callback is not registered", fnName)
	}
	key := fmt.Sprint(name)
	var sheet any
	if sheets != nil {
		sheet = sheets[key]
	}
	sheetJSON, err := json.Marshal(sheet)
	if err != nil {
		return "", err
	}
	payload := make([]any, 0, 1+len(args))
	payload = append(payload, string(sheetJSON))
	for _, arg := range args {
		raw, marshalErr := json.Marshal(arg)
		if marshalErr != nil {
			return "", marshalErr
		}
		payload = append(payload, string(raw))
	}
	jsArgs := make([]any, len(payload))
	copy(jsArgs, payload)
	result := fn.Invoke(jsArgs...)
	return parseHostValue(result)
}

func parseHostValue(result js.Value) (any, error) {
	if result.Type() != js.TypeString {
		return nil, fmt.Errorf("sheet host callback must return a JSON string")
	}
	var payload struct {
		Ok    bool   `json:"ok"`
		Value any    `json:"value"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(result.String()), &payload); err != nil {
		return nil, err
	}
	if !payload.Ok {
		if payload.Error == "" {
			return nil, fmt.Errorf("sheet host callback failed")
		}
		return nil, fmt.Errorf("%s", payload.Error)
	}
	if payload.Value == nil {
		return "", nil
	}
	return payload.Value, nil
}

func toInt(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	case string:
		i, _ := strconv.Atoi(strings.TrimSpace(n))
		return i
	default:
		i, _ := strconv.Atoi(fmt.Sprint(v))
		return i
	}
}

func marshalResult(ok bool, output, errMsg string) string {
	payload := map[string]any{"ok": ok, "output": output}
	if errMsg != "" {
		payload["error"] = errMsg
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return `{"ok":false,"error":"marshal failed"}`
	}
	return string(b)
}

func marshalCheck(ok bool, diags []diagnostic) string {
	payload := map[string]any{"ok": ok, "diagnostics": diags}
	b, err := json.Marshal(payload)
	if err != nil {
		return `{"ok":false,"diagnostics":[{"message":"marshal failed"}]}`
	}
	return string(b)
}
