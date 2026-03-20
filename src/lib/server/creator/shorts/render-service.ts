import { generateMockShortRender } from "../../../creator/mock";
import type { CreatorShortRenderRequest, CreatorShortRenderResponse } from "../../../creator/types";

export async function renderCreatorShort(input: CreatorShortRenderRequest): Promise<CreatorShortRenderResponse> {
  return generateMockShortRender(input);
}
