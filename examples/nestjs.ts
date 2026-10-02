import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { BlazeJob } from "blazerjob";

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private jobs = new BlazeJob({
    storage: "sqlite",
    dbPath: "./blazerjob.db",
    concurrency: 4,
    rate: { maxStarts: 20, intervalMs: 1000 }
  });

  async onModuleInit() {
    this.jobs.registerHandler("sync-user", async (payload, ctx) => {
      if (ctx.signal.aborted) return;
      return { userId: (payload as { userId: string }).userId };
    });
    await this.jobs.start();
  }

  async onModuleDestroy() {
    await this.jobs.shutdown({ timeoutMs: 10_000 });
  }
}
