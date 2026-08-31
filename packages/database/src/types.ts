export type SqlPrimitive = string | number | bigint | boolean | null | Uint8Array | undefined;
export type SqlParams = SqlPrimitive | SqlPrimitive[] | Record<string, SqlPrimitive>;

export type Statement = {
  get(...params: SqlParams[]): Promise<unknown>;
  all(...params: SqlParams[]): Promise<unknown[]>;
  run(...params: SqlParams[]): Promise<{ changes: number }>;
};

export type Db = {
  readonly dialect: 'sqlite' | 'postgres';
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
};
