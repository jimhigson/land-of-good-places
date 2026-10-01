import type { ParkUnavailable } from '../world/prebuilt/parkUnavailable';

/**
 * **"This park can't be opened"** — what a child sees when the park she asked
 * for has no park file this game can use (`world/prebuilt/parkUnavailable.ts`,
 * `docs/design/PREBUILT-PARKS.md`).
 *
 * Jim, 24 September 2026: *"seeds not downloadable is an error."* The game
 * carries no solver, so there is nothing to fall back to; this says so plainly
 * instead of leaving a bus idling at the kerb. Big and short for her, per
 * GAME_DESIGN.md's TEXT rule (nothing below `--lgp-text-min`); the seed and the
 * reason underneath for the grown-up she will fetch.
 *
 * **Retry is a reload** (`boot/prebuiltPark.ts`): it fetches the file again and
 * never solves. When the park came from a `?seed=` in the address — the one way
 * to ask for a seed outside the game's parks — a second button drops it and
 * opens her own park instead.
 */
export function showParkUnavailable(error: ParkUnavailable, splash: HTMLElement | null): void {
  const host = splash ?? document.body;
  host.classList.remove('hidden');
  host.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'boot-card park-unavailable';
  card.setAttribute('role', 'alert');

  const glyph = document.createElement('div');
  glyph.className = 'park-unavailable-glyph';
  glyph.textContent = '🗺️';

  const title = document.createElement('h1');
  title.textContent = "We can't find this park";

  const line = document.createElement('p');
  line.className = 'park-unavailable-line';
  line.textContent = `Park ${error.seed} isn't here.`;

  const why = document.createElement('p');
  why.className = 'park-unavailable-why';
  why.textContent = `For grown-ups: park ${error.seed} could not be opened because ${error.reason}.`;

  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'shop-buy park-unavailable-go';
  again.innerHTML = '<span class="emoji">🔄</span><span>Try again</span>';
  again.addEventListener('click', () => location.reload());

  card.append(glyph, title, line, why, again);

  const params = new URLSearchParams(location.search);
  if (params.has('seed')) {
    params.delete('seed');
    const query = params.toString();
    const home = document.createElement('button');
    home.type = 'button';
    home.className = 'shop-buy park-unavailable-go';
    home.innerHTML = '<span class="emoji">🎡</span><span>Go to my park</span>';
    home.addEventListener('click', () => {
      location.href = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
    });
    card.append(home);
  }

  host.append(card);
}
