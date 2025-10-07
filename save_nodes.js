import fetch from "node-fetch";
import fs from "fs";

// 🔑 Replace with your n8n instance + API key
const BASE_URL = "https://correct-walrus-happily.ngrok-free.app";
const API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...."; // your JWT

// Recursive walker for properties
function extractOptions(properties = [], resource = null) {
  let results = [];

  for (const prop of properties) {
    if (prop.type === "options" && Array.isArray(prop.options)) {
      for (const opt of prop.options) {
        results.push({
          resource: resource || prop.name || null,
          name: opt.displayName || opt.name,
          value: opt.value,
          action: opt.action || null,
          description: opt.description || null,
        });
      }
    }

    // Handle nested collections
    if (prop.type === "fixedCollection" && Array.isArray(prop.options)) {
      for (const opt of prop.options) {
        results = results.concat(extractOptions(opt.values || [], resource));
      }
    }

    if (prop.type === "collection" && Array.isArray(prop.options)) {
      results = results.concat(extractOptions(prop.options, resource));
    }
  }

  return results;
}

async function main() {
  try {
    const url = `${BASE_URL}/types/nodes.json`;
    console.log(`🐶 Fetching from: ${url}`);

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} - ${await res.text()}`);
    }

    const nodes = await res.json();

    const summary = nodes.map((node) => {
      const triggers = extractOptions(node.properties || []).filter((o) =>
        /trigger|rowadded|event/i.test(o.name + o.value)
      );

      const actions = extractOptions(node.properties || []).filter(
        (o) => !/trigger/i.test(o.name + o.value)
      );

      return {
        name: node.name,
        displayName: node.displayName,
        description: node.description,
        triggers,
        actions,
      };
    });

    fs.writeFileSync("active_nodes_summary.json", JSON.stringify(summary, null, 2));
    console.log("✅ active_nodes_summary.json created with", summary.length, "nodes");
  } catch (err) {
    console.error("❌ Failed:", err.message);
  }
}

main();
