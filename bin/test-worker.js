#!/usr/bin/env node
import { expandAndPush } from "../src/service.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: test-worker <share-url> [--title T] [--priority N] [--sound S] [--device D]");
    process.exit(1);
  }
  const shareUrl = args[0];
  const opts = parseOpts(args.slice(1));

  const result = await expandAndPush(shareUrl, opts);
  console.log(JSON.stringify(result, null, 2));
}

function parseOpts(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const v = args[i + 1];
    if (k === "--title") { out.title = v; i++; }
    else if (k === "--priority") { out.priority = v; i++; }
    else if (k === "--sound") { out.sound = v; i++; }
    else if (k === "--device") { out.device = v; i++; }
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
