import { BlazeJob } from "blazerjob";

export async function runHttpExample(url: string) {
  const jobs = new BlazeJob();
  const id = jobs.schedule(undefined, {
    runAt: new Date(),
    type: "http",
    config: {
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { hello: "world" }
    }
  });
  await jobs.start();
  const snapshot = await jobs.waitFor(id);
  await jobs.shutdown();
  return snapshot;
}
