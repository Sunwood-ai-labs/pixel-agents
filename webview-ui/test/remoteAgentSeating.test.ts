/// <reference lib="dom" />

import { describe, expect, it } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import { Direction, type Seat } from '../src/office/types.js';

describe('remote agent seating', () => {
  it('moves a child near a parent that arrives later', () => {
    const office = new OfficeState();
    const seat = (uid: string, seatCol: number, seatRow: number): Seat => ({
      uid,
      seatCol,
      seatRow,
      facingDir: Direction.DOWN,
      assigned: false,
    });
    office.seats = new Map([
      ['far-left', seat('far-left', 1, 1)],
      ['near-parent', seat('near-parent', 9, 9)],
      ['parent', seat('parent', 10, 10)],
    ]);
    const seats = [...office.seats.entries()];
    expect(seats.length).toBeGreaterThan(2);

    let farthest = { first: seats[0]![0], second: seats[1]![0], distance: -1 };
    for (const [firstId, first] of seats) {
      for (const [secondId, second] of seats) {
        const distance =
          (first.seatCol - second.seatCol) ** 2 + (first.seatRow - second.seatRow) ** 2;
        if (distance > farthest.distance) farthest = { first: firstId, second: secondId, distance };
      }
    }

    office.addAgent(2, undefined, undefined, farthest.first, true, 'Remote child', 1);
    office.addAgent(1, undefined, undefined, farthest.second, true, 'Remote parent');
    const child = office.characters.get(2)!;
    const parent = office.characters.get(1)!;
    const parentSeat = office.seats.get(parent.seatId!)!;
    const childSeatBefore = office.seats.get(child.seatId!)!;
    const before =
      (childSeatBefore.seatCol - parentSeat.seatCol) ** 2 +
      (childSeatBefore.seatRow - parentSeat.seatRow) ** 2;

    office.setTeamInfo(2, 'Remote', 'child', false, 1);

    const childSeatAfter = office.seats.get(child.seatId!)!;
    const after =
      (childSeatAfter.seatCol - parentSeat.seatCol) ** 2 +
      (childSeatAfter.seatRow - parentSeat.seatRow) ** 2;
    expect(after).toBeLessThan(before);
    expect(child.leadAgentId).toBe(1);

    office.setAgentActive(1, true);
    office.setAgentActive(2, true);
    const clusteredParentSeat = office.seats.get(parent.seatId!)!;
    const clusteredChildSeat = office.seats.get(child.seatId!)!;
    const clusteredDistance =
      (clusteredChildSeat.seatCol - clusteredParentSeat.seatCol) ** 2 +
      (clusteredChildSeat.seatRow - clusteredParentSeat.seatRow) ** 2;
    expect(clusteredDistance).toBeLessThanOrEqual(2);
    expect(child.tileCol).toBe(clusteredChildSeat.seatCol);
    expect(child.tileRow).toBe(clusteredChildSeat.seatRow);
  });
});
