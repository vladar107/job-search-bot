import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";

export function setupCloudflareInfrastructure() {
    const config = new pulumi.Config();
    const accountId = config.require("cloudflareAccountId");

    // Create a Cloudflare KV Namespace
    const jobKV = new cloudflare.WorkersKvNamespace("job-kv-store", {
        accountId,
        title: "job-kv-store",
    });

    return { 
        jobKV,
        kvNamespaceId: jobKV.id
    };
}
