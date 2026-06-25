import type { InferSelectModel, Table } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { Array as EffectArray, Struct } from "effect";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  Database,
  type DatabaseError,
  type TransactionClient,
  type TxFn,
} from "./database";

export interface RepositoryOptions<Col extends string, Name extends string> {
  idColumn: Col;
  name: Name;
}

export type PartialExcept<T, K extends keyof T> = Partial<Omit<T, K>> &
  Pick<T, K>;

export class EntityNotFound extends Schema.TaggedErrorClass<EntityNotFound>()(
  "EntityNotFound",
  {
    type: Schema.String,
    id: Schema.Any,
  }
) {}

export interface RepositorySchemas<
  InsertSchema extends Schema.Top,
  UpdateSchema extends Schema.Struct<any>,
> {
  readonly insert: InsertSchema;
  readonly update: UpdateSchema;
}

export interface Repository<
  RecordType,
  InsertType,
  UpdateType,
  Col extends keyof UpdateType & string,
  Id,
> {
  readonly deleteById: (
    id: Id,
    tx?: <U>(
      fn: (client: TransactionClient) => Promise<U>
    ) => Effect.Effect<U, DatabaseError>
  ) => Effect.Effect<void, DatabaseError>;

  readonly findById: (
    id: Id,
    tx?: <U>(
      fn: (client: TransactionClient) => Promise<U>
    ) => Effect.Effect<U, DatabaseError>
  ) => Effect.Effect<Option.Option<RecordType>, DatabaseError>;
  readonly insert: (
    insert: InsertType,
    tx?: <U>(
      fn: (client: TransactionClient) => Promise<U>
    ) => Effect.Effect<U, DatabaseError>
  ) => Effect.Effect<RecordType[], DatabaseError | Schema.SchemaError>;

  readonly insertVoid: (
    insert: InsertType,
    tx?: <U>(
      fn: (client: TransactionClient) => Promise<U>
    ) => Effect.Effect<U, DatabaseError>
  ) => Effect.Effect<void, DatabaseError | Schema.SchemaError>;

  readonly update: (
    update: PartialExcept<UpdateType, Col>,
    tx?: <U>(
      fn: (client: TransactionClient) => Promise<U>
    ) => Effect.Effect<U, DatabaseError>
  ) => Effect.Effect<RecordType, DatabaseError | Schema.SchemaError>;

  readonly updateVoid: (
    update: PartialExcept<UpdateType, Col>,
    tx?: <U>(
      fn: (client: TransactionClient) => Promise<U>
    ) => Effect.Effect<U, DatabaseError>
  ) => Effect.Effect<void, DatabaseError | Schema.SchemaError>;

  readonly with: <A, E, R>(
    id: Id,
    f: (item: RecordType) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | EntityNotFound | DatabaseError, R>;
}

export function makeRepository<
  T extends Table<any>,
  InsertSchema extends Schema.Top,
  UpdateSchema extends Schema.Struct<any>,
  Col extends keyof InferSelectModel<T> & keyof UpdateSchema["Type"] & string,
  Name extends string,
  RecordType extends InferSelectModel<T>,
  Id extends InferSelectModel<T>[Col],
>(
  table: T,
  schemas: RepositorySchemas<InsertSchema, UpdateSchema>,
  options: RepositoryOptions<Col, Name>
): Effect.Effect<
  Repository<
    RecordType,
    InsertSchema["Type"],
    UpdateSchema["Type"],
    Col,
    Id
  >,
  never,
  Database
> {
  return Effect.gen(function* () {
    const db = yield* Database;
    const { idColumn } = options;
    const updateSchema = schemas.update.mapFields(Struct.map(Schema.optional));

    const insert = (data: InsertSchema["Type"], tx?: TxFn) =>
      db.makeQueryWithSchema(
        schemas.insert as Schema.Top,
        (execute, input: any) =>
          execute((client) => client.insert(table).values([input]).returning())
      )(data, tx) as unknown as Effect.Effect<
        RecordType[],
        DatabaseError | Schema.SchemaError
      >;

    const insertVoid = (data: InsertSchema["Type"], tx?: TxFn) =>
      db.makeQueryWithSchema(
        schemas.insert as Schema.Top,
        (execute, input: any) =>
          execute((client) => client.insert(table).values(input))
      )(data, tx) as unknown as Effect.Effect<
        void,
        DatabaseError | Schema.SchemaError
      >;

    const update = (
      data: PartialExcept<UpdateSchema["Type"], Col>,
      tx?: TxFn
    ) =>
      db.makeQueryWithSchema(updateSchema, (execute, input: any) =>
        execute((client) =>
          client
            .update(table)
            .set(input)
            // @ts-expect-error drizzle column access is runtime-indexed by configured idColumn
            .where(eq(table[idColumn], input[idColumn]))
            .returning()
        ).pipe(
          Effect.flatMap((result) =>
            Option.match(EffectArray.get(0)(result), {
              onNone: () =>
                Effect.die(
                  new EntityNotFound({
                    type: options.name,
                    id: input[idColumn],
                  })
                ),
              onSome: (record) => Effect.succeed(record as RecordType),
            })
          )
        )
      )(data, tx) as Effect.Effect<
        RecordType,
        DatabaseError | Schema.SchemaError
      >;

    const updateVoid = (
      data: PartialExcept<UpdateSchema["Type"], Col>,
      tx?: TxFn
    ) =>
      db.makeQueryWithSchema(updateSchema, (execute, input: any) =>
        execute((client) =>
          client
            .update(table)
            .set(input)
            // @ts-expect-error drizzle column access is runtime-indexed by configured idColumn
            .where(eq(table[idColumn], input[idColumn]))
        )
      )(data, tx) as unknown as Effect.Effect<
        void,
        DatabaseError | Schema.SchemaError
      >;

    const findById = (id: Id, tx?: TxFn) =>
      db.makeQuery((execute, inputId: Id) =>
        execute((client) =>
          client
            .select()
            .from(table as Table<any>)
            // @ts-expect-error drizzle column access is runtime-indexed by configured idColumn
            .where(eq(table[idColumn], inputId))
            .limit(1)
        ).pipe(
          Effect.map(EffectArray.get(0)),
          Effect.map(Option.map((result) => result as RecordType))
        )
      )(id, tx) as Effect.Effect<Option.Option<RecordType>, DatabaseError>;

    const deleteById = (id: Id, tx?: TxFn) =>
      db.makeQuery((execute, inputId: Id) =>
        execute((client) =>
          // @ts-expect-error drizzle column access is runtime-indexed by configured idColumn
          client.delete(table).where(eq(table[idColumn], inputId))
        )
      )(id, tx) as Effect.Effect<void, DatabaseError>;

    const with_ = <A, E, R>(
      id: Id,
      f: (item: RecordType) => Effect.Effect<A, E, R>
    ): Effect.Effect<A, E | EntityNotFound | DatabaseError, R> =>
      findById(id).pipe(
        Effect.flatMap((result) =>
          Option.match(result, {
            onNone: () =>
              Effect.fail(new EntityNotFound({ type: options.name, id })),
            onSome: (item) => Effect.succeed(item),
          })
        ),
        Effect.flatMap(f)
      );

    return {
      insert,
      insertVoid,
      update,
      updateVoid,
      findById,
      deleteById,
      with: with_,
    };
  });
}
