import { runPoll, startBackgroundPoller } from "../lib/poller";

const once = process.argv.includes("--once");

async function main() {
  if (once) {
    const result = await runPoll("manual");
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  startBackgroundPoller();
  console.log("Shipyard agent is polling GitHub. Press Ctrl+C to stop.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
