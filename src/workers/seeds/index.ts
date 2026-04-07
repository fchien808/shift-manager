import type { WorkerSpec } from "@/types/worker-spec";
import { positioningSpec } from "./positioning";
import { marketingCopySpec } from "./marketing-copy";
import { websiteSpec } from "./website";
import { socialCampaignSpec } from "./social-campaign";
import { csDocsSpec } from "./cs-docs";
import { verificationSpec } from "./verification";

export const seedWorkerSpecs: WorkerSpec[] = [
  positioningSpec,
  marketingCopySpec,
  websiteSpec,
  socialCampaignSpec,
  csDocsSpec,
  verificationSpec,
];

export {
  positioningSpec,
  marketingCopySpec,
  websiteSpec,
  socialCampaignSpec,
  csDocsSpec,
  verificationSpec,
};
