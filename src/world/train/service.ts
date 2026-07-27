/**
 * The bit of the train the rest of the game is allowed to see.
 *
 * The children in the park ride the train, and a `WanderDriver` deciding to
 * catch one needs to know four things: where the stations are, whether there is
 * a seat going, whether it still has one, and where the train has got to. It
 * does **not** need a reference to the train, the route, or three.js — so this
 * is the whole of the coupling between `entities/npc` and `world/train`, and it
 * is a plain data interface behind a module singleton.
 *
 * Why a singleton rather than something passed in: `NpcSystem` builds its
 * drivers in its constructor, and the train is built alongside it in `World`.
 * Threading a train through the crowd's constructor would put a park feature in
 * the signature of the character system, which is exactly the sort of coupling
 * `driver.ts` exists to avoid. A driver asks "is there a train today?" and gets
 * `null` in any world that does not have one.
 */

/** Where a station is, and where a child stands to wait for the train. */
export interface TrainStop {
  readonly index: number;
  readonly name: string;
  /** Centre of the platform. */
  readonly x: number;
  readonly z: number;
}

/**
 * Something holding a seat on the train.
 *
 * `WanderDriver` satisfies this structurally, so the train can pick its
 * passengers out of the crowd without importing the behaviour script — or the
 * crowd importing the train.
 */
export interface TrainPassenger {
  /** Seat number, or `null` when this one is not aboard. */
  readonly trainSeat: number | null;
}

export interface TrainService {
  readonly stops: readonly TrainStop[];

  /** The nearest station to a point, or `null` if there are none. */
  nearestStop(x: number, z: number): TrainStop | null;

  /**
   * Takes a seat, if the train is standing at `stop` with room for one more.
   * Returns the seat number, or `null` if it is not offering.
   */
  claimSeat(stop: number): number | null;

  /** Still yours? Goes false if the train is rebuilt underneath you. */
  seatValid(seat: number): boolean;

  /** The stop the train is standing at right now, or `null` while it moves. */
  stoppedAt(): number | null;

  /** Gives the seat up. Safe to call twice. */
  leaveSeat(seat: number): void;
}

let current: TrainService | null = null;

/** Installed by `ParkTrain` when it is built, and cleared when it is disposed. */
export function setTrainService(service: TrainService | null): void {
  current = service;
}

/** The park's train, if this world has one. */
export function trainService(): TrainService | null {
  return current;
}
