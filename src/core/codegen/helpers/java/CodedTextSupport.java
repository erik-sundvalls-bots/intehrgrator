package se.regionstockholm.intehrgrator.runtime;

import com.nedap.archie.rm.datavalues.DvCodedText;
import com.nedap.archie.rm.datavalues.TermMapping;
import com.nedap.archie.rm.datatypes.CodePhrase;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Value-set lookup for generated Java conversion scripts.
 * Kept separate so a mapping that does not call {@code codedText} does not
 * need Archie on the classpath.
 *
 * Same rule as the TypeScript helper: one case-insensitive match on the code
 * or the rubric becomes {@code value = rubric} and {@code terminology::code}.
 * No unique hit keeps the text as the value only.
 */
public final class CodedTextSupport {
  private CodedTextSupport() {}

  public static DvCodedText codedText(Object text, String[][] choices) {
    if (text instanceof Map<?, ?> map) {
      Object defining = map.get("defining_code");
      String code = textOf(map.get("code_string"));
      if (code.isEmpty() && defining instanceof Map<?, ?> nested) {
        code = textOf(nested.get("code_string"));
      }
      Object termRaw = map.get("terminology_id");
      if (termRaw == null && defining instanceof Map<?, ?> nested) termRaw = nested.get("terminology_id");
      String term = termRaw instanceof Map<?, ?> termMap ? textOf(termMap.get("value")) : textOf(termRaw);
      if (!code.isEmpty()) {
        String value = textOf(map.get("value"));
        DvCodedText result = new DvCodedText(value.isEmpty() ? code : value, (term.isEmpty() ? "local" : term) + "::" + code);
        if (map.get("mappings") instanceof List<?> mappings) {
          List<TermMapping> converted = new ArrayList<>();
          for (Object item : mappings) {
            if (!(item instanceof Map<?, ?> mapping) || !(mapping.get("target") instanceof Map<?, ?> target)) continue;
            Object targetTerm = target.get("terminology_id");
            String terminology = targetTerm instanceof Map<?, ?> id ? textOf(id.get("value")) : textOf(targetTerm);
            TermMapping m = new TermMapping();
            String match = textOf(mapping.get("match"));
            m.setMatch(match.isEmpty() ? '=' : match.charAt(0));
            m.setTarget(new CodePhrase(terminology + "::" + textOf(target.get("code_string"))));
            converted.add(m);
          }
          result.setMappings(converted);
        }
        return result;
      }
      text = map.get("value");
    }
    String s = text == null ? "" : String.valueOf(text).trim();
    if (s.isEmpty()) return null;
    String key = s.toLowerCase();
    String[] hit = null;
    int matches = 0;
    if (choices != null) {
      for (String[] row : choices) {
        if (row == null || row.length < 2) continue;
        String code = row[0] == null ? "" : row[0].trim();
        String rubric = row[1] == null ? "" : row[1].trim();
        if (code.toLowerCase().equals(key) || rubric.toLowerCase().equals(key)) {
          hit = row;
          matches++;
        }
      }
    }
    if (matches != 1 || hit == null) {
      DvCodedText valueOnly = new DvCodedText();
      valueOnly.setValue(s);
      return valueOnly;
    }
    String code = hit[0] == null ? "" : hit[0].trim();
    String rubric = hit.length > 1 && hit[1] != null ? hit[1] : code;
    String terminology = hit.length > 2 && hit[2] != null && !hit[2].isBlank() ? hit[2] : "local";
    return new DvCodedText(rubric, terminology + "::" + code);
  }

  private static String textOf(Object value) {
    return value == null ? "" : String.valueOf(value).trim();
  }
}
