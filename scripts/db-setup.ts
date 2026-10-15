import { client, db } from "@/db";
import { ensureIndexes } from "@/engine/store";

async function main() {
  const names = [
    process.env.MONGODB_DB ?? "archos",
    process.env.MONGODB_TEST_DB ?? "archos_test",
    "archos_preview",
  ];
  for (const name of names) {
    await ensureIndexes(await db(name));
    console.log(`Indexes ready in ${name}`);
  }
  await (await client()).close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
