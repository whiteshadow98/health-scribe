import type { AppConfig } from '@mlc-ai/web-llm'
import { FINETUNED_MODEL, RETIRED_FINETUNED_MODELS } from './models'

// WebLLM is large, so it loads after the first paint instead of blocking it.
export const webllm = () => import('@mlc-ai/web-llm')

let appConfigPromise: Promise<AppConfig> | null = null

/** WebLLM's built-in model list plus the Health Scribe fine-tuned model. */
export function getAppConfig(): Promise<AppConfig> {
  appConfigPromise ??= webllm().then(({ prebuiltAppConfig }) => {
    const base = prebuiltAppConfig.model_list.find((m) => m.model_id === FINETUNED_MODEL.baseId)
    if (!base || !FINETUNED_MODEL.enabled) return prebuiltAppConfig
    return {
      ...prebuiltAppConfig,
      model_list: [
        ...prebuiltAppConfig.model_list,
        ...[FINETUNED_MODEL, ...RETIRED_FINETUNED_MODELS].map((m) => ({ ...base, model: m.url, model_id: m.id })),
      ],
    }
  })
  return appConfigPromise
}

export async function isModelCached(id: string): Promise<boolean> {
  const [{ hasModelInCache }, appConfig] = await Promise.all([webllm(), getAppConfig()])
  return hasModelInCache(id, appConfig).catch(() => false)
}

export async function deleteCachedModel(id: string): Promise<void> {
  const [{ deleteModelAllInfoInCache }, appConfig] = await Promise.all([webllm(), getAppConfig()])
  await deleteModelAllInfoInCache(id, appConfig).catch(() => undefined)
}

/** Frees the storage used by earlier fine-tuned releases. */
export async function deleteRetiredModels(): Promise<void> {
  for (const { id } of RETIRED_FINETUNED_MODELS) {
    if (await isModelCached(id)) await deleteCachedModel(id)
  }
}
