/**
 * Side-effect import: puts {@link installDeterministicMath}'s functions on the
 * global `Math`. It must be the **first** import of an entry point, so that no
 * module computes anything with the platform's own functions before it runs.
 * See `deterministicMath.ts` for why.
 */
import { installDeterministicMath } from './deterministicMath';

installDeterministicMath();
