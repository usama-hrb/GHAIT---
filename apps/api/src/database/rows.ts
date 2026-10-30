/** The base columns of a row as the database returns them (CLAUDE.md "Data rules"). */
export interface BaseRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  deviceId: string;
  voidedAt: Date | null;
}

/** A row's base columns as a record carries them (ISO timestamps). */
export function baseOf(row: BaseRow) {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deviceId: row.deviceId,
    voidedAt: row.voidedAt?.toISOString() ?? null,
  };
}

/** The base columns an insert takes from a record; voidedAt only ever comes from a void. */
export function baseValues(record: {
  id: string;
  createdAt: string;
  updatedAt: string;
  deviceId: string;
}) {
  return {
    id: record.id,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    deviceId: record.deviceId,
  };
}
