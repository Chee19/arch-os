import { MongoClient, type Db } from "mongodb";
import { ConfigError } from "@/engine/errors";

const cache = globalThis as typeof globalThis & {
  _archosMongo?: Promise<MongoClient>;
};

export function client(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return Promise.reject(new ConfigError("MONGODB_URI is not set."));
  // One client per warm function instance; forget it after a failed connect so the next request retries.
  cache._archosMongo ??= new MongoClient(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 8000,
  })
    .connect()
    .catch((e: unknown) => {
      cache._archosMongo = undefined;
      throw e;
    });
  return cache._archosMongo;
}

export async function db(
  name = process.env.MONGODB_DB ?? "archos",
): Promise<Db> {
  return (await client()).db(name);
}
