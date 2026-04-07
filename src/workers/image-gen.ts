/**
 * Image generation for the social campaign worker.
 * Uses Fal.ai Flux Schnell - chosen for speed (2-4s/image)
 * and low cost (~$0.003/image) so the total image gen cost
 * for a shift is negligible next to the LLM costs.
 *
 * Fal.ai API docs: https://fal.ai/models/fal-ai/flux/schnell
 */

import { SocialPost } from "@/types/shift";

const FAL_ENDPOINT = "https://fal.run/fal-ai/flux/schnell";

interface FalResponse {
  images: Array<{ url: string; width: number; height: number }>;
  timings?: Record<string, number>;
}

export async function generateImage(prompt: string): Promise<string> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) {
    // Graceful fallback: return a placeholder URL so the shift
    // doesn't fail if FAL_API_KEY isn't configured yet.
    console.warn("FAL_API_KEY not set - returning placeholder image URL");
    return placeholderForPrompt(prompt);
  }

  const response = await fetch(FAL_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_size: "square_hd",
      num_inference_steps: 4,
      num_images: 1,
      enable_safety_checker: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Fal.ai image generation failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as FalResponse;
  if (!data.images || data.images.length === 0) {
    throw new Error("Fal.ai returned no images");
  }

  return data.images[0].url;
}

export async function generateImagesForCampaign(
  posts: SocialPost[]
): Promise<SocialPost[]> {
  // Generate in parallel - this is a sub-fan-out inside the social worker
  const withImages = await Promise.all(
    posts.map(async (post) => {
      try {
        const imageUrl = await generateImage(post.imagePrompt);
        return { ...post, imageUrl };
      } catch (err) {
        console.error(`Image generation failed for ${post.platform}:`, err);
        return { ...post, imageUrl: placeholderForPrompt(post.imagePrompt) };
      }
    })
  );
  return withImages;
}

function placeholderForPrompt(prompt: string): string {
  // Use a deterministic placeholder service so the demo still looks
  // reasonable even without real image generation.
  const seed = encodeURIComponent(prompt.slice(0, 32));
  return `https://picsum.photos/seed/${seed}/800/800`;
}
