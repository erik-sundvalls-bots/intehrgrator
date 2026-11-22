import { assertEquals } from "@std/assert";
import {
  lineNumberForDeserializeError,
  lineNumberForRmPath,
} from "@intehrgrator/core/output/json_line_lookup.ts";

const sampleJson = `{
  "content": [
    {
      "data": {
        "events": [
          {
            "data": {
              "items": [
                {
                  "value": {
                    "magnitude": 120
                  }
                }
              ]
            }
          }
        ]
      }
    }
  ]
}`;

Deno.test("lineNumberForRmPath finds nested attribute line", () => {
  assertEquals(
    lineNumberForRmPath(sampleJson, "/content[0]/data/events[0]/data/items[0]/value/magnitude"),
    11,
  );
});

Deno.test("lineNumberForDeserializeError finds property from nested message", () => {
  const message =
    "Failed to deserialize property 'content' of COMPOSITION: Failed to deserialize property 'magnitude' of DV_QUANTITY: Cannot determine type";
  assertEquals(lineNumberForDeserializeError(sampleJson, message), 11);
});

Deno.test("lineNumberForRmPath distinguishes array index [0] from [1] (#373)", () => {
  const twoItemsJson = JSON.stringify(
    {
      content: [
        {
          data: {
            events: [
              {
                data: {
                  items: [
                    { value: { magnitude: 120 } },
                    { value: { magnitude: 80 } },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
    null,
    2,
  );
  assertEquals(
    lineNumberForRmPath(twoItemsJson, "/content[0]/data/events[0]/data/items[0]/value/magnitude"),
    11,
  );
  assertEquals(
    lineNumberForRmPath(twoItemsJson, "/content[0]/data/events[0]/data/items[1]/value/magnitude"),
    16,
  );
});

