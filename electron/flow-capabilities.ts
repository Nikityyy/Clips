import type { ProviderCapabilities } from '../src/shared/contracts';
import type { FlowCatalog } from './flow-catalog';
import { FLOW_IMAGE_ASPECTS, FLOW_VIDEO_ASPECTS, isSupportedFlowBatchModel } from './flow-batch';

/** Dynamic catalog adapter: keep friendly live names while exposing only verified batch-API options. */
export function mapFlowCapabilities(
  catalog: FlowCatalog,
  profileName: string,
  status: ProviderCapabilities['status'],
  detail: string,
): ProviderCapabilities {
  const models = catalog.models.filter((model) => isSupportedFlowBatchModel(model.kind, model.aliases)).map((model) => ({
    id: model.id,
    label: model.label,
    kind: model.kind,
    description: model.label,
    supportsReferences: model.referenceCap > 0,
    supportsCharacter: false,
    aliases: model.aliases,
    referenceCap: model.referenceCap,
    maxDuration: model.maxDuration,
    creditCost: null,
  }));
  return {
    provider: 'google-flow',
    status,
    label: 'Google Flow',
    detail,
    models,
    imageAspectRatios: catalog.imageAspectRatios.filter((ratio) => ratio in FLOW_IMAGE_ASPECTS),
    videoAspectRatios: catalog.videoAspectRatios.filter((ratio) => ratio in FLOW_VIDEO_ASPECTS),
    profileName,
    supportsImageToVideo: models.some((model) => model.kind === 'video' && model.referenceCap > 0),
    creditCost: null,
  };
}
