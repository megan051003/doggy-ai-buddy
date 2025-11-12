import fetch from "node-fetch";
import fs from "fs";

const BASE_URL = "https://correct-walrus-happily.ngrok-free.app";
const API_KEY = "YOUR_N8N_API_KEY"; // replace safely or leave blank if endpoint is public

// 🧩 extract nested field definitions
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
          Array.isArray(prop.options)
            ? prop.options.map((opt) => ({
                name: opt.name || opt.displayName,
                value: opt.value,
              }))
            : [],
      });
    }

    // recursively dive into nested options (collections)
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

// 🧩 extract all possible actions & triggers from options/fixedCollections
function extractActionsAndTriggers(properties = []) {
  const actions = [];
  const triggers = [];

  for (const prop of properties) {
    if (prop.type === "options" && Array.isArray(prop.options)) {
      for (const opt of prop.options) {
        const val = opt?.value ?? "";
        const disp = opt?.displayName ?? opt?.name ?? "";

        if (!disp) continue;

        // skip internal/custom pseudo-actions
        if (
          /custom api call/i.test(disp) ||
          (typeof val === "string" &&
            (val.includes("__CUSTOM__") || val.includes("__CUSTOM_API_CALL__")))
        ) {
          continue;
        }

        const base = {
          displayName: disp.trim(),
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

    // recursively check nested collections
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
    console.log("🐾 fetching node types from", `${BASE_URL}/types/nodes.json`);
    const res = await fetch(`${BASE_URL}/types/nodes.json`, {
      headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} - ${await res.text()}`);

    const nodes = await res.json();
    console.log("🐶 fetched", nodes.length, "nodes total");

    const summary = [];
    let hiddenCount = 0;

    for (const node of nodes) {
      // 🔒 skip internal/hidden/deprecated nodes like "Start"
      if (node.hidden || node.deprecated) {
        hiddenCount++;
        continue;
      }

      const { actions, triggers } = extractActionsAndTriggers(node.properties || []);
      const allFields = extractFieldDefs(node.properties || []);

      // skip nodes that have no visible actions/triggers and no real purpose
      if (!actions.length && !triggers.length && allFields.length === 0) continue;

      summary.push({
        name: node.name,
        displayName: node.displayName,
        description: node.description || "",
        group: node.group || [],
        version: node.version,
        icon: node.icon || "",
        actions,
        triggers,
        fields: allFields,
        doc: node.codex?.resources?.primaryDocumentation?.[0]?.url || "",
      });
    }

    // save cleaned list
    fs.writeFileSync("active_nodes_summary.json", JSON.stringify(summary, null, 2));
    console.log(
      `✅ saved active_nodes_summary.json with ${summary.length} nodes (skipped ${hiddenCount} hidden)`
    );
  } catch (err) {
    console.error("❌ failed:", err);
  }
}

main();
