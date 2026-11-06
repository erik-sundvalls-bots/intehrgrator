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
    this.sourceRoot = source;
    this.sheets = sheets != null ? sheets : Map.of();
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

  public static boolean asBoolean(Object value) {
    if (value instanceof Boolean b) return b;
    if (value == null) return false;
    return Boolean.parseBoolean(String.valueOf(value));
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
    return found == null || found.isNull() || found.isMissingNode() ? "" : found.asText();
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
    try {
      return Double.parseDouble(found.asText());
    } catch (NumberFormatException e) {
      return 0d;
    }
  }

  public boolean xpathBoolean(String path, Object node) {
    if (path.trim().startsWith("/")) return Boolean.parseBoolean(xmlString(path, node));
    com.fasterxml.jackson.databind.JsonNode found = jsonAt(path, node);
    return found != null && found.asBoolean(false);
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
    if (found == null) return List.of();
    return List.of(found);
  }

  private static final com.fasterxml.jackson.databind.ObjectMapper JSON =
    new com.fasterxml.jackson.databind.ObjectMapper();

  private com.fasterxml.jackson.databind.JsonNode jsonAt(String path, Object node) {
    com.fasterxml.jackson.databind.JsonNode tree = toJsonNode(node);
    String query = jsonQuery(path);
    if (query.equals("$") || query.equals("$source")) return tree;
    com.fasterxml.jackson.databind.JsonNode cur = tree;
    String body = query.startsWith("$") ? query.substring(1) : query;
    if (body.startsWith(".")) body = body.substring(1);
    for (String seg : body.split("\\.")) {
      if (seg.isEmpty() || seg.equals("source")) continue;
      if (cur == null || cur.isMissingNode()) return cur;
      if (seg.chars().allMatch(Character::isDigit)) cur = cur.get(Integer.parseInt(seg));
      else cur = cur.get(seg);
    }
    return cur;
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

  public Object decisionTable(String name, Map<String, Object> inputs, String outputCol) {
    Sheet s = sheetOf(name);
    if (s == null) return null;
    int width = s.headers.size();
    int oi = outputCol != null && !outputCol.equals("*") ? s.headers.indexOf(outputCol) : width - 1;
    if (oi < 0) oi = Math.max(0, width - 1);
    List<Integer> matches = new ArrayList<>();
    for (int y = 0; y < s.values.size(); y++) {
      boolean ok = true;
      for (int x = 0; x < width - 1; x++) {
        Object cell = y < s.values.size() && x < s.values.get(y).size() ? s.values.get(y).get(x) : null;
        if (dontCare(cell)) continue;
        if (!asString(cell).equals(asString(inputs.get(s.headers.get(x))))) {
          ok = false;
          break;
        }
      }
      if (ok) matches.add(y);
    }
    if (matches.isEmpty()) return null;
    if ("COLLECT".equals(s.hitPolicy)) {
      String join = s.collectJoin != null ? s.collectJoin : "; ";
      List<String> parts = new ArrayList<>();
      for (int y : matches) {
        Object cell = oi < s.values.get(y).size() ? s.values.get(y).get(oi) : null;
        parts.add(asString(decisionCell(s, oi, cell, inputs)));
      }
      return String.join(join, parts);
    }
    int y = matches.get(0);
    return decisionCell(s, oi, oi < s.values.get(y).size() ? s.values.get(y).get(oi) : null, inputs);
  }

  private static Object decisionCell(Sheet sheet, int column, Object value, Map<String, Object> inputs) {
    if (column < 0 || column >= sheet.headers.size() || !sheet.snippetColumns.contains(sheet.headers.get(column))) return value;
    var pattern = java.util.regex.Pattern.compile("\\{\\{\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\}\\}");
    return pattern.matcher(asString(value)).replaceAll(match -> java.util.regex.Matcher.quoteReplacement(asString(inputs.get(match.group(1)))));
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
    /** Output headers whose cells are simple {{input}} snippets. */
    public final List<String> snippetColumns;

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
      this.snippetColumns = snippetColumns != null ? snippetColumns : List.of();
      this.name = name;
      this.headers = headers != null ? headers : List.of();
      this.values = values != null ? values : List.of();
      this.rowNames = rowNames != null ? rowNames : List.of();
      this.hitPolicy = hitPolicy;
      this.collectJoin = collectJoin;
    }
  }
}
