"""Lazy pgvector storage isolated to a uniquely named benchmark schema."""

import math
from uuid import uuid4

from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, select, text
from sqlalchemy.engine import Engine

HNSW_MAX_VECTOR_DIMENSION = 2000


class VectorExtensionUnavailable(RuntimeError):
    """The target database does not already have the pgvector extension."""


def has_vector_extension(database_url: str) -> bool:
    if not database_url.startswith("postgresql+psycopg://"):
        raise ValueError("Benchmark DATABASE_URL must use postgresql+psycopg://.")
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            return bool(connection.execute(text(
                "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')"
            )).scalar_one())
    finally:
        engine.dispose()


class PgvectorStore:
    """Own one UUID-scoped schema and drop it when the run finishes."""

    def __init__(
        self,
        engine: Engine,
        schema: str,
        table: Table,
        model: str,
        dimension: int,
        index_type: str,
    ):
        self.engine = engine
        self.schema = schema
        self.table = table
        self.model = model
        self.dimension = dimension
        self.index_type = index_type
        self.created_schema = True
        self.closed = False

    @classmethod
    def open(
        cls,
        database_url: str,
        model: str,
        dimension: int,
        allow_schema_create: bool,
    ) -> "PgvectorStore":
        if not allow_schema_create:
            raise PermissionError("Set GONURSE_BENCHMARK_ALLOW_SCHEMA_CREATE=YES to create an isolated schema.")
        if not database_url.startswith("postgresql+psycopg://"):
            raise ValueError("Benchmark DATABASE_URL must use postgresql+psycopg://.")
        if not model or dimension <= 0:
            raise ValueError("A model identifier and positive vector dimension are required.")

        engine = create_engine(database_url, pool_pre_ping=True)
        schema_created = False
        initialized = False
        try:
            with engine.connect() as connection:
                available = connection.execute(text(
                    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')"
                )).scalar_one()
            if not available:
                raise VectorExtensionUnavailable(
                    "The vector extension is not installed; install it explicitly in the dedicated benchmark database."
                )

            from pgvector.sqlalchemy import Vector

            schema = f"rankbench_{uuid4().hex}"
            with engine.begin() as connection:
                connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            schema_created = True

            metadata = MetaData(schema=schema)
            table = Table(
                "embeddings",
                metadata,
                Column("id", String(210), primary_key=True),
                Column("model", String(500), nullable=False),
                Column("dimension", Integer, nullable=False),
                Column("embedding", Vector(dimension), nullable=False),
            )
            from sqlalchemy import Index
            if dimension <= HNSW_MAX_VECTOR_DIMENSION:
                Index(
                    "ix_embeddings_cosine",
                    table.c.embedding,
                    postgresql_using="hnsw",
                    postgresql_ops={"embedding": "vector_cosine_ops"},
                )
                index_type = "hnsw_cosine"
            else:
                Index("ix_embeddings_model_dimension", table.c.model, table.c.dimension)
                index_type = "model_dimension_btree; exact pgvector cosine ordering"
            metadata.create_all(engine, checkfirst=False)
            store = cls(engine, schema, table, model, dimension, index_type)
            initialized = True
            return store
        finally:
            if not initialized:
                if schema_created:
                    with engine.begin() as connection:
                        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
                engine.dispose()

    def insert_vectors(self, vectors: dict[str, list[float]]) -> None:
        for vector in vectors.values():
            if (
                len(vector) != self.dimension
                or any(not math.isfinite(value) for value in vector)
                or not any(value != 0 for value in vector)
            ):
                raise ValueError("Vectors must be finite, non-zero, and match the benchmark schema dimension.")
        if not vectors:
            return
        from sqlalchemy.dialects.postgresql import insert

        statement = insert(self.table).values([
            {
                "id": item_id,
                "model": self.model,
                "dimension": self.dimension,
                "embedding": vector,
            }
            for item_id, vector in vectors.items()
        ])
        statement = statement.on_conflict_do_update(
            index_elements=[self.table.c.id],
            set_={
                "model": statement.excluded.model,
                "dimension": statement.excluded.dimension,
                "embedding": statement.excluded.embedding,
            },
        )
        with self.engine.begin() as connection:
            connection.execute(statement)

    def cosine_scores(self, query_vector: list[float], eligible_ids: list[str]) -> dict[str, float]:
        if (
            len(query_vector) != self.dimension
            or any(not math.isfinite(value) for value in query_vector)
            or not any(value != 0 for value in query_vector)
        ):
            raise ValueError("Query vector must be finite, non-zero, and match the benchmark schema dimension.")
        if not eligible_ids:
            return {}
        distance = self.table.c.embedding.cosine_distance(query_vector)
        with self.engine.connect() as connection:
            rows = connection.execute(
                select(self.table.c.id, distance.label("distance"))
                .where(
                    self.table.c.id.in_(eligible_ids),
                    self.table.c.model == self.model,
                    self.table.c.dimension == self.dimension,
                )
                .order_by(distance)
            ).all()
        scores = {item_id: 1.0 - float(cosine_distance) for item_id, cosine_distance in rows}
        if set(scores) != set(eligible_ids):
            raise RuntimeError("pgvector did not return every eligible benchmark opportunity.")
        return scores

    def close(self) -> None:
        if self.closed:
            return
        try:
            if self.created_schema:
                with self.engine.begin() as connection:
                    connection.execute(text(f'DROP SCHEMA "{self.schema}" CASCADE'))
        finally:
            self.engine.dispose()
            self.closed = True

    def __enter__(self) -> "PgvectorStore":
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.close()
