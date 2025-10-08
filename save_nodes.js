import fetch from "node-fetch";
import fs from "fs";

const BASE_URL = "https://correct-walrus-happily.ngrok-free.app";
const API_KEY = "YOUR_N8N_API_KEY"; // replace safely

// Recursively extract subfields for each action (like Sort Order, After, Before)
function extractFieldDefs(properties = []) {
  const fields = [];
  for (const prop of properties) {
    if (prop.displayName && prop.name) {
      fields.push({
        displayName: prop.displayName,
        name: prop.name,
        type: prop.type,
        description: prop.description || "",
        default: prop.default ?? "",
        options:
          prop.options?.map((opt) => ({
            name: opt.name || opt.displayName,
            value: opt.value,
          })) || [],
      });
    }

    // recurse into collections
    if (Array.isArray(prop.options)) {
      for (const opt of prop.options) {
        if (Array.isArray(opt.values)) {
          fields.push(...extractFieldDefs(opt.values));
        }
      }
    }
  }
  return fields;
}

function extractActionsAndTriggers(properties = []) {
  const actions = [];
  const triggers = [];

  for (const prop of properties) {
    if (prop.type === "options" && Array.isArray(prop.options)) {
      for (const opt of prop.options) {
        const val = opt?.value ?? "";
        const disp = opt?.displayName ?? opt?.name ?? "";

        if (!disp) continue;

        // 🧠 skip internal/custom
        if (
          /custom api call/i.test(disp) ||
          (typeof val === "string" &&
            (val.includes("__CUSTOM__") || val.includes("__CUSTOM_API_CALL__")))
        ) {
          continue;
        }

        const base = {
          name: disp.trim(),
          value: typeof val === "string" ? val : JSON.stringify(val),
          description: opt.description || "",
        };

        if (/trigger/i.test(disp) || /event/i.test(disp)) {
          triggers.push(base);
        } else {
          actions.push(base);
        }
      }
    }

    // recurse into nested collections
    if (prop.type === "fixedCollection" && Array.isArray(prop.options)) {
      for (const opt of prop.options) {
        const nested = extractActionsAndTriggers(opt.values || []);
        actions.push(...nested.actions);
        triggers.push(...nested.triggers);
      }
    }
  }

  return { actions, triggers };
}


async function main() {
  try {
    const res = await fetch(`${BASE_URL}/types/nodes.json`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} - ${await res.text()}`);

    const nodes = await res.json();
    console.log("🐶 fetched", nodes.length, "nodes");

    const summary = nodes.map((node) => {
      const { actions, triggers } = extractActionsAndTriggers(node.properties || []);
      const allFields = extractFieldDefs(node.properties || []);

      return {
        name: node.name,
        displayName: node.displayName,
        description: node.description,
        actions,
        triggers,
        fields: allFields, // <--- NEW
      };
    });

    fs.writeFileSync("active_nodes_summary.json", JSON.stringify(summary, null, 2));
    console.log("✅ saved active_nodes_summary.json with", summary.length, "nodes");
  } catch (err) {
    console.error("❌ failed:", err);
  }
}

main();
