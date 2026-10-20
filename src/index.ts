
import "dotenv/config";
import { WordPressClient } from "./wordpress-client";

async function main(): Promise<void> {
  const url = process.env.WP_URL;
  const username = process.env.WP_USERNAME;
  const password = process.env.WP_APP_PASSWORD;

  if (!url || !username || !password) {
    throw new Error("Missing WP_URL, WP_USERNAME, or WP_APP_PASSWORD in .env");
  }

  const client = new WordPressClient(url, username, password);
  const plugins = await client.getPlugins();

  console.log(`Found ${plugins.length} plugins:\n`);

  for (const plugin of plugins) {
    console.log({
      name: plugin.name,
      version: plugin.version,
      status: plugin.status,
      slug: plugin.plugin,
    });
  }
}

main().catch((error: unknown) => {
  console.error("Collection failed:", error);
  process.exitCode = 1;
});
