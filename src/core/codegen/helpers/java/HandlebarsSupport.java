package se.regionstockholm.intehrgrator.runtime;

/**
 * VMS-Hbs render for generated Java conversion scripts.
 * Kept separate so mappings that do not call {@code handlebars} do not need
 * Handlebars.java on the classpath.
 */
public final class HandlebarsSupport {
  private HandlebarsSupport() {}

  public static String handlebars(String template, Object context) {
    try {
      // Mapping preview and TypeScript render with noEscape: the Target format escapes.
      com.github.jknack.handlebars.Handlebars engine = new com.github.jknack.handlebars.Handlebars()
        .with(com.github.jknack.handlebars.EscapingStrategy.NOOP);
      engine.registerHelper("eq", (ctx, options) -> java.util.Objects.equals(ctx, options.param(0)));
      engine.registerHelper("ne", (ctx, options) -> !java.util.Objects.equals(ctx, options.param(0)));
      engine.registerHelper("lt", (ctx, options) -> compareNumbers(ctx, options.param(0)) < 0);
      engine.registerHelper("gt", (ctx, options) -> compareNumbers(ctx, options.param(0)) > 0);
      engine.registerHelper("lte", (ctx, options) -> compareNumbers(ctx, options.param(0)) <= 0);
      engine.registerHelper("gte", (ctx, options) -> compareNumbers(ctx, options.param(0)) >= 0);
      // Kintegrate: inc (v) -> v + 1 (JavaScript +; a string concatenates), dec (v) -> v - 1.
      engine.registerHelper("inc", (ctx, options) -> inc(ctx));
      engine.registerHelper("dec", (ctx, options) -> dec(ctx));
      engine.registerHelper("and", (ctx, options) -> {
        if (!IntehrgratorRuntime.asBoolean(ctx)) return false;
        for (Object arg : options.params) if (!IntehrgratorRuntime.asBoolean(arg)) return false;
        return true;
      });
      engine.registerHelper("or", (ctx, options) -> {
        if (IntehrgratorRuntime.asBoolean(ctx)) return true;
        for (Object arg : options.params) if (IntehrgratorRuntime.asBoolean(arg)) return true;
        return false;
      });
      engine.registerHelper("toLowerCase", (ctx, options) -> ctx == null ? ctx : String.valueOf(ctx).toLowerCase());
      engine.registerHelper("toUpperCase", (ctx, options) -> ctx == null ? ctx : String.valueOf(ctx).toUpperCase());
      engine.registerHelper("regexReplace", (ctx, options) -> String.valueOf(ctx == null ? "" : ctx)
          .replaceAll(String.valueOf(options.param(0, "")), java.util.regex.Matcher.quoteReplacement(String.valueOf(options.param(1, "")))));
      engine.registerHelper("slot", (ctx, options) -> "");
      engine.registerHelperMissing((ctx, options) -> {
        // Handlebars.java also lands here for a plain lookup that finds nothing.
        if (options.params.length > 0 || !options.hash.isEmpty()) {
          throw new IllegalStateException("VMS-Hbs forbids helper: " + options.helperName);
        }
        return options.tagType.inline() ? "" : options.inverse();
      });
      Object root = plain(context);
      return engine.compileInline(template).apply(root != null ? root : java.util.Map.of());
    } catch (Exception e) {
      throw new IllegalStateException("VMS-Hbs render failed: " + e.getMessage(), e);
    }
  }

  /**
   * VMS-Mustache Decision table snippet: sections and lookups, no helpers.
   * A missing input is "" in the generated script but null in Mapping preview,
   * and Handlebars would open a section for "", so empty strings are dropped.
   */
  public static String mustache(String template, java.util.Map<String, Object> locals) {
    java.util.Map<String, Object> bag = new java.util.LinkedHashMap<>();
    if (locals != null) {
      for (java.util.Map.Entry<String, Object> entry : locals.entrySet()) {
        Object value = plain(entry.getValue());
        if (value instanceof CharSequence text && text.length() == 0) continue;
        bag.put(entry.getKey(), value);
      }
    }
    try {
      com.github.jknack.handlebars.Handlebars engine = new com.github.jknack.handlebars.Handlebars()
        .with(com.github.jknack.handlebars.EscapingStrategy.NOOP);
      return engine.compileInline(stripStandalone(template)).apply(bag);
    } catch (Exception e) {
      throw new IllegalStateException("Decision table snippet render failed: " + e.getMessage(), e);
    }
  }

  private static final java.util.regex.Pattern TAG =
    java.util.regex.Pattern.compile("\\{\\{\\{.*?\\}\\}\\}|\\{\\{!--.*?--\\}\\}|\\{\\{.*?\\}\\}", java.util.regex.Pattern.DOTALL);

  /**
   * Handlebars.js standalone lines: a line holding only whitespace and one block tag
   * ({{#..}}, {{^..}}, {{/..}}, {{else}}, {{!..}}) loses that whitespace and its newline.
   * Handlebars.java's prettyPrint strips more than that, so it stays off and the template
   * text is adjusted here instead.
   */
  static String stripStandalone(String template) {
    if (template == null || !template.contains("{{")) return template;
    java.util.List<String> parts = new java.util.ArrayList<>(); // even = text, odd = tag
    java.util.regex.Matcher m = TAG.matcher(template);
    int at = 0;
    while (m.find()) {
      parts.add(template.substring(at, m.start()));
      parts.add(m.group());
      at = m.end();
    }
    parts.add(template.substring(at));
    java.util.List<String> original = new java.util.ArrayList<>(parts); // standalone checks read the original text
    for (int i = 1; i < parts.size(); i += 2) {
      String inner = parts.get(i).replaceFirst("^\\{\\{~?\\s*", "");
      boolean block = !parts.get(i).startsWith("{{{") && (inner.startsWith("#") || inner.startsWith("^")
        || inner.startsWith("/") || inner.startsWith("!") || inner.matches("(?s)else\\b.*"));
      if (!block) continue;
      String before = original.get(i - 1);
      String after = original.get(i + 1);
      boolean prevOk = i == 1 ? before.matches("(?s)(.*\\r?\\n)?[ \\t]*") : before.matches("(?s).*\\r?\\n[ \\t]*");
      boolean nextOk = i + 2 >= parts.size() ? after.matches("(?s)[ \\t]*(\\r?\\n.*)?") : after.matches("(?s)[ \\t]*\\r?\\n.*");
      if (!prevOk || !nextOk) continue;
      parts.set(i - 1, parts.get(i - 1).replaceFirst("[ \\t]*$", ""));
      parts.set(i + 1, parts.get(i + 1).replaceFirst("^[ \\t]*(\\r?\\n)?", ""));
    }
    return String.join("", parts);
  }

  private static final com.fasterxml.jackson.databind.ObjectMapper JSON =
    new com.fasterxml.jackson.databind.ObjectMapper();

  /** Jackson trees become Maps / Lists / scalars so Handlebars.java can resolve paths. */
  private static Object plain(Object value) {
    if (value == null) return null;
    if (value instanceof com.fasterxml.jackson.databind.JsonNode node) {
      if (node.isMissingNode() || node.isNull()) return null;
      return JSON.convertValue(node, Object.class);
    }
    return value;
  }

  private static int compareNumbers(Object left, Object right) {
    return Double.compare(IntehrgratorRuntime.toDouble(left), IntehrgratorRuntime.toDouble(right));
  }

  /** JavaScript `value + 1`. A CharSequence concatenates; everything else is numeric. */
  private static Object inc(Object value) {
    if (value instanceof CharSequence text) return text.toString() + "1";
    return jsAdd(value, 1);
  }

  /** JavaScript `value - 1` (always numeric, including numeric strings). */
  private static Object dec(Object value) {
    return jsAdd(value, -1);
  }

  private static Object jsAdd(Object value, int delta) {
    if (value instanceof Boolean flag) return (flag ? 1 : 0) + delta;
    double n = jsToNumber(value);
    double sum = n + delta;
    if (Double.isNaN(sum) || Double.isInfinite(sum)) return sum;
    if (sum == Math.rint(sum) && sum >= Integer.MIN_VALUE && sum <= Integer.MAX_VALUE) {
      return (int) sum;
    }
    return sum;
  }

  /** JavaScript ToNumber for null, booleans, numbers, and strings. */
  private static double jsToNumber(Object value) {
    if (value == null) return 0d;
    if (value instanceof Boolean flag) return flag ? 1d : 0d;
    if (value instanceof Number number) return number.doubleValue();
    String text = String.valueOf(value).trim();
    if (text.isEmpty()) return 0d;
    try {
      return Double.parseDouble(text);
    } catch (NumberFormatException e) {
      return Double.NaN;
    }
  }
}
