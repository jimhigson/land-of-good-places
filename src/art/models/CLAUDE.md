# Art models: hoods, hats and other worn items


RiPika's and Trilla's hood faces (`hoodShell.ts`/`hats.ts`) were built as a
separate decal mesh floating just in front of the hood's own dome. It was
wound the opposite way round from the dome, so its normals pointed at the
wearer's skull and `MeshToonMaterial`'s `FrontSide` culled it: invisible in
the running game while the mesh, the texture and the code all looked correct
on inspection, and *unfixable* by moving it further out — the first fix
tried, padding the stand-off distance, could not have worked, because the
mesh was never being drawn at all. Found the hard way (31 July 2026) by
casting a ray in from outside and finding it hit nothing. Fixed by baking the
face texture directly into the wearable's own UV mapping instead of a second
mesh — a second mesh that has to be positioned right, every time, is a second
place for exactly this kind of bug to hide.

**When a worn item needs a painted face (or any flat appliqué), paint it into
that item's own UV space. Do not add a second mesh positioned by a formula
that has to track the first one's surface.** One surface, one texture: there
is then no second formula that can fall out of sync when the first one
changes. This does not conflict with ART_DIRECTION.md §7's "nothing is
sculpted, the face is flat appliqué" rule — only *where* the flat texture
lives changes, not the no-sculpting principle.
