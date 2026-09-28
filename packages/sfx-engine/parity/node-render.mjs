import { renderRecipe } from '../dist/index.js';
import { pcmSha256 } from './pcm.mjs';

/** Node's own reference render for one fixed input: the same `renderRecipe`
 * call every environment (Node, or a browser through `harness.html`) makes,
 * on the same recipe. */
export function renderInputNode(input) {
  const rendered = renderRecipe(input.recipe);
  return { id: input.id, sha256: pcmSha256(rendered), left: rendered.left, right: rendered.right, sampleRate: rendered.sampleRate };
}
