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
      com.github.jknack.handlebars.Handlebars engine = new com.github.jknack.handlebars.Handlebars();
      engine.registerHelper("eq", (ctx, options) -> java.util.Objects.equals(ctx, options.param(0)));
      engine.registerHelper("ne", (ctx, options) -> !java.util.Objects.equals(ctx, options.param(0)));
      engine.registerHelper("lt", (ctx, options) -> compareNumbers(ctx, options.param(0)) < 0);
      engine.registerHelper("gt", (ctx, options) -> compareNumbers(ctx, options.param(0)) > 0);
      engine.registerHelper("lte", (ctx, options) -> compareNumbers(ctx, options.param(0)) <= 0);
      engine.registerHelper("gte", (ctx, options) -> compareNumbers(ctx, options.param(0)) >= 0);
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
      engine.registerHelper("slot", (ctx, options) -> "");
      engine.registerHelperMissing((ctx, options) -> {
        throw new IllegalStateException("VMS-Hbs forbids helper: " + options.helperName);
      });
      return engine.compileInline(template).apply(context != null ? context : java.util.Map.of());
    } catch (Exception e) {
      throw new IllegalStateException("VMS-Hbs render failed: " + e.getMessage(), e);
    }
  }

  private static int compareNumbers(Object left, Object right) {
    return Double.compare(IntehrgratorRuntime.toDouble(left), IntehrgratorRuntime.toDouble(right));
  }
}
