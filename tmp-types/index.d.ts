export declare class BlazeJob {
    private db;
    private timer?;
    constructor(options: {
        dbPath: string;
    });
    start(): Promise<void>;
    stop(): void;
    private tick;
    /**
     * Schedule a new task and store its function in the taskMap.
     * @param taskFn The function to execute for this task
     * @param opts Task options: runAt, interval, priority, retriesLeft, type, config
     * @returns The inserted task ID
     */
    schedule(taskFn: () => Promise<void>, opts: {
        runAt: Date | string;
        interval?: number;
        priority?: number;
        retriesLeft?: number;
        type: string;
        config?: any;
    }): number;
}
export declare function stopServer(): Promise<void>;
