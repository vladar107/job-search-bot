import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import * as std from "@pulumi/std";

export function setupCloudflareInfrastructure() {
    const config = new pulumi.Config();
    const accountId = config.require("cloudflareAccountId");

    // // Create a Cloudflare Worker
    // const jobSearcherWorker = new cloudflare.WorkerScript("job-searcher", {
    //     accountId,
    //     name: "job-searcher-worker",
    //     content: std.file({input: "../workers/job-searcher/index.ts"})
    //         .then(invoke => invoke.result),
    // });
    //
    // const telegramBotWorker = new cloudflare.WorkerScript("telegram-bot", {
    //     accountId,
    //     name: "telegram-bot-worker",
    //     content: std.file({input: "../workers/telegram-bot/index.ts"})
    //         .then(invoke => invoke.result),
    // });

    // Create a Cloudflare Queue
    const jobQueue = new cloudflare.Queue("job-notifications", {
        accountId,
        name: "job-notifications-queue",
    });

    // Create a Cloudflare KV Namespace
    const jobKV = new cloudflare.WorkersKvNamespace("job-kv-store", {
        accountId,
        title: "job-kv-store",
    });

    return { jobQueue, jobKV };
}
