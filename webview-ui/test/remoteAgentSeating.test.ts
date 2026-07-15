/// <reference lib="dom" />

import { describe, expect, it } from 'vitest';

import { createCharacter, updateCharacter } from '../src/office/engine/characters.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { deserializeLayout, serializeLayout } from '../src/office/layout/layoutSerializer.js';
import {
  CharacterState,
  Direction,
  type OfficeZone,
  type Seat,
  TileType,
} from '../src/office/types.js';

describe('remote agent seating', () => {
  it('preserves physical zones through layout serialization', () => {
    const office = new OfficeState();
    office.layout.zones = [{ id: 'zone-proof', minCol: 1, maxCol: 9, minRow: 10, maxRow: 20 }];
    const restored = deserializeLayout(serializeLayout(office.getLayout()));
    expect(restored?.zones).toEqual(office.getLayout().zones);
  });

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

  it('keeps a parent, child, and grandchild in one physical section while distinct roots spread out', () => {
    const office = new OfficeState();
    const zones: OfficeZone[] = Array.from({ length: 8 }, (_, index) => ({
      id: `zone-${index + 1}`,
      minCol: index * 10,
      maxCol: index * 10 + 8,
      minRow: 0,
      maxRow: 8,
    }));
    office.layout.zones = zones;
    office.seats = new Map();
    for (const zone of zones) {
      for (let index = 0; index < 3; index++) {
        const seatId = `${zone.id}-seat-${index}`;
        office.seats.set(seatId, {
          uid: seatId,
          seatCol: zone.minCol + 2 + index,
          seatRow: 4,
          facingDir: Direction.DOWN,
          assigned: false,
        });
      }
    }

    office.addAgent(1, undefined, undefined, 'zone-8-seat-0', true);
    office.setAgentActive(1, true);
    const zoneBeforeLateJoin = office.characters.get(1)?.zoneId;
    office.addAgent(2, undefined, undefined, 'zone-8-seat-1', true, undefined, 1);
    office.addAgent(3, undefined, undefined, 'zone-8-seat-2', true, undefined, 2);
    office.setAgentActive(2, true);
    office.setAgentActive(3, true);

    const familyZoneIds = new Set([1, 2, 3].map((id) => office.characters.get(id)?.zoneId));
    expect(familyZoneIds.size).toBe(1);
    const familyZoneId = office.characters.get(1)?.zoneId;
    expect(familyZoneId).toBe(zoneBeforeLateJoin);
    for (const id of [1, 2, 3]) {
      const character = office.characters.get(id)!;
      expect(character.zoneId).toBe(familyZoneId);
      expect(character.seatId?.startsWith(`${familyZoneId}-seat-`)).toBe(true);
    }

    office.addAgent(101, undefined, undefined, 'zone-8-seat-0', true);
    office.addAgent(102, undefined, undefined, 'zone-8-seat-1', true, undefined, 101);
    office.setAgentActive(101, true);
    office.setAgentActive(102, true);
    expect(office.characters.get(101)?.zoneId).not.toBe(familyZoneId);
    expect(office.characters.get(102)?.zoneId).toBe(office.characters.get(101)?.zoneId);
  });

  it('keeps idle wandering paths inside the lineage activity zone', () => {
    const seat: Seat = {
      uid: 'seat',
      seatCol: 0,
      seatRow: 0,
      facingDir: Direction.DOWN,
      assigned: true,
    };
    const character = createCharacter(1, 0, null, null);
    character.state = CharacterState.IDLE;
    character.isActive = false;
    character.tileCol = 0;
    character.tileRow = 1;
    character.wanderTimer = 0;
    character.wanderCount = 0;
    character.wanderLimit = 10;
    const tileMap = Array.from({ length: 3 }, () => Array(5).fill(TileType.FLOOR_1));
    const walkableTiles = tileMap.flatMap((_, row) => tileMap[0]!.map((__, col) => ({ col, row })));
    const random = Math.random;
    Math.random = () => 0.99;
    try {
      updateCharacter(character, 1, walkableTiles, new Map([['seat', seat]]), tileMap, new Set(), {
        minCol: 0,
        maxCol: 1,
        minRow: 0,
        maxRow: 2,
      });
    } finally {
      Math.random = random;
    }
    expect(character.path.length).toBeGreaterThan(0);
    expect(character.path.every((tile) => tile.col <= 1)).toBe(true);
  });

  it('skips a configured section that has no seats', () => {
    const office = new OfficeState();
    office.layout.zones = [
      { id: 'seatless', minCol: 0, maxCol: 4, minRow: 0, maxRow: 4 },
      { id: 'workable', minCol: 10, maxCol: 14, minRow: 0, maxRow: 4 },
    ];
    office.seats = new Map([
      [
        'workable-seat',
        {
          uid: 'workable-seat',
          seatCol: 12,
          seatRow: 2,
          facingDir: Direction.DOWN,
          assigned: false,
        },
      ],
    ]);
    office.addAgent(7, undefined, undefined, undefined, true);
    office.setAgentActive(7, true);
    expect(office.characters.get(7)?.zoneId).toBe('workable');
    expect(office.characters.get(7)?.seatId).toBe('workable-seat');
  });
});
