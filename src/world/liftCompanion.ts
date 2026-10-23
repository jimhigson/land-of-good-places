/**
 * **How far behind her, metres, her companion stands in a lift car** — the
 * castle's and the hotel's alike (`CompanionRide`'s `beside`, by way of
 * `Player`'s `companionBehind`). She rides near the car's mouth facing its
 * doors, and the room in a car is behind her: in the castle she stands 0.9 m in
 * from a car 2.43 m deep (`building/layout.ts`, `LIFT_RIDER_DEPTH`), in the
 * hotel 1.9 m in from an alcove 3.4 m deep (`hotel/layout.ts`). A companion
 * stood 0.8 m further in reaches at most 0.69 m behind its own feet (RiPika,
 * measured off the built models), so its back stays 0.04 m inside the castle's
 * car and 0.01 m inside the hotel's. Through the door it goes first, and one of
 * them is narrower than either door.
 *
 * One owner for both lifts, here rather than in either, so the two cannot
 * drift apart.
 */
export const LIFT_COMPANION_BACK = 0.8;
