import { BlazeJob } from "blazerjob";

export async function runLibraryExample() {
  const jobs = new BlazeJob({ concurrency: 2 });
  jobs.registerHandler("work", async (payload) => ({ done: payload }));
  const id = jobs.schedule(undefined, { handler: "work", payload: { n: 1 }, runAt: new Date() });
  await jobs.start();
  const result = await jobs.waitFor(id);
  await jobs.shutdown();
  return result;
}
