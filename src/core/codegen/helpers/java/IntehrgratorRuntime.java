package se.regionstockholm.intehrgrator.runtime;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Static Java helpers for generated conversion scripts.
 *
 * {@code ConversionScript} imports only the members it calls. XPath and sheet
 * methods use {@link #bind(Object, Map)} so the mapping class stays short.
 * Compile this file once next to every generated script (Jackson is required
 * for the XPath methods).
 */
public class IntehrgratorRuntime {
  private Object sourceRoot;
  private Map<String, Sheet> sheets = Map.of();

  public void bind(Object source, Map<String, Sheet> sheets) {
    this.sourceRoot = unwrapExecuteEnvelope(source);
    this.sheets = sheets != null ? sheets : Map.of();
  }

  private static boolean isFlatBag(com.fasterxml.jackson.databind.JsonNode node) {
    if (node == null || !node.isObject()) return false;
    java.util.Iterator<String> names = node.fieldNames();
    while (names.hasNext()) {
      String key = names.next();
      if (key.contains("|") || key.contains("/")) return true;
    }
    return false;
  }

  /**
   * Production Go mappings execute `{ Parameters, Data }` where Data is openEHR FLAT.
   * Source paths use the FLAT keys, so read from Data, as Mapping preview does.
   */
  public Object unwrapExecuteEnvelope(Object source) {
    if (source == null) return null;
    com.fasterxml.jackson.databind.JsonNode tree = toJsonNode(source);
    if (tree.isObject() && isFlatBag(tree.get("Data"))) return tree.get("Data");
    return source;
  }

  /** `Parameters` of a `{ Parameters, Data }` envelope (what the app uses as the defaults map), or null. */
  @SuppressWarnings("unchecked")
  public Map<String, Object> executeEnvelopeParameters(Object source) {
    if (source == null) return null;
    com.fasterxml.jackson.databind.JsonNode tree = toJsonNode(source);
    if (!tree.isObject() || !isFlatBag(tree.get("Data"))) return null;
    com.fasterxml.jackson.databind.JsonNode params = tree.get("Parameters");
    return params != null && params.isObject() ? JSON.convertValue(params, Map.class) : null;
  }

  public static <T> T rm(T object, Consumer<T> init) {
    init.accept(object);
    return object;
  }

  public static String asString(Object value) {
    return value == null ? "" : String.valueOf(value);
  }

  public static double toDouble(Object value) {
    if (value instanceof Number n) return n.doubleValue();
    if (value == null) return 0d;
    try {
      return Double.parseDouble(String.valueOf(value));
    } catch (NumberFormatException e) {
      return 0d;
    }
  }

  /**
   * Truthiness as in Mapping preview (JavaScript): null, false, 0, NaN, "" and
   * an empty list are false; everything else, including the string "false", is true.
   */
  public static boolean asBoolean(Object value) {
    if (value instanceof Boolean b) return b;
    if (value == null) return false;
    if (value instanceof Number n) return n.doubleValue() != 0d && !Double.isNaN(n.doubleValue());
    if (value instanceof CharSequence text) return text.length() > 0;
    if (value instanceof java.util.Collection<?> list) return !list.isEmpty();
    if (value instanceof com.fasterxml.jackson.databind.JsonNode node) {
      if (node.isNull() || node.isMissingNode()) return false;
      if (node.isBoolean()) return node.asBoolean();
      if (node.isNumber()) return node.asDouble() != 0d && !Double.isNaN(node.asDouble());
      if (node.isTextual()) return !node.asText().isEmpty();
      if (node.isArray()) return node.size() > 0;
    }
    return true;
  }

  public static Object mapValueGet(Object value, Object key) {
    return value instanceof Map<?, ?> map ? map.get(asString(key)) : null;
  }

  public static List<Object> mapEntries(Object value) {
    List<Object> out = new ArrayList<>();
    if (value instanceof Map<?, ?> map) {
      for (Map.Entry<?, ?> entry : map.entrySet()) out.add(Arrays.asList(entry.getKey(), entry.getValue()));
    }
    return out;
  }

  public static List<Object> asList(Object value) {
    if (value instanceof List<?> list) return new ArrayList<>(list);
    if (value == null) return new ArrayList<>();
    return new ArrayList<>(List.of(value));
  }

  public static List<Object> appendList(Object list, Object value) {
    List<Object> result = asList(list);
    result.add(value);
    return result;
  }

  public static Object listGetIndex(Object value, String where, Object at) {
    List<Object> list = asList(value);
    int i = switch (where) {
      case "LAST" -> list.size() - 1;
      case "FROM_START" -> (int) toDouble(at) - 1;
      case "FROM_END" -> list.size() - (int) toDouble(at);
      default -> 0;
    };
    return i >= 0 && i < list.size() ? list.get(i) : null;
  }

  public static Object listGet(List<Object> list, Object index) {
    int i = (int) toDouble(index);
    if (i < 0 || i >= list.size()) return null;
    return list.get(i);
  }

  public static Map<String, Object> mapOf(Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i + 1 < kv.length; i += 2) m.put(asString(kv[i]), kv[i + 1]);
    return m;
  }

  public static boolean sameItem(Object a, Object b) {
    if (a instanceof Number x && b instanceof Number y) return Double.compare(x.doubleValue(), y.doubleValue()) == 0;
    return java.util.Objects.equals(a, b);
  }

  // --- Blockly text, math and list blocks (issue #393) ---------------------
  // Mirrors blocklyOp in src/core/codegen/helpers/blockly_ops.ts; the per-block
  // parity test compares the two. Positions are 1-based like Blockly; a number
  // result that is not finite gives null.

  private static Object blkPlain(Object v) {
    if (v instanceof com.fasterxml.jackson.databind.JsonNode node) {
      if (node.isNull() || node.isMissingNode()) return null;
      if (node.isNumber()) return node.doubleValue();
      if (node.isBoolean()) return node.booleanValue();
      if (node.isTextual()) return node.asText();
      if (node.isArray()) {
        List<Object> out = new ArrayList<>();
        node.forEach(item -> out.add(blkPlain(item)));
        return out;
      }
      return node.toString();
    }
    return v;
  }

  private static List<Object> blkList(Object v) {
    Object p = blkPlain(v);
    if (p instanceof List<?> list) return new ArrayList<>(list);
    if (p == null) return new ArrayList<>();
    return new ArrayList<>(List.of(p));
  }

  /** JavaScript String(v): null → "", whole numbers without ".0", lists joined with ",". */
  public static String jsString(Object v) {
    Object p = blkPlain(v);
    if (p == null) return "";
    if (p instanceof Number n) {
      double d = n.doubleValue();
      if (Double.isFinite(d) && d == Math.rint(d) && Math.abs(d) < 1e21) {
        return java.math.BigDecimal.valueOf(d).toBigInteger().toString();
      }
      if (Double.isNaN(d)) return "NaN";
      return java.math.BigDecimal.valueOf(d).stripTrailingZeros().toPlainString();
    }
    if (p instanceof List<?> list) {
      StringBuilder out = new StringBuilder();
      for (int i = 0; i < list.size(); i++) {
        if (i > 0) out.append(',');
        out.append(jsString(list.get(i)));
      }
      return out.toString();
    }
    if (p instanceof Map<?, ?>) return "[object Object]";
    return String.valueOf(p);
  }

  /** JavaScript Number(v) (NaN where JavaScript gives NaN). */
  public static double jsNumber(Object v) {
    Object p = blkPlain(v);
    if (p == null) return 0d;
    if (p instanceof Number n) return n.doubleValue();
    if (p instanceof Boolean b) return b ? 1d : 0d;
    String s = String.valueOf(p).trim();
    if (s.isEmpty()) return 0d;
    try {
      return Double.parseDouble(s);
    } catch (NumberFormatException e) {
      return Double.NaN;
    }
  }

  private static Object blkFinite(double d) {
    if (!Double.isFinite(d)) return null;
    return d == 0d ? 0d : d;
  }

  private static boolean blkSame(Object a, Object b) {
    Object x = blkPlain(a);
    Object y = blkPlain(b);
    if (x instanceof Number p && y instanceof Number q) return p.doubleValue() == q.doubleValue();
    return java.util.Objects.equals(x, y);
  }

  private static int blkStart(Object where, Object at, int len) {
    return switch (jsString(where)) {
      case "FIRST" -> 0;
      case "FROM_END" -> len - (int) jsNumber(at);
      case "FROM_START" -> (int) jsNumber(at) - 1;
      default -> throw new IllegalArgumentException(
          "Unsupported position " + jsString(where) + " (RANDOM is not supported in generated code)");
    };
  }

  private static int blkEnd(Object where, Object at, int len) {
    return switch (jsString(where)) {
      case "LAST" -> len;
      case "FROM_END" -> len - (int) jsNumber(at) + 1;
      case "FROM_START" -> (int) jsNumber(at);
      default -> throw new IllegalArgumentException("Unsupported position " + jsString(where));
    };
  }

  private static int[] blkRange(int len, Object[] a, int from) {
    int start = Math.max(0, blkStart(blkArg(a, from), blkArg(a, from + 1), len));
    int end = Math.min(len, blkEnd(blkArg(a, from + 2), blkArg(a, from + 3), len));
    return new int[] {start, Math.max(start, end)};
  }

  private static Object blkArg(Object[] a, int i) {
    return i < a.length ? a[i] : null;
  }

  private static List<Double> blkNumbers(Object v) {
    List<Double> out = new ArrayList<>();
    for (Object item : blkList(v)) {
      if (item == null || item instanceof Boolean) continue;
      if (item instanceof String s && s.trim().isEmpty()) continue;
      double d = jsNumber(item);
      if (Double.isFinite(d)) out.add(d);
    }
    return out;
  }

  private static boolean blkPrime(double n) {
    if (n != Math.rint(n) || n < 2) return false;
    long v = (long) n;
    if (v < 4) return true;
    if (v % 2 == 0) return false;
    for (long i = 3; i * i <= v; i += 2) if (v % i == 0) return false;
    return true;
  }

  private static List<String> blkCodePoints(String s) {
    List<String> out = new ArrayList<>();
    s.codePoints().forEach(cp -> out.add(new String(Character.toChars(cp))));
    return out;
  }

  /** One Blockly op; names as BLOCKLY_OP_NAMES in blockly_ops.ts. */
  public static Object blocklyOp(String name, Object... a) {
    switch (name) {
      case "text_length":
        return (double) jsString(blkArg(a, 0)).codePointCount(0, jsString(blkArg(a, 0)).length());
      case "text_isEmpty":
        return jsString(blkArg(a, 0)).isEmpty();
      case "text_indexOf": {
        List<String> t = blkCodePoints(jsString(blkArg(a, 0)));
        List<String> f = blkCodePoints(jsString(blkArg(a, 1)));
        int idx = "LAST".equals(jsString(blkArg(a, 2))) ? java.util.Collections.lastIndexOfSubList(t, f)
            : java.util.Collections.indexOfSubList(t, f);
        return (double) (idx + 1);
      }
      case "text_charAt": {
        List<String> t = blkCodePoints(jsString(blkArg(a, 0)));
        int i = "LAST".equals(jsString(blkArg(a, 1))) ? t.size() - 1 : blkStart(blkArg(a, 1), blkArg(a, 2), t.size());
        return i >= 0 && i < t.size() ? t.get(i) : "";
      }
      case "text_getSubstring": {
        List<String> t = blkCodePoints(jsString(blkArg(a, 0)));
        int[] r = blkRange(t.size(), a, 1);
        return String.join("", t.subList(r[0], r[1]));
      }
      case "math_single": {
        double x = jsNumber(blkArg(a, 1));
        return switch (jsString(blkArg(a, 0))) {
          case "ROOT" -> blkFinite(Math.sqrt(x));
          case "ABS" -> blkFinite(Math.abs(x));
          case "NEG" -> blkFinite(-x);
          case "LN" -> blkFinite(Math.log(x));
          case "LOG10" -> blkFinite(Math.log10(x));
          case "EXP" -> blkFinite(Math.exp(x));
          case "POW10" -> blkFinite(Math.pow(10, x));
          default -> throw new IllegalArgumentException("Unsupported math_single operator " + jsString(blkArg(a, 0)));
        };
      }
      case "math_number_property": {
        double n = jsNumber(blkArg(a, 1));
        if (!Double.isFinite(n)) return false;
        return switch (jsString(blkArg(a, 0))) {
          case "EVEN" -> n % 2 == 0;
          case "ODD" -> Math.abs(n % 2) == 1;
          case "PRIME" -> blkPrime(n);
          case "WHOLE" -> n % 1 == 0;
          case "POSITIVE" -> n > 0;
          case "NEGATIVE" -> n < 0;
          case "DIVISIBLE_BY" -> {
            double d = jsNumber(blkArg(a, 2));
            yield Double.isFinite(d) && d != 0 && n % d == 0;
          }
          default -> throw new IllegalArgumentException("Unsupported math_number_property " + jsString(blkArg(a, 0)));
        };
      }
      case "math_on_list": {
        List<Double> xs = blkNumbers(blkArg(a, 1));
        String op = jsString(blkArg(a, 0));
        double sum = 0;
        for (double x : xs) sum += x;
        switch (op) {
          case "SUM":
            return blkFinite(sum);
          case "MODE": {
            Map<Double, Integer> counts = new LinkedHashMap<>();
            for (double x : xs) counts.merge(x, 1, Integer::sum);
            int top = counts.values().stream().max(Integer::compare).orElse(0);
            List<Object> out = new ArrayList<>();
            counts.forEach((x, c) -> {
              if (c == top) out.add(x);
            });
            return out;
          }
          case "MIN", "MAX", "AVERAGE", "MEDIAN", "STD_DEV":
            if (xs.isEmpty()) return null;
            break;
          default:
            throw new IllegalArgumentException(
                "Unsupported math_on_list operator " + op + " (RANDOM is not supported in generated code)");
        }
        switch (op) {
          case "MIN":
            return xs.stream().min(Double::compare).get();
          case "MAX":
            return xs.stream().max(Double::compare).get();
          case "AVERAGE":
            return blkFinite(sum / xs.size());
          case "MEDIAN": {
            List<Double> s = new ArrayList<>(xs);
            java.util.Collections.sort(s);
            int mid = s.size() / 2;
            return s.size() % 2 == 1 ? s.get(mid) : (s.get(mid - 1) + s.get(mid)) / 2;
          }
          default: {
            double mean = sum / xs.size();
            double v = 0;
            for (double x : xs) v += (x - mean) * (x - mean);
            return blkFinite(Math.sqrt(v / xs.size()));
          }
        }
      }
      case "lists_isEmpty":
        return blkList(blkArg(a, 0)).isEmpty();
      case "lists_indexOf": {
        List<Object> items = blkList(blkArg(a, 0));
        Object find = blkArg(a, 1);
        if ("LAST".equals(jsString(blkArg(a, 2)))) {
          for (int i = items.size() - 1; i >= 0; i--) if (blkSame(items.get(i), find)) return (double) (i + 1);
          return 0d;
        }
        for (int i = 0; i < items.size(); i++) if (blkSame(items.get(i), find)) return (double) (i + 1);
        return 0d;
      }
      case "lists_getSublist": {
        List<Object> items = blkList(blkArg(a, 0));
        int[] r = blkRange(items.size(), a, 1);
        return new ArrayList<>(items.subList(r[0], r[1]));
      }
      case "lists_reverse": {
        List<Object> items = blkList(blkArg(a, 0));
        java.util.Collections.reverse(items);
        return items;
      }
      case "lists_sort": {
        List<Object> items = blkList(blkArg(a, 0));
        String type = jsString(blkArg(a, 1));
        int dir = jsNumber(blkArg(a, 2)) < 0 ? -1 : 1;
        java.util.Comparator<Object> cmp = switch (type) {
          case "TEXT" -> (x, y) -> Integer.signum(jsString(x).compareTo(jsString(y)));
          case "IGNORE_CASE" -> (x, y) -> Integer.signum(jsString(x).toLowerCase().compareTo(jsString(y).toLowerCase()));
          default -> (x, y) -> {
            double p = jsNumber(x);
            double q = jsNumber(y);
            return p < q ? -1 : p > q ? 1 : 0;
          };
        };
        items.sort((x, y) -> dir * cmp.compare(x, y));
        return items;
      }
      case "lists_split": {
        String delim = jsString(blkArg(a, 2));
        if ("JOIN".equals(jsString(blkArg(a, 0)))) {
          List<String> parts = new ArrayList<>();
          for (Object item : blkList(blkArg(a, 1))) parts.add(jsString(item));
          return String.join(delim, parts);
        }
        String input = jsString(blkArg(a, 1));
        if (delim.isEmpty()) return new ArrayList<Object>(blkCodePoints(input));
        return new ArrayList<Object>(Arrays.asList(input.split(java.util.regex.Pattern.quote(delim), -1)));
      }
      case "power":
        return blkFinite(Math.pow(jsNumber(blkArg(a, 0)), jsNumber(blkArg(a, 1))));
      case "round_up":
        return blkFinite(Math.ceil(jsNumber(blkArg(a, 0))));
      case "round_down":
        return blkFinite(Math.floor(jsNumber(blkArg(a, 0))));
      default:
        throw new IllegalArgumentException("Unknown Blockly op " + name);
    }
  }

  public static List<Object> setIntersection(List<Object> a, List<Object> b) {
    List<Object> out = new ArrayList<>();
    for (Object item : a) if (b.stream().anyMatch(other -> sameItem(item, other))) out.add(item);
    return out;
  }

  public static List<Object> setUnion(List<Object> a, List<Object> b) {
    List<Object> out = new ArrayList<>(a);
    for (Object item : b) if (out.stream().noneMatch(other -> sameItem(item, other))) out.add(item);
    return out;
  }

  public static List<Object> setDifference(List<Object> universe, List<Object> excluded) {
    List<Object> out = new ArrayList<>();
    for (Object item : universe) {
      if (excluded.stream().noneMatch(other -> sameItem(item, other))) out.add(item);
    }
    return out;
  }

  @SafeVarargs
  public static <T> List<T> flatten(Object... parts) {
    List<T> out = new ArrayList<>();
    for (Object part : parts) {
      if (part instanceof List<?> list) {
        for (Object item : list) if (item != null) out.add((T) item);
      } else if (part != null) {
        out.add((T) part);
      }
    }
    return out;
  }

  public String xpathString(String path) {
    return xpathString(path, sourceRoot);
  }

  public double xpathNumber(String path) {
    return xpathNumber(path, sourceRoot);
  }

  public boolean xpathBoolean(String path) {
    return xpathBoolean(path, sourceRoot);
  }

  public Object xpathNode(String path) {
    return xpathNode(path, sourceRoot);
  }

  public List<Object> xpathNodes(String path) {
    return xpathNodes(path, sourceRoot);
  }

  public String xpathString(String path, Object node) {
    if (path.trim().startsWith("/")) return xmlString(path, node);
    com.fasterxml.jackson.databind.JsonNode found = jsonAt(path, node);
    if (found == null || !found.isValueNode() || found.isNull()) return "";
    return found.isNumber() ? xmlText(found) : found.asText();
  }

  public double xpathNumber(String path, Object node) {
    if (path.trim().startsWith("/")) {
      try {
        return Double.parseDouble(xmlString(path, node));
      } catch (NumberFormatException e) {
        return 0d;
      }
    }
    com.fasterxml.jackson.databind.JsonNode found = jsonAt(path, node);
    if (found == null || found.isNull() || found.isMissingNode()) return 0d;
    if (found.isNumber()) return found.asDouble();
    if (found.isBoolean()) return found.asBoolean() ? 1d : 0d;
    try {
      return Double.parseDouble(found.asText());
    } catch (NumberFormatException e) {
      return 0d;
    }
  }

  /** As Mapping preview: a non-empty string, a non-zero number, a non-empty list or an object is true. */
  public boolean xpathBoolean(String path, Object node) {
    if (path.trim().startsWith("/")) return Boolean.parseBoolean(xmlString(path, node));
    com.fasterxml.jackson.databind.JsonNode found = jsonAt(path, node);
    if (found == null || found.isNull() || found.isMissingNode()) return false;
    if (found.isBoolean()) return found.asBoolean();
    if (found.isNumber()) return found.asDouble() != 0d && !Double.isNaN(found.asDouble());
    if (found.isTextual()) return !found.asText().isEmpty();
    if (found.isArray()) return found.size() > 0;
    return true;
  }

  public Object xpathNode(String path, Object node) {
    String trimmed = path.trim();
    if (trimmed.startsWith("/")) return xmlNode(path, node);
    if (trimmed.isEmpty() || trimmed.equals("$") || trimmed.equals(".")) return node;
    return jsonAt(path, node);
  }

  public List<Object> xpathNodes(String path, Object node) {
    Object found = xpathNode(path, node);
    if (found instanceof List<?> list) return new ArrayList<>(list);
    if (found instanceof com.fasterxml.jackson.databind.JsonNode jn && jn.isArray()) {
      List<Object> out = new ArrayList<>();
      jn.forEach(out::add);
      return out;
    }
    if (found == null || (found instanceof com.fasterxml.jackson.databind.JsonNode jn && jn.isMissingNode())) {
      return List.of();
    }
    return List.of(found);
  }

  private static final com.fasterxml.jackson.databind.ObjectMapper JSON =
    new com.fasterxml.jackson.databind.ObjectMapper();

  /**
   * Source JSON path steps as Mapping preview reads them: `.name`, `["name"]`,
   * `[N]` (1-based; 0 also means the first item) and `*` / `[*]` over a list.
   */
  static List<String> jsonSegments(String path) {
    String body = path.trim();
    if (body.startsWith("$source")) body = body.substring(7);
    else if (body.startsWith("$")) body = body.substring(1);
    if (body.startsWith(".") || body.startsWith("?")) body = body.substring(1);
    List<String> segs = new ArrayList<>();
    int i = 0;
    while (i < body.length()) {
      char ch = body.charAt(i);
      if (ch == '.' || ch == '?') {
        i++;
        continue;
      }
      if (ch == '*') {
        segs.add("*");
        i++;
        continue;
      }
      if (ch == '[') {
        int close = body.indexOf(']', i + 1);
        if (close < 0) break;
        String tok = body.substring(i + 1, close).trim();
        segs.add(tok.equals("*") ? "*" : tok.replaceAll("^[\"']|[\"']$", ""));
        i = close + 1;
        continue;
      }
      int end = i;
      while (end < body.length() && ".?[*".indexOf(body.charAt(end)) < 0) end++;
      if (end > i) segs.add(body.substring(i, end));
      i = end > i ? end : i + 1;
    }
    return segs;
  }

  private com.fasterxml.jackson.databind.JsonNode jsonAt(String path, Object node) {
    com.fasterxml.jackson.databind.JsonNode tree = toJsonNode(node);
    String trimmed = path.trim();
    if (trimmed.isEmpty() || trimmed.equals("$") || trimmed.equals(".") || trimmed.equals("$source")) return tree;
    // openEHR FLAT key (may hold "." as in "t.ex."): read it whole before splitting.
    if (trimmed.contains("/") && tree != null && tree.isObject() && tree.has(trimmed)) return tree.get(trimmed);
    return jsonWalk(tree, jsonSegments(trimmed), 0);
  }

  private static com.fasterxml.jackson.databind.JsonNode jsonWalk(
    com.fasterxml.jackson.databind.JsonNode cur, List<String> segs, int at
  ) {
    if (at >= segs.size()) return cur;
    if (cur == null) return null;
    String head = segs.get(at);
    if (head.equals("*")) {
      com.fasterxml.jackson.databind.node.ArrayNode out = JSON.createArrayNode();
      if (!cur.isArray()) return out;
      if (at + 1 == segs.size()) return cur;
      for (com.fasterxml.jackson.databind.JsonNode item : cur) {
        com.fasterxml.jackson.databind.JsonNode v = jsonWalk(item, segs, at + 1);
        if (v == null || v.isMissingNode() || v.isNull()) continue;
        if (v.isArray()) v.forEach(out::add);
        else out.add(v);
      }
      return out;
    }
    if (!head.isEmpty() && head.chars().allMatch(Character::isDigit)) {
      if (!cur.isArray()) return null;
      int n = Integer.parseInt(head);
      return jsonWalk(cur.get(n >= 1 ? n - 1 : n), segs, at + 1);
    }
    if (!cur.isObject()) return null;
    return jsonWalk(cur.get(head), segs, at + 1);
  }

  private com.fasterxml.jackson.databind.JsonNode toJsonNode(Object node) {
    if (node instanceof com.fasterxml.jackson.databind.JsonNode j) return j;
    if (node == null) return JSON.nullNode();
    if (node instanceof String s) {
      String t = s.trim();
      if (t.startsWith("{") || t.startsWith("[")) {
        try {
          return JSON.readTree(t);
        } catch (Exception e) {
          return JSON.getNodeFactory().textNode(s);
        }
      }
      return JSON.getNodeFactory().textNode(s);
    }
    return JSON.valueToTree(node);
  }

  static String jsonQuery(String path) {
    String trimmed = path.trim();
    if (trimmed.isEmpty() || trimmed.startsWith("/")) return trimmed;
    String asJson = trimmed.startsWith("$") ? trimmed : "$." + trimmed.replaceFirst("^\\.", "");
    String body = asJson.substring(1);
    if (body.startsWith(".")) body = body.substring(1);
    if (body.isEmpty() || body.equals(".")) return "$";
    StringBuilder q = new StringBuilder();
    int i = 0;
    while (i < body.length()) {
      if (body.charAt(i) == '.') {
        i++;
        continue;
      }
      if (body.charAt(i) == '[') {
        int close = body.indexOf(']', i + 1);
        if (close < 0) break;
        if (q.length() > 0) q.append('.');
        q.append(body, i + 1, close);
        i = close + 1;
        continue;
      }
      int end = i;
      while (end < body.length() && body.charAt(end) != '.' && body.charAt(end) != '[') end++;
      if (q.length() > 0) q.append('.');
      q.append(body, i, end);
      i = end;
    }
    return q.length() == 0 ? "$" : q.toString();
  }

  private String xmlString(String path, Object node) {
    org.w3c.dom.Node xml = xmlNode(path, node);
    return xml == null ? "" : xml.getTextContent() == null ? "" : xml.getTextContent();
  }

  private org.w3c.dom.Node xmlNode(String path, Object node) {
    try {
      org.w3c.dom.Document doc;
      if (node instanceof org.w3c.dom.Document d) doc = d;
      else if (node instanceof org.w3c.dom.Node n) {
        javax.xml.xpath.XPath xp = javax.xml.xpath.XPathFactory.newInstance().newXPath();
        return (org.w3c.dom.Node) xp.evaluate(path, n, javax.xml.xpath.XPathConstants.NODE);
      } else {
        String xml = String.valueOf(node);
        javax.xml.parsers.DocumentBuilder b =
          javax.xml.parsers.DocumentBuilderFactory.newInstance().newDocumentBuilder();
        doc = b.parse(new org.xml.sax.InputSource(new java.io.StringReader(xml)));
      }
      javax.xml.xpath.XPath xp = javax.xml.xpath.XPathFactory.newInstance().newXPath();
      return (org.w3c.dom.Node) xp.evaluate(path, doc, javax.xml.xpath.XPathConstants.NODE);
    } catch (Exception e) {
      return null;
    }
  }

  public Object sheetGetCell(String name, String a1) {
    Sheet s = sheetOf(name);
    if (s == null) return null;
    java.util.regex.Matcher m = java.util.regex.Pattern.compile("^([A-Za-z]+)(\\d+)$").matcher(a1.trim());
    if (!m.matches()) return null;
    int x = 0;
    for (char ch : m.group(1).toUpperCase().toCharArray()) x = x * 26 + (ch - 64);
    int y = Integer.parseInt(m.group(2)) - 1;
    if (y < 0 || y >= s.values.size()) return null;
    List<Object> row = s.values.get(y);
    return row != null && x - 1 < row.size() ? row.get(x - 1) : null;
  }

  public Object sheetGetXy(String name, Object xObj, Object yObj) {
    Sheet s = sheetOf(name);
    if (s == null) return null;
    int x = (int) toDouble(xObj);
    int y = (int) toDouble(yObj);
    if (y < 0 || y >= s.values.size()) return null;
    List<Object> row = s.values.get(y);
    return row != null && x >= 0 && x < row.size() ? row.get(x) : null;
  }

  public List<Object> sheetGetRow(String name, Object yObj) {
    Sheet s = sheetOf(name);
    if (s == null) return List.of();
    int y = (int) toDouble(yObj);
    if (y < 0 || y >= s.values.size()) return List.of();
    return new ArrayList<>(s.values.get(y));
  }

  public List<Object> sheetGetColumn(String name, Object xObj) {
    Sheet s = sheetOf(name);
    if (s == null) return List.of();
    int x = (int) toDouble(xObj);
    List<Object> out = new ArrayList<>();
    for (List<Object> row : s.values) out.add(row != null && x >= 0 && x < row.size() ? row.get(x) : null);
    return out;
  }

  public String sheetGetHeader(String name, Object xObj) {
    Sheet s = sheetOf(name);
    if (s == null) return "";
    int x = (int) toDouble(xObj);
    return x >= 0 && x < s.headers.size() ? s.headers.get(x) : "";
  }

  public List<List<Object>> sheetGetData(String name) {
    Sheet s = sheetOf(name);
    if (s == null) return List.of();
    List<List<Object>> out = new ArrayList<>();
    for (List<Object> row : s.values) out.add(new ArrayList<>(row));
    return out;
  }

  public Object sheetLookup(String name, Object matchCol, Object matchValue, Object returnCol) {
    Sheet s = sheetOf(name);
    if (s == null) return null;
    int mi = columnIndex(s, matchCol);
    int y = -1;
    for (int i = 0; i < s.values.size(); i++) {
      List<Object> row = s.values.get(i);
      Object cell = row != null && mi >= 0 && mi < row.size() ? row.get(mi) : null;
      if (asString(cell).equals(asString(matchValue))) {
        y = i;
        break;
      }
    }
    if (y < 0) return null;
    if (returnCol == null || asString(returnCol).isEmpty()) {
      Map<String, Object> rec = new LinkedHashMap<>();
      List<Object> row = s.values.get(y);
      for (int x = 0; x < s.headers.size(); x++) {
        rec.put(
          s.headers.get(x).isEmpty() ? String.valueOf(x) : s.headers.get(x),
          x < row.size() ? row.get(x) : null
        );
      }
      return rec;
    }
    int ri = columnIndex(s, returnCol);
    List<Object> row = s.values.get(y);
    return ri >= 0 && ri < row.size() ? row.get(ri) : null;
  }

  public Object sheetLookup(String name, Object matchCol, Object matchValue) {
    return sheetLookup(name, matchCol, matchValue, null);
  }

  /**
   * Decision table as Mapping preview evaluates it: condition / output columns,
   * don't-care cells, numeric range and comparison cells (`1..5`, `>= 3`),
   * catch-all rows, FIRST / UNIQUE / COLLECT, typed value outputs and
   * VMS-Mustache snippet outputs. `outputCol` "*" returns every output column.
   */
  public Object decisionTable(String name, Map<String, Object> inputs, String outputCol) {
    Sheet s = sheetOf(name);
    if (s == null) return null;
    Map<String, Object> in = inputs != null ? inputs : Map.of();
    int width = s.headers.size();
    List<Integer> matches = new ArrayList<>();
    for (int y = 0; y < s.values.size(); y++) {
      if (y < s.rowCatchAll.size() && Boolean.TRUE.equals(s.rowCatchAll.get(y))) {
        if (matches.isEmpty()) matches.add(y);
        continue;
      }
      boolean ok = true;
      for (int x = 0; x < width; x++) {
        if (!"condition".equals(s.role(x))) continue;
        if (!cellMatches(s.cell(y, x), in.get(s.headers.get(x)))) {
          ok = false;
          break;
        }
      }
      if (ok) matches.add(y);
    }
    if (matches.isEmpty()) return null;
    boolean all = "*".equals(outputCol);
    int oi = outputCol != null && !all ? s.headers.indexOf(outputCol) : s.firstOutput();
    if (oi < 0) oi = Math.max(0, width - 1);
    String policy = s.hitPolicy != null ? s.hitPolicy : "FIRST";
    if ("UNIQUE".equals(policy) && matches.size() > 1) {
      throw new IllegalStateException("UNIQUE decision table \"" + name + "\" matched " + matches.size() + " rows");
    }
    if ("COLLECT".equals(policy)) {
      if (!all) return collectJoin(s, matches, oi, in);
      Map<String, Object> rec = new LinkedHashMap<>();
      for (int x = 0; x < width; x++) {
        if ("output".equals(s.role(x))) rec.put(s.headers.get(x), collectJoin(s, matches, x, in));
      }
      return rec;
    }
    int y = matches.get(0);
    if (!all) return cellOutput(s, y, oi, in);
    Map<String, Object> rec = new LinkedHashMap<>();
    for (int x = 0; x < width; x++) {
      if ("output".equals(s.role(x))) rec.put(s.headers.get(x), cellOutput(s, y, x, in));
    }
    return rec;
  }

  private static String collectJoin(Sheet s, List<Integer> rows, int column, Map<String, Object> inputs) {
    List<String> parts = new ArrayList<>();
    for (int y : rows) {
      Object value = cellOutput(s, y, column, inputs);
      if (value == null || (value instanceof CharSequence t && t.toString().trim().isEmpty())) continue;
      String text = xmlText(value);
      if (s.collectDedupe && parts.contains(text)) continue;
      parts.add(text);
    }
    return String.join(s.collectJoin != null ? s.collectJoin : "; ", parts);
  }

  private static boolean cellMatches(Object cell, Object input) {
    if (dontCare(cell)) return true;
    double[] pred = numericPredicate(cell);
    if (pred != null) {
      Double n = finiteNumber(input);
      if (n == null) return false;
      return switch ((int) pred[0]) {
        case 0 -> n >= pred[1] && n <= pred[2];
        case 1 -> n >= pred[1];
        case 2 -> n > pred[1];
        case 3 -> n <= pred[1];
        case 4 -> n < pred[1];
        default -> n == pred[1];
      };
    }
    return xmlText(cell).equals(xmlText(input));
  }

  private static final java.util.regex.Pattern RANGE =
    java.util.regex.Pattern.compile("^(-?\\d+(?:\\.\\d+)?)\\s*\\.\\.\\s*(-?\\d+(?:\\.\\d+)?)$");
  private static final java.util.regex.Pattern COMPARE =
    java.util.regex.Pattern.compile("^(>=|<=|>|<|=)\\s*(-?\\d+(?:\\.\\d+)?)$");

  /** {op, a, b}: op 0 range, 1 >=, 2 >, 3 <=, 4 <, 5 =; null when the cell is not numeric. */
  private static double[] numericPredicate(Object cell) {
    if (cell == null || cell instanceof Boolean) return null;
    String text = cell instanceof Number ? xmlText(cell) : String.valueOf(cell).trim();
    var range = RANGE.matcher(text);
    if (range.matches()) {
      double a = Double.parseDouble(range.group(1));
      double b = Double.parseDouble(range.group(2));
      return new double[] {0, Math.min(a, b), Math.max(a, b)};
    }
    var cmp = COMPARE.matcher(text);
    if (cmp.matches()) {
      int op = switch (cmp.group(1)) {
        case ">=" -> 1;
        case ">" -> 2;
        case "<=" -> 3;
        case "<" -> 4;
        default -> 5;
      };
      return new double[] {op, Double.parseDouble(cmp.group(2)), 0};
    }
    return null;
  }

  private static Double finiteNumber(Object value) {
    if (value instanceof com.fasterxml.jackson.databind.JsonNode node) {
      if (node.isNumber()) return node.asDouble();
      value = node.isTextual() ? node.asText() : null;
    }
    if (value instanceof Number n) return Double.isFinite(n.doubleValue()) ? n.doubleValue() : null;
    if (value instanceof CharSequence text && !text.toString().trim().isEmpty()) {
      try {
        double d = Double.parseDouble(text.toString().trim());
        return Double.isFinite(d) ? d : null;
      } catch (NumberFormatException e) {
        return null;
      }
    }
    return null;
  }

  private static Object cellOutput(Sheet s, int y, int column, Map<String, Object> inputs) {
    Object cell = s.cell(y, column);
    if ("snippet".equals(s.outputKind(column))) {
      String template = cell == null ? "" : String.valueOf(cell);
      return template.contains("{{") ? renderSnippet(template, inputs) : template;
    }
    String type = s.valueType(column);
    if (cell == null || "".equals(cell)) return cell;
    if ("number".equals(type)) {
      Double n = finiteNumber(cell);
      return n != null ? (Object) n : cell;
    }
    if ("boolean".equals(type)) {
      if (cell instanceof Boolean) return cell;
      String t = String.valueOf(cell).trim().toLowerCase();
      if (t.equals("true")) return true;
      if (t.equals("false")) return false;
      return cell;
    }
    return cell instanceof String ? cell : xmlText(cell);
  }

  private static final java.util.regex.Pattern SNIPPET_KEY =
    java.util.regex.Pattern.compile("\\{\\{\\s*([A-Za-z_$][\\w.$]*)\\s*\\}\\}");

  /**
   * Full VMS-Mustache through {@code HandlebarsSupport.mustache} when
   * Handlebars.java is on the classpath; plain {@code {{name}}} lookups otherwise.
   */
  private static String renderSnippet(String template, Map<String, Object> inputs) {
    Class<?> support;
    try {
      support = Class.forName("se.regionstockholm.intehrgrator.runtime.HandlebarsSupport");
      support.getMethod("mustache", String.class, Map.class);
      Class.forName("com.github.jknack.handlebars.Handlebars");
    } catch (ClassNotFoundException | NoClassDefFoundError | NoSuchMethodException e) {
      if (template.contains("{{#") || template.contains("{{^")) {
        throw new IllegalStateException(
          "Decision table snippet uses Mustache sections; put HandlebarsSupport and Handlebars.java on the classpath");
      }
      return SNIPPET_KEY.matcher(template).replaceAll(match ->
        java.util.regex.Matcher.quoteReplacement(xmlText(inputs.get(match.group(1)))));
    }
    try {
      return (String) support.getMethod("mustache", String.class, Map.class).invoke(null, template, inputs);
    } catch (java.lang.reflect.InvocationTargetException e) {
      Throwable cause = e.getCause();
      if (cause instanceof RuntimeException runtime) throw runtime;
      throw new IllegalStateException(cause);
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException(e);
    }
  }

  /**
   * A value as Target text, the way Mapping preview prints it: null → "",
   * XML Schema xs:decimal lexical form (plain decimal, no exponent, no ".0"
   * on whole numbers), Jackson scalars as their text, lists joined.
   * Non-finite values keep Java's {@code Double.toString} so sheet cells do
   * not throw; use {@link #formatXmlNumber} / {@link #formatJsonNumber} when
   * writing a typed target field that must reject NaN / Infinity.
   */
  public static String xmlText(Object value) {
    if (value == null) return "";
    if (value instanceof com.fasterxml.jackson.databind.JsonNode node) {
      if (node.isNull() || node.isMissingNode()) return "";
      if (node.isNumber()) return xmlText(node.numberValue());
      if (node.isValueNode()) return node.asText();
      if (node.isArray()) {
        StringBuilder out = new StringBuilder();
        node.forEach(item -> out.append(xmlText(item)));
        return out.toString();
      }
      return node.toString();
    }
    if (value instanceof Number n) {
      if (n instanceof Integer || n instanceof Long || n instanceof Short || n instanceof Byte
        || n instanceof java.math.BigInteger) {
        return n.toString();
      }
      double d = n.doubleValue();
      if (!Double.isFinite(d)) return Double.toString(d);
      return formatXmlDecimal(d);
    }
    if (value instanceof List<?> list) {
      StringBuilder out = new StringBuilder();
      for (Object item : list) out.append(xmlText(item));
      return out.toString();
    }
    return String.valueOf(value);
  }

  /**
   * RFC 8259 JSON number: shortest plain or scientific form, no {@code .0} on
   * integers, error on NaN / Infinity.
   */
  public static String formatJsonNumber(double d) {
    if (!Double.isFinite(d)) {
      throw new IllegalArgumentException(
        "JSON (RFC 8259 §6) cannot express " + d + "; Infinity and NaN are not permitted.");
    }
    if (d == 0d) return "0";
    if (d == Math.rint(d) && Math.abs(d) <= 9007199254740991d) {
      return java.math.BigDecimal.valueOf(d).toBigInteger().toString();
    }
    // Prefer a short scientific form in the ECMA-262 range; otherwise plain decimal.
    double abs = Math.abs(d);
    if (abs >= 1e21 || (abs != 0d && abs < 1e-6)) {
      return Double.toString(d).replace('E', 'e').replace("e+", "e+").replace(".0e", "e");
    }
    return formatXmlDecimal(d);
  }

  /**
   * XML Schema lexical form: {@code xml-integer}, {@code xml-decimal} (default)
   * or {@code xml-double} (allows INF / NaN).
   */
  public static String formatXmlNumber(double d, String form) {
    if ("xml-double".equals(form)) {
      if (Double.isNaN(d)) return "NaN";
      if (d == Double.POSITIVE_INFINITY) return "INF";
      if (d == Double.NEGATIVE_INFINITY) return "-INF";
      if (Double.doubleToRawLongBits(d) == Double.doubleToRawLongBits(-0.0d)) return "-0";
      return formatXmlDecimal(d);
    }
    if (!Double.isFinite(d)) {
      String typ = "xml-integer".equals(form) ? "xs:integer" : "xs:decimal";
      throw new IllegalArgumentException(
        "XML Schema " + typ + " cannot express " + d + "; Infinity and NaN are not in the lexical space.");
    }
    if ("xml-integer".equals(form)) {
      if (d != Math.rint(d)) {
        throw new IllegalArgumentException(
          "XML Schema xs:integer cannot express " + formatXmlDecimal(d) + "; the value is not a whole number.");
      }
    }
    return formatXmlDecimal(d);
  }

  /** Canonical xs:decimal: no exponent, no trailing zeros, no decimal point on integers. */
  public static String formatXmlDecimal(double d) {
    if (!Double.isFinite(d)) {
      throw new IllegalArgumentException(
        "XML Schema xs:decimal cannot express " + d + "; Infinity and NaN are not in the lexical space.");
    }
    if (d == 0d) return "0";
    return java.math.BigDecimal.valueOf(d).stripTrailingZeros().toPlainString();
  }

  public Object decisionTable(String name, Map<String, Object> inputs) {
    return decisionTable(name, inputs, null);
  }

  private Sheet sheetOf(String name) {
    return sheets.get(name);
  }

  private static boolean dontCare(Object cell) {
    if (cell == null) return true;
    String t = String.valueOf(cell).trim();
    return t.isEmpty() || t.equals("—") || t.equals("–") || t.equals("-") || t.equals("*");
  }

  private static int columnIndex(Sheet s, Object ref) {
    if (ref instanceof Number n) return n.intValue();
    String t = asString(ref);
    int hi = s.headers.indexOf(t);
    if (hi >= 0) return hi;
    if (t.chars().allMatch(Character::isLetter)) {
      int n = 0;
      for (char ch : t.toUpperCase().toCharArray()) n = n * 26 + (ch - 64);
      return n - 1;
    }
    try {
      return Integer.parseInt(t);
    } catch (NumberFormatException e) {
      return -1;
    }
  }

  public static final class Sheet {
    public final String name;
    public final List<String> headers;
    public final List<List<Object>> values;
    public final List<String> rowNames;
    public final String hitPolicy;
    public final String collectJoin;
    /** Output headers whose cells are VMS-Mustache snippets. */
    public final List<String> snippetColumns;
    /** Per column: "condition" or "output". Empty: every column but the last is a condition. */
    public final List<String> roles;
    /** Per column: "value" or "snippet" (outputs only). */
    public final List<String> outputKinds;
    /** Per column: "string", "number" or "boolean" (value outputs only). */
    public final List<String> valueTypes;
    /** Per row: true for a catch-all (otherwise) row. */
    public final List<Boolean> rowCatchAll;
    public final boolean collectDedupe;

    public Sheet(String name, List<String> headers, List<List<Object>> values) {
      this(name, headers, values, List.of(), "FIRST", "; ");
    }

    public Sheet(
      String name,
      List<String> headers,
      List<List<Object>> values,
      List<String> rowNames,
      String hitPolicy,
      String collectJoin
    ) {
      this(name, headers, values, rowNames, hitPolicy, collectJoin, List.of());
    }

    public Sheet(String name, List<String> headers, List<List<Object>> values,
        List<String> rowNames, String hitPolicy, String collectJoin, List<String> snippetColumns) {
      this(name, headers, values, rowNames, hitPolicy, collectJoin, snippetColumns,
        List.of(), List.of(), List.of(), List.of(), false);
    }

    public Sheet(String name, List<String> headers, List<List<Object>> values,
        List<String> rowNames, String hitPolicy, String collectJoin, List<String> snippetColumns,
        List<String> roles, List<String> outputKinds, List<String> valueTypes,
        List<Boolean> rowCatchAll, boolean collectDedupe) {
      this.snippetColumns = snippetColumns != null ? snippetColumns : List.of();
      this.name = name;
      this.headers = headers != null ? headers : List.of();
      this.values = values != null ? values : List.of();
      this.rowNames = rowNames != null ? rowNames : List.of();
      this.hitPolicy = hitPolicy;
      this.collectJoin = collectJoin;
      this.roles = roles != null ? roles : List.of();
      this.outputKinds = outputKinds != null ? outputKinds : List.of();
      this.valueTypes = valueTypes != null ? valueTypes : List.of();
      this.rowCatchAll = rowCatchAll != null ? rowCatchAll : List.of();
      this.collectDedupe = collectDedupe;
    }

    String role(int column) {
      if (roles.isEmpty()) return column == headers.size() - 1 ? "output" : "condition";
      return column < roles.size() && roles.get(column) != null ? roles.get(column) : "condition";
    }

    String outputKind(int column) {
      if (column < outputKinds.size() && outputKinds.get(column) != null) return outputKinds.get(column);
      return column < headers.size() && snippetColumns.contains(headers.get(column)) ? "snippet" : "value";
    }

    String valueType(int column) {
      return column < valueTypes.size() && valueTypes.get(column) != null ? valueTypes.get(column) : "string";
    }

    int firstOutput() {
      for (int x = 0; x < headers.size(); x++) if ("output".equals(role(x))) return x;
      return headers.size() - 1;
    }

    Object cell(int y, int x) {
      if (y < 0 || y >= values.size()) return null;
      List<Object> row = values.get(y);
      return row != null && x >= 0 && x < row.size() ? row.get(x) : null;
    }

    /** One sheet from intEHRgrator sheet JSON (`*.sheets.json` entry). */
    public static Sheet fromJson(com.fasterxml.jackson.databind.JsonNode doc) {
      List<String> headers = new ArrayList<>();
      doc.path("headers").forEach(h -> headers.add(h.asText()));
      List<List<Object>> values = new ArrayList<>();
      doc.path("values").forEach(row -> {
        List<Object> cells = new ArrayList<>();
        row.forEach(cell -> cells.add(cell.isNull() ? null : cell.isBoolean() ? (Object) cell.asBoolean()
          : cell.isNumber() ? (Object) cell.numberValue() : cell.asText()));
        values.add(cells);
      });
      List<String> rowNames = new ArrayList<>();
      doc.path("rowNames").forEach(n -> rowNames.add(n.asText()));
      List<String> roles = new ArrayList<>();
      List<String> kinds = new ArrayList<>();
      List<String> types = new ArrayList<>();
      doc.path("decisionColumns").forEach(c -> {
        roles.add(c.path("role").asText("condition"));
        kinds.add(c.hasNonNull("outputKind") ? c.get("outputKind").asText() : null);
        types.add(c.hasNonNull("valueType") ? c.get("valueType").asText() : null);
      });
      List<Boolean> catchAll = new ArrayList<>();
      doc.path("rowCatchAll").forEach(b -> catchAll.add(b.asBoolean(false)));
      return new Sheet(
        doc.path("name").asText(),
        headers,
        values,
        rowNames,
        doc.path("hitPolicy").asText("FIRST"),
        doc.path("collectJoin").asText("; "),
        List.of(),
        roles,
        kinds,
        types,
        catchAll,
        doc.path("collectDedupe").asBoolean(false));
    }

    /** Every sheet in a `*.sheets.json` document (an array or `{ "sheets": [...] }`), by name. */
    public static Map<String, Sheet> mapFromJson(String json) {
      try {
        com.fasterxml.jackson.databind.JsonNode doc = JSON.readTree(json);
        com.fasterxml.jackson.databind.JsonNode list = doc.isArray() ? doc : doc.path("sheets");
        Map<String, Sheet> out = new LinkedHashMap<>();
        list.forEach(item -> {
          Sheet sheet = fromJson(item);
          out.put(sheet.name, sheet);
        });
        return out;
      } catch (java.io.IOException e) {
        throw new IllegalArgumentException("Invalid sheets JSON: " + e.getMessage(), e);
      }
    }
  }
}
